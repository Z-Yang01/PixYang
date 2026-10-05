// 文件操作编排（迁移接缝 4c/4b 混合）：importImages/importOne/renameImage 的 Rust 直译。
// 复用已移植内核：naming（唯一命名）、image_group（分组/日期围栏/安全文件名）、thumbs（双档缩略图）。
// 已记录改进型分歧：导入时由 Rust 直接生成双档缩略图并回写
// thumbnail_path/thumbnail_small_path/width/height（Electron 版由渲染进程传 base64，仅 thumbnail 列）。

use crate::db::{delete_image_record, PixError};
use crate::err_cn;
use crate::image_group;
use crate::images_query::ImageRow;
use crate::naming;
use crate::thumbs;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

// 镜像 extractExifBatch 的 BATCH=8：EXIF/导入进度每批处理完发射一次
pub const EXIF_BATCH: usize = 8;

/// days-since-epoch → YYYY-MM-DD（Howard Hinnant civil_from_days，免 chrono 依赖）
pub fn ymd_from_days(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

/// 今天 YYYY-MM-DD
pub fn today_ymd() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    ymd_from_days(secs.div_euclid(86400))
}

/// 镜像 moveFileSafe：rename 优先，EXDEV 回退 copy+delete
pub fn move_file_safe(from: &Path, to: &Path) -> Result<(), PixError> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| PixError::Io(format!("建目录失败: {e}")))?;
    }
    match std::fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) => {
            // EXDEV（跨盘）与 Windows ERROR_NOT_SAME_DEVICE(17) 均走 copy+delete
            std::fs::copy(from, to).map_err(|e2| PixError::Io(format!("移动失败: {e}/{e2}")))?;
            std::fs::remove_file(from).map_err(|e| PixError::Io(format!("移动清理失败: {e}")))?;
            Ok(())
        }
    }
}

fn db_path_taken(conn: &Connection, full_path: &str, exclude_id: Option<i64>) -> Option<bool> {
    let row: rusqlite::Result<Option<()>> = match exclude_id {
        Some(id) => conn
            .query_row(
                "SELECT 1 FROM images WHERE filepath = ?1 COLLATE NOCASE AND id != ?2",
                rusqlite::params![full_path, id],
                |_| Ok(()),
            )
            .optional(),
        None => conn
            .query_row(
                "SELECT 1 FROM images WHERE filepath = ?1 COLLATE NOCASE",
                [full_path],
                |_| Ok(()),
            )
            .optional(),
    };
    match row {
        Ok(hit) => Some(hit.is_some()),
        // 查询失败不能静默当「未占用」：那会让 INSERT OR IGNORE 吞掉本次导入。
        // 记日志留档，行为维持原样（当未占用，靠盘上 exists 兜底）
        Err(e) => {
            eprintln!("[导入] 占用查询失败，按未占用处理: {full_path} {e}");
            None
        }
    }
}

fn is_path_taken(conn: &Connection, full_path: &str, exclude_id: Option<i64>) -> bool {
    let taken = db_path_taken(conn, full_path, exclude_id).unwrap_or(false);
    taken || Path::new(full_path).exists()
}

fn get_img_row(conn: &Connection, id: i64) -> Option<ImageRow> {
    crate::images_query::get_image_by_id(conn, id).ok()?
}

fn num_i64(v: Option<&Value>) -> i64 {
    v.and_then(|x| x.as_f64()).map(|f| f as i64).unwrap_or(0)
}

fn str_or_empty(v: Option<&Value>) -> String {
    v.and_then(|x| x.as_str()).unwrap_or("").to_string()
}

/// 镜像 importOne：单张导入编排（日期围栏→安全名→唯一名→复制→NEF 避让/收养→落库→缩略图）
pub fn import_one(
    conn: &Connection,
    root: &Path,
    img: &Value,
    pair: Option<&Value>,
    hidden: bool,
    today: &str,
    thumbs_dir: &Path,
) -> Result<Option<ImageRow>, PixError> {
    let raw_date = str_or_empty(img.get("importDate"));
    let date_str = if raw_date.is_empty() {
        today.to_string()
    } else {
        image_group::effective_import_date(&raw_date, today)
    };
    let sub_dir = image_group::date_dir(&date_str)
        .map(|rel| root.join(rel))
        .unwrap_or_else(|| root.join(today));
    std::fs::create_dir_all(&sub_dir).map_err(|e| PixError::Io(format!("建日期目录失败: {e}")))?;

    let safe_name = match image_group::safe_basename(&str_or_empty(img.get("filename"))) {
        Some(n) => n,
        None => {
            eprintln!(
                "[导入] 文件名无效，跳过: {}",
                str_or_empty(img.get("filepath"))
            );
            return Ok(None);
        }
    };
    let taken: std::collections::HashSet<String> = std::collections::HashSet::new();
    // 唯一名占用判定须「盘 ∪ 库」（镜像 isPathTaken）：DB 有记录而盘上无文件（失效/损坏
    // 记录）时只查盘会撞 filepath UNIQUE——INSERT OR IGNORE 把本次导入静默吞掉，
    // 新文件内容挂进旧记录的旧元数据，且导入计数与列表条数漂移
    let unique_name = naming::generate_unique_filename(&sub_dir, &safe_name, &taken, |p| {
        p.exists() || db_path_taken(conn, &p.to_string_lossy(), None).unwrap_or(false)
    });
    let dest_path = sub_dir.join(&unique_name);
    let src_path = str_or_empty(img.get("filepath"));
    let format_value = {
        let f = str_or_empty(img.get("format"));
        if !f.is_empty() {
            f
        } else {
            naming::extname(&unique_name)
                .trim_start_matches('.')
                .to_lowercase()
        }
    };

    if src_path != dest_path.to_string_lossy() {
        if let Err(e) = std::fs::copy(&src_path, &dest_path) {
            let _ = std::fs::remove_file(&dest_path);
            eprintln!("[导入] 复制失败: {src_path} {e}");
            return Ok(None);
        }
    }

    // 手动导入链（parse_import_files）此前丢弃 size/format → Info 面板永远「未知/0 B」：
    // 调用方带 enrich（camera_sync）优先，缺失时从落盘副本兜底。size 兜底必须在复制
    // 之后读：generate_unique_filename 保证 dest 复制前不存在（审查实锤——放在复制前
    // 读 metadata 恒失败，手动导入 size 恒 0，兜底为死代码）
    let size_value = {
        let v = num_i64(img.get("size"));
        if v > 0 {
            v
        } else {
            std::fs::metadata(&dest_path)
                .map(|m| m.len() as i64)
                .unwrap_or(0)
        }
    };

    // 配对 NEF：filepath ∪ raw_path 双列 NOCASE 查占用者，可见占用派生避让、隐藏记录收养
    let mut raw_dest_path = String::new();
    let mut raw_source_path = String::new();
    if let Some(pair) = pair {
        let pair_filepath = str_or_empty(pair.get("filepath"));
        let pair_filename = str_or_empty(pair.get("filename"));
        let raw_ext = naming::extname(&pair_filename).to_string();
        let mut candidate = format!("{}{}", naming::basename_no_ext(&unique_name), raw_ext);
        let mut collision = 0i64;
        loop {
            let target = sub_dir.join(&candidate);
            let owner: Option<(i64, i64)> = conn
                .query_row(
                    "SELECT id, hidden FROM images WHERE filepath = ?1 COLLATE NOCASE OR raw_path = ?2 COLLATE NOCASE",
                    rusqlite::params![target.to_string_lossy(), target.to_string_lossy()],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .unwrap_or(None);
            match owner {
                Some((owner_id, hidden_flag)) => {
                    if hidden_flag == 1 {
                        delete_image_record(conn, owner_id)?;
                        raw_dest_path = target.to_string_lossy().into_owned();
                        break;
                    }
                }
                None => {
                    if pair_filepath == target.to_string_lossy() || !target.exists() {
                        raw_dest_path = target.to_string_lossy().into_owned();
                        break;
                    }
                }
            }
            collision += 1;
            if collision > 9999 {
                break;
            }
            candidate = format!(
                "{}_{}{}",
                naming::basename_no_ext(&unique_name),
                collision,
                raw_ext
            );
        }
        if raw_dest_path.is_empty() {
            eprintln!("[导入] NEF 同名占用过多，放弃配对导入: {pair_filepath}");
        }
        if !raw_dest_path.is_empty() {
            if pair_filepath != raw_dest_path {
                if let Err(e) = std::fs::copy(&pair_filepath, &raw_dest_path) {
                    // 复制失败：raw_path/original_raw_path 均不落库，并清理半截目标文件
                    let _ = std::fs::remove_file(&raw_dest_path);
                    eprintln!("[导入] NEF 复制失败: {pair_filepath} {e}");
                    raw_dest_path = String::new();
                }
            }
            if !raw_dest_path.is_empty() {
                raw_source_path = pair_filepath;
            }
        }
    }

    let thumbnail_value = if hidden {
        String::new()
    } else {
        str_or_empty(img.get("thumbnail"))
    };
    conn.execute(
        "INSERT OR IGNORE INTO images (filename, filepath, original_path, raw_path, original_raw_path, hidden, orientation, rotation, flip_h, flip_v, import_date, taken_at, size, width, height, format, thumbnail)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, 0, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![
            unique_name,
            dest_path.to_string_lossy(),
            src_path,
            raw_dest_path,
            raw_source_path,
            if hidden { 1 } else { 0 },
            num_i64(img.get("orientation")).max(1),
            date_str,
            str_or_empty(img.get("takenAt")),
            size_value,
            num_i64(img.get("width")),
            num_i64(img.get("height")),
            format_value,
            thumbnail_value,
        ],
    )
    .map_err(PixError::Db)?;

    let row = conn
        .query_row(
            "SELECT * FROM images WHERE filepath = ?1",
            [&dest_path.to_string_lossy()],
            crate::images_query::row_from,
        )
        .optional()
        .map_err(PixError::Db)?;

    // 改进型分歧：导入即由 Rust 生成双档缩略图并回写路径/尺寸（失败不致命，列保持空）
    if let (Some(row), false) = (&row, hidden) {
        if let Ok((small, medium, w, h)) = thumbs::generate_tiers(&dest_path) {
            std::fs::create_dir_all(thumbs_dir).ok();
            let big_path = thumbs_dir.join(format!("{}.jpg", row.id));
            let small_path = thumbs_dir.join(format!("{}_s.jpg", row.id));
            let w_ok = std::fs::write(&big_path, medium).is_ok();
            let s_ok = std::fs::write(&small_path, small).is_ok();
            if w_ok && s_ok {
                conn.execute(
                    "UPDATE images SET thumbnail_path = ?1, thumbnail_small_path = ?2, width = ?3, height = ?4 WHERE id = ?5",
                    rusqlite::params![big_path.to_string_lossy(), small_path.to_string_lossy(), w, h, row.id],
                )
                .map_err(PixError::Db)?;
                return conn
                    .query_row(
                        "SELECT * FROM images WHERE filepath = ?1",
                        [&dest_path.to_string_lossy()],
                        crate::images_query::row_from,
                    )
                    .optional()
                    .map_err(PixError::Db);
            }
        }
    }
    Ok(row)
}

/// 镜像 importImages：分组编排（jpg 组可见导入，nef-only 组隐藏导入）。
/// 先整批完成 EXIF 日期富化（镜像 extractExifBatch，按批发射 import-progress），再逐组落库
pub fn import_images(
    conn: &Connection,
    files: &Value,
    date_override: Option<&str>,
    today: &str,
    thumbs_dir: &Path,
    app: Option<&tauri::AppHandle>,
    default_root: &Path,
) -> Result<Vec<ImageRow>, PixError> {
    let mut imported = Vec::new();
    let groups = image_group::group_import_files(&parse_import_files(files));
    // 库内 images_root 为空（全新安装/未设置过）时的兜底必须是启动解析的托管目录，
    // 不能是进程 CWD——CWD 下导入的文件在托管树与 asset scope 之外且存相对路径
    let root = crate::db::images_root(conn, default_root)?;
    let total = groups.len();
    let mut done = 0usize;
    let mut prepared: Vec<(Option<Value>, Option<Value>)> = Vec::with_capacity(total);
    for (_, group) in &groups {
        let jpg = group.jpg.as_ref().map(|j| {
            let mut v = import_file_to_value(j);
            apply_date_override(&mut v, date_override);
            v
        });
        let nef = group.nef.as_ref().map(|n| {
            let mut v = import_file_to_value(n);
            apply_date_override(&mut v, date_override);
            v
        });
        prepared.push((jpg, nef));
        done += 1;
        if let Some(app) = app {
            if done.is_multiple_of(EXIF_BATCH) || done == total {
                crate::progress::emit_progress(
                    app,
                    crate::progress::IMPORT_PROGRESS,
                    json!({ "done": done, "total": total, "task": "import" }),
                );
            }
        }
    }
    for (jpg, nef) in &prepared {
        if let Some(jpg) = jpg {
            if let Some(row) = import_one(conn, &root, jpg, nef.as_ref(), false, today, thumbs_dir)?
            {
                imported.push(row);
            }
        } else if let Some(nef) = nef {
            if let Some(row) = import_one(conn, &root, nef, None, true, today, thumbs_dir)? {
                imported.push(row);
            }
        }
    }
    Ok(imported)
}

fn parse_import_files(files: &Value) -> Vec<image_group::ImportFile> {
    files
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|f| image_group::ImportFile {
                    filename: str_or_empty(f.get("filename")),
                    filepath: str_or_empty(f.get("filepath")),
                    raw_source: f
                        .get("raw_source")
                        .and_then(|x| x.as_str())
                        .map(String::from),
                    raw_filename: f
                        .get("raw_filename")
                        .and_then(|x| x.as_str())
                        .map(String::from),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn import_file_to_value(f: &image_group::ImportFile) -> Value {
    json!({ "filename": f.filename, "filepath": f.filepath })
}

/// 镜像 db:import-images 的日期链：dateOverride > 文件自带 importDate > EXIF 拍摄日期 > 文件 mtime > 今天
fn apply_date_override(img: &mut Value, date_override: Option<&str>) {
    if let Some(d) = date_override.filter(|s| !s.is_empty()) {
        img["importDate"] = json!(d);
        return;
    }
    let has_date = img
        .get("importDate")
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    if has_date {
        return;
    }
    let src = img
        .get("filepath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut dated = false;
    if let Ok(fields) = crate::exif_read::exif_fields(Path::new(&src)) {
        if let Some(taken) = fields.get("taken_at").and_then(|v| v.as_str()) {
            if taken.len() >= 10 {
                img["importDate"] = json!(taken[..10].to_string());
                // 拍摄时间同步落 taken_at 列（import_one 直取 img["takenAt"]，Info 面板
                // 「拍摄时间」行消费）：相机导入 enrich 一路携带该值，手动导入此前只喂
                // importDate、列恒空，同一张图两种导入途径信息面不一致
                img["takenAt"] = json!(taken);
                dated = true;
            }
        }
    }
    if !dated {
        // 镜像 readExifInfo 的 mtime 回退（stat 失败时保持留空 → import_one 落今天）
        if std::fs::metadata(&src).is_ok() {
            img["importDate"] = json!(crate::camera::mtime_ymd(Path::new(&src)));
        }
    }
}

/// 镜像 renameImage：校验→NEF 跟随→磁盘改名（失败回滚）→DB 更新（失败双回滚）
pub fn rename_image(conn: &Connection, id: i64, new_filename: &str) -> Result<Value, PixError> {
    let Some(img) = get_img_row(conn, id) else {
        return Ok(json!(false));
    };
    let invalid = new_filename.trim().is_empty()
        || new_filename
            != Path::new(new_filename)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default()
        || new_filename.chars().any(|c| "\\/:*?\"<>|".contains(c))
        || new_filename == "."
        || new_filename == "..";
    if invalid {
        return Ok(json!({ "error": "文件名含有非法字符" }));
    }
    if naming::extname(new_filename) != naming::extname(&img.filename) {
        return Ok(json!({ "error": "不允许修改扩展名" }));
    }

    let old_path = PathBuf::from(&img.filepath);
    let new_path = old_path.with_file_name(new_filename);
    if old_path != new_path && is_path_taken(conn, &new_path.to_string_lossy(), Some(id)) {
        return Ok(json!({ "error": "同名文件已存在" }));
    }

    let mut new_raw_path = img.raw_path.clone().unwrap_or_default();
    if !img.raw_path.as_deref().unwrap_or("").is_empty() {
        let raw_ext = naming::extname(img.raw_path.as_deref().unwrap_or(""));
        let new_raw_name = format!("{}{}", naming::basename_no_ext(new_filename), raw_ext);
        let candidate_raw =
            PathBuf::from(img.raw_path.as_deref().unwrap_or("")).with_file_name(new_raw_name);
        if candidate_raw.exists()
            && candidate_raw.to_string_lossy() != img.raw_path.as_deref().unwrap_or("")
        {
            return Ok(json!({ "error": "同名文件已存在" }));
        }
        new_raw_path = candidate_raw.to_string_lossy().into_owned();
    }

    let rename = |from: &Path, to: &Path| -> Result<(), PixError> {
        if from != to {
            std::fs::rename(from, to).map_err(|e| PixError::Io(format!("重命名失败: {e}")))?;
        }
        Ok(())
    };

    let result = (|| -> Result<(), PixError> {
        rename(&old_path, &new_path)?;
        if !img.raw_path.as_deref().unwrap_or("").is_empty()
            && new_raw_path != img.raw_path.as_deref().unwrap_or("")
        {
            if let Err(raw_err) = rename(
                Path::new(img.raw_path.as_deref().unwrap_or("")),
                Path::new(&new_raw_path),
            ) {
                // NEF 跟随失败：把已改名的 JPG 改回去，绝不留下 DB 指向不存在路径的 broken 记录
                let _ = rename(&new_path, &old_path);
                return Err(raw_err);
            }
        }
        if let Err(db_err) = conn.execute(
            "UPDATE images SET filename = ?1, filepath = ?2, raw_path = ?3 WHERE id = ?4",
            rusqlite::params![new_filename, new_path.to_string_lossy(), new_raw_path, id],
        ) {
            // 磁盘改名完成、DB 写入失败：两个文件一起改回原位
            if !img.raw_path.as_deref().unwrap_or("").is_empty()
                && new_raw_path != img.raw_path.as_deref().unwrap_or("")
            {
                let _ = rename(
                    Path::new(&new_raw_path),
                    Path::new(img.raw_path.as_deref().unwrap_or("")),
                );
            }
            let _ = rename(&new_path, &old_path);
            return Err(PixError::Db(db_err));
        }
        Ok(())
    })();

    match result {
        Ok(()) => Ok(
            json!({ "success": true, "newFilename": new_filename, "newPath": new_path.to_string_lossy() }),
        ),
        Err(e) => Ok(json!({ "error": format!("重命名失败：{}", err_cn::text(&e)) })),
    }
}

// 启动清扫烘焙残留：镜像 electron/database.js cleanupStaleBakeTemps。
// 按可见记录目录精确匹配「存在主名相同的图片」才删，且候选本身是被管理的图片路径时跳过——
// 绝不误删用户自己命名带 -temp 的文件。覆盖 -temp.(jpg|png|webp)[.part|.icc] 与 主名.ext.bake-tmp 双形态。
pub fn cleanup_stale_bake_temps(conn: &Connection) -> usize {
    let load = |sql: &str| -> rusqlite::Result<Vec<String>> {
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect()
    };
    let (all, visible) = match (
        load("SELECT filepath FROM images"),
        load("SELECT filepath FROM images WHERE hidden = 0"),
    ) {
        (Ok(a), Ok(v)) => (a, v),
        (Err(e), _) | (_, Err(e)) => {
            eprintln!("[编辑清理] -temp 清扫失败: {e}");
            return 0;
        }
    };
    let mut managed: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut by_dir: std::collections::HashMap<String, std::collections::HashSet<String>> =
        std::collections::HashMap::new();
    for p in &all {
        managed.insert(p.to_lowercase());
    }
    for p in &visible {
        if let Some(dir) = Path::new(p).parent() {
            by_dir
                .entry(dir.to_string_lossy().into_owned())
                .or_default()
                .insert(naming::basename_no_ext(&image_group::basename(p)).to_lowercase());
        }
    }
    let mut removed = 0usize;
    for (dir, bases) in &by_dir {
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(base_key) = stale_bake_temp_base(&name) else {
                continue;
            };
            if !bases.contains(&base_key) {
                continue;
            }
            let full = Path::new(dir).join(&name);
            if managed.contains(&full.to_string_lossy().to_lowercase()) {
                continue;
            }
            if std::fs::remove_file(&full).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

// 匹配清理候选并提取主名（小写）：base-temp.(jpe?g|png|webp)[.part|.icc] 或 base.(…).bake-tmp
fn stale_bake_temp_base(name: &str) -> Option<String> {
    let lower = name.to_lowercase();
    let stripped = lower
        .strip_suffix(".part")
        .or_else(|| lower.strip_suffix(".icc"))
        .unwrap_or(&lower);
    for ext in [".jpeg", ".jpg", ".png", ".webp"] {
        if let Some(head) = stripped.strip_suffix(ext) {
            if let Some(base) = head.strip_suffix("-temp") {
                if !base.is_empty() {
                    return Some(base.to_string());
                }
            }
        }
    }
    if let Some(head) = lower.strip_suffix(".bake-tmp") {
        for ext in [
            ".jpeg", ".jpg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".nef",
        ] {
            if let Some(base) = head.strip_suffix(ext) {
                if !base.is_empty() {
                    return Some(base.to_string());
                }
            }
        }
    }
    None
}

#[derive(Debug)]
pub struct ExportOutcome {
    pub copied: u32,
    pub nef_copied: u32,
    pub failed: Vec<String>,
}

// EXCL 独占复制 + _1.._9999 避让，直译 electron/main.js exportFiles 的 COPYFILE_EXCL 循环
fn copy_exclusive(src: &Path, dest: &Path) -> Result<(), std::io::Error> {
    let ext = dest.extension().and_then(|e| e.to_str()).unwrap_or("");
    let ext_dot = if ext.is_empty() {
        String::new()
    } else {
        format!(".{ext}")
    };
    let stem = dest.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let parent = dest.parent().map(Path::to_path_buf).unwrap_or_default();
    let mut final_dest = dest.to_path_buf();
    let mut n = 1u32;
    loop {
        let r = std::fs::File::open(src).and_then(|mut input| {
            let mut out = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&final_dest)?;
            std::io::copy(&mut input, &mut out).map(|_| ())
        });
        match r {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if n > 9999 {
                    return Err(std::io::Error::other("目标目录同名文件过多，避让失败"));
                }
                final_dest = parent.join(format!("{stem}_{n}{ext_dot}"));
                n += 1;
            }
            Err(e) => return Err(e),
        }
    }
}

// ── 批量导出选项（功能 13a）：None/缺省 = 原样复制（历史行为）；convert = 走渲染管线转格式/尺寸 ──

/// 转换参数：format 三选一；quality 1..=100（PNG 无损忽略）；max_edge 0 = 保持原尺寸，>0 = 长边上限（只缩不放大）
#[derive(Debug, Clone, PartialEq)]
pub struct ConvertSpec {
    pub format: String,
    pub quality: i64,
    pub max_edge: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum BatchExportOptions {
    Copy,
    Convert(ConvertSpec),
}

impl BatchExportOptions {
    /// 解析前端传入的 options：None/null/缺 mode = Copy；mode="copy" = Copy；
    /// mode="convert" 时 format 必须 ∈ {jpeg,png,webp}（非法整体报错，不静默降级——
    /// 用户明确要求转格式，静默复制会产出与所选选项不符的文件）；
    /// quality 夹取 1..=100（非有限数值/缺省回退 92，镜像执行器 clamp_int 口径）；
    /// maxEdge 仅接受有限正数（否则视为 0 = 原尺寸，镜像 edit_export 过滤口径）。
    pub fn from_json(v: Option<&Value>) -> Result<Self, String> {
        let Some(v) = v else {
            return Ok(BatchExportOptions::Copy);
        };
        if v.is_null() {
            return Ok(BatchExportOptions::Copy);
        }
        let Some(obj) = v.as_object() else {
            return Err("导出选项格式非法".into());
        };
        let mode = obj.get("mode").and_then(|m| m.as_str()).unwrap_or("copy");
        match mode {
            "copy" => Ok(BatchExportOptions::Copy),
            "convert" => {
                let format = obj.get("format").and_then(|f| f.as_str()).unwrap_or("");
                if !matches!(format, "jpeg" | "png" | "webp") {
                    return Err(format!("不支持的导出格式: {format}"));
                }
                let quality = obj
                    .get("quality")
                    .and_then(|q| q.as_f64())
                    .filter(|q| q.is_finite())
                    .map(|q| q.round().clamp(1.0, 100.0) as i64)
                    .unwrap_or(92);
                let max_edge = obj
                    .get("maxEdge")
                    .and_then(|m| m.as_f64())
                    .filter(|m| m.is_finite() && *m > 0.0)
                    .map(|m| m.round() as u32)
                    .unwrap_or(0);
                Ok(BatchExportOptions::Convert(ConvertSpec {
                    format: format.into(),
                    quality,
                    max_edge,
                }))
            }
            other => Err(format!("未知导出模式: {other}")),
        }
    }

    /// 转换产物的扩展名（jpeg 产物统一 .jpg）
    pub fn ext(&self) -> &'static str {
        match self {
            BatchExportOptions::Copy => "",
            BatchExportOptions::Convert(s) => match s.format.as_str() {
                "png" => ".png",
                "webp" => ".webp",
                _ => ".jpg",
            },
        }
    }
}

/// 转换模式落盘：空 spec（仅 encode stage）走执行器管线（解码→fit-inside 缩放→编码→
/// part+fsync+rename 原子落盘→EXIF 回接），复用单图编辑导出的同一条管线。
/// 目标名 stem+新扩展名，重名 _1.._9999 避让（先探名后渲染，与 edit_export 同口径）。
fn convert_exclusive(
    src: &Path,
    dest_root: &Path,
    stem: &str,
    opts: &BatchExportOptions,
) -> Result<(), String> {
    let ext = opts.ext();
    let ConvertSpec {
        format,
        quality,
        max_edge,
    } = match opts {
        BatchExportOptions::Convert(s) => s,
        BatchExportOptions::Copy => return Err("转换模式缺少转换参数".into()),
    };
    let mut dest = dest_root.join(format!("{stem}{ext}"));
    let mut n = 1u32;
    while dest.exists() {
        if n > 9999 {
            return Err("目标目录同名文件过多，避让失败".into());
        }
        dest = dest_root.join(format!("{stem}_{n}{ext}"));
        n += 1;
    }
    let mut encode_params = json!({ "format": format, "quality": quality });
    if *max_edge > 0 {
        encode_params["resize"] = json!({ "width": max_edge, "height": max_edge });
    }
    let spec = json!({
        "specVersion": 1,
        "stages": [{ "kind": "encode", "params": encode_params }],
    });
    crate::executor::render_spec_to_file(&spec, src, &dest)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// 导出内核：JPG + 配对 NEF，单文件失败不废整批；空文件名跳过；源不存在静默跳过。
// Copy 模式 = 独占复制原图；Convert 模式 = 主图走管线转格式/尺寸，配对 NEF 永远原样复制（RAW 不可转码）。
pub fn export_image_files_with(
    images: &[ImageRow],
    dest_dir: &str,
    options: &BatchExportOptions,
) -> Result<ExportOutcome, String> {
    if dest_dir.is_empty() {
        return Err("导出目标目录无效".into());
    }
    let dest_root = Path::new(dest_dir);
    let mut outcome = ExportOutcome {
        copied: 0,
        nef_copied: 0,
        failed: Vec::new(),
    };
    for img in images {
        let out_name = Path::new(img.filename.as_str())
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if out_name.is_empty() {
            continue;
        }
        let mut jpg_failed = false;
        let src = Path::new(&img.filepath);
        if src.exists() {
            let r = match options {
                BatchExportOptions::Copy => {
                    copy_exclusive(src, &dest_root.join(out_name)).map_err(|e| e.to_string())
                }
                BatchExportOptions::Convert(_) => {
                    let stem = Path::new(out_name)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("");
                    if stem.is_empty() {
                        Err("文件名缺少主名，无法确定导出扩展名".into())
                    } else {
                        convert_exclusive(src, dest_root, stem, options)
                    }
                }
            };
            match r {
                Ok(()) => outcome.copied += 1,
                Err(e) => {
                    jpg_failed = true;
                    outcome.failed.push(format!("{out_name}: {e}"));
                }
            }
        }
        if jpg_failed {
            continue;
        }
        if let Some(raw) = img.raw_path.as_deref() {
            let raw_path = Path::new(raw);
            if raw_path.exists() {
                let raw_ext = raw_path.extension().and_then(|e| e.to_str()).unwrap_or("");
                let raw_ext_dot = if raw_ext.is_empty() {
                    String::new()
                } else {
                    format!(".{raw_ext}")
                };
                let stem = Path::new(out_name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                match copy_exclusive(raw_path, &dest_root.join(format!("{stem}{raw_ext_dot}"))) {
                    Ok(()) => outcome.nef_copied += 1,
                    Err(e) => outcome.failed.push(format!("{out_name}: {e}")),
                }
            }
        }
    }
    Ok(outcome)
}

/// 原样复制（历史入口）：options 缺省即 Copy
pub fn export_image_files(images: &[ImageRow], dest_dir: &str) -> Result<ExportOutcome, String> {
    export_image_files_with(images, dest_dir, &BatchExportOptions::Copy)
}

#[cfg(test)]
mod tests {

    #[test]
    fn 导入_空images_root回退用传入default而非cwd_审查H1() {
        let dir = std::env::temp_dir().join(format!("pixyang_h1_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open(":memory:").unwrap();
        conn.execute_batch(
            "CREATE TABLE images (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL,
             filepath TEXT NOT NULL UNIQUE, original_path TEXT DEFAULT '', raw_path TEXT DEFAULT '',
             original_raw_path TEXT DEFAULT '', hidden INTEGER DEFAULT 0, orientation INTEGER DEFAULT 1,
             rotation INTEGER DEFAULT 0, flip_h INTEGER DEFAULT 0, flip_v INTEGER DEFAULT 0,
             import_date TEXT, taken_at TEXT, size INTEGER DEFAULT 0, width INTEGER, height INTEGER,
             format TEXT DEFAULT '', thumbnail TEXT, thumbnail_path TEXT, thumbnail_small_path TEXT,
             thumbnail_edit_path TEXT, rating INTEGER DEFAULT 0, favorite INTEGER DEFAULT 0,
             notes TEXT DEFAULT '', created_at DATETIME, updated_at DATETIME, duration INTEGER);
             CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);",
        )
        .unwrap();
        // images_root = ''（全新安装 seed 值）：触发 CWD 回退路径
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('images_root', '')",
            [],
        )
        .unwrap();
        // 待导入源文件
        let src_dir = dir.join("src");
        std::fs::create_dir_all(&src_dir).unwrap();
        let img = image::DynamicImage::from(image::RgbaImage::from_fn(8, 8, |_, _| {
            image::Rgba([90, 90, 90, 255])
        }));
        let src = src_dir.join("h1.jpg");
        img.save(&src).unwrap();

        // default_root 指向独立目录（非 CWD）
        let default_root = dir.join("managed_root");
        std::fs::create_dir_all(&default_root).unwrap();
        let files = serde_json::json!([
            { "filename": "h1.jpg", "filepath": src.to_string_lossy() }
        ]);
        let today = crate::file_ops::today_ymd();
        let rows = super::import_images(
            &conn,
            &files,
            None,
            &today,
            &dir.join("thumbs"),
            None,
            &default_root,
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
        // 落库路径必须落在 default_root 下（非 CWD 相对路径）
        let fp = rows[0].filepath.clone();
        assert!(
            fp.starts_with(default_root.to_string_lossy().as_ref()),
            "导入应落 default_root 下: {fp}"
        );
        assert!(Path::new(&fp).is_absolute(), "应为绝对路径: {fp}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 导入_无size输入_落库size为落盘副本字节数() {
        // 审查实锤回归锁：手动导入链（parse_import_files）不带 size，兜底读落盘副本——
        // 若兜底放在复制之前（37ff656 原样），generate_unique_filename 保证 dest 复制前
        // 不存在，metadata 恒失败 → size 恒 0（Info 面板永远 0 B）
        let dir = std::env::temp_dir().join(format!("pixyang_size_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open(":memory:").unwrap();
        conn.execute_batch(
            "CREATE TABLE images (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL,
             filepath TEXT NOT NULL UNIQUE, original_path TEXT DEFAULT '', raw_path TEXT DEFAULT '',
             original_raw_path TEXT DEFAULT '', hidden INTEGER DEFAULT 0, orientation INTEGER DEFAULT 1,
             rotation INTEGER DEFAULT 0, flip_h INTEGER DEFAULT 0, flip_v INTEGER DEFAULT 0,
             import_date TEXT, taken_at TEXT, size INTEGER DEFAULT 0, width INTEGER, height INTEGER,
             format TEXT DEFAULT '', thumbnail TEXT, thumbnail_path TEXT, thumbnail_small_path TEXT,
             thumbnail_edit_path TEXT, rating INTEGER DEFAULT 0, favorite INTEGER DEFAULT 0,
             notes TEXT DEFAULT '', created_at DATETIME, updated_at DATETIME, duration INTEGER);
             CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);",
        )
        .unwrap();
        let src_dir = dir.join("src");
        std::fs::create_dir_all(&src_dir).unwrap();
        let img = DynamicImage::from(RgbaImage::from_fn(8, 8, |_, _| {
            image::Rgba([90, 90, 90, 255])
        }));
        let src = src_dir.join("sz.jpg");
        img.save(&src).unwrap();
        let src_len = std::fs::metadata(&src).unwrap().len();
        assert!(src_len > 0);

        let default_root = dir.join("managed_root");
        std::fs::create_dir_all(&default_root).unwrap();
        // 显式不带 size/format 键：镜像 parse_import_files 的真实输入形状
        let files = serde_json::json!([
            { "filename": "sz.jpg", "filepath": src.to_string_lossy() }
        ]);
        let today = crate::file_ops::today_ymd();
        let rows = super::import_images(
            &conn,
            &files,
            None,
            &today,
            &dir.join("thumbs"),
            None,
            &default_root,
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].size,
            Some(src_len as i64),
            "无 size 输入应从落盘副本兜底实际字节数"
        );
        assert!(rows[0].size.unwrap_or(0) > 0);
        assert_eq!(rows[0].format.as_deref(), Some("jpg"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    use super::*;
    use image::{DynamicImage, RgbaImage};

    fn mem_db() -> Connection {
        crate::images_query::tests::mem_db()
    }

    fn make_jpeg(dir: &Path, name: &str, w: u32, h: u32) -> PathBuf {
        let img = DynamicImage::from(RgbaImage::from_fn(w, h, |x, y| {
            image::Rgba([(x * 7 % 256) as u8, (y * 11 % 256) as u8, 60, 255])
        }));
        let p = dir.join(name);
        img.save(&p).unwrap();
        p
    }

    fn export_row(filename: &str, filepath: &Path, raw_path: Option<&Path>) -> ImageRow {
        ImageRow {
            id: 1,
            filename: filename.into(),
            filepath: filepath.to_string_lossy().into(),
            original_path: None,
            raw_path: raw_path.map(|p| p.to_string_lossy().into()),
            original_raw_path: None,
            hidden: None,
            orientation: None,
            rotation: None,
            flip_h: None,
            flip_v: None,
            import_date: "2026-09-21".into(),
            taken_at: None,
            size: None,
            width: None,
            height: None,
            format: None,
            thumbnail: None,
            thumbnail_path: None,
            thumbnail_small_path: None,
            rating: None,
            favorite: None,
            notes: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn 导出_复制原图与配对NEF并计数() {
        let dir = std::env::temp_dir().join("pixyang_export_basic");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let jpg = make_jpeg(&dir.join("src"), "a.jpg", 32, 20);
        let nef = dir.join("src").join("a.nef");
        std::fs::write(&nef, b"NEFBYTES").unwrap();
        let jpg_b = make_jpeg(&dir.join("src"), "b.jpg", 24, 24);
        let dest = dir.join("out");
        std::fs::create_dir_all(&dest).unwrap();
        let rows = vec![
            export_row("a.jpg", &jpg, Some(&nef)),
            export_row("b.jpg", &jpg_b, None),
        ];
        let o = export_image_files(&rows, dest.to_str().unwrap()).unwrap();
        assert_eq!(o.copied, 2);
        assert_eq!(o.nef_copied, 1);
        assert!(o.failed.is_empty());
        assert!(dest.join("a.jpg").exists());
        assert!(dest.join("a.nef").exists());
        assert!(dest.join("b.jpg").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 导出_重名避让_1后缀() {
        let dir = std::env::temp_dir().join("pixyang_export_dup");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let jpg = make_jpeg(&dir.join("src"), "dup.jpg", 32, 20);
        let dest = dir.join("out");
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(dest.join("dup.jpg"), b"EXISTING").unwrap();
        let rows = vec![export_row("dup.jpg", &jpg, None)];
        let o = export_image_files(&rows, dest.to_str().unwrap()).unwrap();
        assert_eq!(o.copied, 1);
        assert!(o.failed.is_empty());
        assert_eq!(std::fs::read(dest.join("dup.jpg")).unwrap(), b"EXISTING");
        assert!(dest.join("dup_1.jpg").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 导出_单文件失败不废整批_空文件名跳过() {
        let dir = std::env::temp_dir().join("pixyang_export_fail");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let jpg = make_jpeg(&dir.join("src"), "ok.jpg", 32, 20);
        let dest = dir.join("out");
        std::fs::create_dir_all(&dest).unwrap();
        let rows = vec![
            export_row("bad.jpg", &dir.join("src"), None),
            export_row("", &jpg, None),
            export_row("ok.jpg", &jpg, None),
        ];
        let o = export_image_files(&rows, dest.to_str().unwrap()).unwrap();
        assert_eq!(o.copied, 1);
        assert_eq!(o.nef_copied, 0);
        assert_eq!(o.failed.len(), 1);
        assert!(o.failed[0].starts_with("bad.jpg:"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 导出_目标目录无效_整体报错() {
        let dir = std::env::temp_dir().join("pixyang_export_invalid");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let jpg = make_jpeg(&dir, "x.jpg", 16, 16);
        let rows = vec![export_row("x.jpg", &jpg, None)];
        let err = export_image_files(&rows, "").unwrap_err();
        assert_eq!(err, "导出目标目录无效");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── 功能 13a 回归锁：批量导出选项解析（None 回退原样复制 / 合法值 / 非法值） ──

    #[test]
    fn 导出选项_none_null_缺mode回退原样复制() {
        assert_eq!(
            BatchExportOptions::from_json(None).unwrap(),
            BatchExportOptions::Copy
        );
        assert_eq!(
            BatchExportOptions::from_json(Some(&Value::Null)).unwrap(),
            BatchExportOptions::Copy
        );
        assert_eq!(
            BatchExportOptions::from_json(Some(&json!({}))).unwrap(),
            BatchExportOptions::Copy
        );
        assert_eq!(
            BatchExportOptions::from_json(Some(&json!({ "mode": "copy" }))).unwrap(),
            BatchExportOptions::Copy
        );
    }

    #[test]
    fn 导出选项_转换合法解析_质量夹取_长边过滤() {
        let o = BatchExportOptions::from_json(Some(&json!({
            "mode": "convert", "format": "webp", "quality": 250, "maxEdge": 1280
        })))
        .unwrap();
        assert_eq!(
            o,
            BatchExportOptions::Convert(ConvertSpec {
                format: "webp".into(),
                quality: 100,
                max_edge: 1280
            })
        );
        // quality 0 → 夹到 1；quality 缺省 → 92；小数四舍五入
        let q = BatchExportOptions::from_json(Some(&json!({
            "mode": "convert", "format": "jpeg", "quality": 0
        })))
        .unwrap();
        assert_eq!(
            q,
            BatchExportOptions::Convert(ConvertSpec {
                format: "jpeg".into(),
                quality: 1,
                max_edge: 0
            })
        );
        let d = BatchExportOptions::from_json(Some(&json!({
            "mode": "convert", "format": "png"
        })))
        .unwrap();
        assert_eq!(
            d,
            BatchExportOptions::Convert(ConvertSpec {
                format: "png".into(),
                quality: 92,
                max_edge: 0
            })
        );
        // maxEdge 非法（负数/0/非有限数值/字符串）→ 0 = 原尺寸；正小数四舍五入
        for bad in [-5, 0] {
            let m = BatchExportOptions::from_json(Some(&json!({
                "mode": "convert", "format": "jpeg", "maxEdge": bad
            })))
            .unwrap();
            assert_eq!(
                m,
                BatchExportOptions::Convert(ConvertSpec {
                    format: "jpeg".into(),
                    quality: 92,
                    max_edge: 0
                }),
                "maxEdge={bad} 应视为原尺寸"
            );
        }
        let m = BatchExportOptions::from_json(Some(&json!({
            "mode": "convert", "format": "jpeg", "maxEdge": 1279.6
        })))
        .unwrap();
        assert_eq!(
            m,
            BatchExportOptions::Convert(ConvertSpec {
                format: "jpeg".into(),
                quality: 92,
                max_edge: 1280
            })
        );
        assert_eq!(o.ext(), ".webp");
        assert_eq!(d.ext(), ".png");
        assert_eq!(q.ext(), ".jpg");
        assert_eq!(BatchExportOptions::Copy.ext(), "");
    }

    #[test]
    fn 导出选项_非法格式与未知模式整体报错_非对象报错() {
        for bad_fmt in ["gif", "", "JPEG", "avif"] {
            let err = BatchExportOptions::from_json(Some(&json!({
                "mode": "convert", "format": bad_fmt
            })))
            .unwrap_err();
            assert!(
                err.contains("不支持的导出格式"),
                "format={bad_fmt} 应报不支持"
            );
        }
        assert_eq!(
            BatchExportOptions::from_json(Some(&json!({ "mode": "turbo" }))).unwrap_err(),
            "未知导出模式: turbo"
        );
        assert_eq!(
            BatchExportOptions::from_json(Some(&json!("copy"))).unwrap_err(),
            "导出选项格式非法"
        );
    }

    #[test]
    fn 导出_转换模式_jpeg转webp带长边只缩不放大() {
        let dir = std::env::temp_dir().join("pixyang_export_conv_webp");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let jpg = make_jpeg(&dir.join("src"), "a.jpg", 64, 40);
        let dest = dir.join("out");
        std::fs::create_dir_all(&dest).unwrap();
        let opts = BatchExportOptions::from_json(Some(&json!({
            "mode": "convert", "format": "webp", "quality": 90, "maxEdge": 20
        })))
        .unwrap();
        let rows = vec![export_row("a.jpg", &jpg, None)];
        let o = export_image_files_with(&rows, dest.to_str().unwrap(), &opts).unwrap();
        assert_eq!(o.copied, 1);
        assert!(o.failed.is_empty());
        assert!(!dest.join("a.jpg").exists(), "转换模式不应复制原格式文件");
        let out = dest.join("a.webp");
        assert!(out.exists());
        let (w, h) = image::ImageReader::open(&out)
            .unwrap()
            .into_dimensions()
            .unwrap();
        assert_eq!(
            (w, h),
            (20, 13),
            "长边 20：64x40 fit-inside 缩放（40*0.3125=12.5 四舍五入为 13）"
        );
        // 原尺寸（maxEdge=0）不放大：小图导出保持原尺寸
        let opts_full = BatchExportOptions::from_json(Some(&json!({
            "mode": "convert", "format": "webp", "maxEdge": 0
        })))
        .unwrap();
        let dest2 = dir.join("out2");
        std::fs::create_dir_all(&dest2).unwrap();
        let o2 = export_image_files_with(&rows, dest2.to_str().unwrap(), &opts_full).unwrap();
        assert_eq!(o2.copied, 1);
        let (w2, h2) = image::ImageReader::open(dest2.join("a.webp"))
            .unwrap()
            .into_dimensions()
            .unwrap();
        assert_eq!((w2, h2), (64, 40), "maxEdge=0 应保持原尺寸且不放大");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 导出_转换模式_jpeg转png原尺寸_重名避让_1后缀() {
        let dir = std::env::temp_dir().join("pixyang_export_conv_png");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let jpg = make_jpeg(&dir.join("src"), "dup.jpg", 32, 20);
        let dest = dir.join("out");
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(dest.join("dup.png"), b"EXISTING").unwrap();
        let opts = BatchExportOptions::from_json(Some(&json!({
            "mode": "convert", "format": "png"
        })))
        .unwrap();
        let rows = vec![export_row("dup.jpg", &jpg, None)];
        let o = export_image_files_with(&rows, dest.to_str().unwrap(), &opts).unwrap();
        assert_eq!(o.copied, 1);
        assert!(o.failed.is_empty());
        assert_eq!(std::fs::read(dest.join("dup.png")).unwrap(), b"EXISTING");
        let out = dest.join("dup_1.png");
        assert!(out.exists());
        let (w, h) = image::ImageReader::open(&out)
            .unwrap()
            .into_dimensions()
            .unwrap();
        assert_eq!((w, h), (32, 20), "maxEdge 缺省 0 应保持原尺寸");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 导出_转换模式_单文件失败不废整批_NEF仍原样配对复制() {
        let dir = std::env::temp_dir().join("pixyang_export_conv_fail");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let bad = dir.join("src").join("bad.jpg");
        std::fs::write(&bad, b"NOTANIMAGE").unwrap();
        let good = make_jpeg(&dir.join("src"), "good.jpg", 24, 24);
        let nef = dir.join("src").join("good.nef");
        std::fs::write(&nef, b"NEFBYTES").unwrap();
        let dest = dir.join("out");
        std::fs::create_dir_all(&dest).unwrap();
        let opts = BatchExportOptions::from_json(Some(&json!({
            "mode": "convert", "format": "png"
        })))
        .unwrap();
        let rows = vec![
            export_row("bad.jpg", &bad, None),
            export_row("good.jpg", &good, Some(&nef)),
        ];
        let o = export_image_files_with(&rows, dest.to_str().unwrap(), &opts).unwrap();
        assert_eq!(o.copied, 1);
        assert_eq!(o.nef_copied, 1, "配对 NEF 在转换模式下仍原样复制");
        assert_eq!(o.failed.len(), 1);
        assert!(o.failed[0].starts_with("bad.jpg:"));
        assert!(dest.join("good.png").exists());
        assert!(dest.join("good.nef").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn today_ymd_格式正确() {
        let t = today_ymd();
        assert_eq!(t.len(), 10);
        assert_eq!(&t[4..5], "-");
    }

    #[test]
    fn 手动导入无exif日期_回退文件mtime_有覆盖日期时优先() {
        let dir = std::env::temp_dir().join("pixyang_mtime_fallback");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = make_jpeg(&dir, "noexif.jpg", 20, 10);
        // 定到 2020-06-15T12:00:00Z（正午落点，各时区同日），镜像素材无 EXIF → 走 mtime
        let stamp = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_592_222_400);
        let f = std::fs::File::options().append(true).open(&src).unwrap();
        f.set_modified(stamp).unwrap();
        drop(f);

        let mut img = json!({ "filename": "noexif.jpg", "filepath": src.to_string_lossy() });
        apply_date_override(&mut img, None);
        assert_eq!(img["importDate"], "2020-06-15");

        let mut overridden = json!({ "filename": "noexif.jpg", "filepath": src.to_string_lossy() });
        apply_date_override(&mut overridden, Some("2026-01-02"));
        assert_eq!(overridden["importDate"], "2026-01-02");

        let mut missing =
            json!({ "filename": "noexif.jpg", "filepath": dir.join("gone.jpg").to_string_lossy() });
        apply_date_override(&mut missing, None);
        assert!(missing["importDate"].as_str().unwrap_or("").is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 手动导入exif拍摄时间_除importDate外同步落takenAt列() {
        // 全链回归锁：exif_fields 的 taken_at 此前只喂 importDate，img["takenAt"] 恒缺 →
        // import_one 落库 taken_at 列恒空，Info 面板「拍摄时间」行对手动导入的图永不显示
        // （相机导入 enrich 路径有该值，同图两途径信息面不一致）
        let dir = std::env::temp_dir().join("pixyang_takenat_col");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // TIFF 裸容器（exif_from_container_bytes 支持）携带 DateTimeOriginal
        let taken_field = exif::Field {
            tag: exif::Tag::DateTimeOriginal,
            ifd_num: exif::In::PRIMARY,
            value: exif::Value::Ascii(vec![b"2026:09:20 14:30:05".to_vec()]),
        };
        let mut writer = exif::experimental::Writer::new();
        writer.push_field(&taken_field);
        let mut buf = std::io::Cursor::new(Vec::new());
        writer.write(&mut buf, false).unwrap();
        let src = dir.join("withexif.tif");
        std::fs::write(&src, buf.into_inner()).unwrap();

        let mut img = json!({ "filename": "withexif.tif", "filepath": src.to_string_lossy() });
        apply_date_override(&mut img, None);
        assert_eq!(img["importDate"], "2026-09-20");
        assert_eq!(img["takenAt"], "2026-09-20 14:30");

        // 无 EXIF 的图不落 takenAt（mtime 回退无拍摄时间语义，import_one 落空串）
        let noexif = make_jpeg(&dir, "plain.jpg", 8, 8);
        let mut plain = json!({ "filename": "plain.jpg", "filepath": noexif.to_string_lossy() });
        apply_date_override(&mut plain, None);
        assert!(
            plain.get("takenAt").is_none(),
            "无 EXIF 不应杜撰拍摄时间: {:?}",
            plain["takenAt"]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 手动导入exif拍摄时间_import_one落库taken_at列() {
        // 端到端回归锁（R86 补实 R84 修复的落库环节）：apply_date_override 富化的 takenAt
        // 必须经 import_one 写入 taken_at 列（Info 面板「拍摄时间」行 / taken_at 优先排序
        // 消费）——R84 的回归锁止步于 img["takenAt"]，import_one str_or_empty 直取环节
        // 此前无测试覆盖
        let dir = std::env::temp_dir().join("pixyang_takenat_db_col");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        // TIFF 裸容器携带 DateTimeOriginal（与 apply_date_override 层回归锁同构造）
        let taken_field = exif::Field {
            tag: exif::Tag::DateTimeOriginal,
            ifd_num: exif::In::PRIMARY,
            value: exif::Value::Ascii(vec![b"2026:09:20 14:30:05".to_vec()]),
        };
        let mut writer = exif::experimental::Writer::new();
        writer.push_field(&taken_field);
        let mut buf = std::io::Cursor::new(Vec::new());
        writer.write(&mut buf, false).unwrap();
        let src = dir.join("src").join("withexif.tif");
        std::fs::write(&src, buf.into_inner()).unwrap();

        let conn = mem_db();
        let mut img = json!({ "filename": "withexif.tif", "filepath": src.to_string_lossy() });
        apply_date_override(&mut img, None); // 镜像 import_images 的整批 EXIF 富化步骤
        let row = import_one(
            &conn,
            &dir.join("root"),
            &img,
            None,
            false,
            "2026-09-20",
            &dir.join("thumbs"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(row.import_date, "2026-09-20");
        assert_eq!(
            row.taken_at.as_deref(),
            Some("2026-09-20 14:30"),
            "EXIF 拍摄时间必须落 taken_at 列（R86 端到端锁）"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 启动清扫_删残留temp双形态_保留托管与无关文件() {
        let dir = std::env::temp_dir().join("pixyang_bake_temp_clean");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let conn = mem_db();
        let seed = |filename: &str, filepath: &Path, hidden: i64| {
            conn.execute(
                "INSERT INTO images (filename, filepath, import_date, hidden) VALUES (?1, ?2, '2026-09-21', ?3)",
                rusqlite::params![filename, filepath.to_string_lossy(), hidden],
            )
            .unwrap();
        };
        let photo = make_jpeg(&dir, "photo.jpg", 16, 8);
        seed("photo.jpg", &photo, 0);
        let managed_temp = dir.join("m-temp.jpg");
        std::fs::write(&managed_temp, b"real").unwrap();
        let m_jpg = dir.join("m.jpg");
        std::fs::write(&m_jpg, b"m").unwrap();
        seed("m-temp.jpg", &managed_temp, 0);
        let hidden_jpg = dir.join("h.jpg");
        std::fs::write(&hidden_jpg, b"h").unwrap();
        seed("h.jpg", &hidden_jpg, 1);

        std::fs::write(dir.join("photo-temp.jpg"), b"stale").unwrap();
        std::fs::write(dir.join("photo-temp.png.part"), b"stale").unwrap();
        std::fs::write(dir.join("photo.jpg.bake-tmp"), b"stale").unwrap();
        std::fs::write(dir.join("photo-temp.txt"), b"keep").unwrap();
        std::fs::write(dir.join("other-temp.jpg"), b"keep").unwrap();
        std::fs::write(dir.join("h-temp.jpg"), b"keep").unwrap();

        let removed = cleanup_stale_bake_temps(&conn);
        assert_eq!(removed, 3, "双形态残留各计一次");
        assert!(!dir.join("photo-temp.jpg").exists());
        assert!(!dir.join("photo-temp.png.part").exists());
        assert!(!dir.join("photo.jpg.bake-tmp").exists());
        assert!(dir.join("photo-temp.txt").exists(), "扩展名不合不删");
        assert!(dir.join("other-temp.jpg").exists(), "无同名可见主图不删");
        assert!(dir.join("h-temp.jpg").exists(), "隐藏记录主名不参与匹配");
        assert!(managed_temp.exists(), "候选本身是托管记录时绝不删");
        assert!(photo.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 导入单张_落库并生成双档缩略图() {
        let dir = std::env::temp_dir().join("pixyang_import_one");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let src = make_jpeg(&dir.join("src"), "photo.jpg", 60, 40);
        let conn = mem_db();
        let root = dir.join("root");
        let img = json!({ "filename": "photo.jpg", "filepath": src.to_string_lossy(), "importDate": "2026-09-20" });
        let row = import_one(
            &conn,
            &root,
            &img,
            None,
            false,
            "2026-09-20",
            &dir.join("thumbs"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(row.filename, "photo.jpg");
        assert!(row.filepath.contains("2026"));
        assert!(Path::new(&row.filepath).exists());
        assert!(!row.thumbnail_path.as_deref().unwrap_or("").is_empty());
        assert_eq!(row.width, Some(60));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 导入重名派生_1() {
        let dir = std::env::temp_dir().join("pixyang_import_dup");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let src = make_jpeg(&dir.join("src"), "dup.jpg", 30, 20);
        let conn = mem_db();
        let root = dir.join("root");
        let img = json!({ "filename": "dup.jpg", "filepath": src.to_string_lossy() });
        let r1 = import_one(
            &conn,
            &root,
            &img,
            None,
            false,
            "2026-09-20",
            &dir.join("thumbs"),
        )
        .unwrap()
        .unwrap();
        let r2 = import_one(
            &conn,
            &root,
            &img,
            None,
            false,
            "2026-09-20",
            &dir.join("thumbs"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(r1.filename, "dup.jpg");
        assert_eq!(r2.filename, "dup_1.jpg");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 导入_库占而盘缺的失效记录派生避让_不静默并入旧记录() {
        let dir = std::env::temp_dir().join("pixyang_import_db_taken");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let src = make_jpeg(&dir.join("src"), "ghost.jpg", 30, 20);
        let conn = mem_db();
        let root = dir.join("root");
        // 失效记录：filepath 指向托管树内本次导入将命中的目标位，但文件已被外部删除
        let ghost_path = root.join("2026").join("09").join("20").join("ghost.jpg");
        conn.execute(
            "INSERT INTO images (filename, filepath, import_date, notes) VALUES ('ghost.jpg', ?1, '2026-09-20', '旧记录')",
            rusqlite::params![ghost_path.to_string_lossy()],
        )
        .unwrap();
        assert!(!ghost_path.exists(), "前置：盘上确实没有该文件");
        let img = json!({
            "filename": "ghost.jpg",
            "filepath": src.to_string_lossy(),
            "importDate": "2026-09-20",
        });
        let row = import_one(
            &conn,
            &root,
            &img,
            None,
            false,
            "2026-09-20",
            &dir.join("thumbs"),
        )
        .unwrap()
        .unwrap();
        assert_ne!(
            row.notes.as_deref(),
            Some("旧记录"),
            "新导入不得静默并入旧失效记录"
        );
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM images", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 2, "应派生 _1 新记录，而不是被 INSERT OR IGNORE 吞掉");
        assert!(Path::new(&row.filepath).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 改名校验_非法字符_扩展名_占用() {
        let dir = std::env::temp_dir().join("pixyang_rename");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("root").join("2026-01-01")).unwrap();
        let src = make_jpeg(&dir.join("root").join("2026-01-01"), "a.jpg", 20, 10);
        let conn = mem_db();
        let img = json!({ "filename": "a.jpg", "filepath": src.to_string_lossy(), "importDate": "2026-01-01" });
        let row = import_one(
            &conn,
            &dir.join("root"),
            &img,
            None,
            false,
            "2026-01-01",
            &dir.join("thumbs"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            rename_image(&conn, row.id, "../evil.jpg").unwrap()["error"],
            "文件名含有非法字符"
        );
        assert_eq!(
            rename_image(&conn, row.id, "b.png").unwrap()["error"],
            "不允许修改扩展名"
        );
        assert!(rename_image(&conn, 9999, "x.jpg").unwrap().is_boolean());
        let ok = rename_image(&conn, row.id, "renamed.jpg").unwrap();
        assert_eq!(ok["success"], true);
        let updated = get_img_row(&conn, row.id).unwrap();
        assert_eq!(updated.filename, "renamed.jpg");
        assert!(Path::new(&updated.filepath).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

//! 孤儿文件：托管树内存在、但库里没有对应记录的文件（导入中断、外部复制等产生）。
//! 契约：**本模块绝不删除文件**。只提供只读扫描与两种可逆处置——
//! ① 登记入库（原地登记或按拍摄日期重新归档，仅移动）；② 移出托管目录（移动到用户指定目录）。

use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::error::PixError;

const IMAGE_EXTS: [&str; 9] = [
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif", "heic",
];
// 数据/回收站/缩略图缓存目录不参与扫描（它们不在图片托管语义内）
const SKIP_DIRS: [&str; 4] = ["trash", "thumbnails", "data", "edits"];

fn norm(p: &str) -> String {
    p.replace('\\', "/").to_lowercase()
}

fn ext_of(name: &str) -> String {
    crate::naming::extname(name)
        .trim_start_matches('.')
        .to_lowercase()
}

fn is_image_ext(ext: &str) -> bool {
    IMAGE_EXTS.contains(&ext)
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), PixError> {
    let entries = std::fs::read_dir(dir).map_err(|e| PixError::Io(format!("读取目录失败: {e}")))?;
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                eprintln!("[孤儿扫描] 跳过无法读取的项: {e}");
                continue;
            }
        };
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            if SKIP_DIRS.contains(&name.to_lowercase().as_str()) {
                continue;
            }
            walk(&path, out)?;
            continue;
        }
        let ext = ext_of(&name);
        if is_image_ext(&ext) || crate::naming::is_raw_ext(&format!(".{ext}")) {
            out.push(path);
        }
    }
    Ok(())
}

fn exif_taken_at(path: &Path) -> String {
    crate::exif_read::exif_fields(path)
        .ok()
        .and_then(|f| {
            f.get("taken_at")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default()
}

/// 日期链（镜像导入）：EXIF 拍摄日期 > 文件 mtime > 今天
fn effective_date(path: &Path, today: &str) -> String {
    let taken = exif_taken_at(path);
    if taken.len() >= 10 {
        return taken[..10].to_string();
    }
    let m = crate::camera::mtime_ymd(path);
    if m.len() == 10 {
        return m;
    }
    today.to_string()
}

/// 扫描托管树中「有文件、无记录」的图片。返回数组，每项含路径/大小/拍摄日期/mtime/是否原始格式。
pub fn scan_orphan_files(conn: &Connection, images_root: &Path) -> Result<Value, PixError> {
    if !images_root.exists() {
        return Ok(json!({ "error": "图片根目录不可访问（磁盘可能离线），已中止扫描" }));
    }
    let mut known: HashSet<String> = HashSet::new();
    // 已登记图片按「目录 + 主名」索引：孤儿 RAW 若命中，说明它本就是该图的原始文件
    // （早期导入未回写 raw_path），应挂到已有记录而不是新建隐藏行
    let mut partners: HashMap<(String, String), (i64, String)> = HashMap::new();
    {
        // known 必须含全部行（含 hidden=1 的 NEF-only 记录）：隐藏记录的文件同样
        // 「已入库」，漏掉会让它被误报为孤儿——按日期归档收养时文件被搬移而
        // INSERT OR IGNORE 因 filepath UNIQUE 静默忽略，产生坏记录 + 新孤儿
        //（逻辑错误清扫 2026-10-24）。RAW 挂接目标仍只对可见记录（R156 口径）
        let mut stmt = conn.prepare("SELECT id, filepath, raw_path, hidden FROM images")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                r.get::<_, i64>(3)?,
            ))
        })?;
        for row in rows {
            let (id, filepath, raw_path, hidden) = row?;
            known.insert(norm(&filepath));
            if !raw_path.is_empty() {
                known.insert(norm(&raw_path));
            }
            if hidden == 0 {
                let key = partner_key(&filepath);
                partners.insert(key, (id, filepath));
            }
        }
    }

    let mut files: Vec<PathBuf> = Vec::new();
    walk(images_root, &mut files)?;
    files.sort();

    let mut out: Vec<Value> = Vec::new();
    for path in files {
        let lossy = path.to_string_lossy().to_string();
        if known.contains(&norm(&lossy)) {
            continue;
        }
        let filename = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let ext = ext_of(&filename);
        let size = std::fs::metadata(&path)
            .map(|m| m.len() as i64)
            .unwrap_or(0);
        let is_raw = crate::naming::is_raw_ext(&format!(".{ext}"));
        out.push(json!({
            "filepath": lossy,
            "filename": filename,
            "size": size,
            "taken_at": exif_taken_at(&path),
            "mtime": crate::camera::mtime_ymd(&path),
            "is_raw": is_raw,
            // RAW 且同目录同主名已有登记记录 → 入库时挂为该记录的 raw_path（不新建行）
            "has_partner": is_raw && partners.contains_key(&partner_key(&lossy)),
        }));
    }
    Ok(Value::Array(out))
}

/// 登记入库：把孤儿文件补进图库。rearchive=true 时按日期链把文件移到 yyyy/MM/dd 目录再登记，
/// false 则原地登记（不移动文件）。绝不复制、绝不删除。
pub fn adopt_orphan_files(
    conn: &Connection,
    paths: &[String],
    rearchive: bool,
    images_root: &Path,
    thumbs_dir: &Path,
    today: &str,
) -> Result<Value, PixError> {
    if !images_root.exists() {
        return Ok(json!({ "error": "图片根目录不可访问（磁盘可能离线），已中止处理" }));
    }
    // 已登记的（扫描到处理之间可能已入库）直接跳过
    let mut known: HashSet<String> = HashSet::new();
    let mut partners: HashMap<(String, String), (i64, String)> = HashMap::new();
    {
        // known 含全部行（含 hidden=1，与扫描同口径）：隐藏 NEF-only 记录的文件同样
        // 「已入库」，漏掉会让按日期归档收养时文件被搬移而 INSERT OR IGNORE 静默
        // 忽略 → 坏记录 + 新孤儿（逻辑错误清扫 2026-10-24）
        let mut stmt = conn.prepare("SELECT id, filepath, raw_path, hidden FROM images")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                r.get::<_, i64>(3)?,
            ))
        })?;
        for row in rows {
            let (id, filepath, raw_path, hidden) = row?;
            known.insert(norm(&filepath));
            if !raw_path.is_empty() {
                known.insert(norm(&raw_path));
            }
            if hidden == 0 {
                partners.insert(partner_key(&filepath), (id, filepath));
            }
        }
    }

    let chosen: Vec<PathBuf> = paths
        .iter()
        .map(PathBuf::from)
        .filter(|p| p.exists() && !known.contains(&norm(&p.to_string_lossy())))
        .collect();

    // 原始格式（NEF 等）若与同主名图片成对，挂到该图的 raw_path，不单独成行
    let mut paired_raw: HashMap<String, PathBuf> = HashMap::new();
    for p in &chosen {
        let filename = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if !crate::naming::is_raw_filename(&filename) {
            continue;
        }
        let base = crate::naming::pair_base(&filename);
        let has_jpg = chosen.iter().any(|q| {
            let qn = q
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            q.parent() == p.parent()
                && crate::naming::pair_base(&qn) == base
                && is_image_ext(&ext_of(&qn))
        });
        if has_jpg {
            paired_raw.insert(norm(&p.to_string_lossy()), p.clone());
        }
    }

    let mut adopted = 0i64;
    let mut attached = 0i64;
    let mut skipped = 0i64;
    let mut failed = 0i64;
    let mut errors: Vec<String> = Vec::new();
    // 缩略图延后到批尾并行生成（R110 导入同口径）：归档循环里只收行，
    // 24MP 单张双档 ~1.3s，串行内联在收养几十张时是分钟级 → 并行 ~4x
    let mut pending_thumbs: Vec<(crate::images_query::ImageRow, PathBuf)> = Vec::new();

    for src in &chosen {
        let key = norm(&src.to_string_lossy());
        if paired_raw.contains_key(&key) {
            continue; // 作为配对原始文件随主图处理
        }
        let filename = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        // 孤儿 RAW 命中「同目录同主名的已登记图片」：挂为该记录的 raw_path，不新建隐藏行
        // （早期导入未回写 raw_path 的历史数据，以及重复导入留下的冗余 RAW 都走这里）
        if crate::naming::is_raw_filename(&filename) {
            if let Some((pid, pfile)) = partners.get(&partner_key(&src.to_string_lossy())) {
                // 占用查询失败必须 fail-safe：误判「未占用」会让下面的 UPDATE 覆盖
                // 记录已有的 raw_path（配对链接丢失，数据丢失方向）——保守跳过，
                // 用户重跑收养工具即可
                let occupied: String = match conn.query_row(
                    "SELECT COALESCE(raw_path, '') FROM images WHERE id = ?1",
                    rusqlite::params![pid],
                    |r| r.get(0),
                ) {
                    Ok(v) => v,
                    Err(e) => {
                        failed += 1;
                        errors.push(format!("{filename}: 占用查询失败，已跳过"));
                        eprintln!("[孤儿归档] raw_path 占用查询失败(记录 {pid}): {e}");
                        continue;
                    }
                };
                if !occupied.is_empty() {
                    skipped += 1;
                    continue;
                }
                let pdir = PathBuf::from(pfile);
                let pdir = pdir.parent().map(|p| p.to_path_buf()).unwrap_or_default();
                let dest = if rearchive {
                    unique_in(&pdir, &filename)
                } else {
                    src.clone()
                };
                if let Err(e) = move_file(src, &dest) {
                    failed += 1;
                    errors.push(format!("{filename}: 归档失败"));
                    eprintln!("[孤儿归档] RAW 移动失败: {e}");
                    continue;
                }
                if let Err(e) = conn.execute(
                    "UPDATE images SET raw_path = ?1, original_raw_path = ?2 WHERE id = ?3",
                    rusqlite::params![dest.to_string_lossy(), src.to_string_lossy(), pid],
                ) {
                    failed += 1;
                    errors.push(format!("{filename}: 挂接失败"));
                    eprintln!("[孤儿归档] 写回 raw_path 失败: {e}");
                    continue;
                }
                attached += 1;
                continue;
            }
        }
        let date_str = effective_date(src, today);
        let raw_src = find_paired(src, &paired_raw);
        let dest = if rearchive {
            let sub = crate::image_group::date_dir(&date_str)
                .map(|rel| images_root.join(rel))
                .unwrap_or_else(|| images_root.join(today));
            if let Err(e) = std::fs::create_dir_all(&sub) {
                failed += 1;
                errors.push(format!("{filename}: 建日期目录失败"));
                eprintln!("[孤儿归档] 建日期目录失败: {e}");
                continue;
            }
            unique_in(&sub, &filename)
        } else {
            src.clone()
        };
        // 配对原始文件：主图搬家时跟随，目标名按主图主名 + RAW 原扩展名
        let raw_dest = match (&raw_src, rearchive) {
            (Some(r), true) => {
                let rname = r
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                let rext = crate::naming::extname(&rname);
                let candidate = format!(
                    "{}{}",
                    crate::naming::basename_no_ext(&dest.to_string_lossy()),
                    rext
                );
                Some(unique_in(
                    dest.parent().unwrap_or(images_root),
                    &candidate,
                ))
            }
            (Some(r), false) => Some(r.clone()),
            (None, _) => None,
        };
        let original_raw = raw_src.clone();
        let moved_from = src.clone();

        let is_target_raw = crate::naming::is_raw_filename(&filename);
        if let Err(e) = move_file(src, &dest) {
            failed += 1;
            errors.push(format!("{filename}: 归档失败"));
            eprintln!("[孤儿归档] 移动失败: {e}");
            continue;
        }
        let moved_raw = match (&raw_dest, &original_raw) {
            (Some(rt), Some(rs)) => match move_file(rs, rt) {
                Ok(()) => rt.to_string_lossy().to_string(),
                Err(e) => {
                    eprintln!("[孤儿归档] 配对原始文件移动失败（主图照常入库）: {e}");
                    String::new()
                }
            },
            _ => String::new(),
        };

        let format_value = ext_of(&dest.to_string_lossy());
        let dest_name = dest
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let size_value = std::fs::metadata(&dest)
            .map(|m| m.len() as i64)
            .unwrap_or(0);
        let insert = conn.execute(
            "INSERT OR IGNORE INTO images (filename, filepath, original_path, raw_path, original_raw_path, hidden, orientation, rotation, flip_h, flip_v, import_date, taken_at, size, width, height, format, thumbnail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, 0, ?8, ?9, ?10, 0, 0, ?11, '')",
            rusqlite::params![
                dest_name,
                dest.to_string_lossy(),
                // original_path 记来源：重新归档时是被移动前的路径，原地登记则留空（来源即自身）
                if rearchive {
                    moved_from.to_string_lossy().to_string()
                } else {
                    String::new()
                },
                moved_raw,
                if moved_raw.is_empty() { String::new() } else { original_raw.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_default() },
                if is_target_raw { 1 } else { 0 },
                1,
                date_str,
                exif_taken_at(&dest),
                size_value,
                format_value,
            ],
        );
        if let Err(e) = insert {
            failed += 1;
            errors.push(format!("{dest_name}: 写库失败"));
            eprintln!("[孤儿归档] 写库失败: {e}");
            continue;
        }

        // 隐藏记录（NEF-only）不生成缩略图，与导入路径同口径；生成延后到批尾并行
        if !is_target_raw {
            if let Ok(row) = conn.query_row(
                "SELECT * FROM images WHERE filepath = ?1",
                [&dest.to_string_lossy()],
                crate::images_query::row_from,
            ) {
                pending_thumbs.push((row, dest.clone()));
            }
        }
        adopted += 1;
    }

    // 批尾「并行生成 → 按收集顺序串行回写」（write_back_thumbs_chunked 同分块口径，
    // 峰值内存有界）：单个失败不扩散，该行列保持空，其余照常回写
    for chunk in pending_thumbs.chunks(crate::thumbs::PARALLEL_CHUNK) {
        let sources: Vec<&PathBuf> = chunk.iter().map(|(_, p)| p).collect();
        let results = crate::thumbs::generate_tiers_parallel(&sources);
        for ((row, src_path), result) in chunk.iter().zip(results) {
            let Ok((small, medium, w, h)) = result else {
                eprintln!(
                    "[孤儿归档] 缩略图生成失败（列保持空）: {}",
                    src_path.display()
                );
                continue;
            };
            if let Err(e) = crate::file_ops::write_thumbs_and_update(
                conn, row, thumbs_dir, &small, &medium, w, h,
            ) {
                eprintln!("[孤儿归档] 缩略图回写失败（列保持空）: {e}");
            }
        }
    }

    Ok(json!({
        "adopted": adopted,
        "attached": attached,
        "skipped": skipped,
        "failed": failed,
        "errors": errors,
    }))
}

/// 移出托管目录：把孤儿文件搬到用户指定的目录（或同主名的配对原始文件一并搬）。
/// 不做任何删除；同名冲突自动加后缀。
pub fn remove_orphan_files(paths: &[String], target_dir: &Path) -> Result<Value, PixError> {
    if target_dir.to_string_lossy().trim().is_empty() {
        return Ok(json!({ "error": "未选择目标目录" }));
    }
    if let Err(e) = std::fs::create_dir_all(target_dir) {
        return Ok(json!({ "error": format!("目标目录不可创建: {e}") }));
    }
    let mut moved = 0i64;
    let mut failed = 0i64;
    let mut errors: Vec<String> = Vec::new();
    for raw in paths {
        let src = PathBuf::from(raw);
        if !src.exists() {
            continue;
        }
        let filename = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let target = unique_in(target_dir, &filename);
        match move_file(&src, &target) {
            Ok(()) => moved += 1,
            Err(e) => {
                failed += 1;
                errors.push(format!("{filename}: 移动失败"));
                eprintln!("[孤儿移出] 移动失败: {e}");
            }
        }
        // 同目录同主名的其他扩展名文件（如配对的 NEF）一并移出，避免留下半套
        let base = crate::naming::pair_base(&filename);
        if let Some(parent) = src.parent() {
            if let Ok(entries) = std::fs::read_dir(parent) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if !p.is_file() {
                        continue;
                    }
                    let n = p
                        .file_name()
                        .map(|x| x.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let ext = ext_of(&n);
                    if !is_image_ext(&ext) && !crate::naming::is_raw_ext(&format!(".{ext}")) {
                        continue;
                    }
                    if norm(&p.to_string_lossy()) == norm(&src.to_string_lossy()) {
                        continue;
                    }
                    if crate::naming::pair_base(&n) != base {
                        continue;
                    }
                    let t = unique_in(target_dir, &n);
                    if let Err(e) = move_file(&p, &t) {
                        eprintln!("[孤儿移出] 配对文件移动失败: {e}");
                    }
                }
            }
        }
    }
    Ok(json!({ "moved": moved, "failed": failed, "errors": errors }))
}

/// 「目录 + 主名」键（大小写/分隔符归一），用于把孤儿 RAW 与已登记图片配对
fn partner_key(filepath: &str) -> (String, String) {
    let p = PathBuf::from(filepath);
    let dir = p
        .parent()
        .map(|d| norm(&d.to_string_lossy()))
        .unwrap_or_default();
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    (dir, crate::naming::pair_base(&name))
}

fn unique_in(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let base = crate::naming::basename_no_ext(name);
    let ext = crate::naming::extname(name);
    for i in 1..10000 {
        let next = dir.join(format!("{base}_{i}{ext}"));
        if !next.exists() {
            return next;
        }
    }
    dir.join(format!("{base}_x{ext}"))
}

fn move_file(src: &Path, dest: &Path) -> Result<(), PixError> {
    if src == dest {
        return Ok(());
    }
    // 同盘直接 rename；跨盘（E: → D:）rename 会失败，退化为复制+删除源文件
    if std::fs::rename(src, dest).is_ok() {
        return Ok(());
    }
    std::fs::copy(src, dest).map_err(|e| PixError::Io(format!("复制失败: {e}")))?;
    std::fs::remove_file(src).map_err(|e| PixError::Io(format!("清理源文件失败: {e}")))?;
    Ok(())
}

fn find_paired(jpg: &Path, paired: &HashMap<String, PathBuf>) -> Option<PathBuf> {
    let jpg_name = jpg
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let base = crate::naming::pair_base(&jpg_name);
    paired
        .iter()
        .find(|(_, raw)| {
            raw.parent() == jpg.parent()
                && crate::naming::pair_base(
                    &raw
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                ) == base
        })
        .map(|(_, p)| p.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::images_query::tests::mem_db;
    use image::{DynamicImage, RgbaImage};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_jpeg(dir: &Path, name: &str) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let p = dir.join(name);
        let img = DynamicImage::from(RgbaImage::from_fn(40, 30, |x, y| {
            let v = ((x * 7 + y * 3) % 255) as u8;
            image::Rgba([v, 255 - v, 128, 255])
        }));
        img.save(&p).unwrap();
        p
    }

    fn count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM images", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn 扫描孤儿文件_只报未登记的文件() {
        let conn = mem_db();
        let root = temp_dir("orphan_scan");
        let known = write_jpeg(&root.join("2026").join("08").join("31"), "DSC_0001.JPG");
        let orphan = write_jpeg(&root.join("2026").join("10").join("19"), "DSC_0002.JPG");
        conn.execute(
            "INSERT INTO images (filename, filepath, import_date, format) VALUES ('DSC_0001.JPG', ?1, '2026-08-31', 'jpg')",
            [known.to_string_lossy()],
        )
        .unwrap();

        let result = scan_orphan_files(&conn, &root).unwrap();
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 1, "已登记的不得再报：{arr:?}");
        assert_eq!(arr[0]["filepath"], orphan.to_string_lossy().to_string());
        assert_eq!(arr[0]["filename"], "DSC_0002.JPG");
    }

    #[test]
    fn 扫描孤儿文件_跳过回收站与缓存目录() {
        let conn = mem_db();
        let root = temp_dir("orphan_skip");
        write_jpeg(&root.join("trash"), "t.jpg");
        write_jpeg(&root.join("thumbnails"), "s.jpg");
        let real = write_jpeg(&root.join("2026").join("01").join("01"), "a.jpg");
        let arr = scan_orphan_files(&conn, &root).unwrap().as_array().unwrap().clone();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["filepath"], real.to_string_lossy().to_string());
    }

    #[test]
    fn 登记入库_原地登记不改路径且生成记录() {
        let conn = mem_db();
        let root = temp_dir("orphan_adopt_inplace");
        let f = write_jpeg(&root.join("2026").join("10").join("19"), "DSC_0009.JPG");
        assert_eq!(count(&conn), 0);

        let res = adopt_orphan_files(
            &conn,
            &[f.to_string_lossy().to_string()],
            false,
            &root,
            &root.join("thumbs"),
            "2026-10-19",
        )
        .unwrap();
        assert_eq!(res["adopted"], 1);
        assert_eq!(res["failed"], 0);
        assert_eq!(count(&conn), 1);
        let stored: String = conn
            .query_row("SELECT filepath FROM images", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, f.to_string_lossy().to_string(), "原地登记不得移动文件");
        assert!(f.exists());
    }

    #[test]
    fn 登记入库_重新归档按日期链移动文件() {
        let conn = mem_db();
        let root = temp_dir("orphan_adopt_rearchive");
        let f = write_jpeg(&root.join("2026").join("10").join("19"), "DSC_0010.JPG");
        let res = adopt_orphan_files(
            &conn,
            &[f.to_string_lossy().to_string()],
            true,
            &root,
            &root.join("thumbs"),
            "2026-10-19",
        )
        .unwrap();
        assert_eq!(res["adopted"], 1);
        assert!(!f.exists(), "重新归档后原位置不应保留副本");
        let stored: String = conn
            .query_row("SELECT filepath FROM images", [], |r| r.get(0))
            .unwrap();
        // 无 EXIF → 日期链回退到 mtime（今天），目录为 yyyy/MM/dd
        assert!(stored.contains("2026"), "归档目录应为日期目录：{stored}");
        assert!(PathBuf::from(&stored).exists());
    }

    #[test]
    fn 登记入库_已登记的文件被跳过_不产生重复行() {
        let conn = mem_db();
        let root = temp_dir("orphan_adopt_skip");
        let f = write_jpeg(&root.join("2026").join("10").join("19"), "DSC_0011.JPG");
        conn.execute(
            "INSERT INTO images (filename, filepath, import_date, format) VALUES ('DSC_0011.JPG', ?1, '2026-10-19', 'jpg')",
            [f.to_string_lossy()],
        )
        .unwrap();
        let res = adopt_orphan_files(
            &conn,
            &[f.to_string_lossy().to_string()],
            false,
            &root,
            &root.join("thumbs"),
            "2026-10-19",
        )
        .unwrap();
        assert_eq!(res["adopted"], 0);
        assert_eq!(count(&conn), 1, "不得因重复处理产生第二行");
    }

    #[test]
    fn 扫描与收养_隐藏记录的文件不误报不搬移() {
        // 逻辑错误清扫（2026-10-24）：known 集漏掉 hidden=1 行会让 NEF-only 记录的
        // 文件被误报孤儿——按日期归档收养时文件被搬移而 INSERT OR IGNORE 静默忽略，
        // 产生坏记录（旧路径失效）+ 新孤儿
        let conn = mem_db();
        let root = temp_dir("orphan_hidden");
        let dir = root.join("2026").join("10").join("19");
        std::fs::create_dir_all(&dir).unwrap();
        // NEF 文件直接写字节（image crate 不支持 NEF 编码）；本用例不走解码路径
        let f = dir.join("DSC_0100.NEF");
        std::fs::write(&f, b"fake-nef-bytes").unwrap();
        conn.execute(
            "INSERT INTO images (filename, filepath, hidden, import_date, format) VALUES ('DSC_0100.NEF', ?1, 1, '2026-10-19', 'nef')",
            [f.to_string_lossy()],
        )
        .unwrap();

        let arr = scan_orphan_files(&conn, &root).unwrap().as_array().unwrap().clone();
        assert!(arr.is_empty(), "隐藏记录的文件不得误报孤儿: {arr:?}");

        let res = adopt_orphan_files(
            &conn,
            &[f.to_string_lossy().to_string()],
            true,
            &root,
            &root.join("thumbs"),
            "2026-10-19",
        )
        .unwrap();
        assert_eq!(res["adopted"], 0);
        assert_eq!(count(&conn), 1, "不得产生第二行");
        assert!(f.exists(), "原地文件不得被搬移");
    }

    #[test]
    fn 登记入库_孤儿RAW挂到已有记录_不新建隐藏行() {
        let conn = mem_db();
        let root = temp_dir("orphan_attach");
        let dir = root.join("2026").join("08").join("29");
        let jpg = write_jpeg(&dir, "DSC_0100.JPG");
        conn.execute(
            "INSERT INTO images (filename, filepath, import_date, format) VALUES ('DSC_0100.JPG', ?1, '2026-08-29', 'jpg')",
            [jpg.to_string_lossy()],
        )
        .unwrap();
        // 同目录同主名的 NEF（早期导入未回写 raw_path）
        let nef = dir.join("DSC_0100.NEF");
        std::fs::write(&nef, b"raw-bytes").unwrap();

        let res = adopt_orphan_files(
            &conn,
            &[nef.to_string_lossy().to_string()],
            false,
            &root,
            &root.join("thumbs"),
            "2026-10-19",
        )
        .unwrap();
        assert_eq!(res["attached"], 1, "应挂到已有记录：{res:?}");
        assert_eq!(res["adopted"], 0);
        assert_eq!(count(&conn), 1, "不得新建行");
        let raw: String = conn
            .query_row("SELECT COALESCE(raw_path,'') FROM images", [], |r| r.get(0))
            .unwrap();
        assert_eq!(raw, nef.to_string_lossy().to_string());
    }

    #[test]
    fn 登记入库_已有RAW时不覆盖_计入跳过() {
        let conn = mem_db();
        let root = temp_dir("orphan_attach_occupied");
        let dir = root.join("2026").join("08").join("29");
        let jpg = write_jpeg(&dir, "DSC_0101.JPG");
        let old_raw = dir.join("DSC_0101_OLD.NEF");
        std::fs::write(&old_raw, b"old").unwrap();
        conn.execute(
            "INSERT INTO images (filename, filepath, raw_path, import_date, format) VALUES ('DSC_0101.JPG', ?1, ?2, '2026-08-29', 'jpg')",
            rusqlite::params![jpg.to_string_lossy(), old_raw.to_string_lossy()],
        )
        .unwrap();
        let nef = dir.join("DSC_0101.NEF");
        std::fs::write(&nef, b"new").unwrap();

        let res = adopt_orphan_files(
            &conn,
            &[nef.to_string_lossy().to_string()],
            false,
            &root,
            &root.join("thumbs"),
            "2026-10-19",
        )
        .unwrap();
        assert_eq!(res["skipped"], 1);
        assert_eq!(res["attached"], 0);
        let raw: String = conn
            .query_row("SELECT COALESCE(raw_path,'') FROM images", [], |r| r.get(0))
            .unwrap();
        assert_eq!(raw, old_raw.to_string_lossy().to_string(), "已有 RAW 不得被覆盖");
        assert!(nef.exists(), "跳过的文件必须原样保留");
    }

    #[test]
    fn 移出托管目录_只搬走不删除() {
        let root = temp_dir("orphan_remove");
        let f = write_jpeg(&root.join("2026").join("10").join("19"), "DSC_0012.JPG");
        let out = temp_dir("orphan_remove_out");
        let bytes = std::fs::read(&f).unwrap();
        let res = remove_orphan_files(&[f.to_string_lossy().to_string()], &out).unwrap();
        assert_eq!(res["moved"], 1);
        assert_eq!(res["failed"], 0);
        assert!(!f.exists());
        assert_eq!(std::fs::read(out.join("DSC_0012.JPG")).unwrap(), bytes, "内容必须完整保留");
    }

    #[test]
    fn 移出托管目录_未选目标目录时报错且不动文件() {
        let root = temp_dir("orphan_remove_nodir");
        let f = write_jpeg(&root.join("2026").join("10").join("19"), "DSC_0013.JPG");
        let res = remove_orphan_files(&[f.to_string_lossy().to_string()], Path::new("")).unwrap();
        assert!(res.get("error").is_some());
        assert!(f.exists(), "报错时绝不能动文件");
    }

    #[test]
    fn 移出托管目录_同名冲突自动加后缀不覆盖() {
        let root = temp_dir("orphan_remove_dup");
        let a = write_jpeg(&root.join("a"), "DSC_0014.JPG");
        let b_dir = root.join("b");
        let b = write_jpeg(&b_dir, "DSC_0014.JPG");
        let out = temp_dir("orphan_remove_dup_out");
        remove_orphan_files(&[a.to_string_lossy().to_string()], &out).unwrap();
        remove_orphan_files(&[b.to_string_lossy().to_string()], &out).unwrap();
        assert!(out.join("DSC_0014.JPG").exists());
        assert!(out.join("DSC_0014_1.JPG").exists(), "同名必须加后缀，不得覆盖");
    }
}

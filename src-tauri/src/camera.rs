// 相机同步与图片根迁移：镜像 electron/main.js 的 db:sync-camera-folder / fs:set-images-root
// 编排与 electron/database.js 的 prepareCameraSync / attachRawToImage / setImagesRoot。
// scan.rs 的 scan_directory_inner(include_raw) 未公开 include_raw 入口：相机口径
//（含 NEF 独立条目、无配对注记）的枚举在本模块实现。extractExifBatch/readExifInfo
// 首次移植（exif_read 的字节级解析为私有，日期/朝向所需的最小解析就地实现）。
// 串行锁由命令层经 Db(Mutex<Connection>) 持有，内核不做并发处理。

use crate::db::{delete_image_record, images_root, AppPaths, Db, PixError};
use crate::image_group;
use crate::images_query::{row_from, ImageRow};
use crate::naming;
use crate::scan::{CollectedFile, VISIBLE_FORMATS};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::State;

const SCAN_MAX_DEPTH: usize = 12;
const SCAN_MAX_FILES: usize = 20000;

// ── 相机目录扫描（scanImageFiles(dir, true) 口径） ──

fn scan_camera_files(dir: &Path) -> Vec<CollectedFile> {
    if !dir.is_absolute() {
        eprintln!("[扫描] 目录路径无效: {}", dir.display());
        return vec![];
    }
    match std::fs::metadata(dir) {
        Ok(meta) if meta.is_dir() => {}
        _ => return vec![],
    }
    let mut files = Vec::new();
    scan_into(&mut files, dir, 0);
    files
}

fn scan_into(files: &mut Vec<CollectedFile>, dir: &Path, depth: usize) {
    if depth > SCAN_MAX_DEPTH || files.len() >= SCAN_MAX_FILES {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            eprintln!("[扫描] 错误: {} {e}", dir.display());
            return;
        }
    };
    for entry in entries.flatten() {
        if files.len() >= SCAN_MAX_FILES {
            eprintln!("[扫描] 达到上限，截断: {SCAN_MAX_FILES}");
            break;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let full_path = entry.path();
        if file_type.is_dir() {
            scan_into(files, &full_path, depth + 1);
        } else if file_type.is_file() {
            let name = entry.file_name().to_string_lossy().to_string();
            let ext = naming::extname(&name).to_lowercase();
            let supported = VISIBLE_FORMATS.contains(&ext.as_str()) || ext == ".nef";
            if supported {
                let size = std::fs::metadata(&full_path).map(|m| m.len()).unwrap_or(0);
                files.push(CollectedFile {
                    filename: name,
                    filepath: full_path.to_string_lossy().into_owned(),
                    size,
                    format: ext,
                    width: 0,
                    height: 0,
                    raw_source: None,
                    raw_filename: None,
                });
            }
        }
    }
}

// ── EXIF 提取（readExifInfo 口径） ──

struct ExifInfo {
    date: String,
    taken_at: String,
    orientation: i64,
}

fn ymd_from_days(days: i64) -> String {
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

fn mtime_ymd(path: &Path) -> String {
    let secs = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    ymd_from_days(secs.div_euclid(86400))
}

fn read_exif_info(path: &Path) -> ExifInfo {
    let mut raw_date = String::new();
    let mut orientation: i64 = 1;
    if let Ok(buf) = std::fs::read(path) {
        let ex = exif::get_exif_attr_from_jpeg(&mut std::io::Cursor::new(&buf))
            .ok()
            .and_then(|t| exif::Reader::new().read_raw(t).ok())
            .or_else(|| {
                exif::Reader::new()
                    .read_from_container(&mut std::io::BufReader::new(std::io::Cursor::new(&buf)))
                    .ok()
            });
        if let Some(ex) = ex {
            let ascii = |tag: exif::Tag| -> Option<String> {
                match &ex.get_field(tag, exif::In::PRIMARY)?.value {
                    exif::Value::Ascii(v) => v.first().map(|b| {
                        String::from_utf8_lossy(b)
                            .trim_end_matches('\0')
                            .to_string()
                    }),
                    _ => None,
                }
            };
            if let Some(s) = ascii(exif::Tag::DateTimeOriginal) {
                raw_date = s;
            } else if let Some(s) = ascii(exif::Tag::DateTimeDigitized) {
                raw_date = s;
            }
            orientation = ex
                .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
                .and_then(|f| f.value.get_uint(0))
                .filter(|v| *v != 0)
                .map(i64::from)
                .unwrap_or(1);
        }
    }

    let b = raw_date.as_bytes();
    let two_digits = |s: &[u8]| s.len() == 2 && s.iter().all(u8::is_ascii_digit);
    let num = |s: &[u8]| -> Option<u32> {
        if two_digits(s) {
            Some((s[0] - b'0') as u32 * 10 + (s[1] - b'0') as u32)
        } else {
            None
        }
    };
    let valid_ymd = b.len() >= 10
        && b[0..4].iter().all(u8::is_ascii_digit)
        && b[4] == b':'
        && num(&b[5..7]).is_some_and(|m| (1..=12).contains(&m))
        && b[7] == b':'
        && num(&b[8..10]).is_some_and(|d| (1..=31).contains(&d));
    if valid_ymd {
        let date = format!(
            "{}-{}-{}",
            &raw_date[0..4],
            &raw_date[5..7],
            &raw_date[8..10]
        );
        let taken_at = if b.len() >= 16
            && (b[10] == b' ' || b[10] == b'T')
            && two_digits(&b[11..13])
            && b[13] == b':'
            && two_digits(&b[14..16])
        {
            format!("{date} {}:{}", &raw_date[11..13], &raw_date[14..16])
        } else {
            String::new()
        };
        ExifInfo {
            date,
            taken_at,
            orientation,
        }
    } else {
        ExifInfo {
            date: mtime_ymd(path),
            taken_at: String::new(),
            orientation,
        }
    }
}

// ── prepareCameraSync：过滤图库已有文件 ──

struct AttachPair {
    jpg_id: i64,
    nef_source: String,
    nef_filename: String,
}

fn prepare_camera_sync(
    conn: &Connection,
    files: &[CollectedFile],
) -> Result<(Vec<CollectedFile>, Vec<AttachPair>, i64), PixError> {
    let mut order: Vec<(Option<usize>, Option<usize>)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for (i, f) in files.iter().enumerate() {
        let key = format!(
            "{}::{}",
            image_group::dirname(&f.filepath),
            naming::pair_base(&f.filename)
        );
        let slot = match index.get(&key) {
            Some(&gi) => &mut order[gi],
            None => {
                order.push((None, None));
                index.insert(key, order.len() - 1);
                order.last_mut().unwrap()
            }
        };
        if f.format == ".nef" {
            slot.1 = Some(i);
        } else {
            slot.0 = Some(i);
        }
    }

    let mut to_import = Vec::new();
    let mut attach_pairs = Vec::new();
    let mut skipped = 0i64;
    for (jpg_i, nef_i) in &order {
        let nef = nef_i.map(|i| &files[i]);
        if let Some(jpg) = jpg_i.map(|i| &files[i]) {
            let existing: Option<ImageRow> = conn
                .query_row(
                    "SELECT * FROM images WHERE original_path = ?1 COLLATE NOCASE",
                    [&jpg.filepath],
                    row_from,
                )
                .optional()?;
            match existing {
                Some(row) => {
                    let has_raw = row.raw_path.as_deref().is_some_and(|s| !s.is_empty());
                    if !has_raw {
                        if let Some(nef) = nef {
                            attach_pairs.push(AttachPair {
                                jpg_id: row.id,
                                nef_source: nef.filepath.clone(),
                                nef_filename: nef.filename.clone(),
                            });
                        }
                    }
                    skipped += 1;
                }
                None => {
                    to_import.push(jpg.clone());
                    if let Some(nef) = nef {
                        to_import.push(nef.clone());
                    }
                }
            }
        } else if let Some(nef) = nef {
            let as_hidden: Option<i64> = conn
                .query_row(
                    "SELECT id FROM images WHERE original_path = ?1 COLLATE NOCASE",
                    [&nef.filepath],
                    |r| r.get(0),
                )
                .optional()?;
            let as_pair: Option<i64> = conn
                .query_row(
                    "SELECT id FROM images WHERE original_raw_path = ?1 COLLATE NOCASE",
                    [&nef.filepath],
                    |r| r.get(0),
                )
                .optional()?;
            if as_hidden.is_some() || as_pair.is_some() {
                skipped += 1;
            } else {
                to_import.push(nef.clone());
            }
        }
    }
    Ok((to_import, attach_pairs, skipped))
}

// ── attachRawToImage：已导入 JPG 的配对 NEF 落位 ──

fn attach_raw_to_image(
    conn: &Connection,
    image_id: i64,
    nef_source: &str,
    nef_filename: &str,
) -> Result<bool, PixError> {
    let img = match crate::images_query::get_image_by_id(conn, image_id)? {
        Some(img) => img,
        None => return Ok(false),
    };
    if img.raw_path.as_deref().is_some_and(|s| !s.is_empty()) {
        return Ok(false);
    }
    let raw_ext = naming::extname(nef_filename);
    let raw_name = format!("{}{}", naming::basename_no_ext(&img.filename), raw_ext);
    let raw_dest = PathBuf::from(image_group::dirname(&img.filepath)).join(raw_name);
    if let Some(parent) = raw_dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| PixError::Io(format!("建目录失败: {e}")))?;
    }
    if raw_dest.exists() {
        let owner: Option<(i64, i64, Option<String>)> = conn
            .query_row(
                "SELECT id, hidden, original_path FROM images WHERE filepath = ?1",
                [raw_dest.to_string_lossy()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        if let Some((owner_id, hidden, owner_original_path)) = owner {
            if hidden == 1 {
                delete_image_record(conn, owner_id)?;
                conn.execute(
                    "UPDATE images SET raw_path = ?1, original_raw_path = ?2 WHERE id = ?3",
                    rusqlite::params![
                        raw_dest.to_string_lossy(),
                        owner_original_path.unwrap_or_default(),
                        image_id
                    ],
                )?;
                return Ok(true);
            }
            return Ok(false);
        }
        if let Err(e) = std::fs::remove_file(&raw_dest) {
            eprintln!("[相机同步] 清理无主残留失败: {} {e}", raw_dest.display());
            return Ok(false);
        }
    }
    if let Err(e) = std::fs::copy(nef_source, &raw_dest) {
        let _ = std::fs::remove_file(&raw_dest);
        eprintln!("[相机同步] NEF 复制失败: {nef_source} {e}");
        return Ok(false);
    }
    conn.execute(
        "UPDATE images SET raw_path = ?1, original_raw_path = ?2 WHERE id = ?3",
        rusqlite::params![raw_dest.to_string_lossy(), nef_source, image_id],
    )?;
    Ok(true)
}

// ── importImages：分组编排（jpg 组可见导入，nef-only 组隐藏导入） ──

fn import_camera_files(
    conn: &Connection,
    to_import: Vec<Value>,
    root: &Path,
    today: &str,
    thumbs_dir: &Path,
) -> Result<Vec<ImageRow>, PixError> {
    let import_files: Vec<image_group::ImportFile> = to_import
        .iter()
        .map(|v| image_group::ImportFile {
            filename: v
                .get("filename")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            filepath: v
                .get("filepath")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            raw_source: None,
            raw_filename: None,
        })
        .collect();
    let by_path: HashMap<&str, &Value> = to_import
        .iter()
        .filter_map(|v| v.get("filepath").and_then(|x| x.as_str()).map(|p| (p, v)))
        .collect();
    let groups = image_group::group_import_files(&import_files);

    let mut imported = Vec::new();
    for (_, group) in &groups {
        if let Some(jpg) = &group.jpg {
            let Some(jpg_value) = by_path.get(jpg.filepath.as_str()).copied() else {
                continue;
            };
            let nef_value = group
                .nef
                .as_ref()
                .and_then(|n| by_path.get(n.filepath.as_str()).copied());
            let existing: Option<ImageRow> = conn
                .query_row(
                    "SELECT * FROM images WHERE original_path = ?1 COLLATE NOCASE",
                    [jpg.filepath.as_str()],
                    row_from,
                )
                .optional()?;
            if let Some(row) = existing {
                let has_raw = row.raw_path.as_deref().is_some_and(|s| !s.is_empty());
                if !has_raw {
                    if let Some(nef_value) = nef_value {
                        attach_raw_to_image(
                            conn,
                            row.id,
                            nef_value
                                .get("filepath")
                                .and_then(|x| x.as_str())
                                .unwrap_or(""),
                            nef_value
                                .get("filename")
                                .and_then(|x| x.as_str())
                                .unwrap_or(""),
                        )?;
                    }
                }
                continue;
            }
            if let Some(row) = crate::file_ops::import_one(
                conn, root, jpg_value, nef_value, false, today, thumbs_dir,
            )? {
                imported.push(row);
            }
        } else if let Some(nef) = &group.nef {
            let Some(nef_value) = by_path.get(nef.filepath.as_str()).copied() else {
                continue;
            };
            let as_hidden: Option<i64> = conn
                .query_row(
                    "SELECT id FROM images WHERE original_path = ?1 COLLATE NOCASE",
                    [nef.filepath.as_str()],
                    |r| r.get(0),
                )
                .optional()?;
            let as_pair: Option<i64> = conn
                .query_row(
                    "SELECT id FROM images WHERE original_raw_path = ?1 COLLATE NOCASE",
                    [nef.filepath.as_str()],
                    |r| r.get(0),
                )
                .optional()?;
            if as_hidden.is_some() || as_pair.is_some() {
                continue;
            }
            if let Some(row) =
                crate::file_ops::import_one(conn, root, nef_value, None, true, today, thumbs_dir)?
            {
                imported.push(row);
            }
        }
    }
    Ok(imported)
}

/// 镜像 db:sync-camera-folder 全流程（camera_dir 由命令层从 settings 解析）：
/// 扫描（含 NEF）→ prepareCameraSync 去重 → EXIF 提取 → 分组导入 → 补配对，
/// 返回契约同 JS：{scanned, imported, jpgImported, nefImported, attached, skipped}
pub fn camera_sync(
    conn: &Connection,
    camera_dir: &Path,
    default_images_dir: &Path,
    thumbs_dir: &Path,
) -> Result<Value, PixError> {
    let files = scan_camera_files(camera_dir);
    let (to_import, attach_pairs, skipped) = prepare_camera_sync(conn, &files)?;

    let mut enriched: Vec<Value> = Vec::with_capacity(to_import.len());
    for f in &to_import {
        let info = read_exif_info(Path::new(&f.filepath));
        enriched.push(json!({
            "filename": f.filename,
            "filepath": f.filepath,
            "size": f.size,
            "format": f.format,
            "importDate": info.date,
            "takenAt": info.taken_at,
            "orientation": info.orientation,
        }));
    }

    let root = images_root(conn, default_images_dir)?;
    let today = crate::file_ops::today_ymd();
    let imported = import_camera_files(conn, enriched, &root, &today, thumbs_dir)?;

    let mut attached = 0i64;
    for pair in &attach_pairs {
        if attach_raw_to_image(conn, pair.jpg_id, &pair.nef_source, &pair.nef_filename)? {
            attached += 1;
        }
    }

    let jpg_imported = imported.iter().filter(|r| r.hidden != Some(1)).count();
    let nef_imported = imported.iter().filter(|r| r.hidden == Some(1)).count();
    Ok(json!({
        "scanned": files.len(),
        "imported": imported.len(),
        "jpgImported": jpg_imported,
        "nefImported": nef_imported,
        "attached": attached,
        "skipped": skipped,
    }))
}

// ── setImagesRoot：图片根迁移（先搬文件后改库，失败双向回滚） ──

fn resolve_path(p: &str) -> PathBuf {
    let path = Path::new(p);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), PixError> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        [key, value],
    )?;
    Ok(())
}

fn rollback_moves(moves: &[(PathBuf, PathBuf)]) {
    for (from, to) in moves.iter().rev() {
        if let Err(e) = crate::file_ops::move_file_safe(to, from) {
            eprintln!("[迁移] 回滚移动失败: {} {e}", to.display());
        }
    }
}

struct MovePlan {
    id: i64,
    filename: String,
    filepath: String,
    raw_path: String,
    moved_file: bool,
}

/// 镜像 setImagesRoot：迁移已有图片到新根（含 NEF 跟随、日期目录保持）。
/// 预期失败以 {error} 值返回（同 JS 契约），Err 仅承载意外 DB 错误。
pub fn migrate_images_root(
    conn: &Connection,
    new_root: &str,
    default_images_dir: &Path,
    _thumbs_dir: &Path,
) -> Result<Value, PixError> {
    if new_root.is_empty() {
        return Ok(json!({ "error": "保存路径无效" }));
    }
    let old_root = images_root(conn, default_images_dir)?;
    let resolved_new = resolve_path(new_root);
    std::fs::create_dir_all(&resolved_new)
        .map_err(|e| PixError::Io(format!("创建目录失败: {e}")))?;

    if old_root == resolved_new {
        set_setting(conn, "images_root", &resolved_new.to_string_lossy())?;
        return Ok(json!({
            "success": true,
            "path": resolved_new.to_string_lossy(),
            "moved": 0,
        }));
    }

    let mut stmt =
        conn.prepare("SELECT id, filename, filepath, raw_path, import_date FROM images")?;
    let images: Vec<(i64, String, String, Option<String>, String)> = stmt
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?
        .collect::<rusqlite::Result<_>>()?;

    // filepath 列（小写 → 持有者 id 集合）：唯一名判定需排除自身记录（COLLATE NOCASE 语义）
    let mut db_taken: HashMap<String, Vec<i64>> = HashMap::new();
    let mut taken_stmt = conn.prepare("SELECT id, filepath FROM images")?;
    let rows = taken_stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    for (id, filepath) in rows.flatten() {
        db_taken
            .entry(filepath.to_lowercase())
            .or_default()
            .push(id);
    }

    let today = crate::file_ops::today_ymd();
    let mut plans: Vec<MovePlan> = Vec::new();
    let mut moves: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut planned_targets: HashSet<String> = HashSet::new();

    let planned = (|| -> Result<(), PixError> {
        for (id, filename, filepath, raw_path, import_date) in &images {
            // Path::starts_with 按组件比较：目录边界天然成立（JS startsWith 前缀误判的根治形态）
            let relative = Path::new(filepath).strip_prefix(&old_root).ok();
            let rel = match relative {
                Some(r) if !r.as_os_str().is_empty() => r.to_path_buf(),
                // 越界/根自身：回退日期目录布局（import_date 非法时同 importOne 围栏回退今天）
                _ => {
                    let date = image_group::effective_import_date(import_date, &today);
                    let mut fallback =
                        image_group::date_dir(&date).unwrap_or_else(|| PathBuf::from(&today));
                    fallback.push(image_group::basename(filename));
                    fallback
                }
            };
            let full_target = resolved_new.join(&rel);
            let target_dir = full_target.parent().unwrap_or(&resolved_new).to_path_buf();
            let original_name = image_group::basename(&full_target.to_string_lossy());
            let unique = {
                let exclude_id = *id;
                let db_map = &db_taken;
                naming::generate_unique_filename(
                    &target_dir,
                    &original_name,
                    &planned_targets,
                    |p| {
                        if p.exists() {
                            return true;
                        }
                        db_map
                            .get(&p.to_string_lossy().to_lowercase())
                            .is_some_and(|ids| !ids.contains(&exclude_id))
                    },
                )
            };
            let target_path = target_dir.join(&unique);
            planned_targets.insert(target_path.to_string_lossy().to_lowercase());

            let mut new_raw_path = String::new();
            if let Some(raw) = raw_path.as_deref().filter(|s| !s.is_empty()) {
                let raw_ext = naming::extname(raw);
                let target_base = naming::basename_no_ext(&unique);
                let nrp = target_dir.join(format!("{target_base}{raw_ext}"));
                planned_targets.insert(nrp.to_string_lossy().to_lowercase());
                if nrp.to_string_lossy() != *raw && nrp.exists() {
                    return Err(PixError::Io(format!(
                        "目标 NEF 名已被占用（{}）",
                        image_group::basename(&nrp.to_string_lossy())
                    )));
                }
                new_raw_path = nrp.to_string_lossy().into_owned();
            }

            let src = PathBuf::from(filepath);
            let raw = raw_path.as_deref().filter(|s| !s.is_empty());
            if !src.exists() {
                // 源缺失记录跟随迁移改写 DB（整库路径语义一致），盘上有 NEF 则照常搬
                if let (Some(raw), false) = (raw, new_raw_path.is_empty()) {
                    if Path::new(raw).exists() {
                        let nrp = PathBuf::from(&new_raw_path);
                        crate::file_ops::move_file_safe(Path::new(raw), &nrp)?;
                        moves.push((PathBuf::from(raw), nrp));
                    }
                }
                plans.push(MovePlan {
                    id: *id,
                    filename: unique,
                    filepath: target_path.to_string_lossy().into_owned(),
                    raw_path: new_raw_path,
                    moved_file: false,
                });
                continue;
            }
            crate::file_ops::move_file_safe(&src, &target_path)?;
            moves.push((src, target_path.clone()));
            if let Some(raw) = raw {
                if !new_raw_path.is_empty() && Path::new(raw).exists() && raw != new_raw_path {
                    let nrp = PathBuf::from(&new_raw_path);
                    crate::file_ops::move_file_safe(Path::new(raw), &nrp)?;
                    moves.push((PathBuf::from(raw), nrp));
                }
            }
            plans.push(MovePlan {
                id: *id,
                filename: unique,
                filepath: target_path.to_string_lossy().into_owned(),
                raw_path: new_raw_path,
                moved_file: true,
            });
        }
        Ok(())
    })();
    if let Err(e) = planned {
        rollback_moves(&moves);
        return Ok(json!({ "error": format!("移动失败：{e}") }));
    }

    let tx = conn.unchecked_transaction()?;
    let mut tx_err: Option<rusqlite::Error> = None;
    for plan in &plans {
        if let Err(e) = tx.execute(
            "UPDATE images SET filename = ?1, filepath = ?2, raw_path = ?3 WHERE id = ?4",
            rusqlite::params![plan.filename, plan.filepath, plan.raw_path, plan.id],
        ) {
            tx_err = Some(e);
            break;
        }
    }
    if let Some(e) = tx_err {
        drop(tx);
        rollback_moves(&moves);
        eprintln!("[迁移] 事务写入失败: {e}");
        return Ok(json!({ "error": format!("迁移写库失败：{e}") }));
    }
    if let Err(e) = tx.commit() {
        rollback_moves(&moves);
        eprintln!("[迁移] 事务写入失败: {e}");
        return Ok(json!({ "error": format!("迁移写库失败：{e}") }));
    }

    let moved = plans.iter().filter(|p| p.moved_file).count();
    set_setting(conn, "images_root", &resolved_new.to_string_lossy())?;
    Ok(json!({
        "success": true,
        "path": resolved_new.to_string_lossy(),
        "moved": moved,
    }))
}

// ── 命令封装 ──

#[tauri::command]
pub fn sync_camera_folder(db: State<'_, Db>, paths: State<'_, AppPaths>) -> Result<Value, String> {
    let conn = db.0.lock().unwrap();
    let camera_dir: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'camera_folder'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    if camera_dir.is_empty() {
        return Ok(json!({ "error": "未设置相机文件夹" }));
    }
    if !Path::new(&camera_dir).exists() {
        return Ok(json!({ "error": "相机文件夹不存在" }));
    }
    match camera_sync(
        &conn,
        Path::new(&camera_dir),
        &paths.default_images_dir,
        &paths.thumbs_dir,
    ) {
        Ok(v) => Ok(v),
        Err(e) => {
            eprintln!("[ipc] 相机同步失败: {e}");
            Ok(json!({ "error": format!("相机同步失败: {e}") }))
        }
    }
}

#[tauri::command]
pub fn set_images_root(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    app: tauri::AppHandle,
    dir_path: String,
) -> Result<Value, String> {
    let conn = db.0.lock().unwrap();
    match migrate_images_root(
        &conn,
        &dir_path,
        &paths.default_images_dir,
        &paths.thumbs_dir,
    ) {
        Ok(v) => Ok(v),
        Err(e) => {
            eprintln!("[ipc] 迁移图片目录失败: {e}");
            Ok(json!({ "error": format!("迁移失败: {e}") }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, RgbaImage};
    use rusqlite::params;

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

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pixyang_camera_{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM images", [], |r| r.get(0))
            .unwrap()
    }

    fn get_setting(conn: &Connection, key: &str) -> Option<String> {
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()
        .unwrap()
    }

    #[test]
    fn 相机同步首次导入_配对成组与隐藏nef() {
        let dir = temp_dir("first");
        let cam = dir.join("cam");
        let thumbs = dir.join("thumbs");
        let default_images = dir.join("managed");
        std::fs::create_dir_all(&cam).unwrap();
        make_jpeg(&cam, "DSC_1.jpg", 40, 30);
        std::fs::write(cam.join("DSC_1.NEF"), b"pair-raw").unwrap();
        std::fs::write(cam.join("lone.nef"), b"lone-raw").unwrap();

        let conn = mem_db();
        let result = camera_sync(&conn, &cam, &default_images, &thumbs).unwrap();
        assert_eq!(result["scanned"], 3);
        assert_eq!(result["imported"], 2);
        assert_eq!(result["jpgImported"], 1);
        assert_eq!(result["nefImported"], 1);
        assert_eq!(result["attached"], 0);
        assert_eq!(result["skipped"], 0);
        assert_eq!(count(&conn), 2);

        let visible: ImageRow = conn
            .query_row("SELECT * FROM images WHERE hidden = 0", [], row_from)
            .unwrap();
        assert!(visible
            .filepath
            .starts_with(default_images.to_string_lossy().as_ref()));
        assert!(Path::new(&visible.filepath).exists());
        assert_eq!(
            visible.original_path.as_deref(),
            Some(cam.join("DSC_1.jpg").to_string_lossy().as_ref())
        );
        assert!(!visible.raw_path.as_deref().unwrap_or("").is_empty());
        assert!(Path::new(visible.raw_path.as_deref().unwrap_or("")).exists());
        assert!(visible.raw_path.as_deref().unwrap_or("").ends_with(".NEF"));
        assert_eq!(
            visible.original_raw_path.as_deref(),
            Some(cam.join("DSC_1.NEF").to_string_lossy().as_ref())
        );
        assert!(!visible.thumbnail_path.as_deref().unwrap_or("").is_empty());

        let hidden: ImageRow = conn
            .query_row("SELECT * FROM images WHERE hidden = 1", [], row_from)
            .unwrap();
        assert!(hidden
            .filepath
            .starts_with(default_images.to_string_lossy().as_ref()));
        assert!(Path::new(&hidden.filepath).exists());
        assert_eq!(
            hidden.original_path.as_deref(),
            Some(cam.join("lone.nef").to_string_lossy().as_ref())
        );
        assert!(hidden.raw_path.as_deref().unwrap_or("").is_empty());
        assert!(hidden.thumbnail_path.as_deref().unwrap_or("").is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 相机同步重复执行_零新增() {
        let dir = temp_dir("repeat");
        let cam = dir.join("cam");
        let default_images = dir.join("managed");
        std::fs::create_dir_all(&cam).unwrap();
        make_jpeg(&cam, "DSC_1.jpg", 40, 30);
        std::fs::write(cam.join("DSC_1.NEF"), b"pair-raw").unwrap();
        std::fs::write(cam.join("lone.nef"), b"lone-raw").unwrap();

        let conn = mem_db();
        let first = camera_sync(&conn, &cam, &default_images, &dir.join("thumbs")).unwrap();
        assert_eq!(first["imported"], 2);

        let second = camera_sync(&conn, &cam, &default_images, &dir.join("thumbs")).unwrap();
        assert_eq!(second["scanned"], 3);
        assert_eq!(second["imported"], 0);
        assert_eq!(second["jpgImported"], 0);
        assert_eq!(second["nefImported"], 0);
        assert_eq!(second["attached"], 0);
        assert_eq!(second["skipped"], 2);
        assert_eq!(count(&conn), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 相机同步已有记录缺raw时补配对() {
        let dir = temp_dir("attach");
        let cam = dir.join("cam");
        let default_images = dir.join("managed");
        std::fs::create_dir_all(&cam).unwrap();
        let jpg = make_jpeg(&cam, "DSC_2.jpg", 20, 20);
        let cam_nef = cam.join("DSC_2.NEF");
        std::fs::write(&cam_nef, b"late-raw").unwrap();

        let conn = mem_db();
        camera_sync(&conn, &cam, &default_images, &dir.join("thumbs")).unwrap();
        let visible: ImageRow = conn
            .query_row("SELECT * FROM images WHERE hidden = 0", [], row_from)
            .unwrap();
        let raw_in_managed = visible.raw_path.clone().unwrap();
        std::fs::remove_file(&raw_in_managed).unwrap();
        conn.execute(
            "UPDATE images SET raw_path = '', original_raw_path = '' WHERE id = ?1",
            params![visible.id],
        )
        .unwrap();

        let result = camera_sync(&conn, &cam, &default_images, &dir.join("thumbs")).unwrap();
        assert_eq!(result["imported"], 0);
        assert_eq!(result["attached"], 1);
        assert_eq!(result["skipped"], 1);
        assert_eq!(count(&conn), 1);
        let after: ImageRow = conn
            .query_row(
                "SELECT * FROM images WHERE id = ?1",
                params![visible.id],
                row_from,
            )
            .unwrap();
        assert!(Path::new(after.raw_path.as_deref().unwrap()).exists());
        assert_eq!(
            after.original_raw_path.as_deref(),
            Some(cam_nef.to_string_lossy().as_ref())
        );
        assert!(jpg.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 图片根迁移_记录指向新根且文件已移动() {
        let dir = temp_dir("migrate");
        let old_root = dir.join("old");
        let new_root = dir.join("new");
        let date_dir = old_root.join("2026").join("01").join("01");
        std::fs::create_dir_all(&date_dir).unwrap();
        let jpg1 = make_jpeg(&date_dir, "a.jpg", 30, 20);
        let nef1 = date_dir.join("a.nef");
        std::fs::write(&nef1, b"raw-1").unwrap();
        let jpg2 = date_dir.join("b.jpg");

        let conn = mem_db();
        conn.execute(
            "INSERT INTO images (filename, filepath, raw_path, original_raw_path, import_date) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["a.jpg", jpg1.to_string_lossy(), nef1.to_string_lossy(), "cam/a.nef", "2026-01-01"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO images (filename, filepath, import_date) VALUES (?1, ?2, ?3)",
            params!["b.jpg", jpg2.to_string_lossy(), "2026-01-01"],
        )
        .unwrap();

        let thumbs = dir.join("thumbs");
        let result =
            migrate_images_root(&conn, new_root.to_str().unwrap(), &old_root, &thumbs).unwrap();
        assert_eq!(result["success"], true);
        assert_eq!(result["moved"], 1);
        assert_eq!(result["path"], new_root.to_string_lossy().as_ref());

        let new_date = new_root.join("2026").join("01").join("01");
        assert!(new_date.join("a.jpg").exists());
        assert!(new_date.join("a.nef").exists());
        assert!(!jpg1.exists());
        assert!(!nef1.exists());

        let row1: ImageRow = conn
            .query_row(
                "SELECT * FROM images WHERE filename = 'a.jpg'",
                [],
                row_from,
            )
            .unwrap();
        assert_eq!(row1.filepath, new_date.join("a.jpg").to_string_lossy());
        assert!(Path::new(&row1.filepath).exists());
        assert_eq!(
            row1.raw_path.as_deref(),
            Some(new_date.join("a.nef").to_string_lossy().as_ref())
        );
        assert_eq!(row1.original_raw_path.as_deref(), Some("cam/a.nef"));

        let row2: ImageRow = conn
            .query_row(
                "SELECT * FROM images WHERE filename = 'b.jpg'",
                [],
                row_from,
            )
            .unwrap();
        assert_eq!(row2.filepath, new_date.join("b.jpg").to_string_lossy());
        assert!(!Path::new(&row2.filepath).exists());

        assert_eq!(
            get_setting(&conn, "images_root").as_deref(),
            Some(new_root.to_string_lossy().as_ref())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 非法新根_空路径拒绝与目标占用回滚() {
        let dir = temp_dir("rollback");
        let old_root = dir.join("old");
        let date_dir = old_root.join("2026").join("01").join("01");
        std::fs::create_dir_all(&date_dir).unwrap();
        let jpg1 = make_jpeg(&date_dir, "a.jpg", 30, 20);
        let nef1 = date_dir.join("a.nef");
        std::fs::write(&nef1, b"raw-1").unwrap();

        let conn = mem_db();
        conn.execute(
            "INSERT INTO images (filename, filepath, raw_path, import_date) VALUES (?1, ?2, ?3, ?4)",
            params!["a.jpg", jpg1.to_string_lossy(), nef1.to_string_lossy(), "2026-01-01"],
        )
        .unwrap();

        let invalid = migrate_images_root(&conn, "", &old_root, &dir.join("thumbs")).unwrap();
        assert_eq!(invalid["error"], "保存路径无效");
        assert!(get_setting(&conn, "images_root").is_none());
        assert!(jpg1.exists());

        let new_root = dir.join("new");
        let new_date = new_root.join("2026").join("01").join("01");
        std::fs::create_dir_all(&new_date).unwrap();
        std::fs::write(new_date.join("a.nef"), b"occupied").unwrap();

        let result = migrate_images_root(
            &conn,
            new_root.to_str().unwrap(),
            &old_root,
            &dir.join("thumbs"),
        )
        .unwrap();
        assert!(result["error"]
            .as_str()
            .unwrap()
            .contains("目标 NEF 名已被占用"));
        assert!(jpg1.exists());
        assert!(nef1.exists());
        assert!(!new_date.join("a.jpg").exists());
        let row: ImageRow = conn
            .query_row("SELECT * FROM images WHERE id = 1", [], row_from)
            .unwrap();
        assert_eq!(row.filepath, jpg1.to_string_lossy());
        assert_eq!(
            row.raw_path.as_deref(),
            Some(nef1.to_string_lossy().as_ref())
        );
        assert!(get_setting(&conn, "images_root").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

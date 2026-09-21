// 编辑会话内核（迁移接缝 6）：electron/database.js 的 saveEditedImage/getEdits/saveEdits/
// getEditHistory 与 electron/main.js 烘焙（bake）/导出（export）编排中可内核化部分的 Rust 直译。
// 会话状态（editSessions 表、底图缓存、预览世代令牌）留在命令层，此处以 input 参数承接已就绪底图。

use crate::error::PixError;
use crate::executor;
use crate::images_query;
use crate::naming::{basename_no_ext, extname};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const HISTORY_LIMIT: i64 = 50;

// 磁盘上限（LRU）：编辑预览文件数超过时清最旧（与 Electron EDIT_PREVIEW_LIMIT 一致）
pub const EDIT_PREVIEW_LIMIT: i64 = 500;

pub fn default_edits() -> Value {
    json!({
        "schemaVersion": 1,
        "orientation": { "rotate": 0, "flipH": false, "flipV": false },
        "crop": null,
        "basic": {
            "exposure": 0, "contrast": 0, "highlights": 0, "shadows": 0,
            "whites": 0, "blacks": 0, "saturation": 0, "temperature": 0, "tint": 0
        },
        "curves": { "rgb": [], "r": [], "g": [], "b": [] },
        "hsl": { "hue": [], "sat": [], "lum": [] },
        "colorGrading": { "shadows": [], "midtones": [], "highlights": [] },
        "detail": { "sharpness": 0, "noise": 0 },
        "lens": { "profile": "", "distortion": 0, "vignette": 0, "chromatic": 0 },
        "masks": [],
        "output": { "format": "jpeg", "quality": 92, "icc": "", "resize": null }
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn ext_lower(path: &str) -> String {
    extname(path).to_lowercase()
}

fn file_name_of(path: impl AsRef<Path>) -> String {
    path.as_ref()
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn get_edits_row(conn: &Connection, id: i64) -> Result<Option<String>, PixError> {
    conn.query_row(
        "SELECT params_json FROM edits WHERE image_id = ?1",
        [id],
        |r| r.get(0),
    )
    .optional()
    .map_err(PixError::Db)
}

/// 镜像 getEdits：无记录返回 null；params_json 损坏时回退默认参数（永不抛错）
pub fn get_edits(conn: &Connection, id: i64) -> Result<Value, PixError> {
    let row: Option<(i64, String, Option<String>)> = conn
        .query_row(
            "SELECT version, params_json, updated_at FROM edits WHERE image_id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let Some((version, params_json, updated_at)) = row else {
        return Ok(Value::Null);
    };
    let params = match serde_json::from_str::<Value>(&params_json) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[编辑参数] 解析失败: {e}");
            default_edits()
        }
    };
    Ok(json!({ "version": version, "updatedAt": updated_at, "params": params }))
}

/// 镜像 enforceEditPreviewLimit：预览文件数超上限时按 edits.updated_at 清最旧
/// （文件+缓存元数据删除、路径列清空；edits 行保留，下次保存自愈）。返回清理数。
pub fn enforce_edit_preview_limit(
    conn: &Connection,
    thumbs_dir: &Path,
    limit: i64,
) -> Result<i64, PixError> {
    let rows: Vec<(i64, String)> = {
        let mut stmt = conn.prepare(
            "SELECT i.id, i.thumbnail_edit_path
             FROM images i
             LEFT JOIN edits e ON e.image_id = i.id
             WHERE i.thumbnail_edit_path != ''
             ORDER BY COALESCE(e.updated_at, '1970-01-01') DESC",
        )?;
        let it = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        it.collect::<rusqlite::Result<Vec<_>>>()?
    };
    if rows.len() as i64 <= limit {
        return Ok(0);
    }
    let mut removed = 0i64;
    for (id, path) in rows.iter().skip(limit as usize) {
        let _ = std::fs::remove_file(Path::new(path));
        let _ = std::fs::remove_file(Path::new(&format!("{}.meta.json", path)));
        conn.execute(
            "UPDATE images SET thumbnail_edit_path = '' WHERE id = ?1",
            rusqlite::params![id],
        )?;
        removed += 1;
    }
    Ok(removed)
}

/// 镜像 saveEdits：参数 upsert 且 version+1；command.label 非空时推入历史并按 HISTORY_LIMIT 裁剪。
/// preserveGeometry 时保留目标图已有 crop/orientation（命令方未携带几何语义）。
pub fn save_edit_params(
    conn: &Connection,
    id: i64,
    params: &Value,
    command: Option<&Value>,
) -> Result<Value, PixError> {
    if images_query::get_image_by_id(conn, id)?.is_none() {
        return Ok(json!({ "error": "图片不存在" }));
    }
    let preserve = command
        .and_then(|c| c.get("preserveGeometry"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let mut incoming = params.clone();
    if preserve {
        if let Some(json_str) = get_edits_row(conn, id)? {
            let prev: Value = serde_json::from_str(&json_str).unwrap_or(Value::Null);
            if let (Value::Object(prev_map), Value::Object(in_map)) = (&prev, &mut incoming) {
                let crop = prev_map
                    .get("crop")
                    .filter(|v| !v.is_null())
                    .or_else(|| in_map.get("crop").filter(|v| !v.is_null()))
                    .cloned()
                    .unwrap_or(Value::Null);
                in_map.insert("crop".to_string(), crop);
                if let Some(o) = prev_map
                    .get("orientation")
                    .filter(|v| !v.is_null())
                    .or_else(|| in_map.get("orientation"))
                    .cloned()
                {
                    in_map.insert("orientation".to_string(), o);
                }
            }
        }
    }
    let json_text = incoming.to_string();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO edits (image_id, version, params_json, updated_at)
         VALUES (?1, 1, ?2, CURRENT_TIMESTAMP)
         ON CONFLICT(image_id) DO UPDATE SET
           version = version + 1,
           params_json = excluded.params_json,
           updated_at = CURRENT_TIMESTAMP",
        rusqlite::params![id, json_text],
    )?;
    let version: i64 =
        tx.query_row("SELECT version FROM edits WHERE image_id = ?1", [id], |r| {
            r.get(0)
        })?;
    let label = command
        .and_then(|c| c.get("label"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    if let Some(label) = label {
        let last: Option<i64> = tx.query_row(
            "SELECT MAX(step) FROM edit_history WHERE image_id = ?1",
            [id],
            |r| r.get(0),
        )?;
        let entry = json!({
            "label": label.chars().take(100).collect::<String>(),
            "before": command.and_then(|c| c.get("before")).cloned().unwrap_or(Value::Null),
            "after": command.and_then(|c| c.get("after")).cloned().unwrap_or(Value::Null),
            "at": now_ms(),
        });
        tx.execute(
            "INSERT INTO edit_history (image_id, step, command_json) VALUES (?1, ?2, ?3)",
            rusqlite::params![id, last.unwrap_or(0) + 1, entry.to_string()],
        )?;
        tx.execute(
            "DELETE FROM edit_history
             WHERE image_id = ?1
               AND step <= (SELECT MAX(step) FROM edit_history WHERE image_id = ?1) - ?2",
            rusqlite::params![id, HISTORY_LIMIT],
        )?;
    }
    tx.commit()?;
    Ok(json!({ "version": version, "params": incoming }))
}

/// 镜像 getEditHistory：按 step 升序，command_json 损坏的行 command 为 null
pub fn get_edit_history(conn: &Connection, id: i64) -> Result<Vec<Value>, PixError> {
    let mut stmt = conn
        .prepare("SELECT step, command_json FROM edit_history WHERE image_id = ?1 ORDER BY step")?;
    let rows = stmt.query_map([id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = Vec::new();
    for row in rows {
        let (step, command_json) = row?;
        let command = serde_json::from_str::<Value>(&command_json).unwrap_or(Value::Null);
        out.push(json!({ "step": step, "command": command }));
    }
    Ok(out)
}

/// 镜像 saveEditedImage：编辑产物（-temp）原子替代原图，rename 成功后才更新 DB。
/// 铁律：任何失败路径都不得先删原图——rename/写入再失败时原图必须完好。
/// 烘焙后效果已写入像素：参数重置为默认（保留 schemaVersion 与历史记录），否则重进编辑会二次施加。
pub fn save_edits(
    conn: &Connection,
    id: i64,
    edits: &Value,
    rendered_tmp: &Path,
    width: u32,
    height: u32,
    thumbs_dir: &Path,
) -> Result<Value, PixError> {
    let img = match images_query::get_image_by_id(conn, id)? {
        Some(row) => row,
        None => return Ok(json!({ "error": "图片不存在" })),
    };
    if !rendered_tmp.exists() {
        return Ok(json!({ "error": "编辑产物不存在" }));
    }

    let source_path = img.filepath.clone();
    let source_ext = ext_lower(&source_path);
    let out_ext = ext_lower(&rendered_tmp.to_string_lossy());
    let mut target_path = PathBuf::from(&source_path);
    let mut target_format = img.format.clone().unwrap_or_default();
    let mut renamed = false;
    if out_ext != source_ext {
        let dir = target_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();
        let base = basename_no_ext(&file_name_of(&source_path)).to_string();
        target_path = dir.join(format!("{base}{out_ext}"));
        target_format = out_ext;
        renamed = true;
        let target_str = target_path.to_string_lossy().to_string();
        let clash: Option<i64> = conn
            .query_row(
                "SELECT id FROM images WHERE filepath = ?1",
                [&target_str],
                |r| r.get(0),
            )
            .optional()?;
        if clash.is_some() {
            return Ok(
                json!({ "error": format!("目标文件名已被其他图片占用：{}", file_name_of(&target_path)) }),
            );
        }
        if target_path.exists() {
            return Ok(
                json!({ "error": format!("同名文件已存在：{}", file_name_of(&target_path)) }),
            );
        }
    }

    let size = std::fs::metadata(rendered_tmp)
        .map_err(|e| PixError::Io(format!("读取编辑产物失败: {e}")))?
        .len() as i64;

    let mut placed = false;
    for attempt in 0..3 {
        match std::fs::rename(rendered_tmp, &target_path) {
            Ok(()) => {
                placed = true;
                break;
            }
            Err(_) if attempt < 2 => std::thread::sleep(Duration::from_millis(150)),
            Err(_) => {}
        }
    }
    if !placed {
        let side_path = PathBuf::from(format!("{}.bake-tmp", target_path.to_string_lossy()));
        let fallback = std::fs::copy(rendered_tmp, &side_path)
            .and_then(|_| std::fs::rename(&side_path, &target_path));
        if let Err(e) = fallback {
            let _ = std::fs::remove_file(&side_path);
            return Ok(
                json!({ "error": format!("替代原文件失败：{e}（原文件未受影响，请稍后重试）") }),
            );
        }
    }
    let _ = std::fs::remove_file(rendered_tmp);
    if renamed {
        let old = Path::new(&source_path);
        if old.exists() {
            if let Err(e) = std::fs::remove_file(old) {
                eprintln!(
                    "[db] 旧格式源文件清理失败（不阻塞，可手动删除）: {} {e}",
                    source_path
                );
            }
        }
    }

    let final_width = if width > 0 {
        width as i64
    } else {
        img.width.unwrap_or(0)
    };
    let final_height = if height > 0 {
        height as i64
    } else {
        img.height.unwrap_or(0)
    };
    let target_str = target_path.to_string_lossy().to_string();
    let tx = conn.unchecked_transaction()?;
    if renamed {
        tx.execute(
            "UPDATE images
             SET width = ?1, height = ?2, size = ?3, filepath = ?4, format = ?5, filename = ?6,
                 rotation = 0, flip_h = 0, flip_v = 0,
                 thumbnail = '', thumbnail_path = '', thumbnail_small_path = '', thumbnail_edit_path = '',
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?7",
            rusqlite::params![
                final_width,
                final_height,
                size,
                target_str,
                target_format,
                file_name_of(&target_path),
                id
            ],
        )?;
    } else {
        tx.execute(
            "UPDATE images
             SET width = ?1, height = ?2, size = ?3, filepath = ?4, format = ?5,
                 rotation = 0, flip_h = 0, flip_v = 0,
                 thumbnail = '', thumbnail_path = '', thumbnail_small_path = '', thumbnail_edit_path = '',
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?6",
            rusqlite::params![final_width, final_height, size, target_str, target_format, id],
        )?;
    }
    tx.commit()?;

    for name in [format!("{id}.jpg"), format!("{id}_s.jpg")] {
        let p = thumbs_dir.join(name);
        if p.exists() {
            let _ = std::fs::remove_file(p);
        }
    }

    if let Some(json_str) = get_edits_row(conn, id)? {
        let stored: Value = serde_json::from_str(&json_str).unwrap_or(Value::Null);
        let schema_version = stored
            .get("schemaVersion")
            .and_then(|v| v.as_i64())
            .or_else(|| edits.get("schemaVersion").and_then(|v| v.as_i64()))
            .unwrap_or(1);
        let mut reset = default_edits();
        reset["schemaVersion"] = json!(schema_version);
        conn.execute(
            "UPDATE edits SET params_json = ?1 WHERE image_id = ?2",
            rusqlite::params![reset.to_string(), id],
        )?;
    }

    let fresh = images_query::get_image_by_id(conn, id)?
        .ok_or_else(|| PixError::Io("保存后图片记录缺失".into()))?;
    serde_json::to_value(fresh).map_err(|e| PixError::Io(format!("行序列化失败: {e}")))
}

fn force_encode_format(spec: &Value, format: &str) -> Value {
    let mut spec = spec.clone();
    if let Some(stages) = spec.get_mut("stages").and_then(|s| s.as_array_mut()) {
        for stage in stages.iter_mut() {
            if stage.get("kind").and_then(|k| k.as_str()) == Some("encode") {
                if let Some(p) = stage.get_mut("params") {
                    if p.is_null() {
                        *p = json!({});
                    }
                    if let Value::Object(map) = p {
                        map.insert("format".to_string(), json!(format));
                    }
                }
            }
        }
    }
    spec
}

/// 镜像 bakeEditSession 可内核化部分：渲染 spec 到 原名-temp → 原子替代原图。
/// 输出格式跟随原图扩展名（png→png、webp→webp、其余→jpeg）；temp 扩展名跟随输出，
/// 源扩展名不受支持时（gif 等）由 save_edits 托管改名到 .jpg。temp 撞托管记录先围栏后渲染。
pub fn edit_bake(
    conn: &Connection,
    id: i64,
    edits: &Value,
    spec: &Value,
    input: &Path,
    thumbs_dir: &Path,
) -> Result<Value, PixError> {
    let img = match images_query::get_image_by_id(conn, id)? {
        Some(row) => row,
        None => return Ok(json!({ "error": "编辑会话不存在" })),
    };
    let out_format = match ext_lower(&img.filepath).as_str() {
        ".png" => "png",
        ".webp" => "webp",
        _ => "jpeg",
    };
    let out_ext = match out_format {
        "png" => ".png",
        "webp" => ".webp",
        _ => ".jpg",
    };
    let dir = Path::new(&img.filepath)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    let base = basename_no_ext(&file_name_of(&img.filepath)).to_string();
    let temp_path = dir.join(format!("{base}-temp{out_ext}"));
    let temp_str = temp_path.to_string_lossy().to_string();
    let fenced: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM images WHERE filepath = ?1 COLLATE NOCASE",
            [&temp_str],
            |r| r.get(0),
        )
        .optional()?;
    if fenced.is_some() {
        return Ok(
            json!({ "error": format!("临时文件名与图库中另一图片冲突（{}），请重命名冲突图片后重试", file_name_of(&temp_path)) }),
        );
    }

    let forced = force_encode_format(spec, out_format);
    let dims = match executor::render_spec_to_file(&forced, input, &temp_path) {
        Ok(d) => d,
        Err(e) => return Ok(json!({ "error": format!("渲染失败：{e}") })),
    };

    let product = image::ImageReader::open(&temp_path)
        .ok()
        .and_then(|r| r.with_guessed_format().ok())
        .and_then(|r| r.into_dimensions().ok());
    match product {
        Some((w, h)) if w == dims.width && h == dims.height => {}
        Some((w, h)) => {
            let _ = std::fs::remove_file(&temp_path);
            return Ok(
                json!({ "error": format!("渲染产物校验失败（{w}x{h}，期望 {}x{}），已放弃替代", dims.width, dims.height) }),
            );
        }
        None => {
            let _ = std::fs::remove_file(&temp_path);
            return Ok(json!({ "error": "渲染产物校验失败：产物不可解码" }));
        }
    }

    // EXIF 回接来源改原图：base 为再编码副本/NEF 预览时无原图 EXIF（零拷贝时执行器已从原图回接）
    // 必须先于 save_edits：落库 size 需与回接后的磁盘字节一致
    if input != Path::new(&img.filepath) {
        if let Err(e) = crate::exif_relay::relay_exif_files(Path::new(&img.filepath), &temp_path) {
            eprintln!("[编辑烘焙] EXIF 回接失败: {e}");
        }
    }

    let saved = match save_edits(
        conn,
        id,
        edits,
        &temp_path,
        dims.width,
        dims.height,
        thumbs_dir,
    ) {
        Ok(v) => v,
        Err(e) => {
            return Ok(
                json!({ "error": format!("保存失败：{e}（像素可能已替换，请重新进入编辑确认）") }),
            )
        }
    };
    if saved.get("error").is_some() {
        let _ = std::fs::remove_file(&temp_path);
        return Ok(saved);
    }

    // 烘焙后原图已是新像素：预览与底图缓存必须整组清除（ensure_edit_base 按 mtime+size 侧车
    // 复用，残留底图/侧车会让下次编辑从烘焙前像素开始——镜像 Electron cleanupEditBaseCache）
    let preview = thumbs_dir.join(format!("edit-{id}.jpg"));
    let preview_meta = PathBuf::from(format!("{}.meta.json", preview.to_string_lossy()));
    let base_jpg = thumbs_dir.join(format!("edit-{id}-base.jpg"));
    let base_png = thumbs_dir.join(format!("edit-{id}-base.png"));
    let base_sidecar = PathBuf::from(format!("{}.meta.json", base_jpg.to_string_lossy()));
    for p in [preview, preview_meta, base_jpg, base_png, base_sidecar] {
        if p.exists() {
            let _ = std::fs::remove_file(p);
        }
    }

    Ok(json!({ "ok": true, "image": saved }))
}

/// 镜像 exportEditSession 可内核化部分：渲染 spec 到调用方解析好的目标路径，
/// 格式/质量以 spec.encode 为准；不写库、不动原图。
pub fn edit_export(
    conn: &Connection,
    id: i64,
    spec: &Value,
    input: &Path,
    export_path: &Path,
) -> Result<Value, PixError> {
    let img = match images_query::get_image_by_id(conn, id)? {
        Some(row) => row,
        None => return Ok(json!({ "error": "编辑会话不存在" })),
    };
    match executor::render_spec_to_file(spec, input, export_path) {
        Ok(dims) => {
            if input != Path::new(&img.filepath) {
                if let Err(e) =
                    crate::exif_relay::relay_exif_files(Path::new(&img.filepath), export_path)
                {
                    eprintln!("[编辑导出] EXIF 回接失败: {e}");
                }
            }
            Ok(json!({
                "ok": true,
                "path": export_path.to_string_lossy(),
                "width": dims.width,
                "height": dims.height,
            }))
        }
        Err(e) => Ok(json!({ "error": format!("导出失败：{e}") })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, RgbaImage};

    fn edit_mem_db() -> Connection {
        let conn = crate::images_query::tests::mem_db();
        conn.execute_batch(
            "DROP TABLE IF EXISTS edits;
             DROP TABLE IF EXISTS edit_history;
             CREATE TABLE edits (
               image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
               version INTEGER NOT NULL DEFAULT 0,
               params_json TEXT NOT NULL,
               updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE edit_history (
               image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
               step INTEGER NOT NULL,
               command_json TEXT NOT NULL,
               PRIMARY KEY (image_id, step)
             );",
        )
        .unwrap();
        let has_col: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('images') WHERE name = 'thumbnail_edit_path'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        if has_col == 0 {
            conn.execute(
                "ALTER TABLE images ADD COLUMN thumbnail_edit_path TEXT DEFAULT ''",
                [],
            )
            .unwrap();
        }
        conn
    }

    fn fresh_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pixyang_edit_{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_jpeg(dir: &Path, name: &str, w: u32, h: u32, gray: u8) -> PathBuf {
        let img = DynamicImage::from(RgbaImage::from_fn(w, h, |_, _| {
            image::Rgba([gray, gray, gray, 255])
        }));
        let p = dir.join(name);
        img.save(&p).unwrap();
        p
    }

    fn seed_record(conn: &Connection, filename: &str, filepath: &Path, format: &str) -> i64 {
        conn.execute(
            "INSERT INTO images (filename, filepath, import_date, format, rotation, flip_h, width, height)
             VALUES (?1, ?2, '2026-09-20', ?3, 90, 1, 10, 8)",
            rusqlite::params![filename, filepath.to_string_lossy(), format],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn mean_gray(path: &Path) -> f64 {
        let img = image::ImageReader::open(path)
            .unwrap()
            .decode()
            .unwrap()
            .to_luma8();
        img.pixels().map(|p| p.0[0] as f64).sum::<f64>() / (img.width() * img.height()) as f64
    }

    #[test]
    fn save_edits_原子替换_元数据归零_缩略图清空_参数重置() {
        let dir = fresh_dir("save_ok");
        let thumbs = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs).unwrap();
        let conn = edit_mem_db();
        let src = make_jpeg(&dir, "photo.jpg", 60, 40, 100);
        let id = seed_record(&conn, "photo.jpg", &src, ".jpg");
        conn.execute(
            "INSERT INTO edits (image_id, version, params_json) VALUES (?1, 3, ?2)",
            rusqlite::params![
                id,
                json!({
                    "schemaVersion": 1,
                    "orientation": { "rotate": 90 },
                    "basic": { "exposure": 0.4 },
                    "crop": { "x": 1, "y": 1, "w": 5, "h": 5 }
                })
                .to_string()
            ],
        )
        .unwrap();
        std::fs::write(thumbs.join(format!("{id}.jpg")), b"t").unwrap();
        std::fs::write(thumbs.join(format!("{id}_s.jpg")), b"t").unwrap();
        let temp = dir.join("photo-temp.jpg");
        std::fs::write(&temp, b"baked-bytes").unwrap();

        let saved = save_edits(
            &conn,
            id,
            &json!({ "schemaVersion": 1 }),
            &temp,
            800,
            600,
            &thumbs,
        )
        .unwrap();
        assert!(saved.get("error").is_none(), "{saved}");
        assert_eq!(saved["filepath"], src.to_string_lossy().to_string());
        assert_eq!(saved["width"], 800);
        assert_eq!(saved["height"], 600);
        assert_eq!(saved["size"], 11);
        assert_eq!(saved["rotation"], 0);
        assert_eq!(saved["flip_h"], 0);
        assert_eq!(saved["thumbnail_path"], "");
        assert_eq!(std::fs::read(&src).unwrap(), b"baked-bytes");
        assert!(!temp.exists());
        assert!(!thumbs.join(format!("{id}.jpg")).exists());
        assert!(!thumbs.join(format!("{id}_s.jpg")).exists());

        let after = get_edits(&conn, id).unwrap();
        assert_eq!(after["params"]["basic"]["exposure"], 0);
        assert_eq!(after["params"]["orientation"]["rotate"], 0);
        assert!(after["params"]["crop"].is_null());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_edits_temp缺失或记录不存在_报错且原图不动() {
        let dir = fresh_dir("save_missing");
        let conn = edit_mem_db();
        let src = make_jpeg(&dir, "keep.jpg", 20, 10, 100);
        let id = seed_record(&conn, "keep.jpg", &src, ".jpg");
        std::fs::write(&src, b"keep-bytes").unwrap();

        assert_eq!(
            save_edits(
                &conn,
                id,
                &Value::Null,
                &dir.join("nope-temp.jpg"),
                1,
                1,
                &dir
            )
            .unwrap(),
            json!({ "error": "编辑产物不存在" })
        );
        assert_eq!(
            save_edits(
                &conn,
                999_999,
                &Value::Null,
                &dir.join("x-temp.jpg"),
                1,
                1,
                &dir
            )
            .unwrap(),
            json!({ "error": "图片不存在" })
        );
        assert_eq!(std::fs::read(&src).unwrap(), b"keep-bytes");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_edits_扩展名改名目标被占用_报错_释放后托管改名() {
        let dir = fresh_dir("save_clash");
        let conn = edit_mem_db();
        let src = dir.join("a.gif");
        std::fs::write(&src, b"gif-bytes").unwrap();
        let id = seed_record(&conn, "a.gif", &src, ".gif");
        let temp = dir.join("a-temp.jpg");
        std::fs::write(&temp, b"jpeg-baked").unwrap();

        let other = dir.join("a.jpg");
        std::fs::write(&other, b"other-bytes").unwrap();
        let other_id = seed_record(&conn, "a.jpg", &other, ".jpg");
        assert_eq!(
            save_edits(&conn, id, &Value::Null, &temp, 10, 10, &dir).unwrap(),
            json!({ "error": "目标文件名已被其他图片占用：a.jpg" })
        );
        conn.execute("DELETE FROM images WHERE id = ?1", [other_id])
            .unwrap();
        assert_eq!(
            save_edits(&conn, id, &Value::Null, &temp, 10, 10, &dir).unwrap(),
            json!({ "error": "同名文件已存在：a.jpg" })
        );
        std::fs::remove_file(&other).unwrap();

        let saved = save_edits(&conn, id, &Value::Null, &temp, 30, 20, &dir).unwrap();
        assert!(saved.get("error").is_none(), "{saved}");
        assert_eq!(saved["filepath"], other.to_string_lossy().to_string());
        assert_eq!(saved["format"], ".jpg");
        assert_eq!(saved["filename"], "a.jpg");
        assert!(!src.exists());
        assert_eq!(std::fs::read(&other).unwrap(), b"jpeg-baked");
        assert!(!temp.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_edits_宽高为0时保留原记录尺寸() {
        let dir = fresh_dir("save_zero_dim");
        let conn = edit_mem_db();
        let src = make_jpeg(&dir, "z.jpg", 20, 10, 100);
        let id = seed_record(&conn, "z.jpg", &src, ".jpg");
        let temp = dir.join("z-temp.jpg");
        std::fs::write(&temp, b"zz").unwrap();

        let saved = save_edits(&conn, id, &Value::Null, &temp, 0, 0, &dir).unwrap();
        assert!(saved.get("error").is_none(), "{saved}");
        assert_eq!(saved["width"], 10);
        assert_eq!(saved["height"], 8);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_edit_params_版本递增_历史追加与超限裁剪() {
        let dir = fresh_dir("params_hist");
        let conn = edit_mem_db();
        let src = dir.join("h.jpg");
        std::fs::write(&src, b"x").unwrap();
        let id = seed_record(&conn, "h.jpg", &src, ".jpg");
        let params = json!({ "schemaVersion": 1, "basic": { "exposure": 0.5 } });

        let r1 = save_edit_params(
            &conn,
            id,
            &params,
            Some(&json!({ "label": "标".repeat(150), "before": {}, "after": params })),
        )
        .unwrap();
        assert!(r1.get("error").is_none(), "{r1}");
        assert_eq!(r1["version"], 1);
        let r2 = save_edit_params(&conn, id, &params, Some(&json!({ "label": "第二步" }))).unwrap();
        assert_eq!(r2["version"], 2);

        let hist = get_edit_history(&conn, id).unwrap();
        assert_eq!(hist.len(), 2);
        assert_eq!(hist[0]["step"], 1);
        assert_eq!(
            hist[0]["command"]["label"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            100
        );
        assert_eq!(hist[1]["step"], 2);
        assert_eq!(hist[1]["command"]["label"], "第二步");

        save_edit_params(&conn, id, &params, None).unwrap();
        assert_eq!(get_edit_history(&conn, id).unwrap().len(), 2);
        let r3 = save_edit_params(&conn, id, &params, None).unwrap();
        assert_eq!(r3["version"], 4);

        for step in 3..=52 {
            conn.execute(
                "INSERT INTO edit_history (image_id, step, command_json) VALUES (?1, ?2, '{}')",
                rusqlite::params![id, step],
            )
            .unwrap();
        }
        save_edit_params(&conn, id, &params, Some(&json!({ "label": "第五十三步" }))).unwrap();
        let hist = get_edit_history(&conn, id).unwrap();
        assert_eq!(hist.len(), 50);
        assert_eq!(hist[0]["step"], 4);
        assert_eq!(hist[49]["step"], 53);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_edits_往返_损坏回退默认_缺失为null() {
        let dir = fresh_dir("get_edits");
        let conn = edit_mem_db();
        let src = dir.join("g.jpg");
        std::fs::write(&src, b"x").unwrap();
        let id = seed_record(&conn, "g.jpg", &src, ".jpg");
        assert!(get_edits(&conn, id).unwrap().is_null());

        let params = json!({
            "schemaVersion": 1,
            "basic": { "exposure": 1.25 },
            "crop": { "x": 0, "y": 0, "w": 4, "h": 4 }
        });
        save_edit_params(&conn, id, &params, None).unwrap();
        let got = get_edits(&conn, id).unwrap();
        assert_eq!(got["version"], 1);
        assert!(got["updatedAt"].is_string());
        assert_eq!(got["params"]["basic"]["exposure"], 1.25);
        assert_eq!(got["params"]["crop"]["w"], 4);

        conn.execute(
            "UPDATE edits SET params_json = 'not-json' WHERE image_id = ?1",
            [id],
        )
        .unwrap();
        let broken = get_edits(&conn, id).unwrap();
        assert_eq!(broken["version"], 1);
        assert_eq!(broken["params"]["schemaVersion"], 1);
        assert_eq!(broken["params"]["basic"]["exposure"], 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn edit_bake_渲染替代原图_强制源格式_参数重置与预览清理() {
        let dir = fresh_dir("bake_ok");
        let thumbs = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs).unwrap();
        let conn = edit_mem_db();
        let src = make_jpeg(&dir, "photo.jpg", 32, 16, 100);
        let id = seed_record(&conn, "photo.jpg", &src, ".jpg");
        save_edit_params(
            &conn,
            id,
            &json!({ "schemaVersion": 1, "basic": { "exposure": 1 }, "orientation": { "rotate": 90 } }),
            None,
        )
        .unwrap();
        std::fs::write(thumbs.join(format!("{id}.jpg")), b"t").unwrap();
        std::fs::write(thumbs.join(format!("{id}_s.jpg")), b"t").unwrap();
        let preview = thumbs_dir_edit_preview(&thumbs, id);
        std::fs::write(&preview, b"p").unwrap();
        std::fs::write(format!("{}.meta.json", preview.to_string_lossy()), b"m").unwrap();
        let base_jpg = thumbs.join(format!("edit-{id}-base.jpg"));
        let base_png = thumbs.join(format!("edit-{id}-base.png"));
        std::fs::write(&base_jpg, b"b").unwrap();
        std::fs::write(&base_png, b"b").unwrap();

        let spec = json!({
            "specVersion": 1,
            "stages": [
                { "kind": "exposure", "params": { "ev": 1 } },
                { "kind": "encode", "params": { "format": "png" } }
            ]
        });
        let result = edit_bake(
            &conn,
            id,
            &json!({ "basic": { "exposure": 1 } }),
            &spec,
            &src,
            &thumbs,
        )
        .unwrap();
        assert!(result.get("error").is_none(), "{result}");
        assert_eq!(result["ok"], true);
        assert_eq!(result["image"]["rotation"], 0);
        assert!(!dir.join("photo-temp.jpg").exists());
        assert!(!dir.join("photo-temp.png").exists());
        assert!(src.exists());
        let after = mean_gray(&src);
        assert!(after > 150.0, "曝光未写入像素: {after}");
        assert!(!thumbs.join(format!("{id}.jpg")).exists());
        assert!(!thumbs.join(format!("{id}_s.jpg")).exists());
        assert!(!preview.exists());
        assert!(!Path::new(&format!("{}.meta.json", preview.to_string_lossy())).exists());
        assert!(!base_jpg.exists());
        assert!(!base_png.exists());
        let edits = get_edits(&conn, id).unwrap();
        assert_eq!(edits["params"]["basic"]["exposure"], 0);
        assert_eq!(edits["params"]["orientation"]["rotate"], 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn edit_bake_源扩展名不支持时托管改名到jpg并清理旧文件() {
        let dir = fresh_dir("bake_rename");
        let conn = edit_mem_db();
        let real_png = dir.join("real.png");
        DynamicImage::from(RgbaImage::from_fn(8, 8, |_, _| {
            image::Rgba([10, 20, 30, 255])
        }))
        .save(&real_png)
        .unwrap();
        let src = dir.join("b.gif");
        std::fs::copy(&real_png, &src).unwrap();
        let id = seed_record(&conn, "b.gif", &src, ".gif");

        let spec = json!({
            "specVersion": 1,
            "stages": [{ "kind": "encode", "params": { "format": "jpeg" } }]
        });
        let result = edit_bake(&conn, id, &Value::Null, &spec, &src, &dir).unwrap();
        assert!(result.get("error").is_none(), "{result}");
        let new_path = dir.join("b.jpg");
        assert!(new_path.exists());
        assert!(!src.exists());
        assert_eq!(
            result["image"]["filepath"],
            new_path.to_string_lossy().to_string()
        );
        assert_eq!(result["image"]["format"], ".jpg");
        assert_eq!(result["image"]["filename"], "b.jpg");
        assert_eq!(result["image"]["rotation"], 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn edit_bake_temp撞托管记录时围栏报错且不渲染() {
        let dir = fresh_dir("bake_fence");
        let conn = edit_mem_db();
        let src = make_jpeg(&dir, "photo.jpg", 16, 8, 100);
        let id = seed_record(&conn, "photo.jpg", &src, ".jpg");
        let intruder = dir.join("photo-temp.jpg");
        std::fs::write(&intruder, b"victim").unwrap();
        seed_record(&conn, "photo-temp.jpg", &intruder, ".jpg");

        let spec = json!({
            "specVersion": 1,
            "stages": [{ "kind": "encode", "params": { "format": "jpeg" } }]
        });
        let result = edit_bake(&conn, id, &Value::Null, &spec, &src, &dir).unwrap();
        assert_eq!(
            result,
            json!({ "error": "临时文件名与图库中另一图片冲突（photo-temp.jpg），请重命名冲突图片后重试" })
        );
        assert_eq!(std::fs::read(&intruder).unwrap(), b"victim");
        assert!(get_image_row(&conn, id).filepath.contains("photo.jpg"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn edit_export_渲染到目标路径_原图与记录不动() {
        let dir = fresh_dir("export_ok");
        let conn = edit_mem_db();
        let src = make_jpeg(&dir, "photo.jpg", 24, 12, 100);
        let id = seed_record(&conn, "photo.jpg", &src, ".jpg");
        std::fs::create_dir_all(dir.join("out")).unwrap();
        let dest = dir.join("out").join("photo-edited.jpg");
        let before = std::fs::read(&src).unwrap();

        let spec = json!({
            "specVersion": 1,
            "stages": [{ "kind": "encode", "params": { "format": "jpeg", "quality": 90 } }]
        });
        let r = edit_export(&conn, id, &spec, &src, &dest).unwrap();
        assert!(r.get("error").is_none(), "{r}");
        assert_eq!(r["ok"], true);
        assert_eq!(r["path"], dest.to_string_lossy().to_string());
        assert_eq!(r["width"], 24);
        assert_eq!(r["height"], 12);
        assert!(dest.exists());
        assert_eq!(std::fs::read(&src).unwrap(), before);
        let row = crate::images_query::get_image_by_id(&conn, id)
            .unwrap()
            .unwrap();
        assert_eq!(row.filepath, src.to_string_lossy().to_string());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn edit_export_会话不存在时报错() {
        let dir = fresh_dir("export_missing");
        let conn = edit_mem_db();
        let src = make_jpeg(&dir, "x.jpg", 8, 8, 100);
        let spec = json!({
            "specVersion": 1,
            "stages": [{ "kind": "encode", "params": {} }]
        });
        assert_eq!(
            edit_export(&conn, 424_242, &spec, &src, &dir.join("y.jpg")).unwrap(),
            json!({ "error": "编辑会话不存在" })
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ③ EXIF 回接来源改原图：base 为再编码副本（无 EXIF）时，烘焙/导出产物必须从原图回接
    fn seed_with_exif(dir: &Path, conn: &Connection) -> (i64, PathBuf, Vec<u8>) {
        let plain = make_jpeg(dir, "plain.jpg", 16, 8, 100);
        let plain_bytes = std::fs::read(&plain).unwrap();
        let exif_payload = b"Exif\0\0MM\x00\x2a-fake-tiff".to_vec();
        let with_exif = crate::exif_relay::inject_jpeg_exif(&plain_bytes, &[exif_payload.clone()]);
        let src = dir.join("photo.jpg");
        std::fs::write(&src, &with_exif).unwrap();
        let id = seed_record(conn, "photo.jpg", &src, ".jpg");
        let base = dir.join("base-copy.jpg");
        std::fs::write(&base, &plain_bytes).unwrap();
        (id, base, exif_payload)
    }

    #[test]
    fn edit_bake_底图为副本时产物从原图回接exif() {
        let dir = fresh_dir("bake_relay");
        let conn = edit_mem_db();
        let (id, base, exif_payload) = seed_with_exif(&dir, &conn);
        let spec = json!({
            "specVersion": 1,
            "stages": [
                { "kind": "exposure", "params": { "ev": 0.3 } },
                { "kind": "encode", "params": { "format": "jpeg" } }
            ]
        });
        let result = edit_bake(&conn, id, &Value::Null, &spec, &base, &dir).unwrap();
        assert!(result.get("error").is_none(), "{result}");
        let product = std::fs::read(dir.join("photo.jpg")).unwrap();
        assert_eq!(
            crate::exif_relay::jpeg_exif_segments(&product),
            vec![exif_payload]
        );
        assert!(!dir.join("photo-temp.jpg").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn edit_export_底图为副本时产物从原图回接exif() {
        let dir = fresh_dir("export_relay");
        let conn = edit_mem_db();
        let (id, base, exif_payload) = seed_with_exif(&dir, &conn);
        std::fs::create_dir_all(dir.join("out")).unwrap();
        let dest = dir.join("out").join("photo-edited.jpg");
        let spec = json!({
            "specVersion": 1,
            "stages": [{ "kind": "encode", "params": { "format": "jpeg", "quality": 90 } }]
        });
        let r = edit_export(&conn, id, &spec, &base, &dest).unwrap();
        assert_eq!(r["ok"], true, "{r}");
        let product = std::fs::read(&dest).unwrap();
        assert_eq!(
            crate::exif_relay::jpeg_exif_segments(&product),
            vec![exif_payload]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn thumbs_dir_edit_preview(thumbs: &Path, id: i64) -> PathBuf {
        thumbs.join(format!("edit-{id}.jpg"))
    }

    fn get_image_row(conn: &Connection, id: i64) -> crate::images_query::ImageRow {
        crate::images_query::get_image_by_id(conn, id)
            .unwrap()
            .unwrap()
    }
}

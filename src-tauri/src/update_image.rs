use crate::db::PixError;
use crate::err_cn;
use crate::image_group;
use crate::images_query::ImageRow;
use crate::naming;
use crate::progress;
use crate::thumbs;
use rusqlite::{params, params_from_iter, Connection};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

type SqlValue = rusqlite::types::Value;

const UPDATE_ALLOWED: [&str; 9] = [
    "rating",
    "favorite",
    "notes",
    "width",
    "height",
    "import_date",
    "rotation",
    "flip_h",
    "flip_v",
];
const BATCH_ALLOWED: [&str; 2] = ["rating", "favorite"];
const CHUNK_SIZE: usize = 900;
const HASH_WINDOW: i64 = 65_536;

fn get_img_row(conn: &Connection, id: i64) -> Option<ImageRow> {
    crate::images_query::get_image_by_id(conn, id).ok()?
}

fn js_truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

fn valid_ymd(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        })
}

fn value_to_sql(v: &Value) -> Option<SqlValue> {
    match v {
        Value::Null => Some(SqlValue::Null),
        Value::Bool(b) => Some(SqlValue::Integer(if *b { 1 } else { 0 })),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(SqlValue::Integer(i))
            } else {
                n.as_f64().map(SqlValue::Real)
            }
        }
        Value::String(s) => Some(SqlValue::Text(s.clone())),
        _ => None,
    }
}

fn err_message(e: &PixError) -> String {
    match e {
        PixError::Db(e) => err_cn::text(e),
        PixError::Io(msg) => err_cn::line(msg),
    }
}

fn taken_filepaths(conn: &Connection, exclude_id: i64) -> HashSet<String> {
    let mut taken = HashSet::new();
    if let Ok(mut stmt) = conn.prepare("SELECT filepath FROM images WHERE id != ?1") {
        if let Ok(rows) = stmt.query_map([exclude_id], |r| r.get::<_, String>(0)) {
            for p in rows.flatten() {
                taken.insert(p.to_lowercase());
            }
        }
    }
    taken
}

fn date_sub_dir(root: &Path, date: &str) -> PathBuf {
    match image_group::date_dir(date) {
        Some(rel) => {
            let mut dir = root.to_path_buf();
            for part in rel.components() {
                dir.push(part);
            }
            dir
        }
        None => root.to_path_buf(),
    }
}

fn rollback_moves(moves: &[(PathBuf, PathBuf)]) {
    for (from, to) in moves.iter().rev() {
        if let Err(e) = crate::file_ops::move_file_safe(to, from) {
            eprintln!("[日期] 回滚移动失败: {} {e}", to.display());
        }
    }
}

fn row_to_json(conn: &Connection, id: i64) -> Result<Value, PixError> {
    match crate::images_query::get_image_by_id(conn, id)? {
        Some(row) => Ok(serde_json::to_value(row).unwrap_or(Value::Null)),
        None => Ok(Value::Null),
    }
}

fn delete_thumbnail_file(thumbs_dir: &Path, id: i64) {
    // 含编辑派生文件（预览/缓存元数据/底图缓存），镜像 Electron cleanupEditDerivedFiles
    for name in [
        format!("{id}.jpg"),
        format!("{id}_s.jpg"),
        format!("edit-{id}.jpg"),
        format!("edit-{id}.jpg.meta.json"),
        format!("edit-{id}-base.jpg"),
        format!("edit-{id}-base.png"),
    ] {
        let path = thumbs_dir.join(name);
        if path.exists() {
            if let Err(e) = std::fs::remove_file(&path) {
                eprintln!("[缩略图] 删除文件失败: {e}");
            }
        }
    }
}

struct DateMovePlan {
    img: ImageRow,
    sub_dir: PathBuf,
    new_name: String,
    new_path: PathBuf,
    new_path_str: String,
}

// 阶段 1（锁内）：校验 + 读行 + 规划日期移动。Ok((None, Some(v)))=提前终止返回 v；
// Ok((None, None))=无日期移动，继续白名单阶段
fn plan_update_image(
    conn: &Connection,
    id: i64,
    updates: &Value,
    default_images_dir: &Path,
) -> Result<(Option<DateMovePlan>, Option<Value>), PixError> {
    let import_date = updates.get("import_date");
    if js_truthy(import_date) {
        let new_date = js_string(import_date.unwrap()).trim().to_string();
        if !new_date.is_empty() && !valid_ymd(&new_date) {
            return Ok((
                None,
                Some(json!({ "error": "日期格式无效（应为 YYYY-MM-DD）" })),
            ));
        }
        if !new_date.is_empty() {
            if let Some(img) = get_img_row(conn, id) {
                if img.import_date != new_date {
                    let root = crate::db::images_root(conn, default_images_dir)?;
                    let sub_dir = date_sub_dir(&root, &new_date);
                    std::fs::create_dir_all(&sub_dir)
                        .map_err(|e| PixError::Io(format!("建目录失败: {e}")))?;
                    let orig_name = image_group::basename(&img.filename);
                    let taken = taken_filepaths(conn, id);
                    let new_name =
                        naming::generate_unique_filename(&sub_dir, &orig_name, &taken, |p| {
                            p.exists()
                        });
                    let new_path = sub_dir.join(&new_name);
                    if !Path::new(&img.filepath).exists() {
                        return Ok((
                            None,
                            Some(json!({ "error": "源文件不存在，无法修改导入日期" })),
                        ));
                    }
                    return Ok((
                        Some(DateMovePlan {
                            img,
                            sub_dir,
                            new_name,
                            new_path_str: new_path.to_string_lossy().into_owned(),
                            new_path,
                        }),
                        None,
                    ));
                }
            }
        }
    }
    Ok((None, None))
}

// 阶段 2（锁外）：执行文件移动；任一步失败把已移动文件逆序移回，绝不留下 DB 指向不存在路径的 broken 记录。
// 返回（已移动清单, raw_path 终值）
fn execute_date_moves(plan: &DateMovePlan) -> Result<(Vec<(PathBuf, PathBuf)>, String), PixError> {
    let mut new_raw_path = plan.img.raw_path.clone().unwrap_or_default();
    let mut moves: Vec<(PathBuf, PathBuf)> = Vec::new();
    if plan.img.filepath != plan.new_path_str {
        crate::file_ops::move_file_safe(Path::new(&plan.img.filepath), &plan.new_path)?;
        moves.push((PathBuf::from(&plan.img.filepath), plan.new_path.clone()));
    }
    let raw = plan.img.raw_path.clone().unwrap_or_default();
    if !raw.is_empty() && Path::new(&raw).exists() {
        let raw_ext = naming::extname(&raw);
        new_raw_path = plan
            .sub_dir
            .join(format!(
                "{}{raw_ext}",
                naming::basename_no_ext(&plan.new_name)
            ))
            .to_string_lossy()
            .into_owned();
        if raw != new_raw_path {
            // POSIX rename 会静默覆盖占用者：NEF 目标名被占必须显式检查并走回滚分支
            if Path::new(&new_raw_path).exists() {
                rollback_moves(&moves);
                return Err(PixError::Io("目标 NEF 文件名已被占用".into()));
            }
            if let Err(e) =
                crate::file_ops::move_file_safe(Path::new(&raw), Path::new(&new_raw_path))
            {
                rollback_moves(&moves);
                return Err(e);
            }
            moves.push((PathBuf::from(&raw), PathBuf::from(&new_raw_path)));
        }
    }
    Ok((moves, new_raw_path))
}

// 阶段 2.5（纯函数，不触库）：白名单字段收集，返回 (sets, params, bind_unsupported)
fn whitelist_sets(updates: &Value) -> (Vec<String>, Vec<SqlValue>, bool) {
    let mut sets: Vec<String> = Vec::new();
    let mut params_sql: Vec<SqlValue> = Vec::new();
    if let Some(map) = updates.as_object() {
        for (key, value) in map {
            let column = match key.as_str() {
                "flipH" => "flip_h",
                "flipV" => "flip_v",
                other => other,
            };
            if UPDATE_ALLOWED.contains(&column) {
                match value_to_sql(value) {
                    Some(v) => {
                        sets.push(format!("{column} = ?"));
                        params_sql.push(v);
                    }
                    None => return (sets, params_sql, true),
                }
            }
        }
    }
    (sets, params_sql, false)
}

fn apply_date_sets(
    plan: &DateMovePlan,
    new_raw_path: &str,
    sets: &mut Vec<String>,
    params_sql: &mut Vec<SqlValue>,
) {
    sets.push("filename = ?".into());
    sets.push("filepath = ?".into());
    sets.push("raw_path = ?".into());
    params_sql.push(SqlValue::Text(plan.new_name.clone()));
    params_sql.push(SqlValue::Text(plan.new_path_str.clone()));
    params_sql.push(SqlValue::Text(new_raw_path.to_string()));
}

pub fn update_image(
    conn: &Connection,
    id: i64,
    updates: &Value,
    default_images_dir: &Path,
    _thumbs_dir: &Path,
) -> Result<Value, PixError> {
    let (plan, terminal) = plan_update_image(conn, id, updates, default_images_dir)?;
    if let Some(v) = terminal {
        return Ok(v);
    }
    let mut date_moved = false;
    let mut moved_files: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut sets: Vec<String> = Vec::new();
    let mut params_sql: Vec<SqlValue> = Vec::new();

    if let Some(plan) = &plan {
        match execute_date_moves(plan) {
            Ok((moves, new_raw_path)) => {
                date_moved = true;
                moved_files = moves;
                apply_date_sets(plan, &new_raw_path, &mut sets, &mut params_sql);
            }
            Err(e) => {
                eprintln!("[日期] 移动文件失败: {e}");
                return Ok(json!({ "error": format!("移动文件失败：{}", err_message(&e)) }));
            }
        }
    }

    let (w_sets, w_params, bind_unsupported) = whitelist_sets(updates);
    if bind_unsupported {
        rollback_moves(&moved_files);
        return Ok(json!({ "error": "更新失败：不支持的更新值类型" }));
    }
    sets.extend(w_sets);
    params_sql.extend(w_params);

    if sets.is_empty() {
        return if date_moved {
            row_to_json(conn, id)
        } else {
            Ok(json!(true))
        };
    }

    params_sql.push(SqlValue::Integer(id));
    let sql = format!("UPDATE images SET {} WHERE id = ?", sets.join(", "));
    if let Err(e) = conn.execute(&sql, params_from_iter(params_sql)) {
        // 日期移动已把文件落到新路径：UPDATE 失败必须把文件逆序移回，让记录与磁盘一起停在原地
        rollback_moves(&moved_files);
        eprintln!("[日期] 更新失败: {e}");
        return Ok(json!({ "error": format!("更新失败：{}", err_cn::text(&e)) }));
    }
    if date_moved {
        row_to_json(conn, id)
    } else {
        Ok(json!(true))
    }
}

/// Db 级短锁编排：锁内规划 → 锁外文件移动 → 锁内单条 UPDATE + 回读。
/// 与 update_image 行为契约一致；供命令层在 WAL 读连接可用时避免长持写锁
pub fn update_image_db(
    db: &crate::db::Db,
    id: i64,
    updates: &Value,
    default_images_dir: &Path,
    _thumbs_dir: &Path,
) -> Result<Value, PixError> {
    let (plan, terminal) = {
        let conn = db.write_lock();
        plan_update_image(&conn, id, updates, default_images_dir)?
    };
    if let Some(v) = terminal {
        return Ok(v);
    }
    let mut date_moved = false;
    let mut moved_files: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut sets: Vec<String> = Vec::new();
    let mut params_sql: Vec<SqlValue> = Vec::new();

    if let Some(plan) = &plan {
        match execute_date_moves(plan) {
            Ok((moves, new_raw_path)) => {
                date_moved = true;
                moved_files = moves;
                apply_date_sets(plan, &new_raw_path, &mut sets, &mut params_sql);
            }
            Err(e) => {
                eprintln!("[日期] 移动文件失败: {e}");
                return Ok(json!({ "error": format!("移动文件失败：{}", err_message(&e)) }));
            }
        }
    }

    let (w_sets, w_params, bind_unsupported) = whitelist_sets(updates);
    if bind_unsupported {
        rollback_moves(&moved_files);
        return Ok(json!({ "error": "更新失败：不支持的更新值类型" }));
    }
    sets.extend(w_sets);
    params_sql.extend(w_params);

    let conn = db.write_lock();
    if sets.is_empty() {
        return if date_moved {
            row_to_json(&conn, id)
        } else {
            Ok(json!(true))
        };
    }
    params_sql.push(SqlValue::Integer(id));
    let sql = format!("UPDATE images SET {} WHERE id = ?", sets.join(", "));
    if let Err(e) = conn.execute(&sql, params_from_iter(params_sql)) {
        rollback_moves(&moved_files);
        eprintln!("[日期] 更新失败: {e}");
        return Ok(json!({ "error": format!("更新失败：{}", err_cn::text(&e)) }));
    }
    if date_moved {
        row_to_json(&conn, id)
    } else {
        Ok(json!(true))
    }
}

pub fn update_images(
    conn: &Connection,
    image_ids: &[i64],
    updates: &Value,
) -> Result<i64, PixError> {
    let mut sets: Vec<String> = Vec::new();
    let mut params_sql: Vec<SqlValue> = Vec::new();
    if let Some(map) = updates.as_object() {
        for (key, value) in map {
            if BATCH_ALLOWED.contains(&key.as_str()) {
                match value_to_sql(value) {
                    Some(v) => {
                        sets.push(format!("{key} = ?"));
                        params_sql.push(v);
                    }
                    None => return Err(PixError::Io("不支持的更新值类型".into())),
                }
            }
        }
    }
    if sets.is_empty() || image_ids.is_empty() {
        return Ok(0);
    }
    // 多 chunk 必须同事务：中途失败会留下"前半已写、后半未写"的半批状态
    let tx = conn.unchecked_transaction()?;
    let mut changed = 0i64;
    for chunk in image_ids.chunks(CHUNK_SIZE) {
        let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "UPDATE images SET {}, updated_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders})",
            sets.join(", ")
        );
        let mut chunk_params = params_sql.clone();
        chunk_params.extend(chunk.iter().map(|i| SqlValue::Integer(*i)));
        changed += tx.execute(&sql, params_from_iter(chunk_params))? as i64;
    }
    tx.commit()?;
    Ok(changed)
}

pub fn update_image_thumbs(
    conn: &Connection,
    id: i64,
    thumbnail_path: &str,
    thumbnail_small_path: &str,
    width: i64,
    height: i64,
) -> Result<(), PixError> {
    conn.execute(
        "UPDATE images SET thumbnail_path = ?1, thumbnail_small_path = ?2, width = ?3, height = ?4 WHERE id = ?5",
        params![thumbnail_path, thumbnail_small_path, width, height, id],
    )?;
    Ok(())
}

pub fn rebuild_thumbnails(
    conn: &Connection,
    thumbs_dir: &Path,
    all: bool,
    app: Option<&tauri::AppHandle>,
) -> Result<Value, PixError> {
    let where_clause = if all {
        "hidden = 0".to_string()
    } else {
        "hidden = 0 AND (thumbnail_path = '' OR thumbnail_small_path = '')".to_string()
    };
    let rows: Vec<(i64, String)> = {
        let mut stmt = conn.prepare(&format!(
            "SELECT id, filepath FROM images WHERE {where_clause}"
        ))?;
        let it = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        it.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let total = rows.len() as i64;
    let mut rebuilt = 0i64;
    let mut failed = 0i64;
    std::fs::create_dir_all(thumbs_dir)
        .map_err(|e| PixError::Io(format!("建缩略图目录失败: {e}")))?;
    for (index, (id, filepath)) in rows.iter().enumerate() {
        let src = PathBuf::from(filepath);
        match thumbs::generate_tiers(&src) {
            Ok((small, medium, w, h)) => {
                // 写回前再核验：生成期间记录被删/改名则放弃本次写回，不计入统计
                let fresh = crate::images_query::get_image_by_id(conn, *id)?;
                if fresh.is_some_and(|cur| cur.filepath == *filepath) {
                    let medium_path = thumbs_dir.join(format!("{id}.jpg"));
                    let small_path = thumbs_dir.join(format!("{id}_s.jpg"));
                    match std::fs::write(&medium_path, &medium)
                        .and_then(|_| std::fs::write(&small_path, &small))
                    {
                        Ok(_) => {
                            update_image_thumbs(
                                conn,
                                *id,
                                &medium_path.to_string_lossy(),
                                &small_path.to_string_lossy(),
                                w as i64,
                                h as i64,
                            )?;
                            rebuilt += 1;
                        }
                        Err(e) => {
                            failed += 1;
                            eprintln!("[缩略图] 写入失败: {filepath} {e}");
                        }
                    }
                }
            }
            Err(e) => {
                failed += 1;
                eprintln!("[缩略图] 重建失败: {filepath} {e}");
            }
        }
        if let Some(app) = app {
            progress::emit_progress(
                app,
                progress::REBUILD_PROGRESS,
                progress::rebuild_payload(index as i64 + 1, total, failed),
            );
        }
    }
    if let Some(app) = app {
        progress::emit_progress(app, progress::THUMBNAILS_READY, Value::Null);
    }
    Ok(json!({ "total": total, "rebuilt": rebuilt, "failed": failed }))
}

/// Db 级短锁编排：锁内拉取待重建清单 → 锁外逐张生成缩略图（含进度事件）→ 每张核验+写回用短锁。
/// 与 rebuild_thumbnails 统计/写回契约一致；供命令层避免整批长持写锁
pub fn rebuild_thumbnails_unlocked(
    db: &crate::db::Db,
    thumbs_dir: &Path,
    all: bool,
    app: Option<&tauri::AppHandle>,
) -> Result<Value, PixError> {
    let where_clause = if all {
        "hidden = 0".to_string()
    } else {
        "hidden = 0 AND (thumbnail_path = '' OR thumbnail_small_path = '')".to_string()
    };
    let rows: Vec<(i64, String)> = {
        let conn = db.write_lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT id, filepath FROM images WHERE {where_clause}"
        ))?;
        let it = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        it.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let total = rows.len() as i64;
    let mut rebuilt = 0i64;
    let mut failed = 0i64;
    std::fs::create_dir_all(thumbs_dir)
        .map_err(|e| PixError::Io(format!("建缩略图目录失败: {e}")))?;
    for (index, (id, filepath)) in rows.iter().enumerate() {
        let src = PathBuf::from(filepath);
        match thumbs::generate_tiers(&src) {
            Ok((small, medium, w, h)) => {
                let medium_path = thumbs_dir.join(format!("{id}.jpg"));
                let small_path = thumbs_dir.join(format!("{id}_s.jpg"));
                // 短锁：写回前核验记录仍在且未改名，文件写 + 单条 UPDATE 同锁内完成
                let applied = (|| -> Result<bool, PixError> {
                    let conn = db.write_lock();
                    let fresh = crate::images_query::get_image_by_id(&conn, *id)?;
                    if fresh.is_some_and(|cur| cur.filepath == *filepath) {
                        match std::fs::write(&medium_path, &medium)
                            .and_then(|_| std::fs::write(&small_path, &small))
                        {
                            Ok(_) => {
                                update_image_thumbs(
                                    &conn,
                                    *id,
                                    &medium_path.to_string_lossy(),
                                    &small_path.to_string_lossy(),
                                    w as i64,
                                    h as i64,
                                )?;
                                Ok(true)
                            }
                            Err(e) => {
                                eprintln!("[缩略图] 写入失败: {filepath} {e}");
                                Ok(false)
                            }
                        }
                    } else {
                        Ok(false)
                    }
                })()?;
                if applied {
                    rebuilt += 1;
                }
            }
            Err(e) => {
                failed += 1;
                eprintln!("[缩略图] 重建失败: {filepath} {e}");
            }
        }
        if let Some(app) = app {
            progress::emit_progress(
                app,
                progress::REBUILD_PROGRESS,
                progress::rebuild_payload(index as i64 + 1, total, failed),
            );
        }
    }
    if let Some(app) = app {
        progress::emit_progress(app, progress::THUMBNAILS_READY, Value::Null);
    }
    Ok(json!({ "total": total, "rebuilt": rebuilt, "failed": failed }))
}

pub fn scan_broken_records(conn: &Connection, images_root: &Path) -> Result<Value, PixError> {
    if !images_root.exists() {
        return Ok(json!({ "error": "图片根目录不可访问（磁盘可能离线），已中止扫描" }));
    }
    let rows: Vec<(i64, String, String, Option<String>)> = {
        let mut stmt = conn.prepare("SELECT id, filename, filepath, raw_path FROM images")?;
        let it = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        it.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut broken: Vec<Value> = Vec::new();
    for (id, filename, filepath, raw_path) in rows {
        let raw = raw_path.unwrap_or_default();
        if !Path::new(&filepath).exists() {
            broken.push(json!({
                "id": id,
                "filename": filename,
                "filepath": filepath,
                "raw_path": raw,
                "reason": "main",
            }));
        } else if !raw.is_empty() && !Path::new(&raw).exists() {
            broken.push(json!({
                "id": id,
                "filename": filename,
                "filepath": filepath,
                "raw_path": raw,
                "reason": "raw",
            }));
        }
    }
    Ok(Value::Array(broken))
}

pub fn delete_broken_records(
    conn: &Connection,
    ids: &[i64],
    images_root: &Path,
    thumbs_dir: &Path,
) -> Result<Value, PixError> {
    if !images_root.exists() {
        return Ok(json!({ "error": "图片根目录不可访问（磁盘可能离线），已中止清理" }));
    }
    let mut removed: Vec<i64> = Vec::new();
    let mut unbound: Vec<i64> = Vec::new();
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        let Some(img) = crate::images_query::get_image_by_id(&tx, *id)? else {
            continue;
        };
        if Path::new(&img.filepath).exists() {
            // 逐条重新核验：扫描到清理之间文件可能已被恢复；主文件仍在（仅 raw 丢失）只解绑保留记录
            let raw_missing = img
                .raw_path
                .as_deref()
                .map(|p| !p.is_empty() && !Path::new(p).exists())
                .unwrap_or(false);
            if raw_missing {
                tx.execute(
                    "UPDATE images SET raw_path = '', original_raw_path = '' WHERE id = ?1",
                    params![id],
                )?;
                unbound.push(*id);
            }
            continue;
        }
        tx.execute("DELETE FROM image_tags WHERE image_id = ?1", params![id])?;
        tx.execute("DELETE FROM album_images WHERE image_id = ?1", params![id])?;
        tx.execute("DELETE FROM edits WHERE image_id = ?1", params![id])?;
        tx.execute("DELETE FROM edit_history WHERE image_id = ?1", params![id])?;
        tx.execute("DELETE FROM images WHERE id = ?1", params![id])?;
        delete_thumbnail_file(thumbs_dir, *id);
        removed.push(*id);
    }
    tx.commit()?;
    Ok(json!({ "removed": removed, "unbound": unbound }))
}

struct Fnv1a(u64);

impl Fnv1a {
    fn new() -> Self {
        Fnv1a(0xcbf2_9ce4_8422_2325)
    }

    fn update(&mut self, data: &[u8]) {
        for &b in data {
            self.0 ^= u64::from(b);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }

    fn finish(&self) -> u64 {
        self.0
    }
}

// JS quickHash 用 md5；无新依赖约束下改用 std FNV-1a 64，仅用于同轮检测内分组，语义（内容相同→同哈希）不变
fn quick_hash(filepath: &str, size: i64) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(filepath).ok()?;
    let head_len = size.clamp(0, HASH_WINDOW) as usize;
    let mut head = vec![0u8; head_len];
    file.read_exact(&mut head).ok()?;
    let mut hasher = Fnv1a::new();
    hasher.update(&head);
    if size > HASH_WINDOW {
        file.seek(SeekFrom::Start((size - HASH_WINDOW) as u64))
            .ok()?;
        let mut tail = vec![0u8; HASH_WINDOW as usize];
        file.read_exact(&mut tail).ok()?;
        hasher.update(&tail);
    }
    Some(format!("{:016x}", hasher.finish()))
}

pub fn find_duplicates(conn: &Connection, _images_root: &Path) -> Result<Value, PixError> {
    struct DupRow {
        id: i64,
        filename: String,
        filepath: String,
        size: i64,
        width: i64,
        height: i64,
        thumbnail_path: Option<String>,
    }
    let rows: Vec<DupRow> = {
        let mut stmt = conn.prepare(
            "SELECT id, filename, filepath, size, width, height, thumbnail_path FROM images WHERE hidden = 0",
        )?;
        let it = stmt.query_map([], |r| {
            Ok(DupRow {
                id: r.get(0)?,
                filename: r.get(1)?,
                filepath: r.get(2)?,
                size: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                width: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                height: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
                thumbnail_path: r.get(6)?,
            })
        })?;
        it.collect::<rusqlite::Result<Vec<_>>>()?
    };

    // 粗分组：HashMap 记索引保插入序，避免 2 万张时 O(n²) 线性查找
    let mut coarse: Vec<Vec<DupRow>> = Vec::new();
    let mut coarse_idx: HashMap<String, usize> = HashMap::new();
    for r in rows {
        if r.size == 0 {
            continue;
        }
        let key = format!("{}|{}|{}", r.size, r.width, r.height);
        match coarse_idx.get(&key) {
            Some(&i) => coarse[i].push(r),
            None => {
                coarse_idx.insert(key, coarse.len());
                coarse.push(vec![r]);
            }
        }
    }

    let mut groups: Vec<Value> = Vec::new();
    for candidates in &coarse {
        if candidates.len() < 2 {
            continue;
        }
        let mut by_hash: Vec<Vec<&DupRow>> = Vec::new();
        let mut hash_idx: HashMap<String, usize> = HashMap::new();
        for r in candidates {
            let Some(hash) = quick_hash(&r.filepath, r.size) else {
                continue;
            };
            match hash_idx.get(&hash) {
                Some(&i) => by_hash[i].push(r),
                None => {
                    hash_idx.insert(hash, by_hash.len());
                    by_hash.push(vec![r]);
                }
            }
        }
        for items in &by_hash {
            if items.len() >= 2 {
                let size = items[0].size;
                groups.push(json!({
                    "key": format!("g{}", groups.len() + 1),
                    "items": items
                        .iter()
                        .map(|i| json!({
                            "id": i.id,
                            "filename": i.filename,
                            "filepath": i.filepath,
                            "size": i.size,
                            "width": i.width,
                            "height": i.height,
                            "thumbnail_path": i.thumbnail_path,
                        }))
                        .collect::<Vec<_>>(),
                    "wasted": (items.len() as i64 - 1) * size,
                }));
            }
        }
    }
    Ok(Value::Array(groups))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::images_query::get_image_by_id;
    use image::{DynamicImage, RgbaImage};

    fn mem_db() -> Connection {
        crate::images_query::tests::mem_db()
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_jpeg(dir: &Path, name: &str, w: u32, h: u32) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let img = DynamicImage::from(RgbaImage::from_fn(w, h, |x, y| {
            image::Rgba([(x * 7 % 256) as u8, (y * 11 % 256) as u8, 60, 255])
        }));
        let p = dir.join(name);
        img.save(&p).unwrap();
        p
    }

    fn insert_image(
        conn: &Connection,
        filename: &str,
        filepath: &Path,
        raw_path: &str,
        import_date: &str,
        hidden: i64,
    ) -> i64 {
        conn.execute(
            "INSERT INTO images (filename, filepath, raw_path, original_raw_path, import_date, hidden) VALUES (?1, ?2, ?3, ?3, ?4, ?5)",
            params![filename, filepath.to_string_lossy(), raw_path, import_date, hidden],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn 修改导入日期_jpg与nef一起移动到新日期目录() {
        let dir = temp_dir("pixyang_ui_move");
        let root = dir.join("root");
        let old_dir = root.join("2026").join("01").join("01");
        let new_dir = root.join("2026").join("02").join("03");
        let jpg = make_jpeg(&old_dir, "a.jpg", 60, 40);
        let jpg_bytes = std::fs::read(&jpg).unwrap();
        let nef = old_dir.join("a.NEF");
        std::fs::write(&nef, b"RAWDATA").unwrap();
        let conn = mem_db();
        let id = insert_image(
            &conn,
            "a.jpg",
            &jpg,
            &nef.to_string_lossy(),
            "2026-01-01",
            0,
        );

        let result = update_image(
            &conn,
            id,
            &json!({ "import_date": "2026-02-03" }),
            &root,
            &dir.join("thumbs"),
        )
        .unwrap();
        assert!(result.is_object());
        assert_eq!(result["import_date"], "2026-02-03");
        assert_eq!(result["filename"], "a.jpg");
        let new_jpg = new_dir.join("a.jpg");
        let new_nef = new_dir.join("a.NEF");
        assert_eq!(
            result["filepath"].as_str().unwrap(),
            new_jpg.to_string_lossy().to_string()
        );
        assert_eq!(
            result["raw_path"].as_str().unwrap(),
            new_nef.to_string_lossy().to_string()
        );
        assert!(!jpg.exists());
        assert!(!nef.exists());
        assert_eq!(std::fs::read(&new_jpg).unwrap(), jpg_bytes);
        assert_eq!(std::fs::read(&new_nef).unwrap(), b"RAWDATA");
        let row = get_image_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(row.filepath, new_jpg.to_string_lossy().to_string());
        assert_eq!(
            row.raw_path.as_deref(),
            Some(new_nef.to_string_lossy().as_ref())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn nef目标名被占用_整体回滚数据库不动() {
        let dir = temp_dir("pixyang_ui_nef_occupied");
        let root = dir.join("root");
        let old_dir = root.join("2026").join("01").join("01");
        let new_dir = root.join("2026").join("02").join("03");
        let jpg = make_jpeg(&old_dir, "a.jpg", 60, 40);
        let nef = old_dir.join("a.NEF");
        std::fs::write(&nef, b"RAWDATA").unwrap();
        std::fs::create_dir_all(&new_dir).unwrap();
        std::fs::write(new_dir.join("a.NEF"), b"OCCUPIED").unwrap();
        let conn = mem_db();
        let id = insert_image(
            &conn,
            "a.jpg",
            &jpg,
            &nef.to_string_lossy(),
            "2026-01-01",
            0,
        );

        let result = update_image(
            &conn,
            id,
            &json!({ "import_date": "2026-02-03" }),
            &root,
            &dir.join("thumbs"),
        )
        .unwrap();
        assert_eq!(result["error"], "移动文件失败：目标 NEF 文件名已被占用");
        assert!(jpg.exists());
        assert!(!new_dir.join("a.jpg").exists());
        assert!(nef.exists());
        assert_eq!(std::fs::read(&nef).unwrap(), b"RAWDATA");
        let row = get_image_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(row.import_date, "2026-01-01");
        assert_eq!(row.filepath, jpg.to_string_lossy().to_string());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 源文件缺失_拒绝改日期且数据库不动() {
        let dir = temp_dir("pixyang_ui_missing_src");
        let root = dir.join("root");
        let conn = mem_db();
        let missing = root.join("2026").join("01").join("01").join("a.jpg");
        let id = insert_image(&conn, "a.jpg", &missing, "", "2026-01-01", 0);
        let result = update_image(
            &conn,
            id,
            &json!({ "import_date": "2026-02-03", "rating": 5 }),
            &root,
            &dir.join("thumbs"),
        )
        .unwrap();
        assert_eq!(result["error"], "源文件不存在，无法修改导入日期");
        let row = get_image_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(row.import_date, "2026-01-01");
        assert_eq!(row.rating, Some(0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 非法日期_报错且文件与数据库不动() {
        let dir = temp_dir("pixyang_ui_bad_date");
        let root = dir.join("root");
        let old_dir = root.join("2026").join("01").join("01");
        let jpg = make_jpeg(&old_dir, "a.jpg", 60, 40);
        let conn = mem_db();
        let id = insert_image(&conn, "a.jpg", &jpg, "", "2026-01-01", 0);
        for bad in ["20260101", "abc", "2026-1-1"] {
            let result = update_image(
                &conn,
                id,
                &json!({ "import_date": bad }),
                &root,
                &dir.join("thumbs"),
            )
            .unwrap();
            assert_eq!(result["error"], "日期格式无效（应为 YYYY-MM-DD）");
        }
        assert!(jpg.exists());
        let row = get_image_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(row.import_date, "2026-01-01");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 白名单外字段被忽略_别名生效_无移动返回true() {
        let dir = temp_dir("pixyang_ui_whitelist");
        let root = dir.join("root");
        let old_dir = root.join("2026").join("01").join("01");
        let jpg = make_jpeg(&old_dir, "a.jpg", 60, 40);
        let conn = mem_db();
        let id = insert_image(&conn, "a.jpg", &jpg, "", "2026-01-01", 0);
        let result = update_image(
            &conn,
            id,
            &json!({
                "filename": "evil.jpg",
                "filepath": "C:/evil.jpg",
                "hidden": 1,
                "thumbnail_path": "C:/x.jpg",
                "rating": 4,
                "favorite": 1,
                "notes": "hello",
                "width": 111,
                "height": 222,
                "rotation": 90,
                "flipH": 1,
                "flipV": 2
            }),
            &root,
            &dir.join("thumbs"),
        )
        .unwrap();
        assert_eq!(result, json!(true));
        let row = get_image_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(row.rating, Some(4));
        assert_eq!(row.favorite, Some(1));
        assert_eq!(row.notes.as_deref(), Some("hello"));
        assert_eq!(row.width, Some(111));
        assert_eq!(row.height, Some(222));
        assert_eq!(row.rotation, Some(90));
        assert_eq!(row.flip_h, Some(1));
        assert_eq!(row.flip_v, Some(2));
        assert_eq!(row.filename, "a.jpg");
        assert_eq!(row.filepath, jpg.to_string_lossy().to_string());
        assert_eq!(row.hidden, Some(0));
        assert_eq!(row.thumbnail_path.as_deref(), Some(""));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 空更新与同日期返回true不移动() {
        let dir = temp_dir("pixyang_ui_contract");
        let root = dir.join("root");
        let old_dir = root.join("2026").join("01").join("01");
        let jpg = make_jpeg(&old_dir, "a.jpg", 60, 40);
        let conn = mem_db();
        let id = insert_image(&conn, "a.jpg", &jpg, "", "2026-01-01", 0);
        assert_eq!(
            update_image(&conn, id, &json!({}), &root, &dir.join("thumbs")).unwrap(),
            json!(true)
        );
        assert_eq!(
            update_image(
                &conn,
                id,
                &json!({ "import_date": " 2026-01-01 " }),
                &root,
                &dir.join("thumbs")
            )
            .unwrap(),
            json!(true)
        );
        assert!(jpg.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 批量更新仅限评分收藏并返回变更数() {
        let dir = temp_dir("pixyang_ui_batch");
        let root = dir.join("root");
        let conn = mem_db();
        let f1 = make_jpeg(&root, "a.jpg", 60, 40);
        let f2 = make_jpeg(&root, "b.jpg", 30, 20);
        let id1 = insert_image(&conn, "a.jpg", &f1, "", "2026-01-01", 0);
        let id2 = insert_image(&conn, "b.jpg", &f2, "", "2026-01-01", 0);
        let changed = update_images(
            &conn,
            &[id1, id2],
            &json!({ "rating": 5, "favorite": 1, "notes": "ignored" }),
        )
        .unwrap();
        assert_eq!(changed, 2);
        let r1 = get_image_by_id(&conn, id1).unwrap().unwrap();
        let r2 = get_image_by_id(&conn, id2).unwrap().unwrap();
        assert_eq!(r1.rating, Some(5));
        assert_eq!(r1.favorite, Some(1));
        assert_eq!(r1.notes.as_deref(), Some(""));
        assert_eq!(r2.rating, Some(5));
        assert_eq!(
            update_images(&conn, &[id1], &json!({ "notes": "x" })).unwrap(),
            0
        );
        assert_eq!(
            update_images(&conn, &[], &json!({ "rating": 1 })).unwrap(),
            0
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 重建缩略图_统计与回写正确() {
        let dir = temp_dir("pixyang_ui_rebuild");
        let files = dir.join("files");
        let f1 = make_jpeg(&files, "ok1.jpg", 60, 40);
        let f2 = make_jpeg(&files, "ok2.jpg", 30, 20);
        let f3 = make_jpeg(&files, "hidden.jpg", 10, 10);
        let conn = mem_db();
        let id1 = insert_image(&conn, "ok1.jpg", &f1, "", "2026-01-01", 0);
        let id2 = insert_image(&conn, "ok2.jpg", &f2, "", "2026-01-01", 0);
        let _id3 = insert_image(
            &conn,
            "gone.jpg",
            &files.join("gone.jpg"),
            "",
            "2026-01-01",
            0,
        );
        let id4 = insert_image(&conn, "hidden.jpg", &f3, "", "2026-01-01", 1);
        let thumbs_dir = dir.join("thumbs");

        let r1 = rebuild_thumbnails(&conn, &thumbs_dir, true, None).unwrap();
        assert_eq!(r1, json!({ "total": 3, "rebuilt": 2, "failed": 1 }));
        let row1 = get_image_by_id(&conn, id1).unwrap().unwrap();
        assert_eq!(
            row1.thumbnail_path.as_deref(),
            Some(
                thumbs_dir
                    .join(format!("{id1}.jpg"))
                    .to_string_lossy()
                    .as_ref()
            )
        );
        assert!(Path::new(row1.thumbnail_path.as_deref().unwrap_or("")).exists());
        assert!(Path::new(row1.thumbnail_small_path.as_deref().unwrap_or("")).exists());
        assert_eq!(row1.width, Some(60));
        assert_eq!(row1.height, Some(40));
        let hidden_row = get_image_by_id(&conn, id4).unwrap().unwrap();
        assert_eq!(hidden_row.thumbnail_path.as_deref(), Some(""));

        let r2 = rebuild_thumbnails(&conn, &thumbs_dir, false, None).unwrap();
        assert_eq!(r2, json!({ "total": 1, "rebuilt": 0, "failed": 1 }));

        conn.execute(
            "UPDATE images SET thumbnail_path = '', thumbnail_small_path = '' WHERE id = ?1",
            params![id2],
        )
        .unwrap();
        // 只补缺失：候选为 id2（被清空）与 id3（一直失败仍缺失），id4 隐藏不参与
        let r3 = rebuild_thumbnails(&conn, &thumbs_dir, false, None).unwrap();
        assert_eq!(r3, json!({ "total": 2, "rebuilt": 1, "failed": 1 }));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 损坏记录扫描与删除_主缺失删记录_raw缺失仅解绑() {
        let dir = temp_dir("pixyang_ui_broken");
        let root = dir.join("root");
        let d1 = root.join("2026").join("01").join("01");
        let f1 = make_jpeg(&d1, "a.jpg", 60, 40);
        let n1 = d1.join("a.NEF");
        std::fs::write(&n1, b"RAWDATA").unwrap();
        let f3 = make_jpeg(&d1, "c.jpg", 30, 20);
        let conn = mem_db();
        let id1 = insert_image(&conn, "a.jpg", &f1, &n1.to_string_lossy(), "2026-01-01", 0);
        let id2 = insert_image(&conn, "b.jpg", &d1.join("b.jpg"), "", "2026-01-01", 0);
        let id3 = insert_image(
            &conn,
            "c.jpg",
            &f3,
            &d1.join("c.NEF").to_string_lossy(),
            "2026-01-01",
            0,
        );
        let id4 = insert_image(&conn, "d.jpg", &d1.join("d.jpg"), "", "2026-01-01", 1);

        let scan = scan_broken_records(&conn, &root).unwrap();
        let arr = scan.as_array().unwrap();
        assert_eq!(arr.len(), 3);
        let mut by_id: std::collections::HashMap<i64, String> = std::collections::HashMap::new();
        for v in arr {
            by_id.insert(
                v["id"].as_i64().unwrap(),
                v["reason"].as_str().unwrap().to_string(),
            );
        }
        assert_eq!(by_id.get(&id2).map(String::as_str), Some("main"));
        assert_eq!(by_id.get(&id3).map(String::as_str), Some("raw"));
        assert_eq!(by_id.get(&id4).map(String::as_str), Some("main"));
        assert!(!by_id.contains_key(&id1));

        let unreachable = scan_broken_records(&conn, &dir.join("nope")).unwrap();
        assert_eq!(
            unreachable["error"],
            "图片根目录不可访问（磁盘可能离线），已中止扫描"
        );

        let thumbs_dir = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs_dir).unwrap();
        std::fs::write(thumbs_dir.join(format!("{id2}.jpg")), b"x").unwrap();
        std::fs::write(thumbs_dir.join(format!("{id2}_s.jpg")), b"x").unwrap();
        conn.execute("INSERT INTO tags (id, name) VALUES (7, 't')", params![])
            .unwrap();
        conn.execute(
            "INSERT INTO image_tags (image_id, tag_id) VALUES (?1, 7)",
            params![id2],
        )
        .unwrap();

        let result = delete_broken_records(&conn, &[id2, id3, id4], &root, &thumbs_dir).unwrap();
        assert_eq!(result["removed"], json!([id2, id4]));
        assert_eq!(result["unbound"], json!([id3]));
        assert!(get_image_by_id(&conn, id2).unwrap().is_none());
        assert!(get_image_by_id(&conn, id4).unwrap().is_none());
        let row3 = get_image_by_id(&conn, id3).unwrap().unwrap();
        assert_eq!(row3.raw_path.as_deref(), Some(""));
        assert_eq!(row3.original_raw_path.as_deref(), Some(""));
        assert!(f3.exists());
        assert!(!thumbs_dir.join(format!("{id2}.jpg")).exists());
        assert!(!thumbs_dir.join(format!("{id2}_s.jpg")).exists());
        let tag_left: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM image_tags WHERE image_id = ?1",
                params![id2],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tag_left, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 重复检测_同字节文件归组_隐藏与零尺寸不参与() {
        let dir = temp_dir("pixyang_ui_dup");
        let root = dir.join("root");
        let files = dir.join("files");
        let fa = make_jpeg(&files, "a.jpg", 60, 40);
        let fb = files.join("b.jpg");
        std::fs::copy(&fa, &fb).unwrap();
        let fc = make_jpeg(&files, "c.jpg", 30, 30);
        let fd = files.join("d.jpg");
        std::fs::copy(&fa, &fd).unwrap();
        let conn = mem_db();
        let size_a = std::fs::metadata(&fa).unwrap().len() as i64;
        let ida = insert_image(&conn, "a.jpg", &fa, "", "2026-01-01", 0);
        let idb = insert_image(&conn, "b.jpg", &fb, "", "2026-01-01", 0);
        let _ = insert_image(&conn, "c.jpg", &fc, "", "2026-01-01", 0);
        let _ = insert_image(&conn, "d.jpg", &fd, "", "2026-01-01", 1);
        conn.execute(
            "UPDATE images SET size = ?1 WHERE id IN (?2, ?3)",
            params![size_a, ida, idb],
        )
        .unwrap();

        let groups = find_duplicates(&conn, &root).unwrap();
        let arr = groups.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        let g = &arr[0];
        assert_eq!(g["key"], "g1");
        let items = g["items"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["id"], ida);
        assert_eq!(items[1]["id"], idb);
        assert_eq!(g["wasted"], size_a);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 日期移动_Db短锁路径_jpg与nef一起移动() {
        let dir = temp_dir("pixyang_ui_move_db");
        let root = dir.join("root");
        let old_dir = root.join("2026").join("01").join("01");
        let new_dir = root.join("2026").join("02").join("03");
        let jpg = make_jpeg(&old_dir, "a.jpg", 60, 40);
        let jpg_bytes = std::fs::read(&jpg).unwrap();
        let nef = old_dir.join("a.NEF");
        std::fs::write(&nef, b"RAWDATA").unwrap();
        let conn = mem_db();
        let id = insert_image(
            &conn,
            "a.jpg",
            &jpg,
            &nef.to_string_lossy(),
            "2026-01-01",
            0,
        );
        let db = crate::db::Db::from_connection(conn);

        let result = update_image_db(
            &db,
            id,
            &json!({ "import_date": "2026-02-03" }),
            &root,
            &dir.join("thumbs"),
        )
        .unwrap();
        assert!(result.get("error").is_none(), "{result}");
        assert_eq!(
            result["filepath"].as_str().unwrap(),
            new_dir.join("a.jpg").to_string_lossy().to_string()
        );
        assert!(!jpg.exists());
        assert!(!nef.exists());
        assert_eq!(std::fs::read(new_dir.join("a.jpg")).unwrap(), jpg_bytes);
        assert_eq!(std::fs::read(new_dir.join("a.NEF")).unwrap(), b"RAWDATA");
        let row = get_image_by_id(&db.write_lock(), id).unwrap().unwrap();
        assert_eq!(row.filepath, new_dir.join("a.jpg").to_string_lossy());
        assert_eq!(
            row.raw_path.as_deref(),
            Some(new_dir.join("a.NEF").to_string_lossy().as_ref())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 日期移动_Db短锁路径_源缺失报错且库不动() {
        let dir = temp_dir("pixyang_ui_move_db_missing");
        let root = dir.join("root");
        let conn = mem_db();
        let missing = root.join("2026").join("01").join("01").join("a.jpg");
        let id = insert_image(&conn, "a.jpg", &missing, "", "2026-01-01", 0);
        let db = crate::db::Db::from_connection(conn);
        let result = update_image_db(
            &db,
            id,
            &json!({ "import_date": "2026-02-03", "rating": 5 }),
            &root,
            &dir.join("thumbs"),
        )
        .unwrap();
        assert_eq!(result["error"], "源文件不存在，无法修改导入日期");
        let row = get_image_by_id(&db.write_lock(), id).unwrap().unwrap();
        assert_eq!(row.import_date, "2026-01-01");
        assert_eq!(row.rating, Some(0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 日期移动_Db短锁路径_非法值类型_文件回滚库不动() {
        let dir = temp_dir("pixyang_ui_move_db_badtype");
        let root = dir.join("root");
        let old_dir = root.join("2026").join("01").join("01");
        let new_dir = root.join("2026").join("02").join("03");
        let jpg = make_jpeg(&old_dir, "a.jpg", 60, 40);
        let jpg_bytes = std::fs::read(&jpg).unwrap();
        let nef = old_dir.join("a.NEF");
        std::fs::write(&nef, b"RAWDATA").unwrap();
        let conn = mem_db();
        let id = insert_image(
            &conn,
            "a.jpg",
            &jpg,
            &nef.to_string_lossy(),
            "2026-01-01",
            0,
        );
        let db = crate::db::Db::from_connection(conn);

        let result = update_image_db(
            &db,
            id,
            &json!({ "import_date": "2026-02-03", "rating": [1, 2] }),
            &root,
            &dir.join("thumbs"),
        )
        .unwrap();
        assert_eq!(result["error"], "更新失败：不支持的更新值类型");
        assert!(jpg.exists(), "JPG 应回滚到原目录");
        assert_eq!(std::fs::read(&jpg).unwrap(), jpg_bytes);
        assert!(nef.exists(), "NEF 应回滚到原目录");
        assert_eq!(std::fs::read(&nef).unwrap(), b"RAWDATA");
        assert!(!new_dir.join("a.jpg").exists());
        assert!(!new_dir.join("a.NEF").exists());
        let row = get_image_by_id(&db.write_lock(), id).unwrap().unwrap();
        assert_eq!(row.import_date, "2026-01-01");
        assert_eq!(row.filepath, jpg.to_string_lossy().to_string());
        assert_eq!(
            row.raw_path.as_deref(),
            Some(nef.to_string_lossy().as_ref())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 重建缩略图_Db短锁路径_统计与回写一致() {
        let dir = temp_dir("pixyang_ui_rebuild_db");
        let files = dir.join("files");
        let f1 = make_jpeg(&files, "ok1.jpg", 60, 40);
        let f2 = make_jpeg(&files, "ok2.jpg", 30, 20);
        let gone = make_jpeg(&files, "gone.jpg", 10, 10);
        let conn = mem_db();
        let id1 = insert_image(&conn, "ok1.jpg", &f1, "", "2026-01-01", 0);
        let _ = insert_image(&conn, "ok2.jpg", &f2, "", "2026-01-01", 0);
        let _ = insert_image(
            &conn,
            "gone.jpg",
            &files.join("gone.jpg"),
            "",
            "2026-01-01",
            0,
        );
        std::fs::remove_file(&gone).unwrap();
        let db = crate::db::Db::from_connection(conn);
        let thumbs_dir = dir.join("thumbs");

        let r1 = rebuild_thumbnails_unlocked(&db, &thumbs_dir, true, None).unwrap();
        assert_eq!(r1, json!({ "total": 3, "rebuilt": 2, "failed": 1 }));
        let row1 = get_image_by_id(&db.write_lock(), id1).unwrap().unwrap();
        assert_eq!(
            row1.thumbnail_path.as_deref(),
            Some(
                thumbs_dir
                    .join(format!("{id1}.jpg"))
                    .to_string_lossy()
                    .as_ref()
            )
        );
        assert!(Path::new(row1.thumbnail_path.as_deref().unwrap_or("")).exists());
        assert!(Path::new(row1.thumbnail_small_path.as_deref().unwrap_or("")).exists());
        assert_eq!(row1.width, Some(60));
        assert_eq!(row1.height, Some(40));

        let r2 = rebuild_thumbnails_unlocked(&db, &thumbs_dir, false, None).unwrap();
        assert_eq!(r2, json!({ "total": 1, "rebuilt": 0, "failed": 1 }));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

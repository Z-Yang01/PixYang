// Tauri 命令壳：薄封装内核模块（naming/image_group），编排宿主关注点（磁盘 I/O、DTO）。
// 命令不内嵌业务逻辑；错误统一 String（跨 IPC 序列化最简形态）。

use crate::db::{self, AppPaths, Db};
use crate::edit_session;
use crate::executor;
use crate::file_ops;
use crate::image_group::{self, ImportFile, PairGroup};
use crate::images_query;
use crate::naming;
use crate::progress;
use crate::scan;
use crate::tags_albums;
use crate::thumbs;
use crate::update_image;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Deserialize)]
pub struct UniqueFilenameArgs {
    pub dir: String,
    pub name: String,
    #[serde(default)]
    pub taken: Vec<String>,
}

#[tauri::command]
pub fn unique_filename(args: UniqueFilenameArgs) -> Result<String, String> {
    let taken: HashSet<String> = args.taken.into_iter().collect();
    Ok(naming::generate_unique_filename(
        Path::new(&args.dir),
        &args.name,
        &taken,
        |p| p.exists(),
    ))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportFileDto {
    pub filename: String,
    pub filepath: String,
    #[serde(default)]
    pub raw_source: Option<String>,
    #[serde(default)]
    pub raw_filename: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GroupDto {
    pub key: String,
    pub jpg: Option<ImportFileDto>,
    pub nef: Option<ImportFileDto>,
}

impl From<&ImportFile> for ImportFileDto {
    fn from(f: &ImportFile) -> Self {
        Self {
            filename: f.filename.clone(),
            filepath: f.filepath.clone(),
            raw_source: f.raw_source.clone(),
            raw_filename: f.raw_filename.clone(),
        }
    }
}

#[tauri::command]
pub fn group_import_files(files: Vec<ImportFileDto>) -> Result<Vec<GroupDto>, String> {
    let owned: Vec<ImportFile> = files
        .into_iter()
        .map(|f| ImportFile {
            filename: f.filename,
            filepath: f.filepath,
            raw_source: f.raw_source,
            raw_filename: f.raw_filename,
        })
        .collect();
    let groups: Vec<(String, PairGroup)> = image_group::group_import_files(&owned);
    Ok(groups
        .into_iter()
        .map(|(key, g)| GroupDto {
            key,
            jpg: g.jpg.as_ref().map(Into::into),
            nef: g.nef.as_ref().map(Into::into),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 唯一命名命令_磁盘占用派生避让() {
        let dir = std::env::temp_dir().join("pixyang_cmd_test_r3");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), b"x").unwrap();
        let out = unique_filename(UniqueFilenameArgs {
            dir: dir.to_string_lossy().into_owned(),
            name: "a.txt".into(),
            taken: vec![],
        })
        .unwrap();
        assert_eq!(out, "a_1.txt");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 分组命令_nef小写归并到组() {
        let out = group_import_files(vec![
            ImportFileDto {
                filename: "dsc_1.jpg".into(),
                filepath: r"E:\c\dsc_1.jpg".into(),
                raw_source: None,
                raw_filename: None,
            },
            ImportFileDto {
                filename: "DSC_1.NEF".into(),
                filepath: r"E:\c\DSC_1.NEF".into(),
                raw_source: None,
                raw_filename: None,
            },
        ])
        .unwrap();
        assert_eq!(out.len(), 1);
        assert!(out[0].jpg.is_some() && out[0].nef.is_some());
    }

    #[test]
    fn 创建标签_重名与非法名返回错误对象() {
        let conn = crate::images_query::tests::mem_db();
        let ok = create_tag_result(&conn, " travel ", "#abc").unwrap();
        assert_eq!(ok["name"], "travel");
        assert_eq!(ok["id"], 1);
        let dup = create_tag_result(&conn, "travel", "#fff").unwrap();
        assert_eq!(dup["error"], "创建标签失败：名称重复或无效");
        let blank = create_tag_result(&conn, "   ", "#fff").unwrap();
        assert_eq!(blank["error"], "创建标签失败：名称重复或无效");
    }

    #[test]
    fn 创建相册_非法名返回错误对象() {
        let conn = crate::images_query::tests::mem_db();
        let ok = create_album_result(&conn, "trip", "d").unwrap();
        assert_eq!(ok["name"], "trip");
        assert_eq!(ok["image_count"], 0);
        let blank = create_album_result(&conn, "  ", "").unwrap();
        assert_eq!(blank["error"], "创建相册失败：名称无效");
    }

    #[test]
    fn 批量操作失败映射为错误返回值而非reject() {
        let ok = ok_or_error_value::<i64, String>("批量添加标签失败", Ok(3)).unwrap();
        assert_eq!(ok, serde_json::json!(3));
        let err = ok_or_error_value::<i64, String>("批量添加标签失败", Err("boom".into())).unwrap();
        assert_eq!(err["error"], "批量添加标签失败: boom");
        let del =
            ok_or_error_value::<Vec<i64>, String>("批量删除失败", Err("db断开".into())).unwrap();
        assert_eq!(del["error"], "批量删除失败: db断开");
        let rows = ok_or_error_value::<Vec<i64>, String>("批量删除失败", Ok(vec![1, 2])).unwrap();
        assert_eq!(rows, serde_json::json!([1, 2]));
    }
}

// ── 设置通道（迁移接缝 1：与 Electron 读写同一 pixyang.db 的 settings 表） ──

#[tauri::command]
pub fn get_setting(db: State<'_, Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    db::get_setting_raw(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(db: State<'_, Db>, key: String, value: String) -> Result<Value, String> {
    // images_root 只能经 set_images_root 变更：它绑定文件搬迁，裸写会让 DB 路径整体失效
    if key == "images_root" {
        return Ok(json!({ "error": "images_root 需通过迁移图片流程修改" }));
    }
    db.set_setting(&key, &value)
        .map(|_| Value::Null)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(db: State<'_, Db>) -> Result<Value, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    let map = db::all_settings_map(&conn).map_err(|e| e.to_string())?;
    Ok(Value::Object(
        map.into_iter()
            .map(|(k, v)| (k, Value::String(v)))
            .collect(),
    ))
}

// ── 标签/相册只读通道（迁移接缝 2） ──

#[tauri::command]
pub fn get_tags(db: State<'_, Db>) -> Result<Vec<tags_albums::TagRow>, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    tags_albums::get_tags(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_image_tags(
    db: State<'_, Db>,
    image_id: i64,
) -> Result<Vec<tags_albums::TagLite>, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    tags_albums::get_image_tags(&conn, image_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_batch_image_tags(
    db: State<'_, Db>,
    image_ids: Vec<i64>,
) -> Result<std::collections::HashMap<i64, Vec<tags_albums::TagLite>>, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    tags_albums::get_batch_image_tags(&conn, &image_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_albums(db: State<'_, Db>) -> Result<Vec<tags_albums::AlbumRow>, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    tags_albums::get_albums(&conn).map_err(|e| e.to_string())
}

// ── 标签/相册写通道（迁移接缝 4a） ──

// 失败契约镜像 electron/main.js guardDb：invoke reject 对无 catch 的调用点完全静默，
// 失败必须回 {error} 返回值（成功路径维持原形状）
fn ok_or_error_value<T: Serialize, E: std::fmt::Display>(
    label: &str,
    result: Result<T, E>,
) -> Result<Value, String> {
    match result {
        Ok(v) => serde_json::to_value(v).map_err(|e| e.to_string()),
        Err(e) => Ok(json!({ "error": format!("{label}: {e}") })),
    }
}

fn create_tag_result(
    conn: &rusqlite::Connection,
    name: &str,
    color: &str,
) -> Result<Value, String> {
    match tags_albums::create_tag(conn, name, color) {
        Ok(Some(t)) => serde_json::to_value(t).map_err(|e| e.to_string()),
        Ok(None) => Ok(json!({ "error": "创建标签失败：名称重复或无效" })),
        Err(e) => Ok(json!({ "error": format!("创建标签失败: {e}") })),
    }
}

fn create_album_result(
    conn: &rusqlite::Connection,
    name: &str,
    description: &str,
) -> Result<Value, String> {
    match tags_albums::create_album(conn, name, description) {
        Ok(Some(a)) => serde_json::to_value(a).map_err(|e| e.to_string()),
        Ok(None) => Ok(json!({ "error": "创建相册失败：名称无效" })),
        Err(e) => Ok(json!({ "error": format!("创建相册失败: {e}") })),
    }
}

#[tauri::command]
pub fn create_tag(db: State<'_, Db>, name: String, color: String) -> Result<Value, String> {
    let conn = db.write_lock();
    create_tag_result(&conn, &name, &color)
}

#[tauri::command]
pub fn delete_tag(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.write_lock();
    tags_albums::delete_tag(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_tag_to_image(db: State<'_, Db>, image_id: i64, tag_id: i64) -> Result<bool, String> {
    let conn = db.write_lock();
    tags_albums::add_tag_to_image(&conn, image_id, tag_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_tag_from_image(db: State<'_, Db>, image_id: i64, tag_id: i64) -> Result<(), String> {
    let conn = db.write_lock();
    tags_albums::remove_tag_from_image(&conn, image_id, tag_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_tag_to_images(
    db: State<'_, Db>,
    image_ids: Vec<i64>,
    tag_id: i64,
) -> Result<Value, String> {
    let conn = db.write_lock();
    ok_or_error_value(
        "批量添加标签失败",
        tags_albums::add_tag_to_images(&conn, &image_ids, tag_id),
    )
}

#[tauri::command]
pub fn create_album(db: State<'_, Db>, name: String, description: String) -> Result<Value, String> {
    let conn = db.write_lock();
    create_album_result(&conn, &name, &description)
}

#[tauri::command]
pub fn rename_album(
    db: State<'_, Db>,
    id: i64,
    new_name: String,
) -> Result<serde_json::Value, String> {
    let conn = db.write_lock();
    tags_albums::rename_album(&conn, id, &new_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_album(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.write_lock();
    tags_albums::delete_album(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_to_album(db: State<'_, Db>, album_id: i64, image_ids: Vec<i64>) -> Result<(), String> {
    let conn = db.write_lock();
    tags_albums::add_to_album(&conn, album_id, &image_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_from_album(db: State<'_, Db>, album_id: i64, image_id: i64) -> Result<(), String> {
    let conn = db.write_lock();
    tags_albums::remove_from_album(&conn, album_id, image_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_album_images(
    db: State<'_, Db>,
    album_id: i64,
) -> Result<Vec<images_query::ImageRow>, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    tags_albums::get_album_images(&conn, album_id).map_err(|e| e.to_string())
}

// ── 预设通道（迁移接缝 4c：params 原样 JSON 存取，upgradeEdits 在前端桥接层） ──

#[tauri::command]
pub fn get_presets(db: State<'_, Db>) -> Result<Vec<tags_albums::PresetRow>, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    tags_albums::get_presets(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_preset(
    db: State<'_, Db>,
    name: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let conn = db.write_lock();
    tags_albums::create_preset(&conn, &name, &params).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_preset(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.write_lock();
    tags_albums::delete_preset(&conn, id).map_err(|e| e.to_string())
}

// ── 删除通道（迁移接缝 4b） ──

// ── 杂项通道（迁移接缝 14：托管根/库路径/跨页全选/托管文件判定） ──

#[tauri::command]
pub fn get_images_root(db: State<'_, Db>, paths: State<'_, AppPaths>) -> Result<String, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    db::images_root(&conn, &paths.default_images_dir)
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_database_path() -> Result<String, String> {
    Ok(db::default_db_path().to_string_lossy().into_owned())
}

#[tauri::command]
pub fn get_all_image_ids(
    db: State<'_, Db>,
    query: images_query::ImageQuery,
) -> Result<Vec<i64>, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    images_query::get_all_visible_ids(&conn, &query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn file_exists(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    filepath: String,
) -> Result<bool, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    db::managed_file_exists(&conn, &paths.default_images_dir, &filepath).map_err(|e| e.to_string())
}

// ── 缩略图内核命令（迁移接缝 5 阶段 1） ──

#[tauri::command]
pub async fn make_thumbnail_tiers(
    filepath: String,
    thumbs_dir: String,
    id: i64,
) -> Result<(u32, u32), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (small, medium, w, h) =
            thumbs::generate_tiers(std::path::Path::new(&filepath)).map_err(|e| e.to_string())?;
        let dir = std::path::Path::new(&thumbs_dir);
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(format!("{id}.jpg")), small).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(format!("{id}_s.jpg")), medium).map_err(|e| e.to_string())?;
        Ok((w, h))
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn extract_nef_preview(
    nef_path: String,
    out_path: String,
) -> Result<Option<(u32, u32)>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        thumbs::extract_nef_preview(
            std::path::Path::new(&nef_path),
            std::path::Path::new(&out_path),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn image_meta(filepath: String) -> Result<(u32, u32, u32, bool), String> {
    tauri::async_runtime::spawn_blocking(move || {
        thumbs::image_meta(std::path::Path::new(&filepath)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

// ── 导入/改名编排（迁移接缝 4c） ──

#[tauri::command]
pub async fn import_images(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    app: AppHandle,
    files: serde_json::Value,
    date_override: Option<String>,
) -> Result<Vec<images_query::ImageRow>, String> {
    let db = db.inner().clone();
    let paths = paths.inner().clone();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.write_lock();
        file_ops::import_images(
            &conn,
            &files,
            date_override.as_deref(),
            &file_ops::today_ymd(),
            &paths.thumbs_dir,
            Some(&app),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn rename_image(
    db: State<'_, Db>,
    id: i64,
    new_filename: String,
) -> Result<serde_json::Value, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.write_lock();
        file_ops::rename_image(&conn, id, &new_filename).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

// ── 导出（契约镜像 fs:export-images / fs:export-album-images） ──

#[tauri::command]
pub async fn export_images(
    db: State<'_, Db>,
    ids: Vec<i64>,
    dest_dir: String,
) -> Result<Value, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.write_lock();
        let mut images = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(row) =
                images_query::get_image_by_id(&conn, id).map_err(|e| e.to_string())?
            {
                images.push(row);
            }
        }
        finish_export(&images, &dest_dir)
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn export_album_images(
    db: State<'_, Db>,
    album_id: i64,
    dest_dir: String,
) -> Result<Value, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.write_lock();
        let images = tags_albums::get_album_images(&conn, album_id).map_err(|e| e.to_string())?;
        finish_export(&images, &dest_dir)
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

fn finish_export(images: &[images_query::ImageRow], dest_dir: &str) -> Result<Value, String> {
    let total = images.len();
    match file_ops::export_image_files(images, dest_dir) {
        Ok(o) => Ok(json!({
            "total": total,
            "copied": o.copied,
            "nefCopied": o.nef_copied,
            "failed": o.failed,
        })),
        Err(msg) => Ok(json!({ "error": format!("导出失败: {msg}") })),
    }
}

// ── 渲染执行器（迁移接缝 5 阶段 3） ──

#[tauri::command]
pub async fn render_edit(
    spec: serde_json::Value,
    input_path: String,
    output_path: String,
) -> Result<(u32, u32), String> {
    tauri::async_runtime::spawn_blocking(move || {
        executor::render_spec_to_file(
            &spec,
            std::path::Path::new(&input_path),
            std::path::Path::new(&output_path),
        )
        .map(|o| (o.width, o.height))
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

// ── 外围与编辑会话通道（多 agent 内核集成） ──

// 镜像 fs:get-exif：完整 EXIF 仅限托管根内文件（images_root ∪ 数据库目录），越界返回空对象
#[tauri::command]
pub async fn get_exif(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    filepath: String,
) -> Result<Value, String> {
    let db = db.inner().clone();
    let paths = paths.inner().clone();
    Ok(tauri::async_runtime::spawn_blocking(move || {
        let database_dir = db::default_db_path()
            .parent()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let managed = {
            let conn = match db.open_read() {
                Ok(c) => c,
                Err(_) => return json!({}),
            };
            db::images_root(&conn, &paths.default_images_dir)
                .map(|root| {
                    crate::interact::is_managed_path(&root, &database_dir, Path::new(&filepath))
                })
                .unwrap_or(false)
        };
        if !managed {
            return json!({});
        }
        crate::exif_read::exif_fields(Path::new(&filepath)).unwrap_or_else(|_| json!({}))
    })
    .await
    .unwrap_or_else(|_| json!({})))
}

#[tauri::command]
pub async fn scan_directory(dir: String) -> Result<Vec<scan::CollectedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        scan::scan_directory(Path::new(&dir)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn collect_import_files(paths: Vec<String>) -> Result<Vec<scan::CollectedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let as_pathbuf: Vec<std::path::PathBuf> = paths.iter().map(PathBuf::from).collect();
        scan::collect_import_files(&as_pathbuf).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn update_image(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    id: i64,
    updates: Value,
) -> Result<Value, String> {
    let db = db.inner().clone();
    let paths = paths.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        update_image::update_image_db(
            &db,
            id,
            &updates,
            &paths.default_images_dir,
            &paths.thumbs_dir,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn update_images(
    db: State<'_, Db>,
    image_ids: Vec<i64>,
    updates: Value,
) -> Result<i64, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.write_lock();
        update_image::update_images(&conn, &image_ids, &updates).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn rebuild_thumbnails_with_events(
    app: AppHandle,
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    all: bool,
) -> Result<Value, String> {
    let db = db.inner().clone();
    let paths = paths.inner().clone();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        update_image::rebuild_thumbnails_unlocked(&db, &paths.thumbs_dir, all, Some(&app))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn scan_broken_records(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
) -> Result<Value, String> {
    let db = db.inner().clone();
    let paths = paths.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.open_read().map_err(|e| e.to_string())?;
        update_image::scan_broken_records(&conn, &paths.default_images_dir)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn delete_broken_records(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    ids: Vec<i64>,
) -> Result<Value, String> {
    let db = db.inner().clone();
    let paths = paths.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.write_lock();
        update_image::delete_broken_records(
            &conn,
            &ids,
            &paths.default_images_dir,
            &paths.thumbs_dir,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn find_duplicates(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
) -> Result<Value, String> {
    let db = db.inner().clone();
    let paths = paths.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.open_read().map_err(|e| e.to_string())?;
        update_image::find_duplicates(&conn, &paths.default_images_dir).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub fn get_edits(db: State<'_, Db>, id: i64) -> Result<Value, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    edit_session::get_edits(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_edit_params(
    db: State<'_, Db>,
    id: i64,
    params: Value,
    command: Value,
) -> Result<Value, String> {
    let conn = db.write_lock();
    edit_session::save_edit_params(&conn, id, &params, Some(&command)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_edit_history(db: State<'_, Db>, id: i64) -> Result<Vec<Value>, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    edit_session::get_edit_history(&conn, id).map_err(|e| e.to_string())
}

/// 镜像 ensureEditBase：base 解析顺序 ① raw_path 存在且可提取 → NEF 预览底图（source='nef'）；
/// ② orientation=1 且无 alpha → 零拷贝直用原图（不落底图文件，EXIF/alpha 天然保留）；
/// ③ 否则规范化副本。副本/NEF 底图按 mtime+size 侧车校验复用（原图被外部改写后重建）。
/// 纯文件阶段（解码/落盘可能秒级）：raw_path 由调用方短锁读出后传入，本函数不触 DB
fn ensure_edit_base(
    raw_path: Option<&str>,
    thumbs_dir: &Path,
    id: i64,
    src: &Path,
) -> Result<(PathBuf, u32, u32, &'static str), String> {
    std::fs::create_dir_all(thumbs_dir).map_err(|e| e.to_string())?;
    let base_jpg = thumbs_dir.join(format!("edit-{id}-base.jpg"));
    let sidecar = PathBuf::from(format!("{}.meta.json", base_jpg.to_string_lossy()));
    if let Some(raw) = raw_path.filter(|s| !s.is_empty()) {
        let raw_path = PathBuf::from(&raw);
        if raw_path.exists() {
            if base_cache_fresh(&sidecar, "nef", &raw_path) && base_jpg.exists() {
                if let Ok((w, h)) = image_dims(&base_jpg) {
                    return Ok((base_jpg, w, h, "nef"));
                }
            }
            if let Ok(Some((w, h))) = thumbs::extract_nef_preview(&raw_path, &base_jpg) {
                write_base_sidecar(&sidecar, "nef", &raw_path);
                return Ok((base_jpg, w, h, "nef"));
            }
        }
    }
    let (sw, sh, orientation, has_alpha) = thumbs::image_meta(src).map_err(|e| e.to_string())?;
    if orientation == 1 && !has_alpha {
        return Ok((src.to_path_buf(), sw, sh, "jpg"));
    }
    let ext = if has_alpha { "png" } else { "jpg" };
    let base = thumbs_dir.join(format!("edit-{id}-base.{ext}"));
    if base_cache_fresh(&sidecar, "jpg", src) && base.exists() {
        if let Ok((w, h)) = image_dims(&base) {
            return Ok((base, w, h, "jpg"));
        }
    }
    let img = image::ImageReader::open(src)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;
    let oriented = thumbs::apply_orientation(&img, orientation);
    let out = if has_alpha {
        let mut buf = std::io::Cursor::new(Vec::new());
        oriented
            .write_to(&mut buf, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        buf.into_inner()
    } else {
        let rgba = oriented.to_rgba8();
        let mut flat = image::RgbImage::new(rgba.width(), rgba.height());
        for (x, y, px) in rgba.enumerate_pixels() {
            let a = px.0[3] as f32 / 255.0;
            let blend = |c: u8| (c as f32 * a + 255.0 * (1.0 - a)).round() as u8;
            flat.put_pixel(
                x,
                y,
                image::Rgb([blend(px.0[0]), blend(px.0[1]), blend(px.0[2])]),
            );
        }
        let mut buf = std::io::Cursor::new(Vec::new());
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 92);
        flat.write_with_encoder(encoder)
            .map_err(|e| e.to_string())?;
        buf.into_inner()
    };
    std::fs::write(&base, out).map_err(|e| e.to_string())?;
    write_base_sidecar(&sidecar, "jpg", src);
    let (w, h) = if orientation >= 5 { (sh, sw) } else { (sw, sh) };
    Ok((base, w, h, "jpg"))
}

fn image_dims(p: &Path) -> Result<(u32, u32), String> {
    image::ImageReader::open(p)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .into_dimensions()
        .map(|d| (d.0, d.1))
        .map_err(|e| e.to_string())
}

// 侧车 json 记录底图来源（nef|jpg）与源文件 mtime+size，复用前逐项校验
fn base_cache_fresh(sidecar: &Path, source: &str, src: &Path) -> bool {
    let Some((cached_source, mtime, size)) = read_base_sidecar(sidecar) else {
        return false;
    };
    if cached_source != source {
        return false;
    }
    let Some((src_mtime, src_size)) = file_mtime_secs_size(src) else {
        return false;
    };
    mtime == src_mtime && size == src_size
}

fn file_mtime_secs_size(p: &Path) -> Option<(i64, u64)> {
    let meta = std::fs::metadata(p).ok()?;
    let secs = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;
    Some((secs, meta.len()))
}

fn read_base_sidecar(path: &Path) -> Option<(String, i64, u64)> {
    let text = std::fs::read_to_string(path).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    Some((
        v.get("source")?.as_str()?.to_string(),
        v.get("srcMtime")?.as_i64()?,
        v.get("srcSize")?.as_u64()?,
    ))
}

fn write_base_sidecar(sidecar: &Path, source: &str, src: &Path) {
    if let Some((mtime, size)) = file_mtime_secs_size(src) {
        let _ = std::fs::write(
            sidecar,
            json!({ "source": source, "srcMtime": mtime, "srcSize": size }).to_string(),
        );
    }
}

// 编辑会话快照（契约镜像 Electron openEditSession 成功返回）。
// 短锁只读 img 行与已有 edits；temp 残留清理与底图解码/落盘在锁外
pub(crate) fn edit_session_snapshot(db: &Db, thumbs_dir: &Path, id: i64) -> Result<Value, String> {
    let (img, raw_opt, saved_edits) = {
        let conn = db.write_lock();
        let img = images_query::get_image_by_id(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "图片不存在".to_string())?;
        if img.hidden.unwrap_or(0) != 0 {
            return Ok(serde_json::json!({ "error": "隐藏的 NEF 记录不支持编辑" }));
        }
        let edits = edit_session::get_edits(&conn, id).map_err(|e| e.to_string())?;
        let raw = img.raw_path.clone().filter(|s| !s.is_empty());
        (img, raw, edits)
    };
    // 清理上次烘焙中断的残留 temp（各格式变体）；托管记录同名的文件不是残留，绝不删
    //（镜像 Electron openEditSession）：先锁外收集，再短锁判定托管归属
    let mut stale_candidates: Vec<PathBuf> = Vec::new();
    if let (Some(dir), Some(stem)) = (
        Path::new(&img.filepath).parent(),
        Path::new(&img.filepath).file_stem(),
    ) {
        for variant in [".jpg", ".png", ".webp"] {
            let stale = dir.join(format!("{}-temp{}", stem.to_string_lossy(), variant));
            if stale.exists() {
                stale_candidates.push(stale);
            }
        }
    }
    if !stale_candidates.is_empty() {
        let unmanaged: Vec<PathBuf> = {
            let conn = db.write_lock();
            stale_candidates
                .into_iter()
                .filter(|stale| {
                    let managed: Result<i64, rusqlite::Error> = conn.query_row(
                        "SELECT 1 FROM images WHERE filepath = ?1 COLLATE NOCASE",
                        [stale.to_string_lossy()],
                        |r| r.get(0),
                    );
                    matches!(managed, Err(rusqlite::Error::QueryReturnedNoRows))
                })
                .collect()
        };
        for stale in unmanaged {
            let _ = std::fs::remove_file(&stale);
        }
    }
    let (base, w, h, source) =
        ensure_edit_base(raw_opt.as_deref(), thumbs_dir, id, Path::new(&img.filepath))?;
    Ok(serde_json::json!({
        "id": id,
        "source": source,
        "basePath": base.to_string_lossy(),
        "width": w,
        "height": h,
        "hasNef": img.raw_path.as_deref().map(|p| !p.is_empty()).unwrap_or(false),
        "savedEdits": saved_edits,
        "filepath": img.filepath,
    }))
}

#[tauri::command]
pub async fn edit_open(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    id: i64,
) -> Result<Value, String> {
    let db = db.inner().clone();
    let paths = paths.inner().clone();
    tauri::async_runtime::spawn_blocking(move || edit_session_snapshot(&db, &paths.thumbs_dir, id))
        .await
        .map_err(|e| format!("后台任务失败: {e}"))?
}

// 编辑预览缩略图（镜像 Electron edit-preview-ready 链路）：spec 已由桥内按 400 长边构建代理，
// 渲染/缓存元数据/写库在内核闭环，命令层只补事件；渲染失败不影响已保存的编辑参数。
// 短锁只读版本号/行数据，渲染与底图解码在锁外，UPDATE 写回用短锁
pub(crate) fn render_edit_preview_kernel(
    db: &Db,
    thumbs_dir: &Path,
    id: i64,
    spec: &Value,
    input_path: &Path,
) -> Result<Value, String> {
    const RENDER_VERSION: &str = "render-rust-1";
    let (raw_opt, version_before) = {
        let conn = db.write_lock();
        let img = images_query::get_image_by_id(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "图片不存在".to_string())?;
        if img.hidden.unwrap_or(0) != 0 {
            return Ok(serde_json::json!({ "error": "隐藏的 NEF 记录不支持编辑预览" }));
        }
        let version_before = edit_session::get_edits(&conn, id)
            .map_err(|e| e.to_string())?
            .get("version")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        (img.raw_path.filter(|s| !s.is_empty()), version_before)
    };
    let (base, _, _, _) = ensure_edit_base(raw_opt.as_deref(), thumbs_dir, id, input_path)?;
    let preview = thumbs_dir.join(format!("edit-{id}.jpg"));
    let preview_meta = PathBuf::from(format!("{}.meta.json", preview.to_string_lossy()));
    if preview.exists() {
        let cached = std::fs::read_to_string(&preview_meta)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .map(|meta| {
                meta.get("editVersion").and_then(|v| v.as_i64()) == Some(version_before)
                    && meta.get("renderVersion").and_then(|v| v.as_str()) == Some(RENDER_VERSION)
            })
            .unwrap_or(false);
        if cached {
            return Ok(serde_json::json!({ "path": preview.to_string_lossy() }));
        }
    }
    if let Err(e) = executor::render_spec_to_file(spec, &base, &preview) {
        return Ok(serde_json::json!({ "error": format!("渲染失败：{e}") }));
    }
    let conn = db.write_lock();
    let version_unchanged = edit_session::get_edits(&conn, id)
        .map_err(|e| e.to_string())?
        .get("version")
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
        == version_before;
    if version_unchanged {
        let _ = std::fs::write(
            &preview_meta,
            serde_json::json!({
                "editVersion": version_before,
                "renderVersion": RENDER_VERSION,
            })
            .to_string(),
        );
    }
    let _ = conn.execute(
        "UPDATE images SET thumbnail_edit_path = ?1 WHERE id = ?2",
        rusqlite::params![preview.to_string_lossy(), id],
    );
    let _ = edit_session::enforce_edit_preview_limit(
        &conn,
        thumbs_dir,
        edit_session::EDIT_PREVIEW_LIMIT,
    );
    Ok(serde_json::json!({ "path": preview.to_string_lossy() }))
}

#[tauri::command]
pub async fn edit_render_preview(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    app: AppHandle,
    id: i64,
    spec: Value,
    input_path: String,
) -> Result<Value, String> {
    let db = db.inner().clone();
    let paths = paths.inner().clone();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result =
            render_edit_preview_kernel(&db, &paths.thumbs_dir, id, &spec, Path::new(&input_path));
        if let Some(path) = result
            .as_ref()
            .ok()
            .and_then(|v| v.get("path"))
            .and_then(|p| p.as_str())
        {
            progress::emit_progress(
                &app,
                progress::EDIT_PREVIEW_READY,
                serde_json::json!({ "id": id, "path": path }),
            );
        }
        result
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn edit_bake(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    app: AppHandle,
    id: i64,
    edits: Value,
    spec: Value,
    input_path: String,
) -> Result<Value, String> {
    let db = db.inner().clone();
    let paths = paths.inner().clone();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let raw_opt = {
            let conn = db.write_lock();
            images_query::get_image_by_id(&conn, id)
                .map_err(|e| e.to_string())?
                .map(|i| i.raw_path)
                .unwrap_or(None)
        };
        let (base, _, _, _) = ensure_edit_base(
            raw_opt.as_deref(),
            &paths.thumbs_dir,
            id,
            Path::new(&input_path),
        )?;
        let result = {
            let conn = db.write_lock();
            edit_session::edit_bake(&conn, id, &edits, &spec, &base, &paths.thumbs_dir)
                .map_err(|e| e.to_string())
        };
        // 镜像 Electron：烘焙后缩略图由 rebuild 重生成（仅缺失者，后台跑，完成发 thumbnails-ready）
        if let Ok(v) = &result {
            if v.get("error").is_none() {
                let app = app.clone();
                let thumbs_dir = paths.thumbs_dir.clone();
                std::thread::spawn(move || {
                    let db = app.state::<Db>();
                    let _ = update_image::rebuild_thumbnails_unlocked(
                        &db,
                        &thumbs_dir,
                        false,
                        Some(&app),
                    );
                });
            }
        }
        result
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn edit_export(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    id: i64,
    edits: Value,
    spec: Value,
    input_path: String,
    dest_dir: String,
    output: Value,
) -> Result<Value, String> {
    let db = db.inner().clone();
    let paths = paths.inner().clone();
    // edits 由桥层随 spec 一并传入（渲染指令在 spec 中，此处不使用原始参数）
    let _ = edits;
    tauri::async_runtime::spawn_blocking(move || {
        let raw_opt = {
            let conn = db.write_lock();
            images_query::get_image_by_id(&conn, id)
                .map_err(|e| e.to_string())?
                .map(|i| i.raw_path)
                .unwrap_or(None)
        };
        let (base, _, _, _) = ensure_edit_base(
            raw_opt.as_deref(),
            &paths.thumbs_dir,
            id,
            Path::new(&input_path),
        )?;
        if !Path::new(&dest_dir).exists() {
            return Ok(serde_json::json!({ "error": "导出目录不存在" }));
        }
        let src_ext = Path::new(&input_path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e.to_ascii_lowercase()))
            .unwrap_or_else(|| ".jpg".into());
        let supported = ["jpeg", "png", "webp"];
        let out_format = output
            .get("format")
            .and_then(|f| f.as_str())
            .filter(|f| supported.contains(f))
            .map(String::from)
            .unwrap_or_else(|| match src_ext.as_str() {
                ".png" => "png".into(),
                ".webp" => "webp".into(),
                _ => "jpeg".into(),
            });
        let ext = match out_format.as_str() {
            "png" => ".png",
            "webp" => ".webp",
            _ => ".jpg",
        };
        let max_edge = output
            .get("maxEdge")
            .and_then(|v| v.as_f64())
            .filter(|v| *v > 0.0)
            .map(|v| v as u32);
        let dims = image::ImageReader::open(&base)
            .map_err(|e| e.to_string())?
            .with_guessed_format()
            .map_err(|e| e.to_string())?
            .into_dimensions()
            .map_err(|e| e.to_string())?;
        let resize = max_edge
            .filter(|m| dims.0.max(dims.1) > *m)
            .map(|m| serde_json::json!({ "width": m, "height": m }));
        let stem = Path::new(&input_path)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "image".into());
        let size_tag = if resize.is_some() {
            format!("-{}px", max_edge.unwrap())
        } else {
            String::new()
        };
        let mut dest = Path::new(&dest_dir).join(format!("{stem}-edited{size_tag}{ext}"));
        let mut n = 1u32;
        while dest.exists() {
            dest = Path::new(&dest_dir).join(format!("{stem}-edited{size_tag}_{n}{ext}"));
            n += 1;
        }
        let mut spec = spec.clone();
        let quality = output
            .get("quality")
            .and_then(|v| v.as_f64())
            .filter(|q| *q > 0.0)
            .map(|q| q.round().clamp(1.0, 100.0) as i64);
        let encode = spec
            .as_object_mut()
            .ok_or_else(|| "spec 非对象".to_string())?
            .entry("encode")
            .or_insert_with(|| serde_json::json!({}));
        let encode_obj = encode
            .as_object_mut()
            .ok_or_else(|| "spec.encode 非对象".to_string())?;
        let mut encode_params = encode_obj
            .get("params")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        encode_params["format"] = Value::String(out_format.clone());
        if let Some(q) = quality {
            encode_params["quality"] = Value::from(q);
        }
        if let Some(r) = resize {
            encode_params["resize"] = r;
        }
        encode_obj["params"] = encode_params;

        match executor::render_spec_to_file(&spec, Path::new(&base), &dest) {
            Ok(out) => {
                // EXIF 回接来源改原图：base 为再编码副本/NEF 预览时无原图 EXIF（零拷贝时执行器已回接）
                if base != Path::new(&input_path) {
                    if let Err(e) =
                        crate::exif_relay::relay_exif_files(Path::new(&input_path), &dest)
                    {
                        eprintln!("[编辑导出] EXIF 回接失败: {e}");
                    }
                }
                Ok(serde_json::json!({
                    "ok": true,
                    "path": dest.to_string_lossy(),
                    "width": out.width,
                    "height": out.height,
                }))
            }
            Err(e) => Ok(serde_json::json!({ "error": format!("导出失败：{}", e) })),
        }
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn delete_image(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    id: i64,
) -> Result<Option<images_query::ImageRow>, String> {
    let db = db.inner().clone();
    let paths = paths.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.write_lock();
        db::delete_image(&conn, id, &paths.thumbs_dir).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn batch_delete_images(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    ids: Vec<i64>,
) -> Result<Value, String> {
    let db = db.inner().clone();
    let paths = paths.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.write_lock();
        ok_or_error_value(
            "批量删除失败",
            db::batch_delete_images(&conn, &ids, &paths.thumbs_dir),
        )
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

// ── 图片列表查询通道（迁移接缝 3） ──

#[tauri::command]
pub fn get_images(db: State<'_, Db>, query: images_query::ImageQuery) -> Result<Value, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    let (rows, total) = images_query::get_images(&conn, &query).map_err(|e| e.to_string())?;
    Ok(json!({ "images": rows, "total": total }))
}

#[tauri::command]
pub fn get_image(db: State<'_, Db>, id: i64) -> Result<Option<images_query::ImageRow>, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    images_query::get_image_by_id(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_import_dates(db: State<'_, Db>) -> Result<Vec<images_query::ImportDateRow>, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    images_query::get_import_dates(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_stats(db: State<'_, Db>) -> Result<images_query::StatsRow, String> {
    let conn = db.open_read().map_err(|e| e.to_string())?;
    images_query::get_stats(&conn).map_err(|e| e.to_string())
}

#[cfg(test)]
mod edit_cmd_tests {
    use super::*;
    use image::{DynamicImage, RgbaImage};
    use std::path::PathBuf;

    fn edit_mem_db() -> rusqlite::Connection {
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
        let dir = std::env::temp_dir().join(format!("pixyang_cmd_{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_jpeg(dir: &Path, name: &str, w: u32, h: u32, gray: u8) -> PathBuf {
        let img = DynamicImage::from(RgbaImage::from_fn(w, h, |_, _| {
            image::Rgba([gray, gray, 60, 255])
        }));
        let p = dir.join(name);
        img.save(&p).unwrap();
        p
    }

    fn seed_record(conn: &rusqlite::Connection, filename: &str, filepath: &Path) -> i64 {
        conn.execute(
            "INSERT INTO images (filename, filepath, import_date, format, width, height)
             VALUES (?1, ?2, '2026-09-21', 'jpg', 10, 8)",
            rusqlite::params![filename, filepath.to_string_lossy()],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn valid_spec() -> Value {
        serde_json::json!({
            "specVersion": 1,
            "stages": [
                { "kind": "exposure", "params": { "ev": 0.5 } },
                { "kind": "encode", "params": { "format": "jpeg", "quality": 80 } }
            ]
        })
    }

    #[test]
    fn edit_snapshot_返回完整契约() {
        let dir = fresh_dir("open");
        let src = make_jpeg(&dir, "a.jpg", 40, 30, 100);
        let conn = edit_mem_db();
        let id = seed_record(&conn, "a.jpg", &src);
        conn.execute(
            "UPDATE images SET raw_path = ?1 WHERE id = ?2",
            rusqlite::params![dir.join("a.nef").to_string_lossy(), id],
        )
        .unwrap();
        let db = Db::from_connection(conn);
        let thumbs = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs).unwrap();
        let snap = edit_session_snapshot(&db, &thumbs, id).unwrap();
        assert_eq!(snap["id"], id);
        assert_eq!(snap["source"], "jpg");
        assert_eq!(snap["hasNef"], true);
        assert_eq!(snap["width"], 40);
        assert_eq!(snap["height"], 30);
        assert!(snap["savedEdits"].is_null());
        // raw_path 指向的 NEF 不存在：零拷贝直用原图，不落底图文件
        assert_eq!(snap["basePath"], src.to_string_lossy().as_ref());
        assert!(!thumbs.join(format!("edit-{id}-base.jpg")).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn edit_snapshot_nef底图优先提取预览() {
        let dir = fresh_dir("open_nef");
        let src = make_jpeg(&dir, "a.jpg", 40, 30, 100);
        let conn = edit_mem_db();
        let id = seed_record(&conn, "a.jpg", &src);
        // 合成含内嵌全尺寸 JPEG 段（宽 ≥320）的 NEF，走真实提取链路
        let preview_img = DynamicImage::from(RgbaImage::from_fn(320, 200, |x, y| {
            image::Rgba([(x % 256) as u8, (y % 256) as u8, 40, 255])
        }));
        let mut preview_bytes = Vec::new();
        preview_img
            .write_to(
                &mut std::io::Cursor::new(&mut preview_bytes),
                image::ImageFormat::Jpeg,
            )
            .unwrap();
        let nef = dir.join("a.nef");
        std::fs::write(&nef, &preview_bytes).unwrap();
        conn.execute(
            "UPDATE images SET raw_path = ?1 WHERE id = ?2",
            rusqlite::params![nef.to_string_lossy(), id],
        )
        .unwrap();
        let db = Db::from_connection(conn);
        let thumbs = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs).unwrap();
        let snap = edit_session_snapshot(&db, &thumbs, id).unwrap();
        assert_eq!(snap["source"], "nef");
        let base = snap["basePath"].as_str().unwrap();
        assert!(base.ends_with(&format!("edit-{id}-base.jpg")));
        assert!(Path::new(base).exists());
        assert_eq!(snap["width"], 320);
        assert_eq!(snap["height"], 200);
        // 第二次打开：侧车 mtime+size 命中缓存，不再重复提取（直接复用同一底图）
        let before = std::fs::read(base).unwrap();
        let again = edit_session_snapshot(&db, &thumbs, id).unwrap();
        assert_eq!(again["source"], "nef");
        assert_eq!(std::fs::read(base).unwrap(), before);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 编辑底图_规范化副本侧车失效时重建() {
        let dir = fresh_dir("base_stale");
        let thumbs = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs).unwrap();
        let id = 7;
        let src = dir.join("alpha.png");
        DynamicImage::from(RgbaImage::from_fn(20, 10, |_, _| {
            image::Rgba([1, 2, 3, 140])
        }))
        .save(&src)
        .unwrap();
        let (base1, w, h, source) = ensure_edit_base(None, &thumbs, id, &src).unwrap();
        assert_eq!(source, "jpg");
        assert_eq!((w, h), (20, 10));
        let bytes1 = std::fs::read(&base1).unwrap();
        assert!(!bytes1.is_empty());
        // 原图被外部改写（尺寸变化 → size 必变）：侧车失效，底图必须重建
        DynamicImage::from(RgbaImage::from_fn(40, 30, |_, _| {
            image::Rgba([9, 9, 9, 250])
        }))
        .save(&src)
        .unwrap();
        let (base2, w2, h2, _) = ensure_edit_base(None, &thumbs, id, &src).unwrap();
        assert_eq!(base2, base1);
        assert_eq!((w2, h2), (40, 30));
        assert_ne!(std::fs::read(&base2).unwrap(), bytes1);
        // mtime+size 未变时命中缓存复用
        let again = ensure_edit_base(None, &thumbs, id, &src).unwrap();
        assert_eq!(
            std::fs::read(&again.0).unwrap(),
            std::fs::read(&base2).unwrap()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn edit_snapshot_图片不存在_报错() {
        let db = Db::from_connection(edit_mem_db());
        let dir = fresh_dir("open_missing");
        std::fs::create_dir_all(&dir).unwrap();
        let err = edit_session_snapshot(&db, &dir, 999).unwrap_err();
        assert_eq!(err, "图片不存在");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 预览渲染_落盘_写回缩略图路径与缓存元数据() {
        let dir = fresh_dir("preview_ok");
        let src = make_jpeg(&dir, "a.jpg", 40, 30, 100);
        let conn = edit_mem_db();
        let id = seed_record(&conn, "a.jpg", &src);
        let thumbs = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs).unwrap();
        edit_session::save_edit_params(&conn, id, &serde_json::json!({ "exposure": 0.5 }), None)
            .unwrap();
        let db = Db::from_connection(conn);
        let result = render_edit_preview_kernel(&db, &thumbs, id, &valid_spec(), &src).unwrap();
        let preview = thumbs.join(format!("edit-{id}.jpg"));
        assert_eq!(result["path"].as_str().unwrap(), preview.to_string_lossy());
        assert!(preview.exists());
        let stored: String = db
            .write_lock()
            .query_row(
                "SELECT thumbnail_edit_path FROM images WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored.as_str(), preview.to_string_lossy());
        let meta =
            std::fs::read_to_string(thumbs.join(format!("edit-{id}.jpg.meta.json"))).unwrap();
        let meta: Value = serde_json::from_str(&meta).unwrap();
        assert_eq!(meta["editVersion"], 1);
        assert_eq!(meta["renderVersion"], "render-rust-1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 预览渲染_版本未变命中缓存跳过渲染() {
        let dir = fresh_dir("preview_cache");
        let src = make_jpeg(&dir, "a.jpg", 40, 30, 100);
        let conn = edit_mem_db();
        let id = seed_record(&conn, "a.jpg", &src);
        let thumbs = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs).unwrap();
        edit_session::save_edit_params(&conn, id, &serde_json::json!({ "exposure": 0.5 }), None)
            .unwrap();
        let db = Db::from_connection(conn);
        render_edit_preview_kernel(&db, &thumbs, id, &valid_spec(), &src).unwrap();
        let cached = thumbs.join(format!("edit-{id}.jpg"));
        let bytes = std::fs::read(&cached).unwrap();
        let broken_spec = serde_json::json!({ "specVersion": 1 });
        let result = render_edit_preview_kernel(&db, &thumbs, id, &broken_spec, &src).unwrap();
        assert_eq!(result["path"].as_str().unwrap(), cached.to_string_lossy());
        assert_eq!(std::fs::read(&cached).unwrap(), bytes);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 预览渲染_版本前进后缓存失效() {
        let dir = fresh_dir("preview_stale");
        let src = make_jpeg(&dir, "a.jpg", 40, 30, 100);
        let conn = edit_mem_db();
        let id = seed_record(&conn, "a.jpg", &src);
        let thumbs = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs).unwrap();
        edit_session::save_edit_params(&conn, id, &serde_json::json!({ "exposure": 0.5 }), None)
            .unwrap();
        let db = Db::from_connection(conn);
        render_edit_preview_kernel(&db, &thumbs, id, &valid_spec(), &src).unwrap();
        edit_session::save_edit_params(
            &db.write_lock(),
            id,
            &serde_json::json!({ "exposure": 1.5 }),
            None,
        )
        .unwrap();
        let broken_spec = serde_json::json!({ "specVersion": 1 });
        let result = render_edit_preview_kernel(&db, &thumbs, id, &broken_spec, &src).unwrap();
        assert!(result["error"]
            .as_str()
            .unwrap_or("")
            .starts_with("渲染失败"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 预览渲染_失败不写缩略图路径() {
        let dir = fresh_dir("preview_fail");
        let src = make_jpeg(&dir, "a.jpg", 40, 30, 100);
        let conn = edit_mem_db();
        let id = seed_record(&conn, "a.jpg", &src);
        let thumbs = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs).unwrap();
        let db = Db::from_connection(conn);
        let broken_spec = serde_json::json!({ "specVersion": 1 });
        let result = render_edit_preview_kernel(&db, &thumbs, id, &broken_spec, &src).unwrap();
        assert!(result["error"]
            .as_str()
            .unwrap_or("")
            .starts_with("渲染失败"));
        let stored: String = db
            .write_lock()
            .query_row(
                "SELECT thumbnail_edit_path FROM images WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, "");
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn 快照清理上次烘焙残留temp() {
        let dir = fresh_dir("open_stale");
        let src = make_jpeg(&dir, "a.jpg", 40, 30, 100);
        let conn = edit_mem_db();
        let id = seed_record(&conn, "a.jpg", &src);
        std::fs::write(dir.join("a-temp.png"), b"stale").unwrap();
        std::fs::write(dir.join("a-temp.webp"), b"stale").unwrap();
        let db = Db::from_connection(conn);
        let thumbs = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs).unwrap();
        let snap = edit_session_snapshot(&db, &thumbs, id).unwrap();
        assert!(snap.get("error").is_none(), "{snap}");
        assert!(!dir.join("a-temp.png").exists());
        assert!(!dir.join("a-temp.webp").exists());
        assert!(src.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 快照不删托管同名temp() {
        let dir = fresh_dir("open_managed");
        let src = make_jpeg(&dir, "a.jpg", 40, 30, 100);
        let conn = edit_mem_db();
        let id = seed_record(&conn, "a.jpg", &src);
        let managed_lookalike = dir.join("a-temp.jpg");
        std::fs::write(&managed_lookalike, b"real record").unwrap();
        let _ = seed_record(&conn, "a-temp.jpg", &managed_lookalike);
        let db = Db::from_connection(conn);
        let thumbs = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs).unwrap();
        let snap = edit_session_snapshot(&db, &thumbs, id).unwrap();
        assert!(snap.get("error").is_none(), "{snap}");
        assert!(managed_lookalike.exists(), "托管同名文件绝不能被当残留删除");
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn 预览LRU_超限清最旧且文件列同步删除() {
        let dir = fresh_dir("preview_lru");
        let _src = make_jpeg(&dir, "a.jpg", 40, 30, 100);
        let conn = edit_mem_db();
        let thumbs = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs).unwrap();
        let mut ids = Vec::new();
        for i in 0..3 {
            let f = make_jpeg(&dir, &format!("img{i}.jpg"), 40, 30, 100);
            let id = seed_record(&conn, &format!("img{i}.jpg"), &f);
            ids.push(id);
            let p = thumbs.join(format!("edit-{id}.jpg"));
            std::fs::write(&p, b"p").unwrap();
            conn.execute(
                "INSERT INTO edits (image_id, version, params_json, updated_at)
                 VALUES (?1, 1, '{}', ?2)",
                rusqlite::params![id, format!("2026-09-2{i} 00:00:00")],
            )
            .unwrap();
            conn.execute(
                "UPDATE images SET thumbnail_edit_path = ?1 WHERE id = ?2",
                rusqlite::params![p.to_string_lossy(), id],
            )
            .unwrap();
        }
        let removed = edit_session::enforce_edit_preview_limit(&conn, &thumbs, 2).unwrap();
        assert_eq!(removed, 1);
        // 最旧（updated_at 2026-09-20）被清：文件删除、列清空；其余保留
        assert!(!thumbs.join(format!("edit-{}.jpg", ids[0])).exists());
        let cleared: String = conn
            .query_row(
                "SELECT thumbnail_edit_path FROM images WHERE id = ?1",
                [ids[0]],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cleared, "");
        for id in ids.iter().skip(1) {
            assert!(thumbs.join(format!("edit-{id}.jpg")).exists());
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}

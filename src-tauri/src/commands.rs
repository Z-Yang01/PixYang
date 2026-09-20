// Tauri 命令壳：薄封装内核模块（naming/image_group），编排宿主关注点（磁盘 I/O、DTO）。
// 命令不内嵌业务逻辑；错误统一 String（跨 IPC 序列化最简形态）。

use crate::db::Db;
use crate::image_group::{self, ImportFile, PairGroup};
use crate::images_query;
use crate::naming;
use crate::tags_albums;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use tauri::State;

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
}

// ── 设置通道（迁移接缝 1：与 Electron 读写同一 pixyang.db 的 settings 表） ──

#[tauri::command]
pub fn get_setting(db: State<'_, Db>, key: String) -> Result<Option<String>, String> {
    db.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(db: State<'_, Db>, key: String, value: String) -> Result<(), String> {
    db.set_setting(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(db: State<'_, Db>) -> Result<Vec<(String, String)>, String> {
    db.get_all_settings().map_err(|e| e.to_string())
}

// ── 标签/相册只读通道（迁移接缝 2） ──

#[tauri::command]
pub fn get_tags(db: State<'_, Db>) -> Result<Vec<tags_albums::TagRow>, String> {
    let conn = db.0.lock().unwrap();
    tags_albums::get_tags(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_image_tags(
    db: State<'_, Db>,
    image_id: i64,
) -> Result<Vec<tags_albums::TagLite>, String> {
    let conn = db.0.lock().unwrap();
    tags_albums::get_image_tags(&conn, image_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_batch_image_tags(
    db: State<'_, Db>,
    image_ids: Vec<i64>,
) -> Result<std::collections::HashMap<i64, Vec<tags_albums::TagLite>>, String> {
    let conn = db.0.lock().unwrap();
    tags_albums::get_batch_image_tags(&conn, &image_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_albums(db: State<'_, Db>) -> Result<Vec<tags_albums::AlbumRow>, String> {
    let conn = db.0.lock().unwrap();
    tags_albums::get_albums(&conn).map_err(|e| e.to_string())
}

// ── 标签/相册写通道（迁移接缝 4a） ──

#[tauri::command]
pub fn create_tag(
    db: State<'_, Db>,
    name: String,
    color: String,
) -> Result<Option<tags_albums::TagLite>, String> {
    let conn = db.0.lock().unwrap();
    tags_albums::create_tag(&conn, &name, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_tag(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    tags_albums::delete_tag(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_tag_to_image(db: State<'_, Db>, image_id: i64, tag_id: i64) -> Result<bool, String> {
    let conn = db.0.lock().unwrap();
    tags_albums::add_tag_to_image(&conn, image_id, tag_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_tag_from_image(db: State<'_, Db>, image_id: i64, tag_id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    tags_albums::remove_tag_from_image(&conn, image_id, tag_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_tag_to_images(
    db: State<'_, Db>,
    image_ids: Vec<i64>,
    tag_id: i64,
) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    tags_albums::add_tag_to_images(&conn, &image_ids, tag_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_album(
    db: State<'_, Db>,
    name: String,
    description: String,
) -> Result<Option<tags_albums::AlbumRow>, String> {
    let conn = db.0.lock().unwrap();
    tags_albums::create_album(&conn, &name, &description).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_album(
    db: State<'_, Db>,
    id: i64,
    new_name: String,
) -> Result<serde_json::Value, String> {
    let conn = db.0.lock().unwrap();
    tags_albums::rename_album(&conn, id, &new_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_album(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    tags_albums::delete_album(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_to_album(db: State<'_, Db>, album_id: i64, image_ids: Vec<i64>) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    tags_albums::add_to_album(&conn, album_id, &image_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_from_album(db: State<'_, Db>, album_id: i64, image_id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    tags_albums::remove_from_album(&conn, album_id, image_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_album_images(
    db: State<'_, Db>,
    album_id: i64,
) -> Result<Vec<images_query::ImageRow>, String> {
    let conn = db.0.lock().unwrap();
    tags_albums::get_album_images(&conn, album_id).map_err(|e| e.to_string())
}

// ── 图片列表查询通道（迁移接缝 3） ──

#[tauri::command]
pub fn get_images(
    db: State<'_, Db>,
    query: images_query::ImageQuery,
) -> Result<(Vec<images_query::ImageRow>, i64), String> {
    let conn = db.0.lock().unwrap();
    images_query::get_images(&conn, &query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_image(db: State<'_, Db>, id: i64) -> Result<Option<images_query::ImageRow>, String> {
    let conn = db.0.lock().unwrap();
    images_query::get_image_by_id(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_import_dates(db: State<'_, Db>) -> Result<Vec<images_query::ImportDateRow>, String> {
    let conn = db.0.lock().unwrap();
    images_query::get_import_dates(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_stats(db: State<'_, Db>) -> Result<images_query::StatsRow, String> {
    let conn = db.0.lock().unwrap();
    images_query::get_stats(&conn).map_err(|e| e.to_string())
}

use rusqlite::params;
use serde::Serialize;
use tauri::{State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::db::{self, AppPaths, Db};
use crate::err_cn;

// 托管边界同 Electron isManagedPath：图库根 + 数据库所在目录，Path::starts_with 按组件比较等价于 r + path.sep 前缀。
// starts_with 不归一化 .. 组件（E:/root/lib/../.. 对 E:/root 判真），target 须先做组件级归一化再比对
fn normalize_components(path: &std::path::Path) -> std::path::PathBuf {
    let mut out = std::path::PathBuf::new();
    for comp in path.components() {
        match comp {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub(crate) fn is_managed_path(
    images_root: &std::path::Path,
    database_dir: &std::path::Path,
    target: &std::path::Path,
) -> bool {
    let normalized = normalize_components(target);
    normalized.starts_with(images_root) || normalized.starts_with(database_dir)
}

// 镜像 shell:open-path 返回契约：成功返回空串，任何失败以错误字符串正常返回
#[tauri::command]
pub async fn open_path(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    path: String,
) -> Result<String, String> {
    if path.is_empty() {
        return Ok("无效路径".into());
    }
    let target = std::path::PathBuf::from(&path);
    let images_root = {
        let conn = db.open_read().map_err(|e| err_cn::text(&e))?;
        db::images_root(&conn, &paths.default_images_dir).map_err(|e| err_cn::text(&e))?
    };
    let database_dir = db::default_db_path()
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    if !is_managed_path(&images_root, &database_dir, &target) {
        return Ok("仅允许打开图库目录".into());
    }
    match std::fs::metadata(&target) {
        Ok(meta) => {
            if !meta.is_dir() {
                return Ok("目标不是目录".into());
            }
        }
        Err(e) => return Ok(err_cn::text(&e)),
    }
    match tauri_plugin_opener::open_path(&target, None::<&str>) {
        Ok(()) => Ok(String::new()),
        Err(e) => Ok(err_cn::text(&e)),
    }
}

#[derive(Serialize)]
pub struct BackupResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn backup_failure(error: Option<String>) -> BackupResult {
    BackupResult {
        success: false,
        path: None,
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::is_managed_path;
    use std::path::{Path, PathBuf};

    fn roots() -> (PathBuf, PathBuf) {
        (
            PathBuf::from("E:/Pic/library"),
            PathBuf::from("C:/Users/u/AppData/Roaming/pixyang"),
        )
    }

    #[test]
    fn 图库根与数据库目录内路径均受管() {
        let (img, db) = roots();
        assert!(is_managed_path(&img, &db, &img));
        assert!(is_managed_path(&img, &db, &img.join("2026-09/a.jpg")));
        assert!(is_managed_path(&img, &db, &db));
        assert!(is_managed_path(&img, &db, &db.join("pixyang.db")));
    }

    #[test]
    fn 目录外_同前缀名字迷惑_与上级逃逸均不受管() {
        let (img, db) = roots();
        // 同前缀但不同路径组件（starts_with 按组件比较，不被字符串前缀迷惑）
        assert!(!is_managed_path(
            &img,
            &db,
            &Path::new("E:/Pic/libraryEvil")
        ));
        assert!(!is_managed_path(
            &img,
            &db,
            &Path::new("E:/Pic/library2/a.jpg")
        ));
        assert!(!is_managed_path(&img, &db, &Path::new("E:/tmp/x.jpg")));
        assert!(!is_managed_path(&img, &db, &Path::new("D:/Pic/library")));
    }

    #[test]
    fn 组件归一化堵住上级目录穿越() {
        let (img, db) = roots();
        // library 内的 .. 向上逃逸到图库外：归一化后必须判不受管
        assert!(!is_managed_path(
            &img,
            &db,
            &Path::new("E:/Pic/library/../../evil")
        ));
        assert!(!is_managed_path(
            &img,
            &db,
            &Path::new("E:/Pic/library/sub/../../evil.jpg")
        ));
        // 借 .. 绕一圈仍回到受管范围内：保持受管
        assert!(is_managed_path(
            &img,
            &db,
            &Path::new("E:/Pic/library/sub/../a.jpg")
        ));
    }

    #[test]
    fn 空数据库目录回退时仅图库根受管() {
        let (img, _) = roots();
        let fallback = PathBuf::from(".");
        assert!(is_managed_path(&img, &fallback, &img.join("a.jpg")));
        assert!(!is_managed_path(
            &img,
            &fallback,
            &Path::new("C:/Windows/explorer.exe")
        ));
    }
}

#[tauri::command]
pub async fn backup_database(db: State<'_, Db>, window: Window) -> Result<BackupResult, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let dest = match window
        .dialog()
        .file()
        .set_title("备份数据库")
        .set_file_name(format!("pixyang-backup-{stamp}.db"))
        .add_filter("SQLite 数据库", &["db"])
        .blocking_save_file()
    {
        Some(p) => p.to_string(),
        None => return Ok(backup_failure(None)),
    };
    // VACUUM INTO 拒绝写入已存在文件：先写同目录临时名，成功后再替换目标。
    // 旧实现先删用户选中的既有文件再 VACUUM，源库被锁/磁盘满时选中的文件已凭空丢失
    let tmp = format!("{dest}.vacuum-tmp");
    let _ = std::fs::remove_file(&tmp);
    let conn = db.write_lock();
    if let Err(e) = conn.execute("VACUUM INTO ?1", params![&tmp]) {
        let _ = std::fs::remove_file(&tmp);
        return Ok(backup_failure(Some(err_cn::text(&e))));
    }
    if let Err(e) = std::fs::remove_file(&dest) {
        if e.kind() != std::io::ErrorKind::NotFound {
            let _ = std::fs::remove_file(&tmp);
            return Ok(backup_failure(Some(err_cn::text(&e))));
        }
    }
    match std::fs::rename(&tmp, &dest) {
        Ok(_) => Ok(BackupResult {
            success: true,
            path: Some(dest),
            error: None,
        }),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Ok(backup_failure(Some(err_cn::text(&e))))
        }
    }
}

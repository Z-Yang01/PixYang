pub mod camera;
pub mod commands;
pub mod interact;
// [MOD-B]
pub mod db;
pub mod edit_session;
pub mod error;
pub mod executor;
pub mod exif_read;
pub mod exif_relay;
pub mod file_ops;
pub mod image_group;
pub mod images_query;
pub mod naming;
pub mod progress;
pub mod render;
pub mod scan;
pub mod tags_albums;
pub mod thumbs;
pub mod update_image;

use tauri::Manager;

// 注册命令即编译期校验命令签名（generate_handler!）；run() 由桌面入口（main.rs）调用，
// cargo test 不启动窗口，仅保证可编译。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例锁必须最先注册（镜像 requestSingleInstanceLock：二实例唤起已有窗口）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let database =
                db::Db::open(&db::default_db_path()).map_err(|e| format!("数据库打开失败: {e}"))?;
            let default_images_dir = db::default_db_path()
                .parent()
                .unwrap_or(std::path::Path::new("."))
                .join("images");
            let images_root = database
                .get_setting("images_root")
                .unwrap_or(None)
                .filter(|s| !s.is_empty())
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| default_images_dir.clone());
            let _ = std::fs::create_dir_all(&images_root);
            {
                let conn = database.0.lock().unwrap();
                let removed = file_ops::cleanup_stale_bake_temps(&conn);
                if removed > 0 {
                    eprintln!("[启动] 清扫烘焙残留 temp {removed} 个");
                }
            }
            {
                use tauri::Manager;
                let scope = app.asset_protocol_scope();
                let _ = scope.allow_directory(&images_root, true);
                let _ = scope.allow_directory(&db::default_thumbnails_dir(), true);
                let _ = scope.allow_directory(
                    &db::default_db_path()
                        .parent()
                        .unwrap_or(std::path::Path::new("."))
                        .to_path_buf(),
                    true,
                );
            }
            app.manage(database);
            app.manage(db::AppPaths {
                thumbs_dir: db::default_thumbnails_dir(),
                default_images_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::unique_filename,
            commands::group_import_files,
            commands::get_setting,
            commands::set_setting,
            commands::get_settings,
            commands::get_tags,
            commands::get_image_tags,
            commands::get_batch_image_tags,
            commands::get_albums,
            commands::get_images,
            commands::get_image,
            commands::get_import_dates,
            commands::get_stats,
            commands::create_tag,
            commands::delete_tag,
            commands::add_tag_to_image,
            commands::remove_tag_from_image,
            commands::add_tag_to_images,
            commands::create_album,
            commands::rename_album,
            commands::delete_album,
            commands::add_to_album,
            commands::remove_from_album,
            commands::get_album_images,
            commands::delete_image,
            commands::batch_delete_images,
            commands::get_presets,
            commands::create_preset,
            commands::delete_preset,
            commands::get_images_root,
            commands::get_database_path,
            commands::get_all_image_ids,
            commands::file_exists,
            commands::make_thumbnail_tiers,
            commands::extract_nef_preview,
            commands::image_meta,
            commands::render_edit,
            commands::import_images,
            commands::rename_image,
            commands::export_images,
            commands::export_album_images,
            commands::get_exif,
            commands::scan_directory,
            commands::collect_import_files,
            commands::update_image,
            commands::update_images,
            commands::rebuild_thumbnails,
            commands::scan_broken_records,
            commands::delete_broken_records,
            commands::find_duplicates,
            commands::get_edits,
            commands::save_edit_params,
            commands::get_edit_history,
            commands::edit_cancel,
            commands::edit_open,
            commands::edit_bake,
            commands::edit_export,
            commands::edit_render_preview,
            interact::select_directory,
            interact::select_export_directory,
            interact::open_path,
            interact::backup_database,
            camera::sync_camera_folder,
            camera::set_images_root,
            // [CMD-B]
            commands::rebuild_thumbnails_with_events,
        ])
        .run(tauri::generate_context!())
        .expect("tauri 启动失败");
}

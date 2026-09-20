pub mod commands;
pub mod db;
pub mod error;
pub mod executor;
pub mod exif_relay;
pub mod image_group;
pub mod images_query;
pub mod naming;
pub mod render;
pub mod tags_albums;
pub mod thumbs;

use tauri::Manager;

// 注册命令即编译期校验命令签名（generate_handler!）；run() 由桌面入口（main.rs）调用，
// cargo test 不启动窗口，仅保证可编译。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let database =
                db::Db::open(&db::default_db_path()).map_err(|e| format!("数据库打开失败: {e}"))?;
            app.manage(database);
            app.manage(db::AppPaths {
                thumbs_dir: db::default_thumbnails_dir(),
                default_images_dir: db::default_db_path()
                    .parent()
                    .unwrap_or(std::path::Path::new("."))
                    .join("images"),
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
        ])
        .run(tauri::generate_context!())
        .expect("tauri 启动失败");
}

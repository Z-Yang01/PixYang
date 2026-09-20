pub mod commands;
pub mod db;
pub mod image_group;
pub mod naming;
pub mod tags_albums;

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
        ])
        .run(tauri::generate_context!())
        .expect("tauri 启动失败");
}

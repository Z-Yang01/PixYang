pub mod commands;
pub mod image_group;
pub mod naming;

// 注册命令即编译期校验命令签名（generate_handler!）；run() 由桌面入口（main.rs）调用，
// cargo test 不启动窗口，仅保证可编译。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::unique_filename,
            commands::group_import_files,
        ])
        .run(tauri::generate_context!())
        .expect("tauri 启动失败");
}

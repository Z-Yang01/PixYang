// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("cli") {
        // 外部 agent 通道：直连内核执行后退出（无窗口、不触发单实例）
        std::process::exit(pixyang::cli::run(&args[1..]));
    }
    pixyang::run()
}

- 2026-09-21 00:20 启动冒烟（debug 构建 pixyang.exe）：进程树健康存活 8s+（WebView2 初始化
  成功、多进程树正常），打开共享库 %APPDATA%/pixyang/pixyang.db（与 Electron 同一文件，
  路径镜像端到端验证），手动终止无残留。启动级冒烟通过；点击级功能冒烟待人工执行
  （cd src-tauri && cargo run）。
- 2026-09-21 00:40 冒烟问题修复（用户首次视觉冒烟反馈）：
  1) CSP：默认策略未放行 Windows IPC 端点 http://ipc.localhost——tauri.conf.json 设显式 CSP
     （connect-src ipc: http://ipc.localhost；img-src asset: http://asset.localhost 供缩略图；
     style unsafe-inline 供内联样式）。
  2) 返回形状：get_images 命令由元组改为 {images, total} 对象（前端 undefined.length 崩溃根因）；
     get_settings 由 pairs 数组改为 {key: value} 对象（镜像 JS getAllSettings），
     db.rs 新增 get_all_settings_map。三处修复后 cargo 115/115 + golden 全绿 + vitest 961/961，
     dist 与二进制已重建，二次冒烟拉起/终止正常。等待用户二次视觉确认。

- 2026-09-21 00:20 启动冒烟（debug 构建 pixyang.exe）：进程树健康存活 8s+（WebView2 初始化
  成功、多进程树正常），打开共享库 %APPDATA%/pixyang/pixyang.db（与 Electron 同一文件，
  路径镜像端到端验证），手动终止无残留。启动级冒烟通过；点击级功能冒烟待人工执行
  （cd src-tauri && cargo run）。

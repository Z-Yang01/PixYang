@echo off
setlocal

REM ============================================
REM PixYang 一键生产构建
REM 流程：npm run tauri:build
REM       = vite build（前端产物到 dist/）
REM       + Rust release 编译
REM       + NSIS 安装包打包
REM 产物：src-tauri\target\release\bundle\nsis
REM ============================================

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 npm，请先安装 Node.js 并确认其在 PATH 中。
  pause
  exit /b 1
)

if not exist node_modules (
  echo [提示] 未检测到 node_modules，先安装依赖...
  call npm install
  if errorlevel 1 goto :fail
)

echo.
echo [1/2] 开始构建：前端 vite build + Rust release 编译 + NSIS 打包...
echo [2/2] 首次构建需编译全部 Rust 依赖，可能需要数分钟，请耐心等待。
echo.

call npm run tauri:build
if errorlevel 1 goto :fail

echo.
echo ============================================
echo [完成] 构建成功！安装包输出目录：
echo   %~dp0src-tauri\target\release\bundle\nsis
echo ============================================
pause
exit /b 0

:fail
echo.
echo [失败] 构建未成功，请检查上方日志。
pause
exit /b 1

// better-sqlite3 原生二进制在 node（vitest）与 electron（运行时）ABI 间切换
// 用法：node scripts/native.js electron|node
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const pkgDir = path.join(root, 'node_modules', 'better-sqlite3');
const mode = process.argv[2];

function electronExePath() {
  const dist = path.join(root, 'node_modules', 'electron', 'dist');
  if (process.platform === 'win32') return path.join(dist, 'electron.exe');
  if (process.platform === 'darwin') return path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  return path.join(dist, 'electron');
}

function run(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    shell: process.platform === 'win32' ? 'bash.exe' : undefined,
  }).trim();
}

function electronAbi() {
  return run(`ELECTRON_RUN_AS_NODE=1 "${electronExePath()}" -p "process.versions.modules"`);
}

// tar.gz 内只包含 build/Release/better_sqlite3.node，直接按 ustar 结构提取该文件
function extractNodeFile(tarGzPath, destPath) {
  const tar = zlib.gunzipSync(fs.readFileSync(tarGzPath));
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
    const typeflag = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + 512;
    if ((typeflag === '0' || typeflag === '\0') && name.endsWith('better_sqlite3.node')) {
      fs.writeFileSync(destPath, tar.subarray(dataStart, dataStart + size));
      return;
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error('better_sqlite3.node not found in archive');
}

if (mode === 'node') {
  execSync('npm rebuild better-sqlite3', { cwd: root, stdio: 'inherit' });
} else if (mode === 'electron') {
  const pkgVersion = require(path.join(pkgDir, 'package.json')).version;
  const abi = electronAbi();
  const filename = `better-sqlite3-v${pkgVersion}-electron-v${abi}-${process.platform}-${process.arch}.tar.gz`;
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${pkgVersion}/${filename}`;

  const cacheDir = path.join(__dirname, '.prebuilds');
  const cached = path.join(cacheDir, filename);
  fs.mkdirSync(cacheDir, { recursive: true });

  if (!fs.existsSync(cached) || fs.statSync(cached).size === 0) {
    run(`curl -sL --fail --retry 5 --retry-all-errors --retry-delay 2 --max-time 300 -o "${cached}" "${url}"`);
  }
  if (!fs.existsSync(cached) || fs.statSync(cached).size === 0) {
    console.error('[native] electron 预编译下载失败:', url);
    process.exit(1);
  }

  try {
    extractNodeFile(cached, path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node'));
  } catch (e) {
    // 缓存的 tar.gz 损坏/半截时删掉它，下次运行重新下载，避免永久卡在坏缓存
    try { fs.unlinkSync(cached); } catch { /* 文件可能已被清理 */ }
    console.error('[native] 预编译包解压失败，已删除坏缓存，请重新运行:', e.message);
    process.exit(1);
  }
  console.log(`[native] 已切换 better-sqlite3 到 electron ABI (v${abi})`);
} else {
  console.error('用法: node scripts/native.js electron|node');
  process.exit(1);
}

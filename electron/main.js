const { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  initDatabase,
  getImagesRoot,
  getDatabasePath,
  getThumbnailFilePath,
  setImagesRoot,
  getThumbnailSmallFilePath,
  scanImageFiles,
  collectImportFiles,
  prepareCameraSync,
  attachRawToImage,
  importImages,
  getImages,
  getImageById,
  getAllVisibleIds,
  getAllImagePaths,
  getImagesForRebuild,
  updateImageOrientation,
  updateImage,
  updateImages,
  renameImage,
  deleteImage,
  batchDeleteImages,
  findBrokenRecords,
  deleteBrokenRecords,
  findDuplicates,
  getImportDates,
  getTags,
  createTag,
  deleteTag,
  addTagToImage,
  addTagToImages,
  removeTagFromImage,
  getImageTags,
  getBatchImageTags,
  getAlbums,
  createAlbum,
  renameAlbum,
  deleteAlbum,
  addToAlbum,
  removeFromAlbum,
  getAlbumImages,
  getStats,
  getSetting,
  setSetting,
  getAllSettings,
} = require('./database');

let mainWindow;
const isDev = !app.isPackaged;

// ── 窗口状态持久化：记住大小/位置/最大化，重启恢复 ──
const WINDOW_STATE_PATH = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    const data = JSON.parse(fs.readFileSync(WINDOW_STATE_PATH(), 'utf8'));
    if (data && Number.isFinite(data.x) && Number.isFinite(data.y) &&
        Number.isFinite(data.width) && Number.isFinite(data.height)) {
      return data;
    }
  } catch { /* 首次启动或文件损坏，使用默认 */ }
  return { x: undefined, y: undefined, width: 1400, height: 900, maximized: false };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getNormalBounds();
    fs.writeFileSync(WINDOW_STATE_PATH(), JSON.stringify({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: mainWindow.isMaximized(),
    }));
  } catch (e) {
    console.error('[窗口] 保存状态失败:', e.message);
  }
}

function createWindow() {
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 900,
    minHeight: 600,
    title: 'PixYang - 图片管理器',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: isDev ? false : true,
    },
    frame: true,
    backgroundColor: '#1a1b1f',
    show: false,
  });

  if (windowState.maximized) {
    mainWindow.maximize();
  }
  mainWindow.show();

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 关闭/最大化状态变化时保存窗口位置尺寸
  mainWindow.on('close', saveWindowState);
}

// ── 图片处理 ──

// 一次性读取文件头并解析日期/拍摄时间/方向，避免重复读盘
function readExifInfo(filepath) {
  let buf;
  try {
    const fd = fs.openSync(filepath, 'r');
    buf = Buffer.alloc(65536);
    fs.readSync(fd, buf, 0, 65536, 0);
    fs.closeSync(fd);
  } catch (e) {
    return { date: '', takenAt: '', orientation: 1 };
  }
  const str = buf.toString('latin1', 0, 65536);

  // 日期（YYYY-MM-DD）
  let date = '';
  const dm = str.match(/DateTimeOriginal\x00.\x00(\d{4}):(\d{2}):(\d{2})/);
  if (dm) date = `${dm[1]}-${dm[2]}-${dm[3]}`;
  else {
    const loose = str.match(/Exif.{0,200}(\d{4}):(\d{2}):(\d{2})\s/);
    if (loose) date = `${loose[1]}-${loose[2]}-${loose[3]}`;
    else {
      try {
        const st = fs.statSync(filepath);
        const m = st.mtime;
        date = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
      } catch { /* 忽略 */ }
    }
  }

  // 拍摄时间（YYYY-MM-DD HH:MM）
  let takenAt = '';
  const tm = str.match(/DateTimeOriginal\x00.\x00(\d{4}):(\d{2}):(\d{2})\s(\d{2}):(\d{2})/);
  if (tm) takenAt = `${tm[1]}-${tm[2]}-${tm[3]} ${tm[4]}:${tm[5]}`;
  else {
    const tloose = str.match(/Exif.{0,200}(\d{4}):(\d{2}):(\d{2})\s(\d{2}):(\d{2})/);
    if (tloose) takenAt = `${tloose[1]}-${tloose[2]}-${tloose[3]} ${tloose[4]}:${tloose[5]}`;
  }

  // 方向（Orientation）
  let orientation = 1;
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let offset = 2;
    while (offset + 4 <= buf.length) {
      if (buf[offset] !== 0xFF) break;
      const marker = buf[offset + 1];
      if (marker === 0xE1) {
        const segLen = buf.readUInt16BE(offset + 2);
        if (segLen >= 8 && buf.toString('latin1', offset + 4, offset + 10) === 'Exif\0\0') {
          orientation = parseTiffOrientation(buf, offset + 10, segLen - 2);
          break;
        }
        offset += 2 + segLen;
      } else if (marker === 0xDA) {
        break;
      } else if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
        offset += 2;
      } else {
        offset += 2 + buf.readUInt16BE(offset + 2);
      }
    }
  }

  return { date, takenAt, orientation };
}

// 解析 JPEG EXIF Orientation（0x0112），非 JPEG 或无 EXIF 返回 1
function getExifOrientation(filepath) {
  try {
    const fd = fs.openSync(filepath, 'r');
    const buf = Buffer.alloc(65536);
    fs.readSync(fd, buf, 0, 65536, 0);
    fs.closeSync(fd);

    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return 1; // 非 JPEG
    let offset = 2;
    while (offset + 4 <= buf.length) {
      if (buf[offset] !== 0xFF) break;
      const marker = buf[offset + 1];
      if (marker === 0xE1) {
        const segLen = buf.readUInt16BE(offset + 2);
        if (segLen >= 8 && buf.toString('latin1', offset + 4, offset + 10) === 'Exif\0\0') {
          return parseTiffOrientation(buf, offset + 10, segLen - 2);
        }
        offset += 2 + segLen;
      } else if (marker === 0xDA) {
        break; // SOS，EXIF 在前
      } else if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
        offset += 2;
      } else {
        offset += 2 + buf.readUInt16BE(offset + 2);
      }
    }
    return 1;
  } catch (e) {
    return 1;
  }
}

function parseTiffOrientation(buf, tiffStart, tiffLen) {
  const endian = buf.toString('latin1', tiffStart, tiffStart + 2);
  const le = endian === 'II';
  const u16 = (off) => (le ? buf.readUInt16LE(tiffStart + off) : buf.readUInt16BE(tiffStart + off));
  const u32 = (off) => (le ? buf.readUInt32LE(tiffStart + off) : buf.readUInt32BE(tiffStart + off));
  if (tiffLen < 14 || u16(2) !== 42) return 1;
  const ifd0 = u32(4);
  const count = u16(ifd0);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > tiffLen) break;
    if (u16(entry) === 0x0112) {
      return u16(entry + 8);
    }
  }
  return 1;
}

// 解析 JPEG 完整 EXIF（相机/镜头/ISO/光圈/快门/焦距/拍摄时间），供详情面板按需读取
function parseFullExif(filepath) {
  const empty = {
    camera: '', lens: '', iso: '', fNumber: '', exposure: '', focalLength: '', dateTime: '',
    focal35mm: '', flash: '', whiteBalance: '', exposureProgram: '', meteringMode: '',
    exposureBias: '', software: '', artist: '', copyright: '', colorSpace: '', sceneCapture: '',
  };
  try {
    const stat = fs.statSync(filepath);
    const headLen = Math.min(262144, stat.size);
    const fd = fs.openSync(filepath, 'r');
    const buf = Buffer.alloc(headLen);
    fs.readSync(fd, buf, 0, headLen, 0);
    fs.closeSync(fd);

    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return empty;
    let offset = 2;
    let tiffStart = -1;
    while (offset + 4 <= buf.length) {
      if (buf[offset] !== 0xFF) break;
      const marker = buf[offset + 1];
      if (marker === 0xE1) {
        const segLen = buf.readUInt16BE(offset + 2);
        if (segLen >= 8 && buf.toString('latin1', offset + 4, offset + 10) === 'Exif\0\0') {
          tiffStart = offset + 10;
          break;
        }
        offset += 2 + segLen;
      } else if (marker === 0xDA) {
        break;
      } else if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
        offset += 2;
      } else {
        offset += 2 + buf.readUInt16BE(offset + 2);
      }
    }
    if (tiffStart < 0) return empty;

    const le = buf.toString('latin1', tiffStart, tiffStart + 2) === 'II';
    const u16 = (off) => (le ? buf.readUInt16LE(tiffStart + off) : buf.readUInt16BE(tiffStart + off));
    const u32 = (off) => (le ? buf.readUInt32LE(tiffStart + off) : buf.readUInt32BE(tiffStart + off));

    // TIFF 段可能被 64KB 头截断，所有越界访问按缺失处理
    const inBounds = (off, len) => off >= 0 && off + len <= buf.length - tiffStart;

    // type: 2=ASCII 3=SHORT 4=LONG 5=RATIONAL；返回 { value, count, offset } 或 null
    const readEntry = (entry) => {
      const type = u16(entry + 2);
      const count = u32(entry + 4);
      if (!inBounds(entry, 12)) return null;
      let dataOff = entry + 8;
      const typeSize = { 2: 1, 3: 2, 4: 4, 5: 8 }[type];
      if (!typeSize) return null;
      if (typeSize * count > 4) {
        dataOff = u32(entry + 8);
      }
      if (!inBounds(dataOff, typeSize * count)) return null;
      return { type, count, dataOff };
    };
    const readAscii = (entry) => {
      const e = readEntry(entry);
      if (!e || e.type !== 2) return '';
      let s = buf.toString('latin1', tiffStart + e.dataOff, tiffStart + e.dataOff + e.count);
      s = s.replace(/\0.*$/s, '').trim();
      return s;
    };
    const readRational = (entry, idx = 0) => {
      const e = readEntry(entry);
      if (!e || e.type !== 5 || idx >= e.count) return null;
      const off = tiffStart + e.dataOff + idx * 8;
      const num = le ? buf.readUInt32LE(off) : buf.readUInt32BE(off);
      const den = le ? buf.readUInt32LE(off + 4) : buf.readUInt32BE(off + 4);
      if (!den) return null;
      return num / den;
    };

    // 遍历一个 IFD，用回调收集目标 tag
    const walkIfd = (ifdOff, onTag) => {
      if (!inBounds(ifdOff, 2)) return -1;
      const count = u16(ifdOff);
      for (let i = 0; i < count; i++) {
        const entry = ifdOff + 2 + i * 12;
        if (!inBounds(entry, 12)) break;
        onTag(u16(entry), entry);
      }
      return inBounds(ifdOff + 2 + count * 12, 4) ? u32(ifdOff + 2 + count * 12) : -1;
    };

    const result = { ...empty };
    let exifIfd = -1;
    let software = '';
    let artist = '';
    let copyright = '';

    walkIfd(u32(4), (tag, entry) => {
      if (tag === 0x010F) result.camera = readAscii(entry);
      else if (tag === 0x0110) result.model = readAscii(entry);
      else if (tag === 0x0131) software = readAscii(entry);
      else if (tag === 0x013B) artist = readAscii(entry);
      else if (tag === 0x8298) copyright = readAscii(entry);
      else if (tag === 0x8769) exifIfd = u32(entry + 8);
    });
    if (result.camera && result.model && result.model.startsWith(result.camera)) {
      result.camera = result.model;
    } else {
      result.camera = [result.camera, result.model].filter(Boolean).join(' ');
    }
    delete result.model;
    if (software) result.software = software;
    if (artist) result.artist = artist;

    const readShort = (entry, idx = 0) => {
      const e = readEntry(entry);
      if (!e || e.type !== 3 || idx >= e.count) return null;
      return u16(e.dataOff + idx * 2);
    };

    if (exifIfd > 0) {
      let lensModel = '';
      walkIfd(exifIfd, (tag, entry) => {
        if (tag === 0x8827) {
          const v = readShort(entry);
          if (v != null) result.iso = String(v);
        } else if (tag === 0x829D) {
          const f = readRational(entry);
          if (f) result.fNumber = `f/${f.toFixed(1)}`;
        } else if (tag === 0x829A) {
          const t = readRational(entry);
          if (t) result.exposure = t >= 1 ? `${t.toFixed(1)}s` : `1/${Math.round(1 / t)}s`;
        } else if (tag === 0x920A) {
          const f = readRational(entry);
          if (f) result.focalLength = `${Math.round(f)}mm`;
        } else if (tag === 0xA405) {
          const f = readShort(entry);
          if (f) result.focal35mm = `${f}mm`;
        } else if (tag === 0xA434) {
          lensModel = readAscii(entry);
        } else if (tag === 0x9003) {
          const e = readEntry(entry);
          if (e && e.type === 2) {
            const s = buf.toString('latin1', tiffStart + e.dataOff, tiffStart + e.dataOff + Math.min(e.count, 19));
            result.dateTime = s.replace(/\0.*$/s, '').trim();
          }
        } else if (tag === 0x9209) {
          const v = readShort(entry);
          if (v != null) result.flash = (v & 0x01) ? '已闪光' : '未闪光';
        } else if (tag === 0xA403) {
          const v = readShort(entry);
          if (v != null) result.whiteBalance = v === 0 ? '自动' : '手动';
        } else if (tag === 0x8822) {
          const v = readShort(entry);
          if (v != null) {
            result.exposureProgram = ({
              0: '未定义', 1: '手动', 2: '程序自动', 3: '光圈优先',
              4: '快门优先', 5: '创意', 6: '运动', 7: '肖像', 8: '风景',
            })[v] || String(v);
          }
        } else if (tag === 0x9207) {
          const v = readShort(entry);
          if (v != null) {
            result.meteringMode = ({
              0: '未知', 1: '平均', 2: '中央重点', 3: '点测光',
              4: '多点', 5: '矩阵', 6: '局部', 255: '其他',
            })[v] || String(v);
          }
        } else if (tag === 0x9204) {
          const f = readRational(entry);
          if (f != null) result.exposureBias = `${f > 0 ? '+' : ''}${f.toFixed(1)} EV`;
        } else if (tag === 0x8298) {
          const s = readAscii(entry);
          if (s) result.copyright = s;
        } else if (tag === 0xA001) {
          const v = readShort(entry);
          if (v != null) result.colorSpace = v === 1 ? 'sRGB' : (v === 0xFFFF ? 'Uncalibrated' : String(v));
        } else if (tag === 0xA406) {
          const v = readShort(entry);
          if (v != null) {
            result.sceneCapture = ({
              0: '标准', 1: '风景', 2: '人像', 3: '夜景', 4: '运动',
            })[v] || String(v);
          }
        }
      });
      result.lens = lensModel;
    }
    if (copyright) result.copyright = copyright;

    return result;
  } catch (e) {
    console.error('[EXIF] 解析失败:', filepath, e.message);
    return empty;
  }
}

function generateThumbnail(filepath, maxSize = 512) {
  try {
    if (!fs.existsSync(filepath)) return null;
    // 带 EXIF Orientation 的竖图不生成缩略图，由前端直接显示原图（img 自动转正）
    if (getExifOrientation(filepath) !== 1) return null;

    // 先用 buffer 方式加载（比 createFromPath 更可靠）
    const buf = fs.readFileSync(filepath);
    let image = nativeImage.createFromBuffer(buf);

    // 降级：用路径方式
    if (image.isEmpty()) {
      image = nativeImage.createFromPath(filepath);
    }
    if (image.isEmpty()) return null;

    // 记录原图尺寸（导入的图尺寸信息缺失，借生成缩略图一并写入）
    const size = image.getSize();
    const originalWidth = size.width;
    const originalHeight = size.height;
    let { width, height } = size;

    if (width > maxSize || height > maxSize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const resized = image.resize({ width, height, quality: 'good' });
    return { buf: resized.toJPEG(80), width: originalWidth, height: originalHeight };
  } catch (err) {
    console.error('[缩略图] 生成失败:', err.message);
    return null;
  }
}

// 一次解码同时产出列表用小图与中图，避免二次读盘
const THUMB_SMALL_SIZE = 160;
const THUMB_MEDIUM_SIZE = 400;

function generateThumbnailTiers(filepath) {
  try {
    if (!fs.existsSync(filepath)) return null;
    if (getExifOrientation(filepath) !== 1) return null;

    const buf = fs.readFileSync(filepath);
    let image = nativeImage.createFromBuffer(buf);
    if (image.isEmpty()) image = nativeImage.createFromPath(filepath);
    if (image.isEmpty()) return null;

    const size = image.getSize();
    const make = (maxSide) => {
      let { width, height } = size;
      if (width > maxSide || height > maxSide) {
        const ratio = Math.min(maxSide / width, maxSide / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      return image.resize({ width, height, quality: 'good' }).toJPEG(80);
    };

    return {
      small: make(THUMB_SMALL_SIZE),
      medium: make(THUMB_MEDIUM_SIZE),
      width: size.width,
      height: size.height,
    };
  } catch (err) {
    console.error('[缩略图] 生成失败:', err.message);
    return null;
  }
}

// 将缩略图 JPEG Buffer 写入缩略图目录并更新记录，返回文件路径
function saveThumbnailFile(id, jpgBuf) {
  const thumbPath = getThumbnailFilePath(id);
  fs.writeFileSync(thumbPath, jpgBuf);
  return thumbPath;
}

function saveThumbnailTiers(id, tiers) {
  const mediumPath = getThumbnailFilePath(id);
  const smallPath = getThumbnailSmallFilePath(id);
  fs.writeFileSync(mediumPath, tiers.medium);
  fs.writeFileSync(smallPath, tiers.small);
  return { mediumPath, smallPath };
}

function getImageData(filepath, maxWidth = 1920) {
  try {
    if (!fs.existsSync(filepath)) return null;
    // 带 EXIF Orientation 的竖图由前端直接显示原图（img 自动转正）
    if (getExifOrientation(filepath) !== 1) return null;
    const image = nativeImage.createFromPath(filepath);
    if (image.isEmpty()) return null;

    const size = image.getSize();
    let { width, height } = size;

    if (width > maxWidth) {
      const ratio = maxWidth / width;
      width = maxWidth;
      height = Math.round(height * ratio);
    }

    const resized = image.resize({ width, height, quality: 'best' });
    const fmt = path.extname(filepath).toLowerCase();
    let buf;
    if (fmt === '.png' || fmt === '.webp') {
      buf = resized.toPNG();
      return `data:image/png;base64,${buf.toString('base64')}`;
    } else {
      buf = resized.toJPEG(90);
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    }
  } catch (err) {
    console.error('[图片数据] 读取失败:', err.message);
    return null;
  }
}

// ── IPC 处理 ──

let thumbRebuildTimer = null;
// 后台为缺失缩略图的图片补生成（防抖，分批让出事件循环避免阻塞主进程）
function scheduleThumbnailRebuild() {
  if (thumbRebuildTimer) clearTimeout(thumbRebuildTimer);
  thumbRebuildTimer = setTimeout(async () => {
    thumbRebuildTimer = null;
    try {
      const rows = getImagesForRebuild();
      const readyIds = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const tiers = generateThumbnailTiers(r.filepath);
        if (tiers) {
          try {
            const saved = saveThumbnailTiers(r.id, tiers);
            await updateImage(r.id, {
              thumbnail_path: saved.mediumPath,
              thumbnail_small_path: saved.smallPath,
              width: tiers.width,
              height: tiers.height,
            });
            readyIds.push(r.id);
          } catch (e) {
            console.error('[缩略图] 写入失败:', e.message);
          }
        }
        if (i % 3 === 0) await new Promise(res => setImmediate(res));
      }
      if (readyIds.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('thumbnails-ready', readyIds);
      }
    } catch (e) {
      console.error('[缩略图] 后台生成失败:', e.message);
    }
  }, 800);
}

function setupIPC() {
  // 选择导入目录
  ipcMain.handle('dialog:select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: '选择要导入的图片文件夹',
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  // 扫描目录中的图片文件
  ipcMain.handle('fs:scan-directory', async (_event, dirPath) => {
    return scanImageFiles(dirPath, false);
  });

  // 相机文件夹同步：导入图库中缺失的图片（JPG + NEF）
  ipcMain.handle('db:sync-camera-folder', async () => {
    const cameraDir = getSetting('camera_folder');
    if (!cameraDir) return { error: '未设置相机文件夹' };
    if (!fs.existsSync(cameraDir)) return { error: '相机文件夹不存在' };

    const files = await scanImageFiles(cameraDir, true);
    const { toImport, attachPairs, skipped } = prepareCameraSync(files);

    for (const f of toImport) {
      const info = readExifInfo(f.filepath);
      f.importDate = info.date;
      f.takenAt = info.takenAt;
      f.orientation = info.orientation;
    }
    scheduleThumbnailRebuild();

    const imported = await importImages(toImport);
    let attached = 0;
    for (const p of attachPairs) {
      if (await attachRawToImage(p.jpgId, p.nefSource, p.nefFilename)) attached++;
    }

    return {
      scanned: files.length,
      imported: imported.length,
      jpgImported: imported.filter(i => !i.hidden).length,
      nefImported: imported.filter(i => !!i.hidden).length,
      attached,
      skipped,
    };
  });

  // 导入图片：提取日期 + 生成缩略图后写入数据库
  ipcMain.handle('db:import-images', async (_event, imageFiles, dateOverride) => {
    for (const img of imageFiles) {
      // 一次性读取 EXIF：日期 + 拍摄时间 + 方向（缩略图稍后后台补生成）
      const info = readExifInfo(img.filepath);
      img.importDate = dateOverride || info.date;
      img.takenAt = info.takenAt;
      img.orientation = info.orientation;
    }
    const result = await importImages(imageFiles);
    scheduleThumbnailRebuild();
    return result;
  });

  // 获取图片列表（支持日期+标签组合筛选）
  ipcMain.handle('db:get-images', async (_event, options) => {
    return getImages(options);
  });

  // 获取单张图片
  ipcMain.handle('db:get-image', async (_event, id) => {
    return getImageById(id);
  });

  // 获取当前筛选下所有可见图片 id（跨页全选）
  ipcMain.handle('db:get-all-image-ids', async (_event, options) => {
    return getAllVisibleIds(options || {});
  });

  // 拖拽导入：收集拖入的文件/目录为可导入的图片列表
  ipcMain.handle('fs:collect-import-files', async (_event, paths) => {
    return collectImportFiles(paths || []);
  });

  // 批量为多张图片添加同一标签
  ipcMain.handle('db:add-tag-to-images', async (_event, imageIds, tagId) => {
    return addTagToImages(imageIds || [], tagId);
  });

  // 批量更新字段（评分/收藏）
  ipcMain.handle('db:update-images', async (_event, imageIds, updates) => {
    return updateImages(imageIds || [], updates || {});
  });

  // ── 失效记录维护 ──
  ipcMain.handle('db:scan-broken-records', async () => {
    return findBrokenRecords();
  });

  ipcMain.handle('db:delete-broken-records', async (_event, ids) => {
    return deleteBrokenRecords(ids || []);
  });

  // 重复图片检测（元数据粗分组 + 快速哈希验证）
  ipcMain.handle('db:find-duplicates', async () => {
    return findDuplicates();
  });

  // 更新图片字段
  ipcMain.handle('db:update-image', async (_event, id, updates) => {
    return updateImage(id, updates);
  });

  // 重命名图片（同时更新文件名和磁盘文件）
  ipcMain.handle('db:rename-image', async (_event, id, newFilename) => {
    return renameImage(id, newFilename);
  });

  // 删除图片
  ipcMain.handle('db:delete-image', async (_event, id) => {
    return deleteImage(id);
  });

  // ── 重建缩略图 ──
  ipcMain.handle('db:rebuild-thumbnails', async () => {
    const rows = getImagesForRebuild(true);
    let rebuilt = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const tiers = generateThumbnailTiers(r.filepath);
      if (tiers) {
        try {
          const saved = saveThumbnailTiers(r.id, tiers);
          await updateImage(r.id, {
            thumbnail_path: saved.mediumPath,
            thumbnail_small_path: saved.smallPath,
            width: tiers.width,
            height: tiers.height,
          });
          rebuilt++;
        } catch (e) {
          failed++;
        }
      } else {
        failed++;
      }
      if (i % 3 === 0) {
        await new Promise(res => setImmediate(res));
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('rebuild-progress', { done: i + 1, total: rows.length });
        }
      }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rebuild-progress', { done: rows.length, total: rows.length });
      mainWindow.webContents.send('thumbnails-ready');
    }
    return { total: rows.length, rebuilt, failed };
  });

  // ── 数据库备份 ──
  ipcMain.handle('fs:get-database-path', async () => {
    return getDatabasePath();
  });

  ipcMain.handle('fs:backup-database', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '备份数据库',
      defaultPath: `pixyang-backup-${Date.now()}.db`,
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
    });
    if (result.canceled || !result.filePath) return { success: false };
    try {
      fs.copyFileSync(getDatabasePath(), result.filePath);
      return { success: true, path: result.filePath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 获取所有导入日期列表
  ipcMain.handle('db:get-import-dates', async () => {
    return getImportDates();
  });

  // 获取管理目录路径
  ipcMain.handle('fs:get-images-root', async () => {
    return getImagesRoot();
  });

  ipcMain.handle('fs:set-images-root', async (_event, dirPath) => {
    return setImagesRoot(dirPath);
  });

  // 获取缩略图（按需生成，保持返回 data URL 的兼容格式）
  ipcMain.handle('fs:get-thumbnail', async (_event, filepath) => {
    const thumb = generateThumbnail(filepath);
    if (!thumb) return null;
    return `data:image/jpeg;base64,${thumb.buf.toString('base64')}`;
  });

  // 获取完整图片数据
  ipcMain.handle('fs:get-image-data', async (_event, filepath, maxWidth) => {
    return getImageData(filepath, maxWidth);
  });

  // 获取完整 EXIF（详情面板按需读取）
  ipcMain.handle('fs:get-exif', async (_event, filepath) => {
    return parseFullExif(filepath);
  });

  // 检查文件是否存在
  ipcMain.handle('fs:file-exists', async (_event, filepath) => {
    return fs.existsSync(filepath);
  });

  // ── 标签 ──
  ipcMain.handle('db:get-tags', async () => getTags());
  ipcMain.handle('db:create-tag', async (_event, name, color) => createTag(name, color));
  ipcMain.handle('db:delete-tag', async (_event, id) => deleteTag(id));
  ipcMain.handle('db:add-tag-to-image', async (_event, imageId, tagId) => addTagToImage(imageId, tagId));
  ipcMain.handle('db:remove-tag-from-image', async (_event, imageId, tagId) => removeTagFromImage(imageId, tagId));
  ipcMain.handle('db:get-image-tags', async (_event, imageId) => getImageTags(imageId));
  ipcMain.handle('db:get-batch-image-tags', async (_event, imageIds) => getBatchImageTags(imageIds || []));

  // ── 相册 ──
  ipcMain.handle('db:get-albums', async () => getAlbums());
  ipcMain.handle('db:create-album', async (_event, name, description) => createAlbum(name, description));
  ipcMain.handle('db:delete-album', async (_event, id) => deleteAlbum(id));
  ipcMain.handle('db:add-to-album', async (_event, albumId, imageIds) => addToAlbum(albumId, imageIds));
  ipcMain.handle('db:remove-from-album', async (_event, albumId, imageId) => removeFromAlbum(albumId, imageId));
  ipcMain.handle('db:rename-album', async (_event, id, newName) => renameAlbum(id, newName));

  // ── 导出 ──
  ipcMain.handle('dialog:select-export-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择导出的目标文件夹',
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  // 导出文件（JPG + 配对 NEF），处理重名
  async function exportFiles(images, destDir) {
    let copied = 0;
    let nefCount = 0;
    for (const img of images) {
      if (fs.existsSync(img.filepath)) {
        const dest = path.join(destDir, img.filename);
        let finalDest = dest;
        let n = 1;
        while (fs.existsSync(finalDest)) {
          const ext = path.extname(img.filename);
          const base = path.basename(img.filename, ext);
          finalDest = path.join(destDir, `${base}_${n}${ext}`);
          n++;
        }
        await fs.promises.copyFile(img.filepath, finalDest);
        copied++;
      }

      if (img.raw_path && fs.existsSync(img.raw_path)) {
        const rawExt = path.extname(img.raw_path);
        const destBase = path.basename(img.filename, path.extname(img.filename));
        let rawDest = path.join(destDir, `${destBase}${rawExt}`);
        let m = 1;
        while (fs.existsSync(rawDest)) {
          rawDest = path.join(destDir, `${destBase}_${m}${rawExt}`);
          m++;
        }
        await fs.promises.copyFile(img.raw_path, rawDest);
        nefCount++;
      }
    }
    return { copied, nefCount };
  }

  ipcMain.handle('fs:export-album-images', async (_event, albumId, destDir) => {
    const images = getAlbumImages(albumId);
    const r = await exportFiles(images, destDir);
    return { total: images.length, copied: r.copied, nefCopied: r.nefCount };
  });

  // 导出勾选图片（含配对 NEF）
  ipcMain.handle('fs:export-images', async (_event, ids, destDir) => {
    const images = [];
    for (const id of ids) {
      const img = getImageById(id);
      if (img) images.push(img);
    }
    const r = await exportFiles(images, destDir);
    return { total: images.length, copied: r.copied, nefCopied: r.nefCount };
  });

  // ── 统计 ──
  ipcMain.handle('db:get-stats', async () => getStats());

  // ── 设置 ──
  ipcMain.handle('settings:get-all', async () => getAllSettings());
  ipcMain.handle('settings:get', async (_event, key) => getSetting(key));
  ipcMain.handle('settings:set', async (_event, key, value) => setSetting(key, value));

  // ── 缩略图重生 ──
  // ── 批量删除 ──
  ipcMain.handle('db:batch-delete-images', async (_event, ids) => {
    return batchDeleteImages(ids);
  });

  // ── 路径转 file:// URL ──
  function pathToFileUrl(filepath) {
    const normalized = filepath.replace(/\\/g, '/');
    return `file:///${normalized}`;
  }

  ipcMain.handle('fs:to-file-url', async (_event, filepath) => {
    if (!fs.existsSync(filepath)) return null;
    return pathToFileUrl(filepath);
  });

  // 批量路径转 file:// URL，返回 { path: url|null }
  ipcMain.handle('fs:to-file-urls', async (_event, paths) => {
    const result = {};
    if (!Array.isArray(paths)) return result;
    for (const p of paths) {
      if (typeof p !== 'string' || !p || p in result) continue;
      result[p] = fs.existsSync(p) ? pathToFileUrl(p) : null;
    }
    return result;
  });

  // ── 打开文件夹 ──
  ipcMain.handle('shell:open-path', async (_event, dirPath) => {
    const { shell } = require('electron');
    return shell.openPath(dirPath);
  });
}

// 回填历史图片的 EXIF 方向标记（只执行一次，完成后写标记）
async function backfillOrientations() {
  try {
    if (getSetting('orientation_backfilled') === 'true') return 0;
    const rows = getAllImagePaths();
    let count = 0;
    for (let i = 0; i < rows.length; i++) {
      const ori = getExifOrientation(rows[i].filepath);
      if (ori && ori !== 1) {
        updateImageOrientation(rows[i].id, ori);
        count++;
      }
      if (i % 20 === 0) await new Promise(res => setImmediate(res));
    }
    setSetting('orientation_backfilled', 'true');
    console.log(`[方向回填] 完成，更新 ${count} 张`);
    return count;
  } catch (e) {
    console.error('[方向回填] 失败:', e.message);
    return 0;
  }
}

// ── 应用生命周期 ──

app.whenReady().then(async () => {
  // 移除默认菜单栏 (File/Edit/View 等)
  Menu.setApplicationMenu(null);
  await initDatabase();
  setupIPC();
  createWindow();

  // 后台回填历史图片方向标记，完成后通知渲染进程刷新
  setTimeout(async () => {
    await backfillOrientations();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('orientation-backfill-done');
    }
  }, 800);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

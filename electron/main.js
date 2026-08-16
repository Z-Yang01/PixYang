const { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  initDatabase,
  getImagesRoot,
  setImagesRoot,
  scanImageFiles,
  prepareCameraSync,
  attachRawToImage,
  importImages,
  getImages,
  getImageById,
  getAllVisibleIds,
  getAllImagePaths,
  updateImageOrientation,
  updateImage,
  renameImage,
  deleteImage,
  batchDeleteImages,
  getImportDates,
  getTags,
  createTag,
  deleteTag,
  addTagToImage,
  removeTagFromImage,
  getImageTags,
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'PixYang - 图片管理器',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: isDev ? false : true,
    },
    frame: true,
    backgroundColor: '#0f0f13',
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── 图片处理 ──

// 从图片文件中提取 EXIF 日期，降级使用文件修改时间
function extractImageDate(filepath) {
  try {
    // 先尝试从文件头读取 EXIF DateTimeOriginal
    const fd = fs.openSync(filepath, 'r');
    const buf = Buffer.alloc(65536);
    fs.readSync(fd, buf, 0, 65536, 0);
    fs.closeSync(fd);

    // 在文件前64KB中搜索 EXIF DateTimeOriginal 标签 (0x9003)
    // 格式: "DateTimeOriginal" + null + 长度 + null + "YYYY:MM:DD HH:MM:SS"
    const str = buf.toString('latin1', 0, 65536);
    const match = str.match(/DateTimeOriginal\x00.\x00(\d{4}):(\d{2}):(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    // 尝试更宽松的匹配：在 Exif 段中找日期
    const dateMatch = str.match(/Exif.{0,200}(\d{4}):(\d{2}):(\d{2})\s/);
    if (dateMatch) {
      return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    }
    // 降级：使用文件修改日期
    const stat = fs.statSync(filepath);
    const mtime = stat.mtime;
    return `${mtime.getFullYear()}-${String(mtime.getMonth() + 1).padStart(2, '0')}-${String(mtime.getDate()).padStart(2, '0')}`;
  } catch (e) {
    // 最终降级：文件系统日期
    try {
      const stat = fs.statSync(filepath);
      const mtime = stat.mtime;
      return `${mtime.getFullYear()}-${String(mtime.getMonth() + 1).padStart(2, '0')}-${String(mtime.getDate()).padStart(2, '0')}`;
    } catch {
      return '';
    }
  }
}

// 提取 EXIF 拍摄时间（精确到分钟），无 EXIF 时间返回空
function extractTakenAt(filepath) {
  try {
    const fd = fs.openSync(filepath, 'r');
    const buf = Buffer.alloc(65536);
    fs.readSync(fd, buf, 0, 65536, 0);
    fs.closeSync(fd);

    const str = buf.toString('latin1', 0, 65536);
    const match = str.match(/DateTimeOriginal\x00.\x00(\d{4}):(\d{2}):(\d{2})\s(\d{2}):(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
    }
    const loose = str.match(/Exif.{0,200}(\d{4}):(\d{2}):(\d{2})\s(\d{2}):(\d{2})/);
    if (loose) {
      return `${loose[1]}-${loose[2]}-${loose[3]} ${loose[4]}:${loose[5]}`;
    }
    return '';
  } catch (e) {
    return '';
  }
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

    const size = image.getSize();
    let { width, height } = size;

    if (width > maxSize || height > maxSize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const resized = image.resize({ width, height, quality: 'good' });
    const jpgBuf = resized.toJPEG(80);
    return `data:image/jpeg;base64,${jpgBuf.toString('base64')}`;
  } catch (err) {
    console.error('[缩略图] 生成失败:', err.message);
    return null;
  }
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

    const files = scanImageFiles(cameraDir, true);
    const { toImport, attachPairs, skipped } = prepareCameraSync(files);

    for (const f of toImport) {
      f.importDate = extractImageDate(f.filepath);
      f.takenAt = extractTakenAt(f.filepath);
      f.orientation = getExifOrientation(f.filepath);
      if (f.format !== '.nef') {
        const thumb = generateThumbnail(f.filepath);
        if (thumb) {
          f.thumbnail = thumb;
        }
      }
    }

    const imported = importImages(toImport);
    let attached = 0;
    for (const p of attachPairs) {
      if (attachRawToImage(p.jpgId, p.nefSource, p.nefFilename)) attached++;
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
  ipcMain.handle('db:import-images', async (_event, imageFiles) => {
    for (const img of imageFiles) {
      // 从图片 EXIF 或文件时间提取日期
      img.importDate = extractImageDate(img.filepath);
      // 提取拍摄时间（精确到分钟），无则空
      img.takenAt = extractTakenAt(img.filepath);
      // 记录 EXIF 方向
      img.orientation = getExifOrientation(img.filepath);
      // 生成缩略图
      const thumb = generateThumbnail(img.filepath);
      if (thumb) {
        img.thumbnail = thumb;
      }
    }
    const result = importImages(imageFiles);
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

  // 获取缩略图（按需生成）
  ipcMain.handle('fs:get-thumbnail', async (_event, filepath) => {
    return generateThumbnail(filepath);
  });

  // 获取完整图片数据
  ipcMain.handle('fs:get-image-data', async (_event, filepath, maxWidth) => {
    return getImageData(filepath, maxWidth);
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
  function exportFiles(images, destDir) {
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
        fs.copyFileSync(img.filepath, finalDest);
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
        fs.copyFileSync(img.raw_path, rawDest);
        nefCount++;
      }
    }
    return { copied, nefCount };
  }

  ipcMain.handle('fs:export-album-images', async (_event, albumId, destDir) => {
    const images = getAlbumImages(albumId);
    const r = exportFiles(images, destDir);
    return { total: images.length, copied: r.copied, nefCopied: r.nefCount };
  });

  // 导出勾选图片（含配对 NEF）
  ipcMain.handle('fs:export-images', async (_event, ids, destDir) => {
    const images = [];
    for (const id of ids) {
      const img = getImageById(id);
      if (img) images.push(img);
    }
    const r = exportFiles(images, destDir);
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
  ipcMain.handle('fs:to-file-url', async (_event, filepath) => {
    if (!fs.existsSync(filepath)) return null;
    // Windows: C:\xxx -> file:///C:/xxx
    const normalized = filepath.replace(/\\/g, '/');
    return `file:///${normalized.replace(/^([A-Za-z]):/, '$1:')}`;
  });

  // ── 打开文件夹 ──
  ipcMain.handle('shell:open-path', async (_event, dirPath) => {
    const { shell } = require('electron');
    return shell.openPath(dirPath);
  });
}

// 回填历史图片的 EXIF 方向标记
function backfillOrientations() {
  try {
    const rows = getAllImagePaths();
    let count = 0;
    for (const r of rows) {
      const ori = getExifOrientation(r.filepath);
      if (ori && ori !== 1) {
        updateImageOrientation(r.id, ori);
        count++;
      }
    }
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
  setTimeout(() => {
    backfillOrientations();
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

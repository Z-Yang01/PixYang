const { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  initDatabase,
  getImagesRoot,
  setImagesRoot,
  importImages,
  getImages,
  getImageById,
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

function generateThumbnail(filepath, maxSize = 300) {
  try {
    if (!fs.existsSync(filepath)) return null;

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
    const supportedFormats = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.tiff'];
    const imageFiles = [];

    function scanDir(dir) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (supportedFormats.includes(ext)) {
              const stat = fs.statSync(fullPath);
              imageFiles.push({
                filename: entry.name,
                filepath: fullPath,
                size: stat.size,
                format: ext,
                width: 0,
                height: 0,
              });
            }
          }
        }
      } catch (err) {
        console.error('[扫描] 错误:', dir, err.message);
      }
    }

    scanDir(dirPath);
    return imageFiles;
  });

  // 导入图片：提取日期 + 生成缩略图后写入数据库
  ipcMain.handle('db:import-images', async (_event, imageFiles) => {
    for (const img of imageFiles) {
      // 从图片 EXIF 或文件时间提取日期
      img.importDate = extractImageDate(img.filepath);
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

  // ── 导出相册图片 ──
  ipcMain.handle('dialog:select-export-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择导出的目标文件夹',
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('fs:export-album-images', async (_event, albumId, destDir) => {
    const images = getAlbumImages(albumId);
    let count = 0;
    for (const img of images) {
      if (fs.existsSync(img.filepath)) {
        const dest = path.join(destDir, img.filename);
        // 处理重名
        let finalDest = dest;
        let n = 1;
        while (fs.existsSync(finalDest)) {
          const ext = path.extname(img.filename);
          const base = path.basename(img.filename, ext);
          finalDest = path.join(destDir, `${base}_${n}${ext}`);
          n++;
        }
        fs.copyFileSync(img.filepath, finalDest);
        count++;
      }
    }
    return { total: images.length, copied: count };
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

// ── 应用生命周期 ──

app.whenReady().then(async () => {
  // 移除默认菜单栏 (File/Edit/View 等)
  Menu.setApplicationMenu(null);
  await initDatabase();
  setupIPC();
  createWindow();

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

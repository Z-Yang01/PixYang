const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  initDatabase,
  importImages,
  getImages,
  getImageById,
  updateImage,
  deleteImage,
  getAllDirectories,
  getTags,
  createTag,
  deleteTag,
  addTagToImage,
  removeTagFromImage,
  getImageTags,
  getAlbums,
  createAlbum,
  deleteAlbum,
  addToAlbum,
  removeFromAlbum,
  getStats,
} = require('./database');

let mainWindow;

const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'PixYang - Image Manager',
    icon: path.join(__dirname, '../assets/icon.png'),
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

// Generate base64 thumbnail from image file
function generateThumbnail(filepath, maxSize = 300) {
  try {
    if (!fs.existsSync(filepath)) return null;

    const image = nativeImage.createFromPath(filepath);
    if (image.isEmpty()) return null;

    const size = image.getSize();
    let { width, height } = size;

    // Scale down to fit within maxSize
    if (width > maxSize || height > maxSize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const resized = image.resize({ width, height, quality: 'good' });
    const buf = resized.toJPEG(80);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (err) {
    console.error('[Thumbnail] Error generating:', err.message);
    return null;
  }
}

// Get image base64 data (for full preview, scaled)
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
    const format = path.extname(filepath).toLowerCase();
    let buf;
    if (format === '.png' || format === '.webp') {
      buf = resized.toPNG();
      return `data:image/png;base64,${buf.toString('base64')}`;
    } else {
      buf = resized.toJPEG(90);
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    }
  } catch (err) {
    console.error('[ImageData] Error reading:', err.message);
    return null;
  }
}

// ── IPC Handlers ──

function setupIPC() {
  // Select directory for import
  ipcMain.handle('dialog:select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select folder to import images',
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  // Scan directory for images
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
                directory: path.dirname(fullPath),
                size: stat.size,
                format: ext,
                width: 0,
                height: 0,
              });
            }
          }
        }
      } catch (err) {
        console.error('[Scan] Error scanning', dir, err.message);
      }
    }

    scanDir(dirPath);
    return imageFiles;
  });

  // Import images with thumbnails
  ipcMain.handle('db:import-images', async (_event, imageFiles) => {
    // Generate thumbnails for each image
    for (const img of imageFiles) {
      const thumb = generateThumbnail(img.filepath);
      if (thumb) {
        img.thumbnail = thumb;
      }
    }
    const result = importImages(imageFiles);
    return result;
  });

  // Get images with filters
  ipcMain.handle('db:get-images', async (_event, options) => {
    return getImages(options);
  });

  // Get single image
  ipcMain.handle('db:get-image', async (_event, id) => {
    return getImageById(id);
  });

  // Update image
  ipcMain.handle('db:update-image', async (_event, id, updates) => {
    return updateImage(id, updates);
  });

  // Delete image
  ipcMain.handle('db:delete-image', async (_event, id) => {
    return deleteImage(id);
  });

  // Get all directories
  ipcMain.handle('db:get-directories', async () => {
    return getAllDirectories();
  });

  // Get image thumbnail (generate on demand)
  ipcMain.handle('fs:get-thumbnail', async (_event, filepath) => {
    return generateThumbnail(filepath);
  });

  // Get full image data
  ipcMain.handle('fs:get-image-data', async (_event, filepath, maxWidth) => {
    return getImageData(filepath, maxWidth);
  });

  // Check if file exists
  ipcMain.handle('fs:file-exists', async (_event, filepath) => {
    return fs.existsSync(filepath);
  });

  // ── Tags ──
  ipcMain.handle('db:get-tags', async () => getTags());
  ipcMain.handle('db:create-tag', async (_event, name, color) => createTag(name, color));
  ipcMain.handle('db:delete-tag', async (_event, id) => deleteTag(id));
  ipcMain.handle('db:add-tag-to-image', async (_event, imageId, tagId) => addTagToImage(imageId, tagId));
  ipcMain.handle('db:remove-tag-from-image', async (_event, imageId, tagId) => removeTagFromImage(imageId, tagId));
  ipcMain.handle('db:get-image-tags', async (_event, imageId) => getImageTags(imageId));

  // ── Albums ──
  ipcMain.handle('db:get-albums', async () => getAlbums());
  ipcMain.handle('db:create-album', async (_event, name, description) => createAlbum(name, description));
  ipcMain.handle('db:delete-album', async (_event, id) => deleteAlbum(id));
  ipcMain.handle('db:add-to-album', async (_event, albumId, imageIds) => addToAlbum(albumId, imageIds));
  ipcMain.handle('db:remove-from-album', async (_event, albumId, imageId) => removeFromAlbum(albumId, imageId));

  // ── Stats ──
  ipcMain.handle('db:get-stats', async () => getStats());
}

// ── App Lifecycle ──

app.whenReady().then(async () => {
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

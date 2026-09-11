const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const exifr = require('exifr');
const { generateThumbnailTiers, extractNefPreview, normalizeEditBase, renderEdit, closeWorker } = require('./imageWorker');
const {
  initDatabase,
  closeDatabase,
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
  saveEditedImage,
  getEdits,
  saveEdits,
  getEditHistory,
  getPresets,
  createPreset,
  deletePreset,
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

// 一次性读取 EXIF：日期 / 拍摄时间 / 方向（导入时调用）
// 无 EXIF 的现存文件回退文件修改时间；文件读不到则全部留空
async function readExifInfo(filepath) {
  let rawDate = '';
  let orientation = 1;
  try {
    const exif = await exifr.parse(filepath, {
      tiff: true,
      exif: true,
      reviveValues: false,
      translateValues: false,
      pick: ['Make', 'Model', 'Orientation', 'DateTimeOriginal', 'CreateDate'],
    });
    if (exif) {
      if (typeof exif.DateTimeOriginal === 'string') rawDate = exif.DateTimeOriginal;
      else if (typeof exif.CreateDate === 'string') rawDate = exif.CreateDate;
      orientation = Number(exif.Orientation) || 1;
    }
  } catch { /* 无 EXIF 或文件不可读 */ }

  let date = '';
  let takenAt = '';
  const m = rawDate.match(/^(\d{4}):(\d{2}):(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) {
    date = `${m[1]}-${m[2]}-${m[3]}`;
    if (m[4]) takenAt = `${date} ${m[4]}:${m[5]}`;
  } else {
    try {
      const st = fs.statSync(filepath);
      const mt = st.mtime;
      date = `${mt.getFullYear()}-${String(mt.getMonth() + 1).padStart(2, '0')}-${String(mt.getDate()).padStart(2, '0')}`;
    } catch { /* 文件不存在，保持留空 */ }
  }

  return { date, takenAt, orientation };
}

// 解析 EXIF Orientation，非 JPEG 或无 EXIF 返回 1
async function getExifOrientation(filepath) {
  try {
    const ori = await exifr.orientation(filepath);
    return Number(ori) || 1;
  } catch (e) {
    return 1;
  }
}

// 解析完整 EXIF（相机/镜头/ISO/光圈/快门/焦距/拍摄时间），供详情面板按需读取
async function parseFullExif(filepath) {
  const empty = {
    camera: '', lens: '', iso: '', fNumber: '', exposure: '', focalLength: '', dateTime: '',
    focal35mm: '', flash: '', whiteBalance: '', exposureProgram: '', meteringMode: '',
    exposureBias: '', software: '', artist: '', copyright: '', colorSpace: '', sceneCapture: '',
  };
  try {
    const exif = await exifr.parse(filepath, { tiff: true, exif: true, reviveValues: false, translateValues: false });
    if (!exif) return empty;
    const result = { ...empty };
    const make = typeof exif.Make === 'string' ? exif.Make : '';
    const model = typeof exif.Model === 'string' ? exif.Model : '';
    if (make && model && model.startsWith(make)) result.camera = model;
    else result.camera = [make, model].filter(Boolean).join(' ');
    if (exif.Software) result.software = String(exif.Software);
    if (exif.Artist) result.artist = String(exif.Artist);
    if (exif.Copyright) result.copyright = String(exif.Copyright);
    result.lens = exif.LensModel ? String(exif.LensModel) : '';
    if (exif.ISO != null) result.iso = String(Array.isArray(exif.ISO) ? exif.ISO[0] : exif.ISO);
    if (exif.FNumber) result.fNumber = `f/${exif.FNumber.toFixed(1)}`;
    if (exif.ExposureTime) {
      const t = exif.ExposureTime;
      result.exposure = t >= 1 ? `${t.toFixed(1)}s` : `1/${Math.round(1 / t)}s`;
    }
    if (exif.FocalLength) result.focalLength = `${Math.round(exif.FocalLength)}mm`;
    if (exif.FocalLengthIn35mmFormat) result.focal35mm = `${exif.FocalLengthIn35mmFormat}mm`;
    if (typeof exif.DateTimeOriginal === 'string') result.dateTime = exif.DateTimeOriginal;
    if (exif.Flash != null) result.flash = (Number(exif.Flash) & 0x01) ? '已闪光' : '未闪光';
    if (exif.WhiteBalance != null) result.whiteBalance = Number(exif.WhiteBalance) === 0 ? '自动' : '手动';
    if (exif.ExposureBias != null) {
      const f = exif.ExposureBias;
      result.exposureBias = `${f > 0 ? '+' : ''}${f.toFixed(1)} EV`;
    }
    if (exif.ExposureProgram != null) {
      result.exposureProgram = ({
        0: '未定义', 1: '手动', 2: '程序自动', 3: '光圈优先',
        4: '快门优先', 5: '创意', 6: '运动', 7: '肖像', 8: '风景',
      })[Number(exif.ExposureProgram)] || String(exif.ExposureProgram);
    }
    if (exif.MeteringMode != null) {
      result.meteringMode = ({
        0: '未知', 1: '平均', 2: '中央重点', 3: '点测光',
        4: '多点', 5: '矩阵', 6: '局部', 255: '其他',
      })[Number(exif.MeteringMode)] || String(exif.MeteringMode);
    }
    if (exif.ColorSpace != null) result.colorSpace = Number(exif.ColorSpace) === 1 ? 'sRGB' : (Number(exif.ColorSpace) === 0xFFFF ? 'Uncalibrated' : String(exif.ColorSpace));
    if (exif.SceneCaptureType != null) {
      result.sceneCapture = ({
        0: '标准', 1: '风景', 2: '人像', 3: '夜景', 4: '运动',
      })[Number(exif.SceneCaptureType)] || String(exif.SceneCaptureType);
    }
    return result;
  } catch (e) {
    console.error('[EXIF] 解析失败:', filepath, e.message);
    return empty;
  }
}

function saveThumbnailTiers(id, tiers) {
  const mediumPath = getThumbnailFilePath(id);
  const smallPath = getThumbnailSmallFilePath(id);
  fs.writeFileSync(mediumPath, tiers.medium);
  fs.writeFileSync(smallPath, tiers.small);
  return { mediumPath, smallPath };
}

// ── IPC 处理 ──

let thumbRebuildTimer = null;
// 批量并发提取 EXIF（分批让出事件循环），可选覆盖导入日期，并按批回调进度
async function extractExifBatch(files, onProgress, assignDate) {
  const total = files.length;
  let done = 0;
  const BATCH = 8;
  for (let i = 0; i < total; i += BATCH) {
    await Promise.all(files.slice(i, i + BATCH).map(async (img) => {
      const info = await readExifInfo(img.filepath);
      if (assignDate) assignDate(img, info);
      else img.importDate = info.date;
      img.takenAt = info.takenAt;
      img.orientation = info.orientation;
      done++;
    }));
    if (onProgress) onProgress(done, total);
  }
}

function sendProgress(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ── 编辑会话（LR-like 非破坏）──
// open 准备规范化底图（NEF 有配对时取其内嵌全尺寸预览，否则用原图）；
// 保存 = 只写 edits.params_json（参数化，像素不动）；
// 烘焙替代 = 渲染到 原名-temp → 原子替代原图（显式动作，唯一写原图路径）；
// 导出 = 渲染到用户选的目标目录，绝不覆盖原图。NEF 底片永不修改。
const editSessions = new Map();

function getEditCacheDir() {
  const dir = path.join(app.getPath('userData'), 'edit-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function editTempPathFor(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  const base = path.basename(filepath, ext);
  return path.join(path.dirname(filepath), `${base}-temp${ext}`);
}

async function openEditSession(id) {
  const img = getImageById(id);
  if (!img) return { error: '图片不存在' };
  if (img.hidden) return { error: '隐藏的 NEF 记录不支持编辑' };
  if (!fs.existsSync(img.filepath)) return { error: '图片文件不存在' };

  const ext = path.extname(img.filepath).toLowerCase();
  const tempPath = editTempPathFor(img.filepath);

  // 清理上次烘焙中断的残留 temp
  try {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  } catch (e) {
    return { error: `清理临时文件失败：${e.message}` };
  }

  // 编辑底图：优先 NEF 内嵌全尺寸预览（机内显影质量），无/失败回退 JPG 原图
  let source = 'jpg';
  const basePath = path.join(getEditCacheDir(), `${id}-base.jpg`);
  if (img.raw_path && fs.existsSync(img.raw_path)) {
    const preview = await extractNefPreview(img.raw_path, basePath);
    if (preview && preview.ok) source = 'nef';
  }
  let dims;
  try {
    dims = await normalizeEditBase(source === 'nef' ? basePath : img.filepath, basePath);
  } catch (e) {
    return { error: `准备编辑底图失败：${e.message}` };
  }

  editSessions.set(id, {
    id,
    filepath: img.filepath,
    basePath,
    source,
    format: ext === '.png' ? '.png' : '.jpg',
  });

  const saved = getEdits(id);
  return {
    id,
    source,
    basePath,
    width: dims.width,
    height: dims.height,
    hasNef: !!img.raw_path,
    savedEdits: saved ? { version: saved.version, params: saved.params } : null,
  };
}

// 烘焙替代：渲染 EditParams → 原名-temp → 原子替代原图（saveEditedImage 内含
// DB 事务更新、orientation 归零双写、缩略图清空），随后后台重生成缩略图
async function bakeEditSession(id, edits) {
  const session = editSessions.get(id);
  if (!session) return { error: '编辑会话不存在' };

  const tempPath = editTempPathFor(session.filepath);
  let dims;
  try {
    dims = await renderEdit({
      srcPath: session.basePath,
      outPath: tempPath,
      edits: { ...edits, output: { ...edits?.output, format: session.format === '.png' ? 'png' : 'jpeg' } },
    });
  } catch (e) {
    return { error: `渲染失败：${e.message}` };
  }

  const saved = saveEditedImage(id, tempPath, { width: dims.width, height: dims.height });
  if (saved.error) return saved;

  editSessions.delete(id);
  try {
    if (fs.existsSync(session.basePath)) fs.unlinkSync(session.basePath);
  } catch { /* 缓存清理失败无碍 */ }

  scheduleThumbnailRebuild();
  return { ok: true, image: saved };
}

// 导出：渲染全尺寸到目标目录（原名-edited.ext，重名自动加序号），绝不覆盖原图
async function exportEditSession(id, edits, destDir) {
  const session = editSessions.get(id);
  if (!session) return { error: '编辑会话不存在' };
  if (!destDir || !fs.existsSync(destDir)) return { error: '导出目录不存在' };

  const ext = path.extname(session.filepath).toLowerCase();
  const base = path.basename(session.filepath, ext);
  let dest = path.join(destDir, `${base}-edited${ext}`);
  let n = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(destDir, `${base}-edited_${n}${ext}`);
    n++;
  }

  try {
    const dims = await renderEdit({
      srcPath: session.basePath,
      outPath: dest,
      edits: { ...edits, output: { ...edits?.output, format: session.format === '.png' ? 'png' : 'jpeg' } },
    });
    return { ok: true, path: dest, width: dims.width, height: dims.height };
  } catch (e) {
    return { error: `导出失败：${e.message}` };
  }
}

function cancelEditSession(id) {
  const session = editSessions.get(id);
  if (!session) return { ok: true };
  try {
    if (fs.existsSync(session.basePath)) fs.unlinkSync(session.basePath);
  } catch (e) {
    console.error('[编辑] 清理失败:', e.message);
  }
  editSessions.delete(id);
  return { ok: true };
}

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
        const tiers = await generateThumbnailTiers(r.filepath);
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

    await extractExifBatch(toImport, (done, total) => sendProgress('import-progress', { done, total }));
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
    await extractExifBatch(
      imageFiles,
      (done, total) => sendProgress('import-progress', { done, total }),
      (img, info) => { img.importDate = dateOverride || info.date; }
    );
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
      const tiers = await generateThumbnailTiers(r.filepath);
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

  // ── 编辑模式（非破坏）──
  // open 准备编辑底图（NEF 配对时取其内嵌全尺寸预览）；
  // 保存 = 只写 edits.params_json（参数化，像素不动）；
  // bake 烘焙替代 = 渲染到 原名-temp 原子替代原图（唯一写原图路径，显式动作）；
  // export 导出 = 渲染到用户选的目标目录，绝不覆盖原图
  ipcMain.handle('fs:edit-open', async (_event, id) => {
    return openEditSession(id);
  });

  ipcMain.handle('edits:get', async (_event, id) => {
    return getEdits(id);
  });

  ipcMain.handle('edits:save', async (_event, id, params, command) => {
    return saveEdits(id, params, command);
  });

  ipcMain.handle('edit-history:get', async (_event, id) => {
    return getEditHistory(id);
  });

  ipcMain.handle('presets:list', async () => getPresets());
  ipcMain.handle('presets:create', async (_event, name, params) => createPreset(name, params));
  ipcMain.handle('presets:delete', async (_event, id) => deletePreset(id));

  ipcMain.handle('fs:edit-bake', async (_event, id, edits) => {
    return bakeEditSession(id, edits);
  });

  ipcMain.handle('fs:edit-export', async (_event, id, edits, destDir) => {
    return exportEditSession(id, edits, destDir);
  });

  ipcMain.handle('fs:edit-cancel', async (_event, id) => {
    return cancelEditSession(id);
  });

  // ── 路径转 file:// URL ──
  // 用 Node 内置 pathToFileURL 正确编码中文/空格/# 等特殊字符
  function pathToFileUrl(filepath) {
    return pathToFileURL(filepath).href;
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
      const ori = await getExifOrientation(rows[i].filepath);
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

app.on('before-quit', () => {
  closeWorker();
  closeDatabase();
});

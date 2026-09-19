const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const exifr = require('exifr');
const { generateThumbnailTiers, extractNefPreview, normalizeEditBase, getImageMeta, closeWorker } = require('./imageWorker');
const { renderFromEditParams, computeSourceHash, callWorker, sendToWorker, closeRenderWorker } = require('./render/index.cjs');
const {
  getEditPreviewPath, setEditPreviewPath, clearEditPreview, enforceEditPreviewLimit,
} = require('./database');
const { editParamsToRenderSpec, buildProxySpec } = require('../shared/renderSpec.cjs');
const {
  initDatabase,
  closeDatabase,
  backupDatabase,
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
  cleanupStaleBakeTemps,
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

const RENDER_VERSION = 'render-1'; // 渲染管线实现版本：算子语义变化时递增，编辑预览缓存全量失效

function sendProgress(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// 清理编辑派生文件：预览缩略图（含 meta 侧车）+ 编辑底图缓存（含变体与 meta）
function cleanupEditDerivedFiles(id) {
  clearEditPreview(id);
  for (const name of [`${id}-base.jpg`, `${id}-base.jpg.png`, `${id}-base.jpg.meta.json`]) {
    try {
      const p = path.join(getEditCacheDir(), name);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch { /* 清理失败无碍 */ }
  }
  editPreviewStates.delete(id);
  editPreviewRenderSeq.delete(id);
  editPreviewGeneration.delete(id);
}

// 清理上次进程崩溃残留的编辑渲染中间文件（thumbnails/*.render.jpg*）
function cleanupStaleEditTmp() {
  try {
    const dir = path.join(app.getPath('userData'), 'thumbnails');
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (name.includes('.render.jpg')) {
        try { fs.unlinkSync(path.join(dir, name)); } catch { /* 占用中跳过 */ }
      }
    }
  } catch (e) {
    console.error('[编辑预览] 残留清理失败:', e.message);
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

function editTempPathFor(filepath, outExt) {
  const ext = path.extname(filepath).toLowerCase();
  const base = path.basename(filepath, ext);
  // temp 扩展名跟随实际输出格式（内容与扩展名必须一致）
  return path.join(path.dirname(filepath), `${base}-temp${outExt || ext}`);
}

// ── 编辑底图缓存：NEF/JPG 未变化时跳过重复提取与规范化（mtime+size 侧车校验）──
function editBaseMetaPath(id) {
  return path.join(getEditCacheDir(), `${id}-base.jpg.meta.json`);
}

function readEditBaseCache(id, img) {
  try {
    const cached = JSON.parse(fs.readFileSync(editBaseMetaPath(id), 'utf8'));
    const srcPath = cached.source === 'nef' ? cached.nefPath : img.filepath;
    if (!srcPath || !fs.existsSync(cached.basePath || '')) return null;
    const st = fs.statSync(srcPath);
    if (cached.srcMtimeMs === st.mtimeMs && cached.srcSize === st.size) {
      return { basePath: cached.basePath, source: cached.source };
    }
  } catch { /* 缓存缺失/损坏按未命中处理 */ }
  return null;
}

function writeEditBaseCache(id, img, basePath, source) {
  try {
    const st = fs.statSync(source === 'nef' ? img.raw_path : img.filepath);
    fs.writeFileSync(editBaseMetaPath(id), JSON.stringify({
      source, basePath, nefPath: img.raw_path || '', srcMtimeMs: st.mtimeMs, srcSize: st.size,
    }));
  } catch (e) {
    console.error('[编辑底图] 缓存元数据写入失败:', e.message);
  }
}

// 确保编辑底图就绪：优先 NEF 内嵌全尺寸预览，未变化直接命中缓存
async function ensureEditBase(id, img) {
  const cached = readEditBaseCache(id, img);
  if (cached) return { ...cached, cached: true };

  let source = 'jpg';
  const basePath = path.join(getEditCacheDir(), `${id}-base.jpg`);
  if (img.raw_path && fs.existsSync(img.raw_path)) {
    const preview = await extractNefPreview(img.raw_path, basePath);
    if (preview && preview.ok) source = 'nef';
  }
  if (source === 'nef') {
    // NEF 显影预览：normalize 转正（可能含旋转）
    const dims = await normalizeEditBase(basePath, basePath);
    const finalBase = dims.basePath || basePath;
    writeEditBaseCache(id, img, finalBase, source);
    return { basePath: finalBase, source, cached: false };
  }

  // 无 NEF：方向 1 的 JPG/PNG 源零拷贝直用原图（烘焙单次编码、无底图文件、alpha/EXIF 天然保留）；
  // 方向 ≠1 或元数据不可读时才生成转正副本
  try {
    const meta = await getImageMeta(img.filepath);
    if (!meta.orientation || meta.orientation === 1) {
      writeEditBaseCache(id, img, img.filepath, source);
      return { basePath: img.filepath, source, cached: false };
    }
  } catch { /* 元数据失败走 normalize 兜底 */ }
  const dims = await normalizeEditBase(img.filepath, basePath);
  const finalBase = dims.basePath || basePath;
  writeEditBaseCache(id, img, finalBase, source);
  return { basePath: finalBase, source, cached: false };
}

async function openEditSession(id) {
  const img = getImageById(id);
  if (!img) return { error: '图片不存在' };
  if (img.hidden) return { error: '隐藏的 NEF 记录不支持编辑' };
  if (!fs.existsSync(img.filepath)) return { error: '图片文件不存在' };

  const ext = path.extname(img.filepath).toLowerCase();

  // 清理上次烘焙中断的残留 temp（各格式变体）
  for (const variant of ['.jpg', '.png', '.webp']) {
    try {
      const staleTemp = editTempPathFor(img.filepath, variant);
      if (fs.existsSync(staleTemp)) fs.unlinkSync(staleTemp);
    } catch { /* 占用中跳过 */ }
  }

  // 编辑底图（带缓存：NEF/JPG 未变化直接命中，不再重复提取/规范化）
  let baseInfo;
  try {
    baseInfo = await ensureEditBase(id, img);
  } catch (e) {
    return { error: `准备编辑底图失败：${e.message}` };
  }
  const { basePath, source } = baseInfo;
  const dims = await getImageMeta(basePath);

  editSessions.set(id, {
    id,
    filepath: img.filepath,
    basePath,
    source,
    // 输出格式跟随原图（PNG/WebP 源保持原格式与特性），不跟随 NEF 底图
    format: ext === '.png' ? '.png' : (ext === '.webp' ? '.webp' : '.jpg'),
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
// DB 事务更新、参数重置、缩略图清空），随后后台重生成缩略图。
// 输出格式跟随原图扩展名（PNG 源保持 alpha）。
// 输出格式按源扩展名映射（png→png、webp→webp、其余→jpeg），temp 扩展名跟随输出，
// 源扩展名不受支持时（gif/bmp/tiff/svg）由 saveEditedImage 托管改名到 .jpg。
async function bakeEditSession(id, edits) {
  const session = editSessions.get(id);
  if (!session) return { error: '编辑会话不存在' };

  const outFormat = session.format === '.png' ? 'png' : (session.format === '.webp' ? 'webp' : 'jpeg');
  const outExt = outFormat === 'png' ? '.png' : (outFormat === 'webp' ? '.webp' : '.jpg');
  const tempPath = editTempPathFor(session.filepath, outExt);
  let dims;
  try {
    dims = await renderFromEditParams(
      { ...edits, output: { ...edits?.output, format: outFormat } },
      {
        inputPath: session.basePath,
        outputPath: tempPath,
        sourceHash: await computeSourceHashCached(session.basePath),
      }
    );
  } catch (e) {
    return { error: `渲染失败：${e.message}` };
  }

  // 渲染期间会话可能已被取消（editCancel 删除会话并清理底图）——替代前复查
  if (!editSessions.has(id)) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* 清理失败无碍 */ }
    return { error: '编辑会话已取消，已放弃替代' };
  }

  // 渲染产物验证：尺寸与渲染返回一致且文件可解码，异常产物绝不替代原图
  try {
    const sharpCheck = require('sharp');
    const meta = await sharpCheck(tempPath).metadata();
    if (!meta.width || meta.width !== dims.width || meta.height !== dims.height) {
      fs.unlinkSync(tempPath);
      return { error: `渲染产物校验失败（${meta.width || 0}x${meta.height || 0}，期望 ${dims.width}x${dims.height}），已放弃替代` };
    }
  } catch (e) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* 清理失败无碍 */ }
    return { error: `渲染产物校验失败：${e.message}` };
  }

  let saved;
  try {
    saved = saveEditedImage(id, tempPath, { width: dims.width, height: dims.height });
  } catch (e) {
    return { error: `保存失败：${e.message}（像素可能已替换，请重新进入编辑确认）` };
  }
  if (saved.error) return saved;

  // 烘焙后原图已是参数效果：编辑预览缩略图失去意义，清掉（缩略图由 rebuild 重生成）；
  // 递增世代使任何在途预览渲染作废
  bumpEditPreviewGeneration(id);
  clearEditPreview(id);

  editSessions.delete(id);
  try {
    // 零拷贝会话的 basePath 就是原图本身——绝不可删
    if (fs.existsSync(session.basePath) && session.basePath !== session.filepath) fs.unlinkSync(session.basePath);
  } catch { /* 缓存清理失败无碍 */ }
  try {
    // 底图 meta 侧车一并清理（残留无害但会累积）
    const metaPath = editBaseMetaPath(id);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  } catch { /* 清理失败无碍 */ }

  scheduleThumbnailRebuild();
  return { ok: true, image: saved };
}

// 导出：渲染到目标目录（原名-edited[-Npx].ext，重名自动加序号），绝不覆盖原图。
// output 可选 { format: 'jpeg'|'png'|'webp', quality, maxEdge }——缺省跟随原图格式全尺寸。
async function exportEditSession(id, edits, destDir, output = null) {
  const session = editSessions.get(id);
  if (!session) return { error: '编辑会话不存在' };
  if (!destDir || !fs.existsSync(destDir)) return { error: '导出目录不存在' };

  // 输出选项：format 覆盖（jpeg/png/webp）；maxEdge 可选长边缩放（仅原图超长边时生效）
  const SUPPORTED_EXPORT = ['jpeg', 'png', 'webp'];
  const outFormat = SUPPORTED_EXPORT.includes(output?.format)
    ? output.format
    : (session.format === '.png' ? 'png' : (session.format === '.webp' ? 'webp' : 'jpeg'));
  const extMap = { jpeg: '.jpg', png: '.png', webp: '.webp' };
  const ext = extMap[outFormat];
  const maxEdge = Number(output?.maxEdge) > 0 ? Number(output.maxEdge) : null;
  const meta = await getImageMeta(session.basePath);
  const resize = maxEdge && meta.width && Math.max(meta.width, meta.height) > maxEdge
    ? { width: maxEdge, height: maxEdge }
    : null;

  const base = path.basename(session.filepath, path.extname(session.filepath));
  // 尺寸标记仅在实际发生缩放时加入（原图未超长边时 resize 不生效，名字不应撒谎）
  const sizeTag = resize ? `-${maxEdge}px` : '';
  let dest = path.join(destDir, `${base}-edited${sizeTag}${ext}`);
  let n = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(destDir, `${base}-edited${sizeTag}_${n}${ext}`);
    n++;
  }

  try {
    const dims = await renderFromEditParams(
      {
        ...edits,
        output: {
          ...edits?.output,
          format: outFormat,
          quality: Number(output?.quality) > 0 ? Math.min(100, Math.max(1, Math.round(Number(output.quality)))) : (edits?.output?.quality ?? 92),
          resize,
        },
      },
      {
        inputPath: session.basePath,
        outputPath: dest,
        sourceHash: await computeSourceHashCached(session.basePath),
      }
    );
    return { ok: true, path: dest, width: dims.width, height: dims.height };
  } catch (e) {
    return { error: `导出失败：${e.message}` };
  }
}

function cancelEditSession(id) {
  const session = editSessions.get(id);
  // 递增预览世代：在途的编辑预览渲染完成后发现世代不符即丢弃，防止"复活"已被烘焙/取消清掉的预览
  bumpEditPreviewGeneration(id);
  if (session) {
    try {
      // 零拷贝会话的 basePath 就是原图本身——绝不可删
      if (fs.existsSync(session.basePath) && session.basePath !== session.filepath) fs.unlinkSync(session.basePath);
    } catch (e) {
      console.error('[编辑] 清理失败:', e.message);
    }
    editSessions.delete(id);
  }
  return { ok: true };
}

// 图片改名/移动后同步仍打开的编辑会话：零拷贝会话 basePath 就是原图，跟随新路径；
// 非零拷贝 basePath 在 edit-cache 内不受影响，仅更新 filepath（temp 路径与零拷贝判定依赖它）
function reconcileEditSessionPaths(id, img) {
  const session = editSessions.get(id);
  if (!session || !img || !img.filepath || session.filepath === img.filepath) return;
  if (session.basePath === session.filepath) session.basePath = img.filepath;
  session.filepath = img.filepath;
}

// ── 编辑预览缩略图（LRU + 去重 + 世代令牌）──
// 同 id 串行化：进行中时只更新 dirty 参数，完成后补渲最新一次，避免并发写坏同一输出文件。
// 世代令牌：烘焙/取消会递增世代，在途渲染完成后校验，不符则丢弃（不写路径不发事件）。
const editPreviewStates = new Map(); // id -> { running, dirty }
const editPreviewGeneration = new Map(); // id -> number
const editPreviewRenderSeq = new Map(); // id -> 当前在途预览渲染的全局唯一序号（取消定位用）
let nextEditPreviewSeq = 1; // 全局唯一：跨图共 worker 取消集合，per-id 计数会互相误杀

function bumpEditPreviewGeneration(id) {
  editPreviewGeneration.set(id, (editPreviewGeneration.get(id) || 0) + 1);
  // 中止该图在途的预览渲染（worker 收到后于阶段边界退出，立即让出给缩略图重建）
  const seq = editPreviewRenderSeq.get(id);
  if (seq) {
    sendToWorker({ type: 'render-cancel', requestSeq: seq });
    editPreviewRenderSeq.delete(id);
  }
}

// 底图内容哈希缓存（key 含 mtime/size，路径复用时自动失效；避免每次保存同步读整图卡主进程）
const sourceHashCache = new Map();
async function computeSourceHashCached(inputPath) {
  const stat = fs.statSync(inputPath);
  const key = `${inputPath}:${stat.mtimeMs}:${stat.size}`;
  const hit = sourceHashCache.get(key);
  if (hit) return hit;
  const hash = await computeSourceHash(inputPath);
  sourceHashCache.set(key, hash);
  return hash;
}

async function renderEditPreviewOnce(id, params, generation) {
  const img = getImageById(id);
  if (!img || img.hidden) return null;
  // 底图可能是 jpg（默认）或 .jpg.png（alpha 输入被 normalizeBase 改写），两者取先存在者
  let basePath = path.join(getEditCacheDir(), `${id}-base.jpg`);
  if (!fs.existsSync(basePath)) basePath = `${basePath}.png`;
  if (!fs.existsSync(basePath)) {
    const fallback = path.join(getEditCacheDir(), `${id}-base.jpg`);
    let source = img.filepath;
    if (img.raw_path && fs.existsSync(img.raw_path)) {
      const preview = await extractNefPreview(img.raw_path, fallback);
      if (preview && preview.ok) source = fallback;
    }
    const dims = await normalizeEditBase(source, fallback);
    basePath = dims.basePath || fallback;
  }
  const previewPath = getEditPreviewPath(id);
  // Phase 9 渲染取消：全局唯一请求序号（跨图共 worker 取消集合，per-id 计数会互相误杀）
  const requestSeq = nextEditPreviewSeq++;
  editPreviewRenderSeq.set(id, requestSeq);
  // 缓存键校验：edits.version 与 renderVersion 均一致且预览文件存在 → 跳过重渲染
  // （renderer 版本升级后旧缓存必须失效，否则算子语义变化不会反映到缩略图）
  const version = getEdits(id)?.version || 0;
  const previewMetaPath = `${previewPath}.meta.json`;
  try {
    const prevMeta = JSON.parse(fs.readFileSync(previewMetaPath, 'utf8'));
    if (prevMeta.editVersion === version && prevMeta.renderVersion === RENDER_VERSION && fs.existsSync(previewPath)) {
      return previewPath;
    }
  } catch { /* 无缓存元数据，继续渲染 */ }
  const spec = editParamsToRenderSpec(params, { sourceHash: await computeSourceHashCached(basePath) });
  // 代理分辨率（任务书第 20 节）：预览渲染在 decode 后缩到 400 长边再跑后续算子，
  // crop 坐标同步等比缩放——批量同步/连续保存的预览渲染耗时降一个数量级
  const baseDims = await getImageMeta(basePath);
  const { spec: proxySpec } = buildProxySpec(spec, baseDims.width, baseDims.height, 400);
  const renderResult = await callWorker({ type: 'edit-preview', srcPath: basePath, outPath: previewPath, spec: proxySpec, requestSeq });
  editPreviewRenderSeq.delete(id);
  // Phase 9：被取消的渲染（烘焙/取消会话触发）不写路径不发事件
  if (renderResult && renderResult.cancelled) {
    try {
      if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath);
    } catch { /* 清理失败无碍 */ }
    return null;
  }
  try {
    fs.writeFileSync(previewMetaPath, JSON.stringify({ editVersion: version, renderVersion: RENDER_VERSION }));
  } catch (e) { console.error('[编辑预览] 缓存元数据写入失败:', e.message); }
  // 世代校验：烘焙/取消已发生则本次渲染作废（不复活被清掉的预览）
  if (editPreviewGeneration.get(id) !== generation) {
    try {
      if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath);
    } catch { /* 清理失败无碍 */ }
    return null;
  }
  setEditPreviewPath(id, previewPath);
  enforceEditPreviewLimit();
  sendProgress('edit-preview-ready', { id, path: previewPath });
  return previewPath;
}

async function refreshEditPreview(id, params) {
  const st = editPreviewStates.get(id) || { running: false, dirty: null };
  st.dirty = params;
  editPreviewStates.set(id, st);
  if (st.running) return null;
  st.running = true;
  const generation = editPreviewGeneration.get(id) || 0;
  try {
    while (st.dirty) {
      const latest = st.dirty;
      st.dirty = null;
      if (editPreviewGeneration.get(id) !== generation) break;
      await renderEditPreviewOnce(id, latest, generation);
    }
  } catch (e) {
    console.error('[编辑预览] 生成失败:', e.message);
  } finally {
    st.running = false;
    if (!st.dirty) editPreviewStates.delete(id);
  }
  return null;
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

    const imported = await importImages(toImport);
    let attached = 0;
    for (const p of attachPairs) {
      if (await attachRawToImage(p.jpgId, p.nefSource, p.nefFilename)) attached++;
    }
    // 必须在导入落库后调度：防抖触发时 getImagesForRebuild 才能查到新记录
    //（此前放在 importImages 之前，同步进来的图片一直没有缩略图）
    scheduleThumbnailRebuild();

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
    const list = ids || [];
    const removed = await deleteBrokenRecords(list);
    for (const id of list) {
      cancelEditSession(id); // 记录删除后仍打开的会话必须作废，防残留僵尸会话
      cleanupEditDerivedFiles(id);
    }
    return removed;
  });

  // 重复图片检测（元数据粗分组 + 快速哈希验证）
  ipcMain.handle('db:find-duplicates', async () => {
    return findDuplicates();
  });

  // 更新图片字段（import_date 变更会移动文件：打开中的编辑会话路径需同步）
  ipcMain.handle('db:update-image', async (_event, id, updates) => {
    const result = await updateImage(id, updates);
    if (result && !result.error && updates && updates.import_date) {
      reconcileEditSessionPaths(id, getImageById(id));
    }
    return result;
  });

  // 重命名图片（同时更新文件名和磁盘文件；打开中的编辑会话路径同步，避免烘焙报底图丢失）
  ipcMain.handle('db:rename-image', async (_event, id, newFilename) => {
    const result = await renameImage(id, newFilename);
    if (result && result.success) {
      reconcileEditSessionPaths(id, getImageById(id));
    }
    return result;
  });

  // 删除图片（含编辑派生文件清理：预览缩略图、编辑底图缓存，并取消打开中的编辑会话）
  ipcMain.handle('db:delete-image', async (_event, id) => {
    const result = await deleteImage(id);
    if (result && !result.error) {
      cleanupEditDerivedFiles(id);
      cancelEditSession(id);
    }
    return result;
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
      await backupDatabase(result.filePath);
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
    const result = await setImagesRoot(dirPath);
    // 迁移成功后所有在途编辑会话的文件路径已过期（零拷贝会话 basePath 即原图）——逐会话跟随新路径
    if (result && result.success) {
      for (const id of editSessions.keys()) {
        reconcileEditSessionPaths(id, getImageById(id));
      }
    }
    return result;
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
    const results = (await batchDeleteImages(ids)) || [];
    for (const r of results) {
      if (r && !r.error) {
        cleanupEditDerivedFiles(r.id);
        cancelEditSession(r.id);
      }
    }
    return results;
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
    const result = saveEdits(id, params, command);
    // 参数保存成功后异步刷新编辑预览缩略图（不阻塞保存返回；失败仅告警）
    if (result && !result.error) {
      refreshEditPreview(id, params).catch((e) => {
        console.error('[编辑预览] 生成失败:', e.message);
      });
    }
    return result;
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

  ipcMain.handle('fs:edit-export', async (_event, id, edits, destDir, output) => {
    return exportEditSession(id, edits, destDir, output || null);
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
  cleanupStaleEditTmp();
  setupIPC();
  createWindow();

  // 后台回填历史图片方向标记，完成后通知渲染进程刷新
  setTimeout(async () => {
    const staleTemps = cleanupStaleBakeTemps();
    if (staleTemps) console.log(`[编辑清理] 已清除 ${staleTemps} 个烘焙 temp 残留`);
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
  closeRenderWorker();
  closeDatabase();
});

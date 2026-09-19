import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const MAIN_JS = path.join(ROOT, 'electron', 'main.js');
const DB_JS = path.join(ROOT, 'electron', 'database.js');
const IMAGE_WORKER_JS = path.join(ROOT, 'electron', 'imageWorker.js');
const RENDER_INDEX_JS = path.join(ROOT, 'electron', 'render', 'index.cjs');
const TMP_BASE = path.join(os.tmpdir(), `pixyang-main-test-${process.pid}`);
const FIXTURES = path.join(TMP_BASE, 'fixtures');
const THUMBS = path.join(TMP_BASE, 'thumbs');
const USER_DATA = path.join(TMP_BASE, 'userData');
const WINDOW_STATE = path.join(USER_DATA, 'window-state.json');

const handlers = new Map();
const winInstances = [];

function makeWindowInstance() {
  const inst = {
    webContents: {
      send: vi.fn(),
      openDevTools: vi.fn(),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      getURL: vi.fn(() => 'file:///app/dist/index.html'),
      reload: vi.fn(),
    },
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    isMinimized: vi.fn(() => false),
    maximize: vi.fn(),
    isDestroyed: vi.fn(() => true),
    isMaximized: vi.fn(() => false),
    getNormalBounds: vi.fn(() => ({ x: 1, y: 2, width: 1200, height: 800 })),
  };
  winInstances.push(inst);
  return inst;
}

function emptyImage() {
  return { isEmpty: () => true };
}

function buildExifJpeg(options = {}) {
  const {
    orientation = 1,
    make = 'NIKON CORPORATION',
    model = 'NIKON CORPORATION Z 6_2',
    iso = 100,
    fNumber = 40,
    exposureNum = 1,
    exposureDen = 100,
    focalLength = 50,
    lens = 'NIKKOR Z 50mm f/1.8 S',
    dateTime = '2023:01:15 10:30:00',
    embedDateTimeLiteral = false,
  } = options;
  const enc = (s) => Buffer.from(s, 'latin1');
  const u16le = (v) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v);
    return b;
  };
  const u32le = (v) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v);
    return b;
  };
  const u16be = (v) => {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(v);
    return b;
  };
  const entry = (tag, type, count, value) => {
    const b = Buffer.alloc(12);
    b.writeUInt16LE(tag, 0);
    b.writeUInt16LE(type, 2);
    b.writeUInt32LE(count, 4);
    value.copy(b, 8);
    return b;
  };
  const makeB = enc(make + '\0');
  const modelB = enc(model + '\0');
  const lensB = enc(lens + '\0');
  const dtB = enc(dateTime + '\0');
  const rational = (n, d) => Buffer.concat([u32le(n), u32le(d)]);
  const ifd0Count = orientation !== 1 ? 4 : 3;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const exifSize = 2 + 6 * 12 + 4;
  let cur = 8 + ifd0Size;
  const makeOff = cur;
  cur += makeB.length;
  const modelOff = cur;
  cur += modelB.length;
  const exifIfdOff = cur;
  cur += exifSize;
  const fnOff = cur;
  cur += 8;
  const expOff = cur;
  cur += 8;
  const focalOff = cur;
  cur += 8;
  const lensOff = cur;
  cur += lensB.length;
  const dtOff = cur;
  const ifd0Entries = [
    entry(0x010f, 2, makeB.length, u32le(makeOff)),
    entry(0x0110, 2, modelB.length, u32le(modelOff)),
    entry(0x8769, 4, 1, u32le(exifIfdOff)),
  ];
  if (orientation !== 1) {
    ifd0Entries.push(entry(0x0112, 3, 1, Buffer.concat([u16le(orientation), Buffer.alloc(2)])));
  }
  const exifEntries = [
    entry(0x8827, 3, 1, Buffer.concat([u16le(iso), Buffer.alloc(2)])),
    entry(0x829d, 5, 1, u32le(fnOff)),
    entry(0x829a, 5, 1, u32le(expOff)),
    entry(0x920a, 5, 1, u32le(focalOff)),
    entry(0xa434, 2, lensB.length, u32le(lensOff)),
    entry(0x9003, 2, dtB.length, u32le(dtOff)),
  ];
  const tiff = Buffer.concat([
    enc('II'),
    u16le(42),
    u32le(8),
    u16le(ifd0Count),
    ...ifd0Entries,
    u32le(0),
    makeB,
    modelB,
    u16le(6),
    ...exifEntries,
    u32le(0),
    rational(fNumber, 10),
    rational(exposureNum, exposureDen),
    rational(focalLength, 1),
    lensB,
    dtB,
  ]);
  let payload = Buffer.concat([enc('Exif\0\0'), tiff]);
  if (embedDateTimeLiteral) {
    payload = Buffer.concat([payload, enc('DateTimeOriginal\0\0\0'), enc('2023:01:15 10:30')]);
  }
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1]),
    u16be(payload.length + 2),
    payload,
    Buffer.from([0xff, 0xd9]),
  ]);
}

const electronStub = {
  app: {
    whenReady: () => Promise.resolve(),
    getPath: (name) => path.join(TMP_BASE, name),
    isPackaged: true,
    on: vi.fn(),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    hasSingleInstanceLock: () => true,
  },
  BrowserWindow: Object.assign(vi.fn(makeWindowInstance), { getAllWindows: vi.fn(() => []) }),
  ipcMain: {
    handle: vi.fn((channel, fn) => {
      handlers.set(channel, fn);
    }),
    on: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
  nativeImage: {
    createFromBuffer: vi.fn(() => emptyImage()),
    createFromPath: vi.fn(() => emptyImage()),
  },
  Menu: { setApplicationMenu: vi.fn() },
  shell: { openPath: vi.fn(async () => '') },
};

const dbDefaults = {
  initDatabase: async () => {},
  saveDatabase: () => {},
  getImagesRoot: () => 'C:/PixYangImages',
  getDatabasePath: () => path.join(TMP_BASE, 'pixyang.db'),
  backupDatabase: async () => {},
  getThumbnailFilePath: (id) => path.join(THUMBS, `${id}.jpg`),
  getThumbnailSmallFilePath: (id) => path.join(THUMBS, `${id}_s.jpg`),
  deleteThumbnailFile: () => {},
  setImagesRoot: (p) => p,
  scanImageFiles: async () => [],
  collectImportFiles: async () => [],
  prepareCameraSync: () => ({ toImport: [], attachPairs: [], skipped: 0 }),
  attachRawToImage: async () => true,
  importImages: async (files) => files,
  getImages: () => [],
  getImageById: () => null,
  getAllVisibleIds: () => [],
  getAllImagePaths: () => [],
  getImagesForRebuild: () => [],
  updateImageOrientation: () => {},
  updateImage: async () => {},
  updateImageThumbs: async () => {},
  updateImages: async () => {},
  renameImage: async () => {},
  deleteImage: async () => {},
  batchDeleteImages: async () => {},
  cleanupStaleBakeTemps: () => 0,
  saveEditedImage: () => ({ error: 'not stubbed' }),
  getEdits: () => null,
  saveEdits: () => ({ error: 'not stubbed' }),
  getEditHistory: () => [],
  getPresets: () => [],
  createPreset: () => ({ error: 'not stubbed' }),
  deletePreset: () => {},
  getEditPreviewPath: (id) => path.join(THUMBS, `edit-${id}.jpg`),
  getEditPreviewPathFor: () => '',
  setEditPreviewPath: () => {},
  clearEditPreview: () => {},
  enforceEditPreviewLimit: () => 0,
  findBrokenRecords: () => [],
  deleteBrokenRecords: async () => ({ removed: [], unbound: [] }),
  findDuplicates: () => [],
  getImportDates: () => [],
  getTags: () => [],
  createTag: (name, color) => ({ id: 1, name, color }),
  deleteTag: () => {},
  addTagToImage: () => {},
  removeTagFromImage: () => {},
  getImageTags: () => [],
  getBatchImageTags: () => ({}),
  addTagToImages: async () => {},
  getAlbums: () => [],
  createAlbum: (name, description) => ({ id: 1, name, description }),
  renameAlbum: async () => {},
  deleteAlbum: () => {},
  addToAlbum: () => {},
  removeFromAlbum: () => {},
  getAlbumImages: () => [],
  getStats: () => ({ totalImages: 0, totalTags: 0, totalAlbums: 0, favorites: 0 }),
  getSetting: () => null,
  setSetting: () => {},
  getAllSettings: () => ({}),
};

const dbStub = {};
for (const [key, impl] of Object.entries(dbDefaults)) {
  dbStub[key] = vi.fn(impl);
}

const workerStub = {
  generateThumbnailTiers: vi.fn(async () => null),
  extractNefPreview: vi.fn(async () => null),
  normalizeEditBase: vi.fn(async () => ({ width: 2000, height: 1200 })),
  getImageMeta: vi.fn(async () => ({ width: 2000, height: 1200, orientation: 1, hasAlpha: false })),
  closeWorker: vi.fn(async () => {}),
};

// 渲染入口（electron/render/index.cjs）：bake/export 经 RenderSpec 走 worker
const renderModuleStub = {
  renderFromEditParams: vi.fn(async () => ({ ok: true, width: 800, height: 600 })),
  renderFromSpec: vi.fn(async () => ({ ok: true })),
  computeSourceHash: vi.fn(() => 'hash-stub'),
  callWorker: vi.fn(async () => ({ ok: true, width: 400, height: 300 })),
  sendToWorker: vi.fn(),
  closeRenderWorker: vi.fn(async () => {}),
};

require.cache[require.resolve('electron')] = {
  id: 'electron',
  filename: require.resolve('electron'),
  loaded: true,
  exports: electronStub,
};
require.cache[DB_JS] = { id: DB_JS, filename: DB_JS, loaded: true, exports: dbStub };
require.cache[IMAGE_WORKER_JS] = { id: IMAGE_WORKER_JS, filename: IMAGE_WORKER_JS, loaded: true, exports: workerStub };
require.cache[RENDER_INDEX_JS] = { id: RENDER_INDEX_JS, filename: RENDER_INDEX_JS, loaded: true, exports: renderModuleStub };

const call = (channel, ...args) => handlers.get(channel)({ sender: { id: 1 } }, ...args);
const randomJpg = path.join(FIXTURES, 'random.jpg');
const photoPng = path.join(FIXTURES, 'photo.png');
const exif1Jpg = path.join(FIXTURES, 'exif1.jpg');
const exif6Jpg = path.join(FIXTURES, 'exif6.jpg');
const exifSonyJpg = path.join(FIXTURES, 'exif-sony.jpg');
const EMPTY_EXIF = {
  camera: '', lens: '', iso: '', fNumber: '', exposure: '', focalLength: '', dateTime: '',
  focal35mm: '', flash: '', whiteBalance: '', exposureProgram: '', meteringMode: '',
  exposureBias: '', software: '', artist: '', copyright: '', colorSpace: '', sceneCapture: '',
};

const ALL_CHANNELS = [
  'dialog:select-directory',
  'fs:scan-directory',
  'db:sync-camera-folder',
  'db:import-images',
  'db:get-images',
  'db:get-image',
  'db:get-all-image-ids',
  'fs:collect-import-files',
  'db:add-tag-to-images',
  'db:update-images',
  'db:scan-broken-records',
  'db:delete-broken-records',
  'db:find-duplicates',
  'db:update-image',
  'db:rename-image',
  'db:delete-image',
  'db:rebuild-thumbnails',
  'edits:get',
  'edits:save',
  'edit-history:get',
  'presets:list',
  'presets:create',
  'presets:delete',
  'fs:edit-bake',
  'fs:edit-export',
  'fs:get-database-path',
  'fs:backup-database',
  'db:get-import-dates',
  'fs:get-images-root',
  'fs:set-images-root',
  'fs:get-exif',
  'fs:file-exists',
  'db:get-tags',
  'db:create-tag',
  'db:delete-tag',
  'db:add-tag-to-image',
  'db:remove-tag-from-image',
  'db:get-image-tags',
  'db:get-batch-image-tags',
  'db:get-albums',
  'db:create-album',
  'db:delete-album',
  'db:add-to-album',
  'db:remove-from-album',
  'db:rename-album',
  'dialog:select-export-directory',
  'fs:export-album-images',
  'fs:export-images',
  'db:get-stats',
  'settings:get-all',
  'settings:get',
  'settings:set',
  'db:batch-delete-images',
  'fs:to-file-url',
  'fs:to-file-urls',
  'shell:open-path',
];

function setDefaultMocks() {
  for (const [key, impl] of Object.entries(dbDefaults)) {
    dbStub[key].mockReset();
    dbStub[key].mockImplementation(impl);
  }
  electronStub.dialog.showOpenDialog.mockReset();
  electronStub.dialog.showOpenDialog.mockImplementation(async () => ({ canceled: true, filePaths: [] }));
  electronStub.dialog.showSaveDialog.mockReset();
  electronStub.dialog.showSaveDialog.mockImplementation(async () => ({ canceled: true }));
  electronStub.nativeImage.createFromBuffer.mockReset();
  electronStub.nativeImage.createFromBuffer.mockImplementation(() => emptyImage());
  electronStub.nativeImage.createFromPath.mockReset();
  electronStub.nativeImage.createFromPath.mockImplementation(() => emptyImage());
  workerStub.generateThumbnailTiers.mockReset();
  workerStub.generateThumbnailTiers.mockImplementation(async () => null);
  workerStub.extractNefPreview.mockReset();
  workerStub.extractNefPreview.mockImplementation(async () => null);
  workerStub.normalizeEditBase.mockReset();
  workerStub.normalizeEditBase.mockImplementation(async () => ({ width: 2000, height: 1200 }));
  renderModuleStub.renderFromEditParams.mockReset();
  renderModuleStub.renderFromEditParams.mockImplementation(async () => ({ ok: true, width: 800, height: 600 }));
  renderModuleStub.callWorker.mockReset();
  renderModuleStub.callWorker.mockImplementation(async () => ({ ok: true, width: 400, height: 300 }));
  renderModuleStub.sendToWorker.mockReset();
  renderModuleStub.sendToWorker.mockImplementation(() => {});
  dbStub.getEdits.mockReset();
  dbStub.getEdits.mockImplementation(() => null);
  dbStub.saveEdits.mockReset();
  dbStub.saveEdits.mockImplementation(() => ({ error: 'not stubbed' }));
  dbStub.getEditHistory.mockReset();
  dbStub.getEditHistory.mockImplementation(() => []);
  dbStub.getPresets.mockReset();
  dbStub.getPresets.mockImplementation(() => []);
  dbStub.createPreset.mockReset();
  dbStub.createPreset.mockImplementation(() => ({ error: 'not stubbed' }));
  dbStub.clearEditPreview.mockReset();
  dbStub.clearEditPreview.mockImplementation(() => {});
  dbStub.setEditPreviewPath.mockReset();
  dbStub.setEditPreviewPath.mockImplementation(() => {});
  dbStub.enforceEditPreviewLimit.mockReset();
  dbStub.enforceEditPreviewLimit.mockImplementation(() => 0);
}

beforeAll(async () => {
  fs.mkdirSync(FIXTURES, { recursive: true });
  fs.mkdirSync(THUMBS, { recursive: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.writeFileSync(WINDOW_STATE, JSON.stringify({ x: 10, y: 20, width: 1200, height: 800, maximized: true }));
  fs.writeFileSync(randomJpg, Buffer.alloc(2048, 0xab));
  fs.writeFileSync(photoPng, Buffer.alloc(512, 0xcd));
  fs.writeFileSync(path.join(FIXTURES, 'a.jpg'), 'A');
  fs.writeFileSync(path.join(FIXTURES, 'a.nef'), 'RAW-A');
  fs.writeFileSync(path.join(FIXTURES, 'c.jpg'), 'C');
  fs.writeFileSync(path.join(FIXTURES, 'c.nef'), 'RAW-C');
  fs.writeFileSync(exif1Jpg, buildExifJpeg({ orientation: 1 }));
  fs.writeFileSync(exif6Jpg, buildExifJpeg({ orientation: 6, embedDateTimeLiteral: true }));
  fs.writeFileSync(exifSonyJpg, buildExifJpeg({ orientation: 1, make: 'SONY', model: 'ILCE-7M4' }));
  require(MAIN_JS);
  await new Promise((r) => setTimeout(r, 30));
});

beforeEach(() => {
  setDefaultMocks();
});

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 950));
  fs.rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('IPC 注册', () => {
  it('注册不少于 40 个 handler', () => {
    expect(handlers.size).toBeGreaterThanOrEqual(40);
  });

  it('包含所有预期通道', () => {
    const missing = ALL_CHANNELS.filter((c) => !handlers.has(c));
    expect(missing).toEqual([]);
  });
});

describe('窗口与生命周期', () => {
  it('createWindow 恢复窗口状态并最大化、加载打包页面、移除菜单', () => {
    expect(winInstances.length).toBeGreaterThanOrEqual(1);
    const win = winInstances[0];
    expect(win.maximize).toHaveBeenCalled();
    expect(win.show).toHaveBeenCalled();
    expect(win.loadURL).not.toHaveBeenCalled();
    expect(win.loadFile.mock.calls[0][0]).toMatch(/dist[/\\]index\.html$/);
    expect(win.on).toHaveBeenCalledWith('closed', expect.any(Function));
    expect(win.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(electronStub.Menu.setApplicationMenu).toHaveBeenCalledWith(null);
    expect(electronStub.ipcMain.handle).toBeDefined();
  });

  it('window-all-closed 在非 darwin 下退出应用', () => {
    const cb = electronStub.app.on.mock.calls.find(([e]) => e === 'window-all-closed')?.[1];
    expect(cb).toBeDefined();
    cb();
    expect(electronStub.app.quit).toHaveBeenCalled();
  });

  it('activate 在无窗口时重建窗口', () => {
    const cb = electronStub.app.on.mock.calls.find(([e]) => e === 'activate')?.[1];
    expect(cb).toBeDefined();
    const before = winInstances.length;
    cb();
    expect(winInstances.length).toBe(before + 1);
  });

  it('saveWindowState 按 isDestroyed 分支工作并写入窗口边界', () => {
    const inst = winInstances[winInstances.length - 1];
    const closeCb = inst.on.mock.calls.find(([e]) => e === 'close')?.[1];
    expect(closeCb).toBeDefined();

    inst.isDestroyed.mockReturnValue(true);
    expect(() => closeCb()).not.toThrow();

    inst.isDestroyed.mockReturnValue(false);
    closeCb();
    const saved = JSON.parse(fs.readFileSync(WINDOW_STATE, 'utf8'));
    expect(saved).toEqual({ x: 1, y: 2, width: 1200, height: 800, maximized: false });

    inst.getNormalBounds.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => closeCb()).not.toThrow();

    inst.isDestroyed.mockReturnValue(true);
  });

  it('启动即申请单实例锁', () => {
    expect(electronStub.app.requestSingleInstanceLock).toHaveBeenCalled();
  });

  it('second-instance：已最小化的主窗口被恢复并聚焦', () => {
    const cb = electronStub.app.on.mock.calls.find(([e]) => e === 'second-instance')?.[1];
    expect(cb).toBeDefined();
    const win = winInstances[winInstances.length - 1];
    win.isDestroyed.mockReturnValue(false);
    win.isMinimized.mockReturnValue(true);
    cb();
    expect(win.restore).toHaveBeenCalled();
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    win.isDestroyed.mockReturnValue(true);
    win.isMinimized.mockReturnValue(false);
  });

  it('will-navigate：跨源拒绝、同源（HMR reload）放行、坏 URL 一律拒绝', () => {
    const win = winInstances[0];
    const cb = win.webContents.on.mock.calls.find(([e]) => e === 'will-navigate')?.[1];
    expect(cb).toBeDefined();
    const cross = { preventDefault: vi.fn() };
    cb(cross, 'https://evil.example.com/x');
    expect(cross.preventDefault).toHaveBeenCalled();
    const same = { preventDefault: vi.fn() };
    cb(same, 'file:///app/dist/index.html?reload=1');
    expect(same.preventDefault).not.toHaveBeenCalled();
    const bad = { preventDefault: vi.fn() };
    cb(bad, 'not a url');
    expect(bad.preventDefault).toHaveBeenCalled();
  });

  it('setWindowOpenHandler：拒绝一切新窗口', () => {
    const win = winInstances[0];
    expect(win.webContents.setWindowOpenHandler).toHaveBeenCalled();
    const handler = win.webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(handler('https://example.com')).toEqual({ action: 'deny' });
  });

  it('render-process-gone：窗口存活时自动重载', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const win = winInstances[winInstances.length - 1];
    const cb = win.webContents.on.mock.calls.find(([e]) => e === 'render-process-gone')?.[1];
    expect(cb).toBeDefined();
    win.isDestroyed.mockReturnValue(false);
    cb({}, { reason: 'oom', exitCode: 1 });
    expect(win.webContents.reload).toHaveBeenCalled();
    win.isDestroyed.mockReturnValue(true);
    win.webContents.reload.mockClear();
    errSpy.mockRestore();
  });
});

describe('打包配置契约（electron-builder files）', () => {
  it('build.files 覆盖主进程静态 require 的全部顶层目录（files 自定义模式会顶掉默认全收录）', () => {
    const pkg = require('../../../package.json');
    const files = pkg.build.files;
    for (const dir of ['dist/**/*', 'electron/**/*', 'shared/**/*', 'package.json']) {
      expect(files).toContain(dir);
    }
  });
});

describe('查询委托类 handler', () => {
  it('db:get-images 透传筛选参数与返回值', async () => {
    const rows = [{ id: 1, filename: 'x.jpg' }];
    dbStub.getImages.mockReturnValueOnce(rows);
    const options = { date: '2024-01-01', tags: [1, 2] };
    await expect(call('db:get-images', options)).resolves.toBe(rows);
    expect(dbStub.getImages).toHaveBeenCalledWith(options);
  });

  it('db:get-image 按 id 查询', async () => {
    const row = { id: 7 };
    dbStub.getImageById.mockReturnValueOnce(row);
    await expect(call('db:get-image', 7)).resolves.toBe(row);
    expect(dbStub.getImageById).toHaveBeenCalledWith(7);
  });

  it('db:get-all-image-ids 无参数时回退空对象', async () => {
    dbStub.getAllVisibleIds.mockReturnValueOnce([1, 2]);
    await expect(call('db:get-all-image-ids')).resolves.toEqual([1, 2]);
    expect(dbStub.getAllVisibleIds).toHaveBeenCalledWith({});
  });

  it('db:get-stats 透传统计结果', async () => {
    const stats = { totalImages: 3, totalTags: 1, totalAlbums: 2, favorites: 5 };
    dbStub.getStats.mockReturnValueOnce(stats);
    await expect(call('db:get-stats')).resolves.toBe(stats);
    expect(dbStub.getStats).toHaveBeenCalled();
  });

  it('db:get-import-dates 透传结果', async () => {
    const dates = ['2024-01-01'];
    dbStub.getImportDates.mockReturnValueOnce(dates);
    await expect(call('db:get-import-dates')).resolves.toBe(dates);
  });

  it('db:get-tags 透传结果', async () => {
    const tags = [{ id: 1, name: '风景' }];
    dbStub.getTags.mockReturnValueOnce(tags);
    await expect(call('db:get-tags')).resolves.toBe(tags);
  });

  it('db:get-albums 透传结果', async () => {
    const albums = [{ id: 1, name: '旅行' }];
    dbStub.getAlbums.mockReturnValueOnce(albums);
    await expect(call('db:get-albums')).resolves.toBe(albums);
  });

  it('db:get-image-tags 按 imageId 查询', async () => {
    const tags = [{ id: 2 }];
    dbStub.getImageTags.mockReturnValueOnce(tags);
    await expect(call('db:get-image-tags', 9)).resolves.toBe(tags);
    expect(dbStub.getImageTags).toHaveBeenCalledWith(9);
  });

  it('db:get-batch-image-tags 空入参回退空数组', async () => {
    const map = { 1: [] };
    dbStub.getBatchImageTags.mockReturnValueOnce(map);
    await expect(call('db:get-batch-image-tags', [1])).resolves.toBe(map);
    expect(dbStub.getBatchImageTags).toHaveBeenCalledWith([1]);
    await call('db:get-batch-image-tags', null);
    expect(dbStub.getBatchImageTags).toHaveBeenLastCalledWith([]);
  });

  it('fs:get-images-root / fs:get-database-path 透传', async () => {
    await expect(call('fs:get-images-root')).resolves.toBe('C:/PixYangImages');
    expect(dbStub.getImagesRoot).toHaveBeenCalled();
    await expect(call('fs:get-database-path')).resolves.toBe(path.join(TMP_BASE, 'pixyang.db'));
    expect(dbStub.getDatabasePath).toHaveBeenCalled();
  });

  it('settings:get-all / settings:get 透传', async () => {
    const all = { theme: 'dark' };
    dbStub.getAllSettings.mockReturnValueOnce(all);
    await expect(call('settings:get-all')).resolves.toBe(all);
    dbStub.getSetting.mockReturnValueOnce('light');
    await expect(call('settings:get', 'theme')).resolves.toBe('light');
    expect(dbStub.getSetting).toHaveBeenCalledWith('theme');
  });
});

describe('写入委托类 handler', () => {
  it('db:update-image 透传 id 与 updates', async () => {
    await call('db:update-image', 5, { rating: 4 });
    expect(dbStub.updateImage).toHaveBeenCalledWith(5, { rating: 4 });
  });

  it('db:update-images 空入参回退并透传', async () => {
    await call('db:update-images', [1, 2], { favorite: 1 });
    expect(dbStub.updateImages).toHaveBeenCalledWith([1, 2], { favorite: 1 });
    await call('db:update-images', null, null);
    expect(dbStub.updateImages).toHaveBeenLastCalledWith([], {});
  });

  it('db:rename-image 透传', async () => {
    await call('db:rename-image', 3, 'new.jpg');
    expect(dbStub.renameImage).toHaveBeenCalledWith(3, 'new.jpg');
  });

  it('db:delete-image 透传', async () => {
    await call('db:delete-image', 8);
    expect(dbStub.deleteImage).toHaveBeenCalledWith(8);
  });

  it('db:batch-delete-images 透传', async () => {
    await call('db:batch-delete-images', [1, 2, 3]);
    expect(dbStub.batchDeleteImages).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('db:add-tag-to-image / db:remove-tag-from-image 透传', async () => {
    await call('db:add-tag-to-image', 1, 2);
    expect(dbStub.addTagToImage).toHaveBeenCalledWith(1, 2);
    await call('db:remove-tag-from-image', 1, 2);
    expect(dbStub.removeTagFromImage).toHaveBeenCalledWith(1, 2);
  });

  it('db:add-tag-to-images 空入参回退并透传', async () => {
    await call('db:add-tag-to-images', [1, 2], 5);
    expect(dbStub.addTagToImages).toHaveBeenCalledWith([1, 2], 5);
    await call('db:add-tag-to-images', null, 5);
    expect(dbStub.addTagToImages).toHaveBeenLastCalledWith([], 5);
  });

  it('db:create-tag 透传名称与颜色', async () => {
    await expect(call('db:create-tag', '人物', '#ff0000')).resolves.toEqual({ id: 1, name: '人物', color: '#ff0000' });
    expect(dbStub.createTag).toHaveBeenCalledWith('人物', '#ff0000');
  });

  it('db:delete-tag 透传', async () => {
    await call('db:delete-tag', 4);
    expect(dbStub.deleteTag).toHaveBeenCalledWith(4);
  });

  it('db:create-album 透传名称与描述', async () => {
    await expect(call('db:create-album', '旅行', '2024')).resolves.toEqual({ id: 1, name: '旅行', description: '2024' });
    expect(dbStub.createAlbum).toHaveBeenCalledWith('旅行', '2024');
  });

  it('db:rename-album / db:delete-album 透传', async () => {
    await call('db:rename-album', 2, '新名字');
    expect(dbStub.renameAlbum).toHaveBeenCalledWith(2, '新名字');
    await call('db:delete-album', 2);
    expect(dbStub.deleteAlbum).toHaveBeenCalledWith(2);
  });

  it('db:add-to-album / db:remove-from-album 透传', async () => {
    await call('db:add-to-album', 2, [1, 2]);
    expect(dbStub.addToAlbum).toHaveBeenCalledWith(2, [1, 2]);
    await call('db:remove-from-album', 2, 1);
    expect(dbStub.removeFromAlbum).toHaveBeenCalledWith(2, 1);
  });

  it('settings:set 透传 key 与 value', async () => {
    await call('settings:set', 'theme', 'light');
    expect(dbStub.setSetting).toHaveBeenCalledWith('theme', 'light');
  });

  it('settings:set 拒绝裸写 images_root（审查批 4，只能走迁移流程）', async () => {
    const result = await call('settings:set', 'images_root', 'D:/elsewhere');
    expect(result.error).toBeTruthy();
    expect(dbStub.setSetting).not.toHaveBeenCalled();
  });

  it('长任务 handler 异常转 { error } 不 reject（审查批 4）', async () => {
    dbStub.batchDeleteImages.mockRejectedValueOnce(new Error('EBUSY'));
    await expect(call('db:batch-delete-images', [1])).resolves.toEqual({ error: expect.stringContaining('EBUSY') });
    dbStub.deleteBrokenRecords.mockRejectedValueOnce(new Error('boom'));
    await expect(call('db:delete-broken-records', [1])).resolves.toEqual({ error: expect.stringContaining('boom') });
    dbStub.renameImage.mockResolvedValueOnce(false);
    await expect(call('db:rename-image', 1, 'a.jpg')).resolves.toEqual({ error: '记录不存在或已被删除' });
  });

  it('db:scan-broken-records / db:delete-broken-records 委托', async () => {
    const broken = [{ id: 9 }];
    dbStub.findBrokenRecords.mockReturnValueOnce(broken);
    await expect(call('db:scan-broken-records')).resolves.toBe(broken);
    dbStub.deleteBrokenRecords.mockResolvedValueOnce({ removed: [9], unbound: [] });
    await expect(call('db:delete-broken-records', [9])).resolves.toEqual({ removed: 1, unbound: 0 });
    expect(dbStub.deleteBrokenRecords).toHaveBeenCalledWith([9]);
    await call('db:delete-broken-records', null);
    expect(dbStub.deleteBrokenRecords).toHaveBeenLastCalledWith([]);
  });

  it('db:find-duplicates 委托', async () => {
    const groups = [{ hash: 'aa', ids: [1, 2] }];
    dbStub.findDuplicates.mockReturnValueOnce(groups);
    await expect(call('db:find-duplicates')).resolves.toBe(groups);
  });
});

describe('fs 工具类 handler', () => {
  it('fs:to-file-url 对存在的文件返回 file:/// URL', async () => {
    const url = await call('fs:to-file-url', randomJpg);
    expect(url).toBe(`file:///${randomJpg.replace(/\\/g, '/')}`);
    expect(url.startsWith('file:///')).toBe(true);
    expect(url.includes('\\')).toBe(false);
  });

  it('fs:to-file-url 对不存在的文件返回 null', async () => {
    await expect(call('fs:to-file-url', path.join(TMP_BASE, 'nope.jpg'))).resolves.toBeNull();
  });

  it('fs:to-file-urls 批量转换并去重、跳过非法值', async () => {
    const missing = path.join(TMP_BASE, 'missing.png');
    const result = await call('fs:to-file-urls', [randomJpg, missing, randomJpg, 42, '']);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result[randomJpg]).toBe(`file:///${randomJpg.replace(/\\/g, '/')}`);
    expect(result[missing]).toBeNull();
  });

  it('fs:to-file-urls 非数组入参返回空对象', async () => {
    await expect(call('fs:to-file-urls', 'not-array')).resolves.toEqual({});
  });

  it('fs:file-exists 使用真实 fs 判断', async () => {
    await expect(call('fs:file-exists', randomJpg)).resolves.toBe(true);
    await expect(call('fs:file-exists', path.join(TMP_BASE, 'nope.jpg'))).resolves.toBe(false);
  });

  it('fs:get-exif：非 JPEG 随机文件返回空字段对象', async () => {
    await expect(call('fs:get-exif', randomJpg)).resolves.toEqual(EMPTY_EXIF);
  });

  it('fs:get-exif：文件不存在走异常兜底返回空字段对象', async () => {
    await expect(call('fs:get-exif', path.join(TMP_BASE, 'nope.jpg'))).resolves.toEqual(EMPTY_EXIF);
  });

  it('fs:get-exif：解析手工构造的 JPEG EXIF 全字段', async () => {
    await expect(call('fs:get-exif', exif1Jpg)).resolves.toEqual({
      ...EMPTY_EXIF,
      camera: 'NIKON CORPORATION Z 6_2',
      lens: 'NIKKOR Z 50mm f/1.8 S',
      iso: '100',
      fNumber: 'f/4.0',
      exposure: '1/100s',
      focalLength: '50mm',
      dateTime: '2023:01:15 10:30:00',
    });
  });

  it('fs:get-exif：model 不以 make 开头时拼接相机名', async () => {
    await expect(call('fs:get-exif', exifSonyJpg)).resolves.toEqual({
      ...EMPTY_EXIF,
      camera: 'SONY ILCE-7M4',
      lens: 'NIKKOR Z 50mm f/1.8 S',
      iso: '100',
      fNumber: 'f/4.0',
      exposure: '1/100s',
      focalLength: '50mm',
      dateTime: '2023:01:15 10:30:00',
    });
  });

  it('fs:get-exif / fs:file-exists：托管根外文件一律拒绝（审查批 6 L4/L5）', async () => {
    // 前缀逃逸目录：字符串前缀命中 TMP_BASE 但并非其子路径
    const evilDir = `${TMP_BASE}-evil6`;
    fs.mkdirSync(evilDir, { recursive: true });
    const evilFile = path.join(evilDir, 'probe.jpg');
    fs.writeFileSync(evilFile, 'x');
    try {
      // 修复前：任意本地路径可被 exiftool 读取 / existsSync 探测（存在性 oracle）
      await expect(call('fs:get-exif', MAIN_JS)).resolves.toBeNull();
      await expect(call('fs:get-exif', evilFile)).resolves.toBeNull();
      await expect(call('fs:get-exif', null)).resolves.toBeNull();
      await expect(call('fs:file-exists', MAIN_JS)).resolves.toBe(false);
      await expect(call('fs:file-exists', evilFile)).resolves.toBe(false);
      await expect(call('fs:file-exists', null)).resolves.toBe(false);
      // 托管根内行为不变
      await expect(call('fs:file-exists', randomJpg)).resolves.toBe(true);
      await expect(call('fs:get-exif', exif1Jpg)).resolves.toMatchObject({ camera: 'NIKON CORPORATION Z 6_2' });
    } finally {
      fs.rmSync(evilDir, { recursive: true, force: true });
    }
  });
});

describe('导入与相机同步', () => {
  it('db:import-images 为每个文件附加 importDate/takenAt/orientation', async () => {
    const imgs = [{ filepath: exif6Jpg }, { filepath: randomJpg }, { filepath: 'Z:/definitely/missing.jpg' }];
    const result = await call('db:import-images', imgs);
    expect(result).toBe(imgs);
    expect(dbStub.importImages).toHaveBeenCalledWith(imgs);
    expect(imgs[0]).toEqual({
      filepath: exif6Jpg,
      importDate: '2023-01-15',
      takenAt: '2023-01-15 10:30',
      orientation: 6,
    });
    expect(imgs[1].importDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(imgs[1].takenAt).toBe('');
    expect(imgs[1].orientation).toBe(1);
    expect(imgs[2]).toEqual({
      filepath: 'Z:/definitely/missing.jpg',
      importDate: '',
      takenAt: '',
      orientation: 1,
    });
  });

  it('db:import-images 支持日期覆盖', async () => {
    const imgs = [{ filepath: exif6Jpg }];
    await call('db:import-images', imgs, '2024-05-01');
    expect(imgs[0].importDate).toBe('2024-05-01');
    expect(imgs[0].takenAt).toBe('2023-01-15 10:30');
  });

  it('fs:collect-import-files 委托 collectImportFiles', async () => {
    const collected = [{ filepath: 'C:/a.jpg' }];
    dbStub.collectImportFiles.mockResolvedValueOnce(collected);
    await expect(call('fs:collect-import-files', ['C:/a'])).resolves.toBe(collected);
    expect(dbStub.collectImportFiles).toHaveBeenCalledWith(['C:/a']);
    await call('fs:collect-import-files', null);
    expect(dbStub.collectImportFiles).toHaveBeenLastCalledWith([]);
  });

  it('db:import-images：非数组入参归一为空列表，不进 EXIF 批解析（审查批 6 L6）', async () => {
    await expect(call('db:import-images', 'C:/Windows')).resolves.toEqual([]);
    expect(dbStub.importImages).toHaveBeenCalledWith([]);
    await expect(call('db:import-images', null)).resolves.toEqual([]);
  });

  it('fs:scan-directory 委托 scanImageFiles', async () => {
    dbStub.scanImageFiles.mockResolvedValueOnce(['C:/dir/x.jpg']);
    await expect(call('fs:scan-directory', 'C:/dir')).resolves.toEqual(['C:/dir/x.jpg']);
    expect(dbStub.scanImageFiles).toHaveBeenCalledWith('C:/dir', false);
  });

  it('db:sync-camera-folder：未设置相机文件夹时返回错误', async () => {
    await expect(call('db:sync-camera-folder')).resolves.toEqual({ error: '未设置相机文件夹' });
  });

  it('db:sync-camera-folder：文件夹不存在时返回错误', async () => {
    dbStub.getSetting.mockReturnValueOnce(path.join(TMP_BASE, 'no-camera-dir'));
    await expect(call('db:sync-camera-folder')).resolves.toEqual({ error: '相机文件夹不存在' });
  });

  it('db:sync-camera-folder：正常流程导入并绑定 NEF', async () => {
    dbStub.getSetting.mockImplementation((key) => (key === 'camera_folder' ? FIXTURES : null));
    dbStub.scanImageFiles.mockResolvedValueOnce([randomJpg, exif6Jpg]);
    const toImport = [{ filepath: exif6Jpg }];
    dbStub.prepareCameraSync.mockReturnValueOnce({
      toImport,
      attachPairs: [{ jpgId: 'j1', nefSource: 'src.nef', nefFilename: 'a.nef' }],
      skipped: 3,
    });
    dbStub.importImages.mockResolvedValueOnce([{ hidden: false }, { hidden: true }]);
    const result = await call('db:sync-camera-folder');
    expect(result).toEqual({ scanned: 2, imported: 2, jpgImported: 1, nefImported: 1, attached: 1, skipped: 3 });
    expect(toImport[0].importDate).toBe('2023-01-15');
    expect(toImport[0].takenAt).toBe('2023-01-15 10:30');
    expect(toImport[0].orientation).toBe(6);
    expect(dbStub.attachRawToImage).toHaveBeenCalledWith('j1', 'src.nef', 'a.nef');
  });

  it('导入与相机同步并发触发时经导入锁串行，不交错', async () => {
    let active = 0;
    let maxActive = 0;
    dbStub.importImages.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return [];
    });
    dbStub.getSetting.mockImplementation((key) => (key === 'camera_folder' ? FIXTURES : null));
    dbStub.scanImageFiles.mockResolvedValue([randomJpg]);
    dbStub.prepareCameraSync.mockReturnValue({ toImport: [{ filepath: randomJpg }], attachPairs: [], skipped: 0 });
    const p1 = call('db:import-images', [{ filepath: randomJpg }]);
    const p2 = call('db:sync-camera-folder');
    await Promise.all([p1, p2]);
    expect(maxActive).toBe(1);
    expect(dbStub.importImages).toHaveBeenCalledTimes(2);
  });

  it('导入锁内任务抛错不阻塞后续导入', async () => {
    dbStub.importImages.mockRejectedValueOnce(new Error('boom'));
    await expect(call('db:import-images', [{ filepath: randomJpg }])).rejects.toThrow('boom');
    const imgs = [{ filepath: randomJpg }];
    await expect(call('db:import-images', imgs)).resolves.toBe(imgs);
  });
});

describe('编辑会话（非破坏保存）', () => {
  const editImage = () => ({
    id: 77,
    filename: 'editme.jpg',
    filepath: path.join(FIXTURES, 'editme.jpg'),
    hidden: 0,
    raw_path: '',
    width: 2000,
    height: 1200,
  });
  const sampleEdits = { orientation: { rotate: 90 }, basic: { exposure: 0.5 } };

  it('fs:edit-open：jpg 源返回会话信息（含已存参数）并清理残留 temp', async () => {
    fs.writeFileSync(path.join(FIXTURES, 'editme.jpg'), 'img');
    fs.writeFileSync(path.join(FIXTURES, 'editme-temp.jpg'), 'stale-temp');
    dbStub.getImageById.mockReturnValueOnce(editImage());
    dbStub.getEdits.mockReturnValueOnce({ version: 2, params: sampleEdits });
    const session = await call('fs:edit-open', 77);
    expect(session.error).toBeUndefined();
    expect(session.source).toBe('jpg');
    expect(session.width).toBe(2000);
    expect(session.savedEdits.version).toBe(2);
    expect(fs.existsSync(path.join(FIXTURES, 'editme-temp.jpg'))).toBe(false);
    // 零拷贝：方向 1 的源直接引用原图作为底图，无需 normalize 副本
    expect(session.basePath).toBe(path.join(FIXTURES, 'editme.jpg'));
    expect(workerStub.normalizeEditBase).not.toHaveBeenCalled();
    await call('fs:edit-cancel', 77);
  });

  it('fs:edit-open：配对 NEF 预览提取成功时源为 nef', async () => {
    fs.writeFileSync(path.join(FIXTURES, 'editme.jpg'), 'img');
    fs.writeFileSync(path.join(FIXTURES, 'editme.nef'), 'raw');
    workerStub.extractNefPreview.mockResolvedValueOnce({ ok: true, width: 2000, height: 1200 });
    dbStub.getImageById.mockReturnValueOnce({ ...editImage(), raw_path: path.join(FIXTURES, 'editme.nef') });
    const session = await call('fs:edit-open', 77);
    expect(session.source).toBe('nef');
    expect(session.hasNef).toBe(true);
    await call('fs:edit-cancel', 77);
  });

  it('fs:edit-open：不存在的图片/隐藏记录/缺失文件返回错误', async () => {
    dbStub.getImageById.mockReturnValueOnce(null);
    expect(await call('fs:edit-open', 999)).toEqual({ error: '图片不存在' });

    dbStub.getImageById.mockReturnValueOnce({ ...editImage(), hidden: 1 });
    const hidden = await call('fs:edit-open', 77);
    expect(hidden.error).toBe('隐藏的 NEF 记录不支持编辑');

    dbStub.getImageById.mockReturnValueOnce({ ...editImage(), filepath: path.join(FIXTURES, 'gone.jpg') });
    const missing = await call('fs:edit-open', 77);
    expect(missing.error).toBe('图片文件不存在');
  });

  it('fs:edit-bake：渲染 EditParams 到 temp 并委托 saveEditedImage', async () => {
    fs.writeFileSync(path.join(FIXTURES, 'editme.jpg'), 'img');
    dbStub.getImageById.mockReturnValue(editImage());
    await call('fs:edit-open', 77);
    // computeSourceHashCached 会 statSync 底图（stub 的 normalizeEditBase 不真写盘）
    fs.writeFileSync(path.join(USER_DATA, 'edit-cache', '77-base.jpg'), 'base');

    renderModuleStub.renderFromEditParams.mockResolvedValueOnce({ ok: true, width: 800, height: 600 });
    // 产物验证需要真实可解码且尺寸匹配的 temp（sharp 可用）
    const sharpMod = require('sharp');
    await sharpMod({ create: { width: 800, height: 600, channels: 3, background: '#3366aa' } }).jpeg().toFile(path.join(FIXTURES, 'editme-temp.jpg'));
    const baked = { id: 77, filename: 'editme.jpg', filepath: path.join(FIXTURES, 'editme.jpg') };
    dbStub.saveEditedImage.mockReturnValueOnce(baked);
    const result = await call('fs:edit-bake', 77, sampleEdits);
    expect(result.ok).toBe(true);
    expect(result.image).toBe(baked);
    expect(renderModuleStub.renderFromEditParams).toHaveBeenCalledWith(
      expect.objectContaining({ basic: expect.objectContaining({ exposure: 0.5 }) }),
      expect.objectContaining({
        inputPath: path.join(FIXTURES, 'editme.jpg'),
        outputPath: path.join(FIXTURES, 'editme-temp.jpg'),
      })
    );
    expect(dbStub.saveEditedImage).toHaveBeenCalledWith(77, path.join(FIXTURES, 'editme-temp.jpg'), { width: 800, height: 600 });
    // 烘焙后会话关闭
    expect((await call('fs:edit-bake', 77, sampleEdits)).error).toBe('编辑会话不存在');
  });

  it('fs:edit-export：渲染到目标目录（重名自动加序号），不碰原图', async () => {
    fs.writeFileSync(path.join(FIXTURES, 'editme.jpg'), 'img');
    dbStub.getImageById.mockReturnValue(editImage());
    await call('fs:edit-open', 77);

    const destDir = path.join(TMP_BASE, 'export-dir');
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(USER_DATA, 'edit-cache', '77-base.jpg'), 'base'); // hash 缓存 statSync 需要
    renderModuleStub.renderFromEditParams.mockResolvedValue({ ok: true, width: 800, height: 600 });
    const r1 = await call('fs:edit-export', 77, sampleEdits, destDir);
    expect(r1.ok).toBe(true);
    expect(r1.path).toBe(path.join(destDir, 'editme-edited.jpg'));
    fs.writeFileSync(r1.path, 'rendered'); // 模拟渲染产物（stub 不真写盘），触发第二次重名
    const r2 = await call('fs:edit-export', 77, sampleEdits, destDir);
    expect(r2.path).toBe(path.join(destDir, 'editme-edited_1.jpg'));
    expect(renderModuleStub.renderFromEditParams).toHaveBeenCalledTimes(2);
    await call('fs:edit-cancel', 77);
  });

  it('edits:get/save、edit-history:get、presets 透传数据库层', async () => {
    const stored = { version: 3, params: sampleEdits };
    dbStub.getEdits.mockReturnValueOnce(stored);
    await expect(call('edits:get', 77)).resolves.toBe(stored);

    const saved = { version: 4, params: sampleEdits };
    dbStub.saveEdits.mockReturnValueOnce(saved);
    const r = await call('edits:save', 77, sampleEdits, { label: '曝光' });
    expect(r).toBe(saved);
    expect(dbStub.saveEdits).toHaveBeenCalledWith(77, sampleEdits, { label: '曝光' });

    const hist = [{ step: 1, command: { label: '曝光' } }];
    dbStub.getEditHistory.mockReturnValueOnce(hist);
    await expect(call('edit-history:get', 77)).resolves.toBe(hist);

    dbStub.getPresets.mockReturnValueOnce([]);
    await expect(call('presets:list')).resolves.toEqual([]);
    dbStub.createPreset.mockReturnValueOnce({ id: 1, name: '暖调' });
    await expect(call('presets:create', '暖调', sampleEdits)).resolves.toEqual({ id: 1, name: '暖调' });
    await call('presets:delete', 1);
    expect(dbStub.deletePreset).toHaveBeenCalledWith(1);
  });

  it('零拷贝会话取消后原图不得被清理（basePath === filepath 护栏）', async () => {
    fs.writeFileSync(path.join(FIXTURES, 'editme.jpg'), 'img');
    dbStub.getImageById.mockReturnValue(editImage());
    await call('fs:edit-open', 77);
    const original = path.join(FIXTURES, 'editme.jpg');
    expect(fs.existsSync(original)).toBe(true);
    await call('fs:edit-cancel', 77);
    expect(fs.existsSync(original)).toBe(true); // 原图绝不可删
  });

  it('fs:edit-cancel 幂等；零拷贝会话不触碰原图，非零拷贝底图被清理', async () => {
    // 零拷贝会话：basePath === filepath，取消只关会话不删文件
    fs.writeFileSync(path.join(FIXTURES, 'editme.jpg'), 'img');
    dbStub.getImageById.mockReturnValue(editImage());
    await call('fs:edit-open', 77);
    expect(await call('fs:edit-cancel', 77)).toEqual({ ok: true });
    expect(fs.existsSync(path.join(FIXTURES, 'editme.jpg'))).toBe(true);
    // 幂等
    expect(await call('fs:edit-cancel', 77)).toEqual({ ok: true });
    // 非零拷贝会话（NEF 显影）：base 文件属缓存，取消时清理
    fs.writeFileSync(path.join(FIXTURES, 'editme.nef'), 'raw');
    workerStub.extractNefPreview.mockResolvedValueOnce({ ok: true, width: 2000, height: 1200 });
    dbStub.getImageById.mockReturnValueOnce({ ...editImage(), raw_path: path.join(FIXTURES, 'editme.nef') });
    await call('fs:edit-open', 77);
    expect(await call('fs:edit-cancel', 77)).toEqual({ ok: true });
  });

  it('db:rename-image：打开中的零拷贝会话跟随新路径（烘焙使用新 filepath）', async () => {
    const oldPath = path.join(FIXTURES, 'editme.jpg');
    const newPath = path.join(FIXTURES, 'renamed.jpg');
    fs.writeFileSync(oldPath, 'img');
    dbStub.getImageById.mockReturnValueOnce(editImage());
    await call('fs:edit-open', 77);
    fs.writeFileSync(newPath, 'img');
    dbStub.renameImage.mockResolvedValueOnce({ success: true, newFilename: 'renamed.jpg', newPath });
    dbStub.getImageById.mockReturnValueOnce({ ...editImage(), filename: 'renamed.jpg', filepath: newPath });
    await call('db:rename-image', 77, 'renamed.jpg');
    renderModuleStub.renderFromEditParams.mockResolvedValueOnce({ ok: true, width: 800, height: 600 });
    const sharpMod = require('sharp');
    await sharpMod({ create: { width: 800, height: 600, channels: 3, background: '#3366aa' } }).jpeg().toFile(path.join(FIXTURES, 'renamed-temp.jpg'));
    dbStub.saveEditedImage.mockReturnValueOnce({ id: 77, filepath: newPath });
    const result = await call('fs:edit-bake', 77, sampleEdits);
    expect(result.ok).toBe(true);
    expect(renderModuleStub.renderFromEditParams).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        inputPath: newPath,
        outputPath: path.join(FIXTURES, 'renamed-temp.jpg'),
      })
    );
    expect(fs.existsSync(newPath)).toBe(true);
  });

  it('fs:set-images-root：迁移成功后打开中的零拷贝会话跟随新根路径', async () => {
    const oldPath = path.join(FIXTURES, 'editme.jpg');
    const movedPath = path.join(FIXTURES, 'newroot', 'editme.jpg');
    fs.writeFileSync(oldPath, 'img');
    dbStub.getImageById.mockReturnValueOnce(editImage());
    await call('fs:edit-open', 77);
    fs.mkdirSync(path.dirname(movedPath), { recursive: true });
    fs.writeFileSync(movedPath, 'img');
    dbStub.setImagesRoot.mockResolvedValueOnce({ success: true, path: path.join(FIXTURES, 'newroot'), moved: 1 });
    dbStub.getImageById.mockReturnValueOnce({ ...editImage(), filepath: movedPath });
    const r = await call('fs:set-images-root', path.join(FIXTURES, 'newroot'));
    expect(r.success).toBe(true);
    const destDir = path.join(TMP_BASE, 'export-newroot');
    fs.mkdirSync(destDir, { recursive: true });
    renderModuleStub.renderFromEditParams.mockResolvedValueOnce({ ok: true, width: 800, height: 600 });
    const ex = await call('fs:edit-export', 77, sampleEdits, destDir);
    expect(ex.ok).toBe(true);
    const last = renderModuleStub.renderFromEditParams.mock.calls[renderModuleStub.renderFromEditParams.mock.calls.length - 1];
    expect(last[1].inputPath).toBe(movedPath);
    await call('fs:edit-cancel', 77);
  });

  it('fs:set-images-root：迁移抛错转 {error} 返回值而非 IPC reject（审查批 6 L7）', async () => {
    dbStub.setImagesRoot.mockRejectedValueOnce(new Error('EPERM: operation not permitted'));
    const r = await call('fs:set-images-root', 'D:/somewhere');
    expect(r).toEqual({ error: expect.stringContaining('迁移失败') });
    expect(r.error).toContain('EPERM');
  });

  it('db:update-image：import_date 移动文件后打开中的会话跟随新 filepath', async () => {
    const oldPath = path.join(FIXTURES, 'editme.jpg');
    const movedPath = path.join(FIXTURES, '2033', '05', '05', 'editme.jpg');
    fs.writeFileSync(oldPath, 'img');
    dbStub.getImageById.mockReturnValueOnce(editImage());
    await call('fs:edit-open', 77);
    fs.mkdirSync(path.dirname(movedPath), { recursive: true });
    fs.writeFileSync(movedPath, 'img');
    dbStub.updateImage.mockResolvedValueOnce(true);
    dbStub.getImageById.mockReturnValueOnce({ ...editImage(), filepath: movedPath });
    await call('db:update-image', 77, { import_date: '2033-05-05' });
    const destDir = path.join(TMP_BASE, 'export-moved');
    fs.mkdirSync(destDir, { recursive: true });
    renderModuleStub.renderFromEditParams.mockResolvedValueOnce({ ok: true, width: 800, height: 600 });
    const r = await call('fs:edit-export', 77, sampleEdits, destDir);
    expect(r.ok).toBe(true);
    const lastCall = renderModuleStub.renderFromEditParams.mock.calls[renderModuleStub.renderFromEditParams.mock.calls.length - 1];
    expect(lastCall[1].inputPath).toBe(movedPath);
    await call('fs:edit-cancel', 77);
  });

  it('db:delete-image：删除后取消打开中的编辑会话并清理派生文件', async () => {
    fs.writeFileSync(path.join(FIXTURES, 'editme.jpg'), 'img');
    dbStub.getImageById.mockReturnValueOnce(editImage());
    await call('fs:edit-open', 77);
    dbStub.deleteImage.mockResolvedValueOnce({ id: 77 });
    await call('db:delete-image', 77);
    expect(dbStub.clearEditPreview).toHaveBeenCalledWith(77);
    expect(await call('fs:edit-bake', 77, sampleEdits)).toEqual({ error: '编辑会话不存在' });
  });

  it('db:batch-delete-images：对每个已删除 id 清理派生文件并取消会话', async () => {
    fs.writeFileSync(path.join(FIXTURES, 'editme.jpg'), 'img');
    dbStub.getImageById.mockReturnValueOnce(editImage());
    await call('fs:edit-open', 77);
    dbStub.batchDeleteImages.mockResolvedValueOnce([{ id: 77 }, { id: 88 }]);
    await call('db:batch-delete-images', [77, 88]);
    expect(dbStub.clearEditPreview).toHaveBeenCalledWith(77);
    expect(dbStub.clearEditPreview).toHaveBeenCalledWith(88);
    expect(await call('fs:edit-bake', 77, sampleEdits)).toEqual({ error: '编辑会话不存在' });
  });

  it('db:delete-broken-records：仅对真正删除的记录清理派生文件，解绑记录不动', async () => {
    dbStub.deleteBrokenRecords.mockResolvedValueOnce({ removed: [11], unbound: [12] });
    const r = await call('db:delete-broken-records', [11, 12]);
    expect(r).toEqual({ removed: 1, unbound: 1 });
    expect(dbStub.clearEditPreview).toHaveBeenCalledWith(11);
    // 12 只是解绑缺失 NEF：可见记录与会话仍在，不得清理其派生文件/作废会话
    expect(dbStub.clearEditPreview).not.toHaveBeenCalledWith(12);
  });

  it('fs:edit-export：webp 源缺省导出 webp（跟随原图格式，与烘焙一致）', async () => {
    const webpPath = path.join(FIXTURES, 'editme.webp');
    fs.writeFileSync(webpPath, 'img');
    dbStub.getImageById.mockReturnValueOnce({ ...editImage(), filename: 'editme.webp', filepath: webpPath });
    await call('fs:edit-open', 77);
    const destDir = path.join(TMP_BASE, 'export-webp');
    fs.mkdirSync(destDir, { recursive: true });
    renderModuleStub.renderFromEditParams.mockResolvedValueOnce({ ok: true, width: 800, height: 600 });
    const r = await call('fs:edit-export', 77, sampleEdits, destDir);
    expect(r.ok).toBe(true);
    expect(r.path).toBe(path.join(destDir, 'editme-edited.webp'));
    const lastCall = renderModuleStub.renderFromEditParams.mock.calls[renderModuleStub.renderFromEditParams.mock.calls.length - 1];
    expect(lastCall[0].output.format).toBe('webp');
    await call('fs:edit-cancel', 77);
  });
});

describe('缩略图重建、导出与备份', () => {
  it('db:rebuild-thumbnails：缩略图生成失败计入 failed', async () => {
    dbStub.getImagesForRebuild.mockReturnValueOnce([
      { id: 'r1', filepath: randomJpg },
      { id: 'r2', filepath: randomJpg },
    ]);
    await expect(call('db:rebuild-thumbnails')).resolves.toEqual({ total: 2, rebuilt: 0, failed: 2 });
    expect(dbStub.getImagesForRebuild).toHaveBeenCalledWith(true);
    expect(workerStub.generateThumbnailTiers).toHaveBeenCalledWith(randomJpg);
  });

  it('db:rebuild-thumbnails：成功生成时写双档缩略图并更新记录', async () => {
    workerStub.generateThumbnailTiers.mockImplementation(async (_fp) => ({
      small: Buffer.from('small-jpg'),
      medium: Buffer.from('medium-jpg'),
      width: 4000,
      height: 2000,
    }));
    // 写回前再核验会重读记录：路径一致才写，缺失即视为陈旧
    dbStub.getImageById.mockImplementation((id) => ({ id, filepath: randomJpg }));
    dbStub.getImagesForRebuild.mockReturnValueOnce([
      { id: 's1', filepath: randomJpg },
      { id: 'b1', filepath: randomJpg },
    ]);
    await expect(call('db:rebuild-thumbnails')).resolves.toEqual({ total: 2, rebuilt: 2, failed: 0 });
    expect(dbStub.updateImageThumbs).toHaveBeenNthCalledWith(1, 's1', {
      thumbnail_path: path.join(THUMBS, 's1.jpg'),
      thumbnail_small_path: path.join(THUMBS, 's1_s.jpg'),
      width: 4000,
      height: 2000,
    });
    expect(dbStub.updateImageThumbs).toHaveBeenNthCalledWith(2, 'b1', {
      thumbnail_path: path.join(THUMBS, 'b1.jpg'),
      thumbnail_small_path: path.join(THUMBS, 'b1_s.jpg'),
      width: 4000,
      height: 2000,
    });
    expect(fs.readFileSync(path.join(THUMBS, 's1.jpg')).toString()).toBe('medium-jpg');
    expect(fs.readFileSync(path.join(THUMBS, 's1_s.jpg')).toString()).toBe('small-jpg');
  });

  it('fs:export-images：跳过 null 记录与缺失文件，仅复制存在的 JPG/NEF', async () => {
    const dest = path.join(TMP_BASE, 'export-1');
    fs.mkdirSync(dest, { recursive: true });
    dbStub.getImageById.mockImplementation((id) => (
      {
        '1': { filename: 'a.jpg', filepath: path.join(FIXTURES, 'a.jpg'), raw_path: path.join(FIXTURES, 'a.nef') },
        '2': { filename: 'b.jpg', filepath: path.join(TMP_BASE, 'missing.jpg'), raw_path: path.join(TMP_BASE, 'missing.nef') },
      }[id] || null
    ));
    const result = await call('fs:export-images', ['1', '2', '3'], dest);
    expect(result).toEqual({ total: 2, copied: 1, nefCopied: 1 });
    expect(fs.readFileSync(path.join(dest, 'a.jpg'), 'utf8')).toBe('A');
    expect(fs.readFileSync(path.join(dest, 'a.nef'), 'utf8')).toBe('RAW-A');
  });

  it('fs:export-images：目标重名时自动加序号后缀', async () => {
    const dest = path.join(TMP_BASE, 'export-2');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'c.jpg'), 'OLD');
    fs.writeFileSync(path.join(dest, 'c.nef'), 'OLD-RAW');
    dbStub.getImageById.mockImplementation((id) => (
      id === 'c'
        ? { filename: 'c.jpg', filepath: path.join(FIXTURES, 'c.jpg'), raw_path: path.join(FIXTURES, 'c.nef') }
        : null
    ));
    const result = await call('fs:export-images', ['c'], dest);
    expect(result).toEqual({ total: 1, copied: 1, nefCopied: 1 });
    expect(fs.readFileSync(path.join(dest, 'c_1.jpg'), 'utf8')).toBe('C');
    expect(fs.readFileSync(path.join(dest, 'c_1.nef'), 'utf8')).toBe('RAW-C');
    expect(fs.readFileSync(path.join(dest, 'c.jpg'), 'utf8')).toBe('OLD');
  });

  it('fs:export-album-images：导出相册图片并统计', async () => {
    const dest = path.join(TMP_BASE, 'export-3');
    fs.mkdirSync(dest, { recursive: true });
    dbStub.getAlbumImages.mockReturnValueOnce([
      { filename: 'a.jpg', filepath: path.join(FIXTURES, 'a.jpg'), raw_path: path.join(FIXTURES, 'a.nef') },
    ]);
    const result = await call('fs:export-album-images', 4, dest);
    expect(result).toEqual({ total: 1, copied: 1, nefCopied: 1 });
    expect(dbStub.getAlbumImages).toHaveBeenCalledWith(4);
  });

  it('fs:export-images：destDir 无效返回错误契约（审查批 6）', async () => {
    await expect(call('fs:export-images', ['1'], '')).resolves.toEqual({ error: expect.stringContaining('导出目标目录无效') });
    await expect(call('fs:export-images', ['1'], null)).resolves.toEqual({ error: expect.stringContaining('导出目标目录无效') });
    await expect(call('fs:export-album-images', 4, 42)).resolves.toEqual({ error: expect.stringContaining('导出目标目录无效') });
  });

  it('fs:export-images：导出名只取 basename，脏 filename 不逃出目标目录（审查批 6 L1 纵深）', async () => {
    const dest = path.join(TMP_BASE, 'export-basename');
    fs.mkdirSync(dest, { recursive: true });
    dbStub.getImageById.mockImplementation((id) => (
      {
        'dirty': { filename: '../../../outside.jpg', filepath: path.join(FIXTURES, 'a.jpg'), raw_path: '' },
        'blank': { filename: '', filepath: path.join(FIXTURES, 'a.jpg'), raw_path: '' },
      }[id] || null
    ));
    const result = await call('fs:export-images', ['dirty', 'blank'], dest);
    expect(result).toEqual({ total: 2, copied: 1, nefCopied: 0 });
    expect(fs.readFileSync(path.join(dest, 'outside.jpg'), 'utf8')).toBe('A');
    expect(fs.existsSync(path.join(TMP_BASE, 'outside.jpg'))).toBe(false);
  });

  it('fs:backup-database：取消保存时返回 success:false', async () => {
    await expect(call('fs:backup-database')).resolves.toEqual({ success: false });
  });

  it('fs:backup-database：备份到目标路径（经在线备份 API）', async () => {
    const backupPath = path.join(TMP_BASE, 'backup.db');
    electronStub.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: backupPath });
    dbStub.backupDatabase.mockImplementationOnce(async (dest) => { fs.copyFileSync(path.join(FIXTURES, 'a.jpg'), dest); });
    await expect(call('fs:backup-database')).resolves.toEqual({ success: true, path: backupPath });
    expect(dbStub.backupDatabase).toHaveBeenCalledWith(backupPath);
    expect(fs.readFileSync(backupPath, 'utf8')).toBe('A');
  });

  it('fs:backup-database：备份失败返回错误信息', async () => {
    electronStub.dialog.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(TMP_BASE, 'backup-fail.db'),
    });
    dbStub.backupDatabase.mockImplementationOnce(async () => { throw new Error('backup boom'); });
    const result = await call('fs:backup-database');
    expect(result.success).toBe(false);
    expect(result.error).toContain('backup boom');
  });
});

describe('对话框与 shell', () => {
  it('dialog:select-directory：取消返回 null', async () => {
    await expect(call('dialog:select-directory')).resolves.toBeNull();
  });

  it('dialog:select-directory：选择时返回第一个路径', async () => {
    electronStub.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:/picked', 'C:/other'] });
    await expect(call('dialog:select-directory')).resolves.toBe('C:/picked');
  });

  it('dialog:select-export-directory：取消返回 null', async () => {
    await expect(call('dialog:select-export-directory')).resolves.toBeNull();
  });

  it('shell:open-path 仅允许打开托管根（图库根/数据库目录）内的目录（审查批 4）', async () => {
    // 根外路径：拒绝且不触达 shell
    await expect(call('shell:open-path', 'C:/some/dir')).resolves.toBe('仅允许打开图库目录');
    // 前缀兄弟目录不得因 startsWith 误放行
    await expect(call('shell:open-path', `${TMP_BASE}-evil`)).resolves.toBe('仅允许打开图库目录');
    expect(electronStub.shell.openPath).not.toHaveBeenCalled();
    // 数据库所在目录 = 托管根：放行
    await expect(call('shell:open-path', TMP_BASE)).resolves.toBe('');
    expect(electronStub.shell.openPath).toHaveBeenCalledWith(TMP_BASE);
    // 根内文件（非目录）拒绝
    fs.writeFileSync(path.join(TMP_BASE, 'notadir.txt'), 'x');
    await expect(call('shell:open-path', path.join(TMP_BASE, 'notadir.txt'))).resolves.toBe('目标不是目录');
    expect(electronStub.shell.openPath).toHaveBeenCalledTimes(1);
  });
});

describe('编辑预览缓存键（任务书第 26 节 cache 行为）', () => {
  const previewPath = () => path.join(THUMBS, 'edit-77.jpg');
  const metaPath = () => path.join(THUMBS, 'edit-77.jpg.meta.json');
  const editImage = () => ({
    id: 77, filename: 'editme.jpg', filepath: path.join(FIXTURES, 'editme.jpg'),
    hidden: 0, raw_path: '', width: 2000, height: 1200,
  });

  beforeEach(() => {
    fs.writeFileSync(path.join(FIXTURES, 'editme.jpg'), 'img');
    fs.mkdirSync(path.join(USER_DATA, 'edit-cache'), { recursive: true });
    fs.writeFileSync(path.join(USER_DATA, 'edit-cache', '77-base.jpg'), 'base'); // hash statSync 需要
    // edits:save 触发 refreshEditPreview 的前置：保存成功 + 图存在 + 有版本
    dbStub.saveEdits.mockReturnValue({ version: 5, params: {} });
    dbStub.getImageById.mockReturnValue(editImage());
    dbStub.getEdits.mockReturnValue({ version: 5, params: {} });
    dbStub.setEditPreviewPath.mockImplementation(() => {});
    dbStub.enforceEditPreviewLimit.mockImplementation(() => 0);
  });

  it('首次保存：无缓存元数据 → 渲染并写入 editVersion/renderVersion', async () => {
    dbStub.getImageById.mockReturnValue(editImage());
    dbStub.getEdits.mockReturnValue({ version: 5, params: {} });
    renderModuleStub.callWorker.mockResolvedValueOnce({ ok: true, width: 400, height: 300 });
    await call('edits:save', 77, { basic: { exposure: 1 } }, { label: 'x' });
    await vi.waitFor(() => {
      expect(renderModuleStub.callWorker).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'edit-preview', requestSeq: expect.any(Number) })
      );
      const meta = JSON.parse(fs.readFileSync(metaPath(), 'utf8'));
      expect(meta.editVersion).toBe(5);
      expect(meta.renderVersion).toBe('render-1');
    });
    expect(fs.existsSync(previewPath())).toBe(false); // stub 不真写盘，但元数据已记录
  });

  it('同版本且预览文件存在 → 缓存命中，跳过渲染且路径不重复写回', async () => {
    dbStub.getImageById.mockReturnValue(editImage());
    dbStub.getEdits.mockReturnValue({ version: 5, params: {} });
    // 预置：预览文件与同版本元数据
    fs.writeFileSync(previewPath(), 'preview');
    fs.writeFileSync(metaPath(), JSON.stringify({ editVersion: 5, renderVersion: 'render-1' }));
    const callsBefore = renderModuleStub.callWorker.mock.calls.length;
    await call('edits:save', 77, { basic: { exposure: 1 } }, { label: 'x' });
    await new Promise((r) => setTimeout(r, 30));
    expect(renderModuleStub.callWorker.mock.calls.length).toBe(callsBefore); // 未重渲染
    expect(dbStub.setEditPreviewPath).not.toHaveBeenCalled(); // 命中路径直接返回，不重复写回
  });

  it('renderer 版本变更 → 缓存失效重新渲染', async () => {
    dbStub.getImageById.mockReturnValue(editImage());
    dbStub.getEdits.mockReturnValue({ version: 5, params: {} });
    fs.writeFileSync(previewPath(), 'preview');
    fs.writeFileSync(metaPath(), JSON.stringify({ editVersion: 5, renderVersion: 'render-OLD' }));
    renderModuleStub.callWorker.mockResolvedValueOnce({ ok: true, width: 400, height: 300 });
    await call('edits:save', 77, { basic: { exposure: 1 } }, { label: 'x' });
    await vi.waitFor(() => {
      expect(renderModuleStub.callWorker).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'edit-preview' })
      );
    });
  });
});

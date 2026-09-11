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
const TMP_BASE = path.join(os.tmpdir(), `pixyang-main-test-${process.pid}`);
const FIXTURES = path.join(TMP_BASE, 'fixtures');
const THUMBS = path.join(TMP_BASE, 'thumbs');
const USER_DATA = path.join(TMP_BASE, 'userData');
const WINDOW_STATE = path.join(USER_DATA, 'window-state.json');

const handlers = new Map();
const winInstances = [];

function makeWindowInstance() {
  const inst = {
    webContents: { send: vi.fn(), openDevTools: vi.fn() },
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
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

function nonEmptyImage(width, height) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: vi.fn(() => ({
      toJPEG: vi.fn(() => Buffer.from('thumbjpg')),
      toPNG: vi.fn(() => Buffer.from('thumbpng')),
    })),
  };
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
  cur += dtB.length;
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
  updateImages: async () => {},
  renameImage: async () => {},
  deleteImage: async () => {},
  batchDeleteImages: async () => {},
  findBrokenRecords: () => [],
  deleteBrokenRecords: async () => [],
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
  closeWorker: vi.fn(async () => {}),
};

require.cache[require.resolve('electron')] = {
  id: 'electron',
  filename: require.resolve('electron'),
  loaded: true,
  exports: electronStub,
};
require.cache[DB_JS] = { id: DB_JS, filename: DB_JS, loaded: true, exports: dbStub };
require.cache[IMAGE_WORKER_JS] = { id: IMAGE_WORKER_JS, filename: IMAGE_WORKER_JS, loaded: true, exports: workerStub };

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

  it('db:scan-broken-records / db:delete-broken-records 委托', async () => {
    const broken = [{ id: 9 }];
    dbStub.findBrokenRecords.mockReturnValueOnce(broken);
    await expect(call('db:scan-broken-records')).resolves.toBe(broken);
    await call('db:delete-broken-records', [9]);
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
    dbStub.getImagesForRebuild.mockReturnValueOnce([
      { id: 's1', filepath: randomJpg },
      { id: 'b1', filepath: randomJpg },
    ]);
    await expect(call('db:rebuild-thumbnails')).resolves.toEqual({ total: 2, rebuilt: 2, failed: 0 });
    expect(dbStub.updateImage).toHaveBeenNthCalledWith(1, 's1', {
      thumbnail_path: path.join(THUMBS, 's1.jpg'),
      thumbnail_small_path: path.join(THUMBS, 's1_s.jpg'),
      width: 4000,
      height: 2000,
    });
    expect(dbStub.updateImage).toHaveBeenNthCalledWith(2, 'b1', {
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

  it('fs:backup-database：取消保存时返回 success:false', async () => {
    await expect(call('fs:backup-database')).resolves.toEqual({ success: false });
  });

  it('fs:backup-database：复制数据库文件到目标路径', async () => {
    const backupPath = path.join(TMP_BASE, 'backup.db');
    electronStub.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: backupPath });
    dbStub.getDatabasePath.mockReturnValueOnce(path.join(FIXTURES, 'a.jpg'));
    await expect(call('fs:backup-database')).resolves.toEqual({ success: true, path: backupPath });
    expect(fs.readFileSync(backupPath, 'utf8')).toBe('A');
  });

  it('fs:backup-database：复制失败返回错误信息', async () => {
    electronStub.dialog.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(TMP_BASE, 'backup-fail.db'),
    });
    dbStub.getDatabasePath.mockReturnValueOnce(path.join(TMP_BASE, 'no-such.db'));
    const result = await call('fs:backup-database');
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
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

  it('shell:open-path 委托 shell.openPath', async () => {
    await expect(call('shell:open-path', 'C:/some/dir')).resolves.toBe('');
    expect(electronStub.shell.openPath).toHaveBeenCalledWith('C:/some/dir');
  });
});

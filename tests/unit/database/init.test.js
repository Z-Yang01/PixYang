import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const TMP_ROOT = path.join(os.tmpdir(), `pixyang-test-db-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

const nodeRequire = createRequire(import.meta.url);
const electronId = nodeRequire.resolve('electron');
nodeRequire.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: {
    app: {
      getPath: (name) => path.join(globalThis.__PIXYANG_TEST_TMP_ROOT__, name === 'userData' ? 'userdata' : name),
    },
  },
};

globalThis.__PIXYANG_TEST_TMP_ROOT__ = TMP_ROOT;

const db = (await import('../../../electron/database.js')).default;

afterEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 700));
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  delete nodeRequire.cache[electronId];
  delete globalThis.__PIXYANG_TEST_TMP_ROOT__;
});

beforeAll(async () => {
  await db.initDatabase();
});

describe('initDatabase 初始化与基础路径', () => {
  it('默认设置被写入', () => {
    expect(db.getSetting('theme')).toBe('dark');
    expect(db.getSetting('images_root')).toBe('');
    expect(db.getSetting('camera_folder')).toBe('');
    expect(db.getSetting('db_path')).toBe('');
    expect(db.getSetting('grid_rows')).toBe('3');
    expect(db.getSetting('grid_columns')).toBe('5');
    expect(db.getSetting('grid_gap')).toBe('12');
    expect(db.getSetting('content_padding')).toBe('16');
    expect(db.getSetting('orientation_backfilled')).toBe('false');
    expect(db.getSetting('sort_by')).toBe('import_date');
    expect(db.getSetting('sort_order')).toBe('DESC');
    const all = db.getAllSettings();
    expect(Object.keys(all)).toEqual(expect.arrayContaining([
      'theme', 'images_root', 'camera_folder', 'db_path',
      'grid_rows', 'grid_columns', 'grid_gap', 'content_padding',
      'orientation_backfilled', 'sort_by', 'sort_order',
    ]));
  });

  it('getDatabasePath 指向临时 userData 目录', () => {
    expect(db.getDatabasePath()).toBe(path.join(TMP_ROOT, 'userdata', 'pixyang.db'));
  });

  it('getImagesRoot 指向临时目录并自动创建', () => {
    const root = db.getImagesRoot();
    expect(root).toBe(path.join(TMP_ROOT, 'userdata', 'images'));
    expect(fs.existsSync(root)).toBe(true);
  });

  it('getThumbnailFilePath 指向 thumbnails 目录', () => {
    const p = db.getThumbnailFilePath(42);
    expect(path.dirname(p)).toBe(path.join(TMP_ROOT, 'userdata', 'thumbnails'));
    expect(path.basename(p)).toBe('42.jpg');
  });

  it('deleteThumbnailFile 删除文件且重复调用不抛错', () => {
    const p = db.getThumbnailFilePath(7);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'thumb');
    db.deleteThumbnailFile(7);
    expect(fs.existsSync(p)).toBe(false);
    expect(() => db.deleteThumbnailFile(7)).not.toThrow();
  });

  it('getImageSubDir 正常日期转换与回退今天', () => {
    expect(db.getImageSubDir('2026-09-09')).toBe(path.join('2026', '09', '09'));
    const now = new Date();
    const today = path.join(
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    );
    expect(db.getImageSubDir('invalid')).toBe(today);
  });

  it('ensureDir 递归创建目录', () => {
    const deep = path.join(TMP_ROOT, 'deep', 'a', 'b');
    db.ensureDir(deep);
    expect(fs.existsSync(deep)).toBe(true);
  });

  it('generateUniqueFilename 冲突时递增后缀', () => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'uniq-'));
    expect(db.generateUniqueFilename(dir, 'a.jpg')).toBe('a.jpg');
    fs.writeFileSync(path.join(dir, 'a.jpg'), 'x');
    expect(db.generateUniqueFilename(dir, 'a.jpg')).toBe('a_1.jpg');
    fs.writeFileSync(path.join(dir, 'a_1.jpg'), 'x');
    expect(db.generateUniqueFilename(dir, 'a.jpg')).toBe('a_2.jpg');
  });

  it('setSetting/getSetting/getAllSettings 读写设置', () => {
    db.setSetting('my-key', 'v1');
    expect(db.getSetting('my-key')).toBe('v1');
    db.setSetting('my-key', 'v2');
    expect(db.getSetting('my-key')).toBe('v2');
    expect(db.getSetting('no-such-key')).toBe(null);
    expect(db.getAllSettings()['my-key']).toBe('v2');
  });

  it('空库 getStats 全为 0', () => {
    expect(db.getStats()).toEqual({ totalImages: 0, totalTags: 0, totalAlbums: 0, favorites: 0 });
  });

  it('saveDatabase 防抖后落盘到数据库文件', async () => {
    fs.mkdirSync(path.dirname(db.getDatabasePath()), { recursive: true });
    db.saveDatabase();
    await new Promise((r) => setTimeout(r, 700));
    expect(fs.existsSync(db.getDatabasePath())).toBe(true);
  });
});

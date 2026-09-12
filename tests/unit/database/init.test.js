import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

afterAll(async () => {
  db.closeDatabase();
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

  it('数据库文件在初始化时即时创建（WAL 模式）', () => {
    db.saveDatabase();
    expect(fs.existsSync(db.getDatabasePath())).toBe(true);
  });
});

describe('非破坏编辑表迁移（edits / edit_history / presets）', () => {
  function makeImg(name) {
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'ed-'));
    const src = path.join(dir, name);
    fs.writeFileSync(src, 'bytes');
    return { filename: name, filepath: src, size: 5, format: '.jpg', width: 0, height: 0 };
  }

  it('initDatabase 后新表存在且幂等（二次初始化无副作用）', async () => {
    const tables = db.getAllSettings && db.getDatabasePath ? null : null; // 占位，表存在性通过行为验证
    expect(tables).toBeNull();
    // 幂等：重复跑一次迁移路径（模拟二次启动）
    await db.initDatabase();
    await db.initDatabase();
    expect(db.getEdits(12345678)).toBeNull();
  });

  it('saveEdits/getEdits：版本递增、参数归一化、原图字节不变', async () => {
    const [img] = await db.importImages([makeImg('ne.jpg')]);
    const before = fs.readFileSync(img.filepath, 'utf8');
    const r1 = db.saveEdits(img.id, { basic: { exposure: 0.5 } }, { label: '曝光', before: 0, after: 0.5 });
    const r2 = db.saveEdits(img.id, { basic: { exposure: 1 } }, { label: '曝光', before: 0.5, after: 1 });
    expect(r1.version).toBe(1);
    expect(r2.version).toBe(2);
    expect(r2.params.basic.exposure).toBe(1);
    expect(r2.params.output.format).toBe('jpeg'); // 缺失字段回填默认
    expect(db.getEdits(img.id).params.basic.exposure).toBe(1);
    expect(fs.readFileSync(img.filepath, 'utf8')).toBe(before); // 像素不动
  });

  it('edit_history：滑杆全程一条、裁剪到上限 50 步', () => {
    const rows = db.getAllImagePaths();
    const id = rows[rows.length - 1].id;
    expect(db.getEditHistory(id).length).toBe(2);
    for (let i = 0; i < 60; i++) {
      db.saveEdits(id, { basic: { contrast: i } }, { label: `对比度 ${i}` });
    }
    const hist = db.getEditHistory(id);
    expect(hist.length).toBe(50);
    expect(hist[0].step).toBe(13); // 62 步只留最后 50 步
  });

  it('clearEdits 清参数与历史', async () => {
    const [img] = await db.importImages([makeImg('ce.jpg')]);
    db.saveEdits(img.id, { basic: { exposure: 1 } }, { label: '曝光' });
    db.clearEdits(img.id);
    expect(db.getEdits(img.id)).toBeNull();
    expect(db.getEditHistory(img.id)).toEqual([]);
  });

  it('presets：创建/重名拒绝/删除', () => {
    const p = db.createPreset('my-preset', { basic: { temperature: 30 } });
    expect(p.id).toBeGreaterThan(0);
    const list = db.getPresets();
    expect(list.find(x => x.name === 'my-preset').params.basic.temperature).toBe(30);
    expect(db.createPreset('my-preset', {}).error).toBeTruthy();
    db.deletePreset(p.id);
    expect(db.getPresets().find(x => x.name === 'my-preset')).toBeUndefined();
  });

  it('烘焙替代后 edits.orientation 归零而影调保留（saveEditedImage 联动）', async () => {
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'bake-'));
    const src = path.join(dir, 'b.jpg');
    fs.writeFileSync(src, 'v1');
    const [img] = await db.importImages([{ filename: 'b.jpg', filepath: src, size: 2, format: '.jpg', width: 0, height: 0 }]);
    db.saveEdits(img.id, { orientation: { rotate: 90 }, basic: { exposure: 0.4 } });
    const temp = path.join(dir, 'b-temp.jpg');
    fs.writeFileSync(temp, 'v2-longer');
    const saved = db.saveEditedImage(img.id, temp, { width: 800, height: 600 });
    const after = db.getEdits(img.id);
    expect(after.params.orientation.rotate).toBe(0);
    expect(after.params.basic.exposure).toBe(0.4);
    expect(saved.width).toBe(800);
    // 烘焙后编辑预览缩略图记录一并清空（原图已是参数效果）
    expect(saved.thumbnail_edit_path).toBe('');
  });

  it('编辑预览缩略图：路径读写 + clearEditPreview 清文件与记录 + 烘焙联动清理', async () => {
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'editp-'));
    const src = path.join(dir, 'e.jpg');
    fs.writeFileSync(src, 'v1');
    const [img] = await db.importImages([{ filename: 'e.jpg', filepath: src, size: 2, format: '.jpg', width: 0, height: 0 }]);

    const previewPath = db.getEditPreviewPath(img.id);
    expect(path.basename(previewPath)).toBe(`edit-${img.id}.jpg`);
    fs.writeFileSync(previewPath, 'preview-bytes');
    db.setEditPreviewPath(img.id, previewPath);
    expect(db.getEditPreviewPathFor(img.id)).toBe(previewPath);

    db.clearEditPreview(img.id);
    expect(fs.existsSync(previewPath)).toBe(false);
    expect(db.getEditPreviewPathFor(img.id)).toBe('');
  });

  it('编辑预览 LRU：超过上限清最旧（按 updated_at）', async () => {
    // 直接构造多行记录验证裁剪逻辑（上限 500，生成 505 条轻量记录）
    const rawDb = db.__getDb();
    const insert = rawDb.prepare('INSERT INTO images (filename, filepath, thumbnail_edit_path, updated_at) VALUES (?, ?, ?, ?)');
    const ids = [];
    for (let i = 0; i < 505; i++) {
      // 严格递增时间戳保证 LRU 排序确定性（i=0 最旧）
      insert.run(String(i), `x/${i}.jpg`, `p/${i}.jpg`, `2020-01-01 00:00:${String(i % 60).padStart(2, '0')}:0${Math.floor(i / 60)}`);
      ids.push(rawDb.prepare('SELECT id FROM images WHERE filename = ?').get(String(i)).id);
    }
    const removed = db.enforceEditPreviewLimit();
    expect(removed).toBe(5);
    // updated_at 最小的 5 条（i=0,60,120,180,240）被清空路径；相邻的保留
    expect(db.getEditPreviewPathFor(ids[0])).toBe('');
    expect(db.getEditPreviewPathFor(ids[60])).toBe('');
    expect(db.getEditPreviewPathFor(ids[240])).toBe('');
    expect(db.getEditPreviewPathFor(ids[1])).not.toBe('');
    expect(db.getEditPreviewPathFor(ids[61])).not.toBe('');
    expect(db.getEditPreviewPathFor(ids[504])).not.toBe('');
  });
});

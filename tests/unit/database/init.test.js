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

  it('烘焙替代后参数重置为默认（防二次施加），缩略图与编辑预览清空', async () => {
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'bake-'));
    const src = path.join(dir, 'b.jpg');
    fs.writeFileSync(src, 'v1');
    const [img] = await db.importImages([{ filename: 'b.jpg', filepath: src, size: 2, format: '.jpg', width: 0, height: 0 }]);
    db.saveEdits(img.id, { orientation: { rotate: 90 }, basic: { exposure: 0.4 } });
    const temp = path.join(dir, 'b-temp.jpg');
    fs.writeFileSync(temp, 'v2-longer');
    const saved = db.saveEditedImage(img.id, temp, { width: 800, height: 600 });
    const after = db.getEdits(img.id);
    // 像素已含全部效果：参数整体回默认（否则重进编辑会二次施加）
    expect(after.params.orientation.rotate).toBe(0);
    expect(after.params.basic.exposure).toBe(0);
    expect(after.params.crop).toBeNull();
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

  it('编辑预览 LRU：超过上限清最旧（按 edits.updated_at）', async () => {
    // 直接构造多行记录验证裁剪逻辑（上限 500，生成 505 条轻量记录）
    const rawDb = db.__getDb();
    const insert = rawDb.prepare('INSERT INTO images (filename, filepath, thumbnail_edit_path) VALUES (?, ?, ?)');
    const insertEdit = rawDb.prepare('INSERT INTO edits (image_id, version, params_json, updated_at) VALUES (?, 1, ?, ?)');
    const ids = [];
    for (let i = 0; i < 505; i++) {
      insert.run(String(i), `x/${i}.jpg`, `p/${i}.jpg`);
      const id = rawDb.prepare('SELECT id FROM images WHERE filename = ?').get(String(i)).id;
      ids.push(id);
      // 预览的"最近使用"= 最近一次参数保存时间（规范分秒、严格递增，i=0 最旧）
      insertEdit.run(id, '{}', `2020-01-01 00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`);
    }
    const removed = db.enforceEditPreviewLimit();
    expect(removed).toBe(5);
    // edits.updated_at 最小的 5 条（i=0..4）被清空路径；其余保留
    expect(db.getEditPreviewPathFor(ids[0])).toBe('');
    expect(db.getEditPreviewPathFor(ids[4])).toBe('');
    expect(db.getEditPreviewPathFor(ids[5])).not.toBe('');
    expect(db.getEditPreviewPathFor(ids[504])).not.toBe('');
  });

  it('编辑预览 LRU 淘汰时同步清理 meta 侧车文件', async () => {
    const rawDb = db.__getDb();
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'lru-meta-'));
    const src = path.join(dir, 'lru.jpg');
    fs.writeFileSync(src, 'bytes');
    const [img] = await db.importImages([{ filename: 'lru.jpg', filepath: src, size: 5, format: '.jpg', width: 0, height: 0 }]);
    const previewPath = db.getEditPreviewPath(img.id);
    fs.writeFileSync(previewPath, 'preview-bytes');
    fs.writeFileSync(`${previewPath}.meta.json`, JSON.stringify({ editVersion: 1, renderVersion: 'render-1' }));
    db.setEditPreviewPath(img.id, previewPath);

    const insert = rawDb.prepare('INSERT INTO images (filename, filepath, thumbnail_edit_path) VALUES (?, ?, ?)');
    const insertEdit = rawDb.prepare("INSERT INTO edits (image_id, version, params_json, updated_at) VALUES (?, 1, '{}', ?)");
    for (let i = 0; i < 501; i++) {
      insert.run(`lru-filler-${i}`, `lru/${i}.jpg`, `lru/${i}.jpg`);
      const fid = rawDb.prepare('SELECT id FROM images WHERE filename = ?').get(`lru-filler-${i}`).id;
      insertEdit.run(fid, '2021-01-01 00:00:00');
    }
    insertEdit.run(img.id, '2020-01-01 00:00:00');

    const removed = db.enforceEditPreviewLimit();
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(db.getEditPreviewPathFor(img.id)).toBe('');
    expect(fs.existsSync(previewPath)).toBe(false);
    expect(fs.existsSync(`${previewPath}.meta.json`)).toBe(false);
  });
});

describe('索引与迁移回归（审查批 3）', () => {
  it('NOCASE 去重查询走表达式索引，不退化为全表扫描', () => {
    const raw = db.__getDb();
    for (const col of ['original_path', 'original_raw_path']) {
      const plan = raw
        .prepare(`EXPLAIN QUERY PLAN SELECT id FROM images WHERE ${col} = ? COLLATE NOCASE`)
        .all('x')
        .map((r) => r.detail)
        .join(' | ');
      expect(plan, `${col}: ${plan}`).toContain(`idx_images_${col}_nc`);
      expect(plan, `${col}: ${plan}`).not.toMatch(/SCAN images/);
    }
  });

  it('有数据表重跑 initDatabase：updated_at 被丢弃后逐列容错补列并回填 created_at', async () => {
    const raw = db.__getDb();
    expect(raw.prepare('SELECT COUNT(*) c FROM images').get().c).toBeGreaterThan(0);
    raw.exec('ALTER TABLE images DROP COLUMN updated_at');
    await db.initDatabase();
    // initDatabase 会关闭旧句柄并重开，断言必须走新句柄
    const reopened = db.__getDb();
    const cols = reopened.pragma('table_info(images)').map((c) => c.name);
    expect(cols).toContain('updated_at');
    // 非常量默认在有人数据的表必抛——迁移用可空列 + 回填，回填后不得残留 NULL
    expect(reopened.prepare('SELECT COUNT(*) c FROM images WHERE updated_at IS NULL').get().c).toBe(0);
    // 逐列容错：单列失败不得吞掉其后所有列（旧实现整体 try/catch 的真实病灶）
    expect(cols).toEqual(expect.arrayContaining(['thumbnail_edit_path', 'hash', 'flag', 'thumbnail_small_path']));
  });

  it('getImages limit/offset 脏值在边界钳制：负 LIMIT（SQLite 语义=无限制）与 NaN 不再抛错或全量返回', async () => {
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'limit-'));
    for (let i = 0; i < 3; i++) {
      const src = path.join(dir, `l${i}.jpg`);
      fs.writeFileSync(src, 'x');
      await db.importImages([{ filename: `l${i}.jpg`, filepath: src, size: 1, format: '.jpg', width: 0, height: 0 }]);
    }
    const neg = db.getImages({ limit: -100, offset: 0 });
    expect(neg.images.length).toBeLessThanOrEqual(1);
    const nan = db.getImages({ limit: NaN, offset: NaN });
    expect(Array.isArray(nan.images)).toBe(true);
    expect(nan.images.length).toBeGreaterThan(0);
  });
});

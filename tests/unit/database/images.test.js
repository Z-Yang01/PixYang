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

function ensureTmpRoot() {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
}

function writeFile(filePath, content) {
  ensureTmpRoot();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function makeImage(name, dir, content = 'data') {
  const filepath = path.join(dir, name);
  writeFile(filepath, content);
  return {
    filename: name,
    filepath,
    size: Buffer.byteLength(content),
    format: path.extname(name),
    width: 0,
    height: 0,
  };
}

function tmpDir(tag) {
  ensureTmpRoot();
  return fs.mkdtempSync(path.join(TMP_ROOT, `${tag}-`));
}

function getIds(result) {
  return result.images.map((i) => i.id);
}

let hiddenNefId = null;

afterAll(() => {
  db.closeDatabase();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  delete nodeRequire.cache[electronId];
  delete globalThis.__PIXYANG_TEST_TMP_ROOT__;
});

beforeAll(async () => {
  await db.initDatabase();
});

describe('importImages 导入', () => {
  it('同目录同主名 jpg+nef 配对导入', async () => {
    const dir = tmpDir('pair');
    const jpg = makeImage('photo1.jpg', dir, 'jpgbytes');
    const nef = makeImage('photo1.nef', dir, 'nefbytes');
    const imported = await db.importImages([jpg, nef]);
    expect(imported).toHaveLength(1);
    const row = imported[0];
    expect(row.hidden).toBe(0);
    expect(row.original_path).toBe(jpg.filepath);
    expect(row.raw_path).not.toBe('');
    expect(row.original_raw_path).toBe(nef.filepath);
    expect(fs.existsSync(row.filepath)).toBe(true);
    expect(fs.existsSync(row.raw_path)).toBe(true);
    expect(path.dirname(row.raw_path)).toBe(path.dirname(row.filepath));
    expect(path.basename(row.raw_path, '.nef')).toBe(path.basename(row.filepath, '.jpg'));
    expect(row.import_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row.taken_at).toBe('');
  });

  it('NEF 复制失败：raw_path 与 original_raw_path 均不落库（防相机同步去重跳过重试）', async () => {
    const dir = tmpDir('neffail');
    const jpg = makeImage('fail1.jpg', dir, 'jpgbytes');
    const nef = makeImage('fail1.nef', dir, 'nefbytes');
    fs.unlinkSync(nef.filepath);
    const imported = await db.importImages([jpg, nef]);
    expect(imported).toHaveLength(1);
    const row = imported[0];
    expect(row.raw_path).toBe('');
    // 修复前：catch 清空被随后的无条件赋值覆盖，original_raw_path 仍指向未复制成功的源 NEF
    expect(row.original_raw_path).toBe('');
    expect(fs.existsSync(row.filepath)).toBe(true);
  });

  it('无 jpg 配对的 nef 作为隐藏记录导入', async () => {
    const dir = tmpDir('lone');
    const nef = makeImage('solo.nef', dir, 'rawonly');
    const imported = await db.importImages([nef]);
    expect(imported).toHaveLength(1);
    expect(imported[0].hidden).toBe(1);
    expect(imported[0].raw_path).toBe('');
    expect(imported[0].original_raw_path).toBe('');
    expect(fs.existsSync(imported[0].filepath)).toBe(true);
    hiddenNefId = imported[0].id;
  });

  it('重复 original_path 去重并自动补充配对 NEF', async () => {
    const dir = tmpDir('dedup');
    const jpg = makeImage('attach.jpg', dir, 'attachjpg');
    const first = await db.importImages([jpg]);
    expect(first).toHaveLength(1);
    expect(first[0].raw_path).toBe('');
    const nef = makeImage('attach.nef', dir, 'attachnef');
    const withRaw = { ...jpg, raw_source: nef.filepath, raw_filename: 'attach.nef' };
    const second = await db.importImages([withRaw]);
    expect(second).toHaveLength(0);
    const rec = db.getImageById(first[0].id);
    expect(rec.raw_path).not.toBe('');
    expect(fs.existsSync(rec.raw_path)).toBe(true);
    expect(rec.original_raw_path).toBe(nef.filepath);
    expect(path.dirname(rec.raw_path)).toBe(path.dirname(rec.filepath));
    const third = await db.importImages([withRaw]);
    expect(third).toHaveLength(0);
    expect(db.getImageById(first[0].id).raw_path).toBe(rec.raw_path);
  });
});

describe('getImages 查询', () => {
  it('hidden 记录不出现在图库查询中', () => {
    const result = db.getImages({ limit: 100000 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.images.every((i) => i.hidden === 0)).toBe(true);
    expect(getIds(result)).not.toContain(hiddenNefId);
  });

  it('分页 limit/offset 与 total', async () => {
    const dir = tmpDir('page');
    const files = [];
    for (let i = 0; i < 5; i++) files.push({ ...makeImage(`pg-${i}.jpg`, dir, `pg${i}`), importDate: '2031-06-15' });
    await db.importImages(files);
    const p1 = db.getImages({ importDate: '2031-06-15', limit: 2, offset: 0 });
    expect(p1.total).toBe(5);
    expect(p1.images).toHaveLength(2);
    const p3 = db.getImages({ importDate: '2031-06-15', limit: 2, offset: 4 });
    expect(p3.images).toHaveLength(1);
    expect(p3.total).toBe(5);
    const p4 = db.getImages({ importDate: '2031-06-15', limit: 2, offset: 10 });
    expect(p4.images).toHaveLength(0);
    const all = db.getImages({ importDate: '2031-06-15', limit: 100 });
    expect(all.images.map((i) => i.filename).sort()).toEqual([
      'pg-0.jpg', 'pg-1.jpg', 'pg-2.jpg', 'pg-3.jpg', 'pg-4.jpg',
    ]);
  });

  it('favorite 筛选', async () => {
    const dir = tmpDir('fav');
    const [a] = await db.importImages([{ ...makeImage('fav-a.jpg', dir, 'fa'), importDate: '2032-02-02' }]);
    const [b] = await db.importImages([{ ...makeImage('fav-b.jpg', dir, 'fb'), importDate: '2032-02-02' }]);
    await db.updateImage(a.id, { favorite: 1 });
    const result = db.getImages({ importDate: '2032-02-02', favorite: true, limit: 100 });
    expect(result.total).toBe(1);
    expect(result.images[0].id).toBe(a.id);
    expect(result.images[0].favorite).toBe(1);
    expect(b.id).not.toBe(a.id);
  });

  it('search 匹配 filename/notes/标签名', async () => {
    const dir = tmpDir('srch');
    const [s1] = await db.importImages([{ ...makeImage('zsearch-alpha.jpg', dir, 's1'), importDate: '2035-01-01' }]);
    const [s2] = await db.importImages([{ ...makeImage('zsearch-beta.jpg', dir, 's2'), importDate: '2035-01-01' }]);
    const [s3] = await db.importImages([{ ...makeImage('zsearch-gamma.jpg', dir, 's3'), importDate: '2035-01-01' }]);
    await db.updateImage(s2.id, { notes: 'magicword-note' });
    const tag = db.createTag('magicword-tag');
    db.addTagToImage(s3.id, tag.id);
    const byName = db.getImages({ search: 'zsearch-alpha', limit: 100 });
    expect(byName.total).toBe(1);
    expect(byName.images[0].id).toBe(s1.id);
    const byNotes = db.getImages({ search: 'magicword-note', limit: 100 });
    expect(byNotes.total).toBe(1);
    expect(byNotes.images[0].id).toBe(s2.id);
    const byTag = db.getImages({ search: 'magicword-tag', limit: 100 });
    expect(byTag.total).toBe(1);
    expect(byTag.images[0].id).toBe(s3.id);
  });

  it('tagId 与 albumId 筛选', async () => {
    const pgList = db.getImages({ importDate: '2031-06-15', limit: 100 });
    const tag = db.createTag('filter-tag-x');
    const target = pgList.images[0];
    db.addTagToImage(target.id, tag.id);
    const byTag = db.getImages({ tagId: tag.id, limit: 100 });
    expect(byTag.total).toBe(1);
    expect(byTag.images[0].id).toBe(target.id);
    const album = db.createAlbum('filter-alb-x');
    const other = pgList.images[1];
    db.addToAlbum(album.id, [other.id]);
    const byAlbum = db.getImages({ albumId: album.id, limit: 100 });
    expect(byAlbum.total).toBe(1);
    expect(byAlbum.images[0].id).toBe(other.id);
  });

  it('dateFrom/dateTo 范围与 importDate 精确筛选', async () => {
    const dir = tmpDir('range');
    await db.importImages([
      { ...makeImage('range-a.jpg', dir, 'ra'), importDate: '2036-01-01' },
      { ...makeImage('range-b.jpg', dir, 'rb'), importDate: '2036-01-03' },
    ]);
    const ranged = db.getImages({ dateFrom: '2036-01-01', dateTo: '2036-01-02', limit: 100 });
    expect(ranged.total).toBe(1);
    expect(ranged.images[0].filename).toBe('range-a.jpg');
    const exact = db.getImages({ importDate: '2036-01-03', limit: 100 });
    expect(exact.total).toBe(1);
    expect(exact.images[0].filename).toBe('range-b.jpg');
  });

  it('排序 taken_at 优先于 import_date', async () => {
    const dir = tmpDir('sort');
    const [a] = await db.importImages([{ ...makeImage('sort-a.jpg', dir, 'sa'), importDate: '2030-03-01', takenAt: '2030-01-02 10:00' }]);
    const [b] = await db.importImages([{ ...makeImage('sort-b.jpg', dir, 'sb'), importDate: '2030-01-01' }]);
    const [c] = await db.importImages([{ ...makeImage('sort-c.jpg', dir, 'sc'), importDate: '2030-05-01', takenAt: '2030-01-01 09:00' }]);
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(c.id).toBeTruthy();
    const asc = db.getImages({ dateFrom: '2030-01-01', dateTo: '2030-12-31', sortBy: 'import_date', sortOrder: 'ASC', limit: 100 });
    const ascNames = asc.images.map((i) => i.filename);
    expect(ascNames.indexOf('sort-b.jpg')).toBeLessThan(ascNames.indexOf('sort-c.jpg'));
    expect(ascNames.indexOf('sort-c.jpg')).toBeLessThan(ascNames.indexOf('sort-a.jpg'));
    const desc = db.getImages({ dateFrom: '2030-01-01', dateTo: '2030-12-31', sortBy: 'import_date', sortOrder: 'DESC', limit: 100 });
    const descNames = desc.images.map((i) => i.filename);
    expect(descNames.indexOf('sort-a.jpg')).toBeLessThan(descNames.indexOf('sort-c.jpg'));
    expect(descNames.indexOf('sort-c.jpg')).toBeLessThan(descNames.indexOf('sort-b.jpg'));
  });

  it('sortBy filename 与非法字段回退', async () => {
    const dir = tmpDir('srt2');
    await db.importImages([
      { ...makeImage('fname-c.jpg', dir, 'fc'), importDate: '2037-01-01' },
      { ...makeImage('fname-a.jpg', dir, 'fa2'), importDate: '2037-01-01' },
      { ...makeImage('fname-b.jpg', dir, 'fb2'), importDate: '2037-01-01' },
    ]);
    const byName = db.getImages({ importDate: '2037-01-01', sortBy: 'filename', sortOrder: 'ASC', limit: 100 });
    expect(byName.images.map((i) => i.filename)).toEqual(['fname-a.jpg', 'fname-b.jpg', 'fname-c.jpg']);
    const fallback = db.getImages({ importDate: '2037-01-01', sortBy: 'evil); DROP TABLE images; --', limit: 100 });
    expect(fallback.total).toBe(3);
  });
});

describe('updateImage 更新', () => {
  it('rating/favorite/notes/尺寸更新', async () => {
    const dir = tmpDir('upd1');
    const [img] = await db.importImages([makeImage('upd-a.jpg', dir, 'ua')]);
    expect(await db.updateImage(img.id, { rating: 5, favorite: 1, notes: 'nice', width: 800, height: 600, rotation: 90 })).toBe(true);
    const rec = db.getImageById(img.id);
    expect(rec.rating).toBe(5);
    expect(rec.favorite).toBe(1);
    expect(rec.notes).toBe('nice');
    expect(rec.width).toBe(800);
    expect(rec.height).toBe(600);
    expect(rec.rotation).toBe(90);
  });

  it('flipH/flipV 自动映射 flip_h/flip_v', async () => {
    const dir = tmpDir('upd2');
    const [img] = await db.importImages([makeImage('upd-b.jpg', dir, 'ub')]);
    await db.updateImage(img.id, { flipH: 1, flipV: 1 });
    const rec = db.getImageById(img.id);
    expect(rec.flip_h).toBe(1);
    expect(rec.flip_v).toBe(1);
  });

  it('空更新与未知字段安全返回', async () => {
    const dir = tmpDir('upd3');
    const [img] = await db.importImages([makeImage('upd-c.jpg', dir, 'uc')]);
    expect(await db.updateImage(img.id, {})).toBe(true);
    expect(await db.updateImage(img.id, { hacker: 'x' })).toBe(true);
    expect(db.getImageById(img.id).hacker).toBeUndefined();
  });

  it('import_date 变更移动 JPG 与配对 NEF 到新日期目录', async () => {
    const dir = tmpDir('movedate');
    const jpg = makeImage('mvdate.jpg', dir, 'm1');
    const nef = makeImage('mvdate.nef', dir, 'm2');
    const [img] = await db.importImages([jpg, nef]);
    const oldFilepath = img.filepath;
    const oldRawPath = img.raw_path;
    expect(await db.updateImage(img.id, { import_date: '2033-05-05' })).toBe(true);
    const rec = db.getImageById(img.id);
    expect(rec.import_date).toBe('2033-05-05');
    expect(rec.filepath).toContain(path.join('2033', '05', '05'));
    expect(rec.filename).toBe(path.basename(rec.filepath));
    expect(fs.existsSync(rec.filepath)).toBe(true);
    expect(fs.existsSync(oldFilepath)).toBe(false);
    expect(rec.raw_path).not.toBe('');
    expect(path.dirname(rec.raw_path)).toBe(path.dirname(rec.filepath));
    expect(path.basename(rec.raw_path, '.nef')).toBe(path.basename(rec.filepath, '.jpg'));
    expect(fs.existsSync(rec.raw_path)).toBe(true);
    expect(fs.existsSync(oldRawPath)).toBe(false);
  });

  it('import_date 未变化时不移动文件', async () => {
    const dir = tmpDir('movedate2');
    const [img] = await db.importImages([{ ...makeImage('stay.jpg', dir, 'st'), importDate: '2034-04-04' }]);
    const before = db.getImageById(img.id).filepath;
    await db.updateImage(img.id, { import_date: '2034-04-04' });
    const rec = db.getImageById(img.id);
    expect(rec.filepath).toBe(before);
    expect(fs.existsSync(before)).toBe(true);
  });
});

describe('renameImage 重命名', () => {
  it('重命名文件与配对 NEF 同步', async () => {
    const dir = tmpDir('rn1');
    const jpg = makeImage('rename-old.jpg', dir, 'r1');
    const nef = makeImage('rename-old.nef', dir, 'r2');
    const [img] = await db.importImages([jpg, nef]);
    const res = db.renameImage(img.id, 'rename-new.jpg');
    expect(res).toEqual({
      success: true,
      newFilename: 'rename-new.jpg',
      newPath: path.join(path.dirname(img.filepath), 'rename-new.jpg'),
    });
    expect(fs.existsSync(res.newPath)).toBe(true);
    expect(fs.existsSync(img.filepath)).toBe(false);
    const rec = db.getImageById(img.id);
    expect(rec.filename).toBe('rename-new.jpg');
    expect(rec.filepath).toBe(res.newPath);
    expect(path.basename(rec.raw_path)).toBe('rename-new.nef');
    expect(fs.existsSync(rec.raw_path)).toBe(true);
    expect(fs.existsSync(img.raw_path)).toBe(false);
  });

  it('重名文件返回错误且不改动', async () => {
    const dir = tmpDir('rn2');
    const [img] = await db.importImages([makeImage('clash-src.jpg', dir, 'c1')]);
    const clashPath = path.join(path.dirname(img.filepath), 'clash.jpg');
    fs.writeFileSync(clashPath, 'existing');
    const res = db.renameImage(img.id, 'clash.jpg');
    expect(res).toEqual({ error: '同名文件已存在' });
    const rec = db.getImageById(img.id);
    expect(rec.filename).toBe('clash-src.jpg');
    expect(fs.existsSync(rec.filepath)).toBe(true);
    expect(fs.readFileSync(clashPath, 'utf8')).toBe('existing');
  });

  it('不存在的图片 id 返回 false', () => {
    expect(db.renameImage(99999999, 'x.jpg')).toBe(false);
  });

  it('文件名含路径分量或非法字符时拒绝', () => {
    expect(db.renameImage(1, '../evil.jpg').error).toBeTruthy();
    expect(db.renameImage(1, 'a/b.jpg').error).toBeTruthy();
    expect(db.renameImage(1, 'a\b.jpg').error).toBeTruthy();
    expect(db.renameImage(1, '..').error).toBeTruthy();
  });

  it('NEF 跟随改名失败时回滚 JPG 改名（不留 broken 记录）', async () => {
    const dir = tmpDir('rn3');
    const jpg = makeImage('roll-old.jpg', dir, 'r1');
    const nef = makeImage('roll-old.nef', dir, 'r2');
    const [img] = await db.importImages([jpg, nef]);
    fs.unlinkSync(img.raw_path); // raw_path 指向已消失的 NEF → 跟随改名 ENOENT
    const res = db.renameImage(img.id, 'roll-new.jpg');
    expect(res.error).toBeTruthy();
    const rec = db.getImageById(img.id);
    expect(rec.filename).toBe('roll-old.jpg'); // 回滚后记录保持原名
    expect(rec.filepath).toBe(img.filepath);
    expect(fs.existsSync(img.filepath)).toBe(true); // JPG 已被改回原位
    expect(fs.existsSync(path.join(path.dirname(img.filepath), 'roll-new.jpg'))).toBe(false);
  });
});

describe('deleteImage / batchDeleteImages / updateImages', () => {
  it('updateImages 超过 900 张（SQLite 变量上限）分块成功不抛错', { timeout: 60000 }, async () => {
    const dir = tmpDir('bulk');
    const files = [];
    for (let i = 0; i < 901; i++) {
      files.push(makeImage(`bulk-${i}.jpg`, dir, `v${i}`));
    }
    const rows = await db.importImages(files);
    expect(rows.length).toBe(901);
    const ids = rows.map((r) => r.id);
    const changed = db.updateImages(ids, { rating: 5 });
    expect(changed).toBe(901);
    const after = db.getImageById(ids[900]);
    expect(after.rating).toBe(5);
    expect(rows.filter((r) => r.rating === 5).length).toBe(0); // 更新前全为默认
  });


  it('deleteImage 删除文件、缩略图与关联数据', async () => {
    const dir = tmpDir('del1');
    const jpg = makeImage('del-a.jpg', dir, 'd1');
    const nef = makeImage('del-a.nef', dir, 'd2');
    const [img] = await db.importImages([jpg, nef]);
    const tag = db.createTag('del-tag');
    db.addTagToImage(img.id, tag.id);
    const album = db.createAlbum('del-alb');
    db.addToAlbum(album.id, [img.id]);
    const thumbPath = db.getThumbnailFilePath(img.id);
    fs.mkdirSync(path.dirname(thumbPath), { recursive: true });
    fs.writeFileSync(thumbPath, 'thumb');
    const removed = db.deleteImage(img.id);
    expect(removed.id).toBe(img.id);
    expect(db.getImageById(img.id)).toBe(null);
    expect(fs.existsSync(img.filepath)).toBe(false);
    expect(fs.existsSync(img.raw_path)).toBe(false);
    expect(fs.existsSync(thumbPath)).toBe(false);
    expect(db.getImageTags(img.id)).toEqual([]);
    expect(db.getAlbumImages(album.id)).toEqual([]);
  });

  it('deleteImage 不存在的 id 返回 false', () => {
    expect(db.deleteImage(99999999)).toBe(false);
  });

  it('batchDeleteImages 批量删除并跳过无效 id', async () => {
    const dir = tmpDir('del2');
    const [a] = await db.importImages([makeImage('batch-a.jpg', dir, 'b1')]);
    const [b] = await db.importImages([makeImage('batch-b.jpg', dir, 'b2')]);
    const results = db.batchDeleteImages([a.id, b.id, 99999999]);
    expect(results).toHaveLength(2);
    expect(db.getImageById(a.id)).toBe(null);
    expect(db.getImageById(b.id)).toBe(null);
    expect(fs.existsSync(a.filepath)).toBe(false);
    expect(fs.existsSync(b.filepath)).toBe(false);
  });

  it('updateImages 批量更新仅限 rating/favorite', async () => {
    const dir = tmpDir('upd4');
    const [a] = await db.importImages([makeImage('mu-a.jpg', dir, 'u1')]);
    const [b] = await db.importImages([makeImage('mu-b.jpg', dir, 'u2')]);
    expect(db.updateImages([a.id, b.id], { rating: 4, favorite: 1, notes: 'nope' })).toBe(2);
    expect(db.getImageById(a.id).rating).toBe(4);
    expect(db.getImageById(a.id).favorite).toBe(1);
    expect(db.getImageById(a.id).notes).toBe('');
    expect(db.getImageById(b.id).rating).toBe(4);
    expect(db.updateImages([], { rating: 1 })).toBe(0);
    expect(db.updateImages(null, { rating: 1 })).toBe(0);
    expect(db.updateImages([a.id], { notes: 'x' })).toBe(0);
  });
});

describe('saveEditedImage 编辑保存', () => {
  it('temp 原子替代原图，变换元数据归零、尺寸更新、缩略图清空', async () => {
    const dir = tmpDir('edit-save');
    const [img] = await db.importImages([makeImage('edited.jpg', dir, 'original-bytes')]);
    // 预置变换元数据与缩略图
    await db.updateImage(img.id, {
      rating: 3,
      rotation: 90,
      flip_h: 1,
      width: 100,
      height: 80,
      thumbnail_path: 'thumb-old.jpg',
    });
    const tempPath = path.join(dir, 'edited-temp.jpg');
    fs.writeFileSync(tempPath, 'edited-new-bytes');

    const saved = db.saveEditedImage(img.id, tempPath, { width: 1920, height: 1080 });
    expect(saved.error).toBeUndefined();
    expect(saved.filepath).toBe(img.filepath);
    expect(saved.width).toBe(1920);
    expect(saved.height).toBe(1080);
    expect(saved.size).toBe('edited-new-bytes'.length);
    // 原路径内容已被替代
    expect(fs.readFileSync(img.filepath, 'utf8')).toBe('edited-new-bytes');
    expect(fs.existsSync(tempPath)).toBe(false);
    // 变换烘焙归零，缩略图清空待重生成；评分不受影响
    expect(saved.rotation).toBe(0);
    expect(saved.flip_h).toBe(0);
    expect(saved.thumbnail_path).toBe('');
    expect(saved.rating).toBe(3);
  });

  it('temp 缺失或不存在的记录返回错误且原图不动', async () => {
    const dir = tmpDir('edit-err');
    const [img] = await db.importImages([makeImage('keep.jpg', dir, 'keep-bytes')]);
    expect(db.saveEditedImage(img.id, path.join(dir, 'nope-temp.jpg'), {})).toEqual({ error: '编辑产物不存在' });
    expect(db.saveEditedImage(999999, path.join(dir, 'x-temp.jpg'), {})).toEqual({ error: '图片不存在' });
    expect(fs.readFileSync(img.filepath, 'utf8')).toBe('keep-bytes');
  });
});

describe('saveEditedImage 原子替代与回退', () => {
  it('格式改名烘焙：filepath/format 更新，旧格式源文件被清理', async () => {
    const dir = tmpDir('edit-rename');
    const [img] = await db.importImages([makeImage('legacy.webp', dir, 'webp-bytes')]);
    expect(img.format).toBe('.webp');
    const tempPath = path.join(dir, 'legacy-temp.jpg');
    fs.writeFileSync(tempPath, 'jpeg-baked-bytes');

    const saved = db.saveEditedImage(img.id, tempPath, { width: 300, height: 200 });
    expect(saved.error).toBeUndefined();
    expect(saved.filepath.endsWith('.jpg')).toBe(true);
    expect(saved.format).toBe('.jpg');
    expect(fs.existsSync(saved.filepath)).toBe(true);
    expect(fs.readFileSync(saved.filepath, 'utf8')).toBe('jpeg-baked-bytes');
    // 旧 webp 源文件清理
    expect(fs.existsSync(img.filepath)).toBe(false);
  });

  it('rename 连续失败时走旁路回退：原图经副本替换、无 .bake-tmp 残留', async () => {
    const dir = tmpDir('edit-fallback');
    const [img] = await db.importImages([makeImage('fallback.jpg', dir, 'original-bytes')]);
    const tempPath = path.join(dir, 'fallback-temp.jpg');
    fs.writeFileSync(tempPath, 'fallback-baked-bytes');

    let calls = 0;
    const origRename = fs.renameSync;
    fs.renameSync = (...args) => {
      calls++;
      if (calls <= 3) throw Object.assign(new Error('EBUSY: locked'), { code: 'EBUSY' });
      return origRename(...args);
    };
    try {
      const saved = db.saveEditedImage(img.id, tempPath, { width: 10, height: 10 });
      expect(saved.error).toBeUndefined();
      expect(calls).toBe(4);
      expect(fs.readFileSync(img.filepath, 'utf8')).toBe('fallback-baked-bytes');
      expect(fs.existsSync(`${img.filepath}.bake-tmp`)).toBe(false);
      expect(fs.existsSync(tempPath)).toBe(false);
    } finally {
      fs.renameSync = origRename;
    }
  });

  it('彻底失败时返回错误且原图字节完好（无丢失窗口）', async () => {
    const dir = tmpDir('edit-noloss');
    const [img] = await db.importImages([makeImage('noloss.jpg', dir, 'precious-bytes')]);
    const tempPath = path.join(dir, 'noloss-temp.jpg');
    fs.writeFileSync(tempPath, 'unplaceable-bytes');

    const origRename = fs.renameSync;
    const origCopy = fs.copyFileSync;
    fs.renameSync = () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); };
    fs.copyFileSync = () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); };
    try {
      const saved = db.saveEditedImage(img.id, tempPath, { width: 10, height: 10 });
      expect(saved.error).toContain('原文件未受影响');
      expect(fs.readFileSync(img.filepath, 'utf8')).toBe('precious-bytes');
      expect(fs.existsSync(tempPath)).toBe(true); // 产物保留供重试
    } finally {
      fs.renameSync = origRename;
      fs.copyFileSync = origCopy;
    }
  });
});

describe('saveEdits preserveGeometry（批量同步保留目标几何）', () => {
  it('preserveGeometry 时保留已有 crop/orientation；不带标记时整体替换', async () => {
    const dir = tmpDir('sync-geom');
    const [img] = await db.importImages([makeImage('sync.jpg', dir, 'sync-bytes')]);
    // 目标图先有裁剪+旋转
    const first = db.saveEdits(img.id, {
      orientation: { rotate: 90, flipH: false, flipV: false },
      crop: { x: 10, y: 20, w: 300, h: 200, ratio: 'free', angle: 0 },
      basic: { exposure: 1 },
    });
    expect(first.error).toBeUndefined();

    // 仅同步影调（不带几何）+ preserveGeometry → 目标 crop/rotation 保留
    const synced = db.saveEdits(img.id, { basic: { exposure: -0.5 } }, { label: '批量同步影调', preserveGeometry: true });
    expect(synced.error).toBeUndefined();
    const after = db.getEdits(img.id).params;
    expect(after.crop.w).toBe(300);
    expect(after.orientation.rotate).toBe(90);
    expect(after.basic.exposure).toBe(-0.5);

    // 不带标记 → 几何被替换为默认（整体替换语义）
    const synced2 = db.saveEdits(img.id, { basic: { exposure: 0.2 } }, { label: '同步' });
    expect(synced2.error).toBeUndefined();
    const after2 = db.getEdits(img.id).params;
    expect(after2.crop).toBeNull();
    expect(after2.orientation.rotate).toBe(0);
  });
});

describe('查询辅助函数', () => {
  it('getImageById 返回完整记录', async () => {
    const dir = tmpDir('byid');
    const [img] = await db.importImages([makeImage('byid.jpg', dir, 'bi')]);
    const rec = db.getImageById(img.id);
    expect(rec.id).toBe(img.id);
    expect(rec.filename).toBe('byid.jpg');
    expect(db.getImageById(99999999)).toBe(null);
  });

  it('getAllImagePaths/getImagesForRebuild/updateImageOrientation', async () => {
    const dir = tmpDir('reb');
    const [r1] = await db.importImages([makeImage('reb-a.jpg', dir, 'x1')]);
    const [r2] = await db.importImages([makeImage('reb-b.png', dir, 'x2')]);
    const [r3] = await db.importImages([makeImage('reb-c.jpg', dir, 'x3')]);
    await db.updateImage(r2.id, {
      thumbnail_path: 'reb-b-thumb.jpg',
      thumbnail_small_path: 'reb-b-thumb-s.jpg',
    });
    db.updateImageOrientation(r3.id, 6);
    expect(db.getImageById(r3.id).orientation).toBe(6);
    const all = db.getAllImagePaths();
    expect(all.map((r) => r.id)).toContain(hiddenNefId);
    const partial = db.getImagesForRebuild(false);
    const partialIds = partial.map((r) => r.id);
    expect(partialIds).toContain(r1.id);
    expect(partialIds).not.toContain(r2.id);
    // 竖图（orientation != 1）现在也生成缩略图，缺失时同样进入重建列表
    expect(partialIds).toContain(r3.id);
    expect(partialIds).not.toContain(hiddenNefId);
    expect(partial[0]).toHaveProperty('filename');
    const full = db.getImagesForRebuild(true);
    const fullIds = full.map((r) => r.id);
    expect(fullIds).toContain(r1.id);
    expect(fullIds).toContain(r2.id);
    expect(fullIds).toContain(r3.id);
    expect(fullIds).not.toContain(hiddenNefId);
  });

  it('getAllVisibleIds 返回可见图片 id', () => {
    expect(db.getAllVisibleIds({ importDate: '2031-06-15' })).toHaveLength(5);
    expect(db.getAllVisibleIds({ importDate: '2031-06-15', favorite: true })).toHaveLength(0);
  });

  it('getImportDates 分组计数排序且排除 hidden', async () => {
    const dir = tmpDir('dates');
    await db.importImages([
      { ...makeImage('dt-a.jpg', dir, 'da'), importDate: '2049-12-31' },
      { ...makeImage('dt-b.jpg', dir, 'db'), importDate: '2049-12-31' },
      { ...makeImage('dt-c.jpg', dir, 'dc'), importDate: '2048-12-31' },
      { ...makeImage('dt-nef.nef', dir, 'dn'), importDate: '2047-01-01' },
    ]);
    const dates = db.getImportDates();
    const entry2049 = dates.find((d) => d.date === '2049-12-31');
    const entry2048 = dates.find((d) => d.date === '2048-12-31');
    expect(entry2049.count).toBe(2);
    expect(entry2048.count).toBe(1);
    expect(dates.find((d) => d.date === '2047-01-01')).toBeUndefined();
    expect(dates.indexOf(entry2049)).toBeLessThan(dates.indexOf(entry2048));
  });

  it('getStats 与图库状态一致', () => {
    const stats = db.getStats();
    const all = db.getImages({ limit: 1000000 });
    expect(stats.totalImages).toBe(all.total);
    expect(stats.favorites).toBe(db.getImages({ favorite: true, limit: 1000000 }).total);
    expect(stats.totalTags).toBeGreaterThan(0);
    expect(stats.totalAlbums).toBeGreaterThan(0);
  });
});

describe('NEF 配对关系保持（任务书第 26 节 metadata 测试）', () => {
  it('参数保存与烘焙替代全程 raw_path/original_raw_path/NEF 文件字节不变', async () => {
    const dir = tmpDir('nef-relation');
    const jpgSrc = path.join(dir, 'pair-src.jpg');
    const nefSrc = path.join(dir, 'pair-src.nef');
    fs.writeFileSync(jpgSrc, 'jpg-original-bytes');
    fs.writeFileSync(nefSrc, 'nef-negative-bytes-never-touched');
    const nefBytesBefore = fs.readFileSync(nefSrc);

    const [img] = await db.importImages([
      { filename: 'pair.jpg', filepath: jpgSrc, size: 18, format: '.jpg', raw_source: nefSrc, raw_filename: 'pair.nef' },
    ]);
    const rec = db.getImageById(img.id);
    expect(rec.raw_path).toBeTruthy();
    expect(rec.original_raw_path).toBe(nefSrc);
    const rawPathAfterImport = rec.raw_path;
    const originalRawAfterImport = rec.original_raw_path;

    // 非破坏保存参数：NEF 配对不动
    db.saveEdits(img.id, { basic: { exposure: 0.8 } }, { label: '曝光' });
    expect(db.getImageById(img.id).raw_path).toBe(rawPathAfterImport);
    expect(db.getImageById(img.id).original_raw_path).toBe(originalRawAfterImport);
    expect(fs.readFileSync(nefSrc).equals(nefBytesBefore)).toBe(true);

    // 烘焙替代：JPG 被替代但 NEF 底片与配对关系保持
    const temp = path.join(dir, 'pair-temp.jpg');
    fs.writeFileSync(temp, 'baked-bytes');
    db.saveEditedImage(img.id, temp, { width: 100, height: 80 });
    const after = db.getImageById(img.id);
    expect(after.raw_path).toBe(rawPathAfterImport);
    expect(after.original_raw_path).toBe(originalRawAfterImport);
    expect(fs.existsSync(rawPathAfterImport)).toBe(true);
    expect(fs.readFileSync(nefSrc).equals(nefBytesBefore)).toBe(true);
    expect(fs.statSync(nefSrc).mtimeMs > 0).toBe(true);
  });

  it('删除带配对 NEF 的图片：JPG 与 NEF 一并清理（既有约定回归）', async () => {
    const dir = tmpDir('nef-del');
    const jpgSrc = path.join(dir, 'del-src.jpg');
    const nefSrc = path.join(dir, 'del-src.nef');
    fs.writeFileSync(jpgSrc, 'jpg');
    fs.writeFileSync(nefSrc, 'nef');
    const [img] = await db.importImages([
      { filename: 'del.jpg', filepath: jpgSrc, size: 3, format: '.jpg', raw_source: nefSrc, raw_filename: 'del.nef' },
    ]);
    const rec = db.getImageById(img.id);
    db.deleteImage(img.id);
    expect(fs.existsSync(rec.filepath)).toBe(false);
    expect(fs.existsSync(rec.raw_path)).toBe(false); // 删除约定：NEF 跟随删除
    expect(db.getImageById(img.id)).toBeNull();
  });
});

describe('编辑数据删除一致性（edits / edit_history）', () => {
  it('foreign_keys=ON 生效：直接删除 images 行时 edits 与 edit_history 级联清理', async () => {
    const dir = tmpDir('fk-cascade');
    const [img] = await db.importImages([makeImage('fk-a.jpg', dir, 'fk1')]);
    db.saveEdits(img.id, { basic: { exposure: 0.5 } }, { label: '曝光' });
    db.saveEdits(img.id, { basic: { exposure: 0.8 } }, { label: '曝光' });
    expect(db.getEdits(img.id)).not.toBeNull();
    expect(db.getEditHistory(img.id)).toHaveLength(2);
    expect(db.__getDb().pragma('foreign_keys', { simple: true })).toBe(1);
    db.__getDb().prepare('DELETE FROM images WHERE id = ?').run(img.id);
    expect(db.getEdits(img.id)).toBeNull();
    expect(db.getEditHistory(img.id)).toEqual([]);
  });

  it('deleteImage 显式清理 edits 与 edit_history（不依赖级联）', async () => {
    const dir = tmpDir('del-edit');
    const [img] = await db.importImages([makeImage('del-ed.jpg', dir, 'd1')]);
    db.saveEdits(img.id, { basic: { exposure: 0.5 } }, { label: '曝光' });
    expect(db.getEdits(img.id)).not.toBeNull();
    db.deleteImage(img.id);
    expect(db.getEdits(img.id)).toBeNull();
    expect(db.getEditHistory(img.id)).toEqual([]);
  });

  it('deleteBrokenRecords 同样清理 edits 与 edit_history', async () => {
    const dir = tmpDir('del-broken-edit');
    const [img] = await db.importImages([makeImage('broken-ed.jpg', dir, 'b1')]);
    db.saveEdits(img.id, { basic: { exposure: 0.5 } }, { label: '曝光' });
    fs.unlinkSync(img.filepath);
    expect(db.deleteBrokenRecords([img.id])).toBe(1);
    expect(db.getEdits(img.id)).toBeNull();
    expect(db.getEditHistory(img.id)).toEqual([]);
  });
});

describe('saveEditedImage 目标冲突护栏', () => {
  it('烘焙改名（gif→jpg）撞上其他记录的 filepath 时报错且不覆盖任何文件', async () => {
    const dir = tmpDir('edit-clash');
    const [gif] = await db.importImages([makeImage('clash.gif', dir, 'gif-bytes')]);
    const [jpg] = await db.importImages([makeImage('clash.jpg', dir, 'jpg-bytes')]);
    const temp = path.join(dir, 'clash-temp.jpg');
    fs.writeFileSync(temp, 'baked-bytes');
    const res = db.saveEditedImage(gif.id, temp, { width: 10, height: 10 });
    expect(res.error).toBeTruthy();
    expect(fs.readFileSync(jpg.filepath, 'utf8')).toBe('jpg-bytes');
    expect(fs.readFileSync(gif.filepath, 'utf8')).toBe('gif-bytes');
    expect(db.getImageById(gif.id).filepath).toBe(gif.filepath);
    expect(db.getImageById(jpg.id).filepath).toBe(jpg.filepath);
  });
});

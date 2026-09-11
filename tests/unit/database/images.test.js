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
});

describe('deleteImage / batchDeleteImages / updateImages', () => {
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
    expect(partialIds).not.toContain(r3.id);
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

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

function makeImage(name, dir, content = 'data') {
  const filepath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, content);
  return {
    filename: name,
    filepath,
    size: Buffer.byteLength(content),
    format: path.extname(name),
    width: 0,
    height: 0,
  };
}

let a1 = null;
let a2 = null;
let a3 = null;
let hiddenRec = null;
let albumX = null;

afterAll(() => {
  db.closeDatabase();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  delete nodeRequire.cache[electronId];
  delete globalThis.__PIXYANG_TEST_TMP_ROOT__;
});

beforeAll(async () => {
  await db.initDatabase();
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'alb-'));
  [a1] = await db.importImages([{ ...makeImage('alb-1.jpg', dir, 'v1'), importDate: '2040-01-01' }]);
  [a2] = await db.importImages([{ ...makeImage('alb-2.jpg', dir, 'v2'), importDate: '2040-01-01' }]);
  [a3] = await db.importImages([{ ...makeImage('alb-3.jpg', dir, 'v3'), importDate: '2040-01-01' }]);
  [hiddenRec] = await db.importImages([makeImage('alb-hidden.nef', dir, 'h1')]);
  db.updateImageThumbs(a1.id, { thumbnail_path: 'cover-1.jpg' });
  db.updateImageThumbs(a3.id, { thumbnail_path: 'cover-3.jpg' });
  db.updateImageThumbs(hiddenRec.id, { thumbnail_path: 'cover-hidden.jpg' });
  albumX = db.createAlbum('旅行相册', '描述');
  db.addToAlbum(albumX.id, [a1.id, a2.id, a3.id, hiddenRec.id]);
});

describe('相册操作', () => {
  it('createAlbum 返回新相册', () => {
    expect(albumX.name).toBe('旅行相册');
    expect(albumX.description).toBe('描述');
    expect(albumX.id).toBeTruthy();
    const empty = db.createAlbum('空相册');
    const found = db.getAlbums().find((a) => a.id === empty.id);
    expect(found.image_count).toBe(0);
    expect(found.cover_path).toBe(null);
  });

  it('renameAlbum 修改名称', () => {
    expect(db.renameAlbum(albumX.id, '旅行相册2')).toBe(true);
    expect(db.getAlbums().find((a) => a.id === albumX.id).name).toBe('旅行相册2');
  });

  it('createAlbum/renameAlbum 入参清洗（审查批 6 L9）', () => {
    expect(db.createAlbum('')).toBe(null);
    expect(db.createAlbum('   ')).toBe(null);
    expect(db.createAlbum(null)).toBe(null);
    const long = db.createAlbum('y'.repeat(100), 'z'.repeat(300));
    expect(long.name).toHaveLength(50);
    expect(long.description).toHaveLength(200);
    db.deleteAlbum(long.id);
    expect(db.renameAlbum(albumX.id, '  ')).toEqual({ error: '相册名称无效' });
    expect(db.getAlbums().find((a) => a.id === albumX.id).name).toBe('旅行相册2');
  });

  it('getAlbums 返回 cover_path 与 image_count（hidden 记录不计数，与 getAlbumImages 口径一致）', () => {
    const found = db.getAlbums().find((a) => a.id === albumX.id);
    expect(found.image_count).toBe(3);
    expect(found.cover_path).toBe('cover-3.jpg');
  });

  it('getAlbumImages 过滤隐藏图片', () => {
    const images = db.getAlbumImages(albumX.id);
    expect(images.map((i) => i.id).sort()).toEqual([a1.id, a2.id, a3.id].sort());
    expect(images.map((i) => i.id)).not.toContain(hiddenRec.id);
  });

  it('addToAlbum 重复添加幂等', () => {
    db.addToAlbum(albumX.id, [a1.id, a3.id]);
    expect(db.getAlbumImages(albumX.id)).toHaveLength(3);
    expect(db.getAlbums().find((a) => a.id === albumX.id).image_count).toBe(3);
  });

  it('removeFromAlbum 移除单张', () => {
    db.removeFromAlbum(albumX.id, a2.id);
    const images = db.getAlbumImages(albumX.id);
    expect(images.map((i) => i.id)).not.toContain(a2.id);
    expect(images).toHaveLength(2);
    expect(db.getAlbums().find((a) => a.id === albumX.id).image_count).toBe(2);
  });

  it('getImages 支持 albumId 筛选', () => {
    const result = db.getImages({ albumId: albumX.id, limit: 100 });
    expect(result.total).toBe(2);
    expect(result.images.map((i) => i.id).sort()).toEqual([a1.id, a3.id].sort());
  });

  it('deleteAlbum 清理相册与关联', () => {
    const y = db.createAlbum('待删除相册');
    db.addToAlbum(y.id, [a1.id]);
    db.deleteAlbum(y.id);
    expect(db.getAlbums().find((a) => a.id === y.id)).toBeUndefined();
    expect(db.getAlbumImages(y.id)).toEqual([]);
    expect(db.getImages({ albumId: y.id, limit: 100 }).total).toBe(0);
  });
});

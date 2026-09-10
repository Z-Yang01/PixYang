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

function ensureTmpRoot() {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
}

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

function tmpDir(tag) {
  ensureTmpRoot();
  return fs.mkdtempSync(path.join(TMP_ROOT, `${tag}-`));
}

let hostId = null;

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
  const dir = tmpDir('tagimg');
  const [img] = await db.importImages([makeImage('tag-host.jpg', dir, 'host')]);
  hostId = img.id;
});

describe('标签操作', () => {
  it('createTag 创建并返回带默认颜色的记录', () => {
    const tag = db.createTag('风景');
    expect(tag.name).toBe('风景');
    expect(tag.id).toBeTruthy();
    expect(tag.color).toBe('#6366f1');
  });

  it('createTag 支持自定义颜色', () => {
    const tag = db.createTag('人像', '#ff0000');
    expect(tag.color).toBe('#ff0000');
  });

  it('createTag 重名返回 null', () => {
    expect(db.createTag('风景')).toBe(null);
  });

  it('getTags 返回 image_count 并按名称排序', () => {
    db.createTag('b-tag');
    db.createTag('a-tag');
    const bTag = db.getTags().find((t) => t.name === 'b-tag');
    db.addTagToImage(hostId, bTag.id);
    const tags = db.getTags();
    const a = tags.find((t) => t.name === 'a-tag');
    const b = tags.find((t) => t.name === 'b-tag');
    expect(a.image_count).toBe(0);
    expect(b.image_count).toBe(1);
    expect(tags.indexOf(a)).toBeLessThan(tags.indexOf(b));
  });

  it('addTagToImage/getImageTags/removeTagFromImage', () => {
    const tag = db.createTag('temp-tag');
    expect(db.addTagToImage(hostId, tag.id)).toBe(true);
    expect(db.addTagToImage(hostId, tag.id)).toBe(true);
    expect(db.getImageTags(hostId).filter((t) => t.id === tag.id)).toHaveLength(1);
    db.removeTagFromImage(hostId, tag.id);
    expect(db.getImageTags(hostId).find((t) => t.id === tag.id)).toBeUndefined();
  });

  it('addTagToImages 批量添加且幂等', async () => {
    const dir = tmpDir('batchtag');
    const [x] = await db.importImages([makeImage('bt-x.jpg', dir, 'x')]);
    const [y] = await db.importImages([makeImage('bt-y.jpg', dir, 'y')]);
    const tag = db.createTag('batch-tag');
    expect(db.addTagToImages([x.id, y.id], tag.id)).toBe(2);
    expect(db.addTagToImages([x.id, y.id], tag.id)).toBe(2);
    expect(db.getImageTags(x.id).filter((t) => t.id === tag.id)).toHaveLength(1);
    expect(db.getImageTags(y.id).filter((t) => t.id === tag.id)).toHaveLength(1);
    expect(db.addTagToImages([], tag.id)).toBe(0);
    expect(db.addTagToImages(null, tag.id)).toBe(0);
  });

  it('getBatchImageTags 返回映射结构', async () => {
    const dir = tmpDir('maptag');
    const [m1] = await db.importImages([makeImage('map-1.jpg', dir, 'm1')]);
    const [m2] = await db.importImages([makeImage('map-2.jpg', dir, 'm2')]);
    const t1 = db.createTag('map-tag1');
    const t2 = db.createTag('map-tag2');
    db.addTagToImage(m1.id, t1.id);
    db.addTagToImage(m1.id, t2.id);
    db.addTagToImage(m2.id, t1.id);
    const result = db.getBatchImageTags([m1.id, m2.id, 99999999]);
    expect(result[m1.id]).toHaveLength(2);
    expect(result[m2.id]).toHaveLength(1);
    expect(result[m2.id][0].name).toBe('map-tag1');
    expect(result[99999999]).toBeUndefined();
    expect(db.getBatchImageTags([])).toEqual({});
    expect(db.getBatchImageTags(null)).toEqual({});
  });

  it('deleteTag 移除标签与图片关联', () => {
    const tag = db.createTag('doomed-tag');
    db.addTagToImage(hostId, tag.id);
    db.deleteTag(tag.id);
    expect(db.getTags().find((t) => t.id === tag.id)).toBeUndefined();
    expect(db.getImageTags(hostId).find((t) => t.id === tag.id)).toBeUndefined();
  });
});

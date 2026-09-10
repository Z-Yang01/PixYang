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

let brokenIds = [];
let healthyId = null;

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

describe('scanImageFiles / collectImportFiles', () => {
  it('递归扫描、扩展名过滤并检测 NEF 配对', async () => {
    const dir = tmpDir('scan1');
    writeFile(path.join(dir, 'a.jpg'), 'aaa');
    writeFile(path.join(dir, 'b.png'), 'bbb');
    writeFile(path.join(dir, 'c.txt'), 'ccc');
    writeFile(path.join(dir, 'a.nef'), 'raw1');
    writeFile(path.join(dir, 'sub', 'd.jpeg'), 'ddd');
    writeFile(path.join(dir, 'sub', 'e.nef'), 'raw2');
    const files = await db.scanImageFiles(dir, false);
    expect(files.map((f) => f.filename).sort()).toEqual(['a.jpg', 'b.png', 'd.jpeg']);
    const a = files.find((f) => f.filename === 'a.jpg');
    expect(a.raw_source).toBe(path.join(dir, 'a.nef'));
    expect(a.raw_filename).toBe('a.nef');
    expect(a.size).toBe(3);
    expect(a.format).toBe('.jpg');
    const d = files.find((f) => f.filename === 'd.jpeg');
    expect(d.raw_source).toBeUndefined();
    expect(d.raw_filename).toBeUndefined();
  });

  it('includeRaw 时包含 nef 且不做配对检测', async () => {
    const dir = tmpDir('scan2');
    writeFile(path.join(dir, 'a.jpg'), 'aaa');
    writeFile(path.join(dir, 'a.nef'), 'raw1');
    const files = await db.scanImageFiles(dir, true);
    expect(files.map((f) => f.filename).sort()).toEqual(['a.jpg', 'a.nef']);
    expect(files.find((f) => f.filename === 'a.jpg').raw_source).toBeUndefined();
  });

  it('不存在的目录返回空数组', async () => {
    const files = await db.scanImageFiles(path.join(TMP_ROOT, 'no-such-dir'));
    expect(files).toEqual([]);
  });

  it('collectImportFiles 过滤文件扩展名并跳过无效路径', () => {
    const dir = tmpDir('collect');
    const jpg = path.join(dir, 'cf.jpg');
    const txt = path.join(dir, 'cf.txt');
    writeFile(jpg, 'imgdata');
    writeFile(txt, 'textdata');
    const files = db.collectImportFiles([jpg, txt, path.join(dir, 'missing.jpg'), null, 42]);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('cf.jpg');
    expect(files[0].filepath).toBe(jpg);
    expect(files[0].format).toBe('.jpg');
    expect(files[0].size).toBe(7);
    expect(db.collectImportFiles(null)).toEqual([]);
  });

  it('collectImportFiles 目录分支当前实现会抛错（疑似 bug）', () => {
    const dir = tmpDir('collect2');
    writeFile(path.join(dir, 'x.jpg'), 'x');
    expect(() => db.collectImportFiles([dir])).toThrow();
  });
});

describe('相机同步', () => {
  it('prepareCameraSync 区分新导入、补配对与跳过', async () => {
    const cam = tmpDir('cam');
    const a1j = makeImage('cam1.jpg', cam, 'c1j');
    const a1n = makeImage('cam1.nef', cam, 'c1n');
    const a2j = makeImage('cam2.jpg', cam, 'c2j');
    const a2n = makeImage('cam2.nef', cam, 'c2n');
    const a3n = makeImage('cam3.nef', cam, 'c3n');
    const [existing2] = await db.importImages([a2j]);
    const [existing3] = await db.importImages([a3n]);
    const result = db.prepareCameraSync([a1j, a1n, a2j, a2n, a3n]);
    expect(result.toImport.map((f) => f.filepath).sort()).toEqual([a1j.filepath, a1n.filepath].sort());
    expect(result.attachPairs).toEqual([
      { jpgId: existing2.id, nefSource: a2n.filepath, nefFilename: 'cam2.nef' },
    ]);
    expect(result.skipped).toBe(2);
    expect(existing3.id).toBeTruthy();
  });

  it('attachRawToImage 复制 NEF 并记录 raw_path', async () => {
    const dir = tmpDir('attach');
    const srcDir = tmpDir('attach-src');
    const src = path.join(srcDir, 'origin.nef');
    fs.writeFileSync(src, 'rawcontent');
    const [img] = await db.importImages([makeImage('host.jpg', dir, 'hostjpg')]);
    expect(await db.attachRawToImage(img.id, src, 'origin.nef')).toBe(true);
    const rec = db.getImageById(img.id);
    expect(rec.raw_path).toBe(path.join(path.dirname(rec.filepath), 'host.nef'));
    expect(fs.existsSync(rec.raw_path)).toBe(true);
    expect(rec.original_raw_path).toBe(src);
    expect(await db.attachRawToImage(img.id, src, 'origin.nef')).toBe(false);
    expect(await db.attachRawToImage(99999999, src, 'origin.nef')).toBe(false);
  });

  it('attachRawToImage 源文件缺失时返回 false', async () => {
    const dir = tmpDir('attach2');
    const [img] = await db.importImages([makeImage('host2.jpg', dir, 'h2')]);
    expect(await db.attachRawToImage(img.id, path.join(dir, 'nope.nef'), 'nope.nef')).toBe(false);
    expect(db.getImageById(img.id).raw_path).toBe('');
  });
});

describe('失效记录维护', () => {
  it('findBrokenRecords 找出文件缺失的记录', async () => {
    const dir = tmpDir('broken');
    const [missing] = await db.importImages([makeImage('missing.jpg', dir, 'm')]);
    const [paired] = await db.importImages([makeImage('paired.jpg', dir, 'p'), makeImage('paired.nef', dir, 'q')]);
    const [healthy] = await db.importImages([makeImage('healthy.jpg', dir, 'h')]);
    fs.unlinkSync(missing.filepath);
    fs.unlinkSync(paired.raw_path);
    const broken = db.findBrokenRecords();
    brokenIds = broken.map((r) => r.id);
    healthyId = healthy.id;
    expect(brokenIds).toContain(missing.id);
    expect(brokenIds).toContain(paired.id);
    expect(brokenIds).not.toContain(healthy.id);
    expect(broken[0]).toHaveProperty('raw_path');
  });

  it('deleteBrokenRecords 清理记录且不删除现存文件', () => {
    const healthy = db.getImageById(healthyId);
    expect(healthy).not.toBe(null);
    fs.mkdirSync(path.dirname(healthy.filepath), { recursive: true });
    fs.writeFileSync(healthy.filepath, 'h');
    const removed = db.deleteBrokenRecords(brokenIds);
    expect(removed).toBe(brokenIds.length);
    for (const id of brokenIds) expect(db.getImageById(id)).toBe(null);
    expect(db.getImageById(healthyId)).not.toBe(null);
    expect(fs.existsSync(healthy.filepath)).toBe(true);
    expect(db.deleteBrokenRecords('not-array')).toBe(0);
    expect(db.deleteBrokenRecords([99999999])).toBe(0);
  });
});

describe('重复图片检测', () => {
  it('findDuplicates 按内容找出重复组', async () => {
    const dir = tmpDir('dup');
    const contentA = Buffer.alloc(2000, 7);
    const contentUni = Buffer.alloc(2000, 9);
    const contentB = Buffer.alloc(1500, 3);
    const [d1] = await db.importImages([makeImage('dup-a1.jpg', dir, contentA)]);
    const [d2] = await db.importImages([makeImage('dup-a2.jpg', dir, contentA)]);
    const [u1] = await db.importImages([makeImage('uni.jpg', dir, contentUni)]);
    const [b1] = await db.importImages([makeImage('dup-b1.jpg', dir, contentB)]);
    const [b2] = await db.importImages([makeImage('dup-b2.jpg', dir, contentB)]);
    for (const rec of [d1, d2, u1]) await db.updateImage(rec.id, { width: 100, height: 50 });
    for (const rec of [b1, b2]) await db.updateImage(rec.id, { width: 300, height: 200 });
    const groups = db.findDuplicates();
    expect(groups).toHaveLength(2);
    const groupA = groups.find((g) => g.items[0].size === 2000);
    const groupB = groups.find((g) => g.items[0].size === 1500);
    expect(groupA.items.map((i) => i.id).sort()).toEqual([d1.id, d2.id].sort());
    expect(groupA.wasted).toBe(2000);
    expect(groupA.items[0].width).toBe(100);
    expect(groupA.items[0]).toHaveProperty('thumbnail_path');
    expect(groupB.items.map((i) => i.id).sort()).toEqual([b1.id, b2.id].sort());
    expect(groupB.wasted).toBe(1500);
  });
});

describe('setImagesRoot 存储目录迁移', () => {
  it('参数校验', async () => {
    expect(await db.setImagesRoot(null)).toEqual({ error: '保存路径无效' });
    expect(await db.setImagesRoot(123)).toEqual({ error: '保存路径无效' });
  });

  it('相同路径直接成功不移动', async () => {
    const res = await db.setImagesRoot(db.getImagesRoot());
    expect(res.success).toBe(true);
    expect(res.moved).toBe(0);
    expect(res.path).toBe(path.resolve(db.getImagesRoot()));
  });

  it('整体搬迁图片与配对 NEF 到新根目录', async () => {
    const dir = tmpDir('mvroot-src');
    const [img] = await db.importImages([makeImage('mover.jpg', dir, 'mj'), makeImage('mover.nef', dir, 'mn')]);
    const [ghost] = await db.importImages([makeImage('ghost.jpg', dir, 'g')]);
    fs.unlinkSync(ghost.filepath);
    const beforeRoot = path.resolve(db.getImagesRoot());
    const expectedMoved = db.getAllImagePaths().filter((r) => fs.existsSync(r.filepath)).length;
    const newRoot = tmpDir('mvroot-dst');
    const res = await db.setImagesRoot(newRoot);
    expect(res.success).toBe(true);
    expect(res.moved).toBe(expectedMoved);
    expect(res.path).toBe(path.resolve(newRoot));
    expect(db.getImagesRoot()).toBe(path.resolve(newRoot));
    expect(db.getSetting('images_root')).toBe(path.resolve(newRoot));
    const rec = db.getImageById(img.id);
    expect(rec.filepath.startsWith(path.resolve(newRoot))).toBe(true);
    expect(fs.existsSync(rec.filepath)).toBe(true);
    expect(fs.existsSync(img.filepath)).toBe(false);
    expect(path.relative(path.resolve(newRoot), rec.filepath)).toBe(path.relative(beforeRoot, img.filepath));
    expect(rec.raw_path).not.toBe('');
    expect(fs.existsSync(rec.raw_path)).toBe(true);
    expect(path.basename(rec.raw_path, '.nef')).toBe(path.basename(rec.filepath, '.jpg'));
    const ghostRec = db.getImageById(ghost.id);
    expect(ghostRec.filepath.startsWith(path.resolve(newRoot))).toBe(true);
    expect(fs.existsSync(ghostRec.filepath)).toBe(false);
  });
});

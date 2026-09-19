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

let brokenIds = [];
let healthyId = null;
let missingId = null;
let pairedId = null;

afterAll(() => {
  db.closeDatabase();
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

  it('collectImportFiles 过滤文件扩展名并跳过无效路径', async () => {
    const dir = tmpDir('collect');
    const jpg = path.join(dir, 'cf.jpg');
    const txt = path.join(dir, 'cf.txt');
    writeFile(jpg, 'imgdata');
    writeFile(txt, 'textdata');
    const files = await db.collectImportFiles([jpg, txt, path.join(dir, 'missing.jpg'), null, 42]);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('cf.jpg');
    expect(files[0].filepath).toBe(jpg);
    expect(files[0].format).toBe('.jpg');
    expect(files[0].size).toBe(7);
    expect(await db.collectImportFiles(null)).toEqual([]);
  });

  it('collectImportFiles 目录分支递归扫描（修复后不再抛错）', async () => {
    const dir = tmpDir('collect2');
    writeFile(path.join(dir, 'x.jpg'), 'x');
    const files = await db.collectImportFiles([dir]);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('x.jpg');
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

  it('attachRawToImage 目标名被隐藏 NEF 记录占用时收养该记录', async () => {
    const nefSrcDir = tmpDir('adopt-nefsrc');
    const nefSrc = makeImage('adp.nef', nefSrcDir, 'adoptraw');
    const [hidden] = await db.importImages([nefSrc]);
    expect(hidden.hidden).toBe(1);
    const jpgSrc = makeImage('adp.jpg', tmpDir('adopt-jpgsrc'), 'adoptjpg');
    const [img] = await db.importImages([jpgSrc]);
    expect(db.getImageById(img.id).raw_path).toBe('');
    expect(await db.attachRawToImage(img.id, hidden.original_path, 'adp.nef')).toBe(true);
    const rec = db.getImageById(img.id);
    expect(rec.raw_path).toBe(hidden.filepath);
    expect(rec.original_raw_path).toBe(nefSrc.filepath);
    expect(db.getImageById(hidden.id)).toBe(null);
    expect(fs.existsSync(rec.raw_path)).toBe(true);
    expect(fs.readFileSync(rec.raw_path, 'utf8')).toBe('adoptraw');
  });

  it('attachRawToImage 清理无主半截残留后继续复制', async () => {
    const dir = tmpDir('orphan');
    const srcDir = tmpDir('orphan-src');
    const src = path.join(srcDir, 'real.nef');
    fs.writeFileSync(src, 'realfull');
    const [img] = await db.importImages([makeImage('orph.jpg', dir, 'orphjpg')]);
    const rec0 = db.getImageById(img.id);
    const rawDest = path.join(path.dirname(rec0.filepath), 'orph.nef');
    fs.writeFileSync(rawDest, 'halfwritten');
    expect(await db.attachRawToImage(img.id, src, 'real.nef')).toBe(true);
    const rec = db.getImageById(img.id);
    expect(rec.raw_path).toBe(rawDest);
    expect(fs.readFileSync(rawDest, 'utf8')).toBe('realfull');
    expect(rec.original_raw_path).toBe(src);
  });

  it('prepareCameraSync 大写扩展名 UP1.JPG+UP1.NEF 分组配对并端到端导入', async () => {
    const cam = tmpDir('camupper');
    const j = makeImage('UP1.JPG', cam, 'ujpg');
    const n = makeImage('UP1.NEF', cam, 'uneffile');
    const prep = db.prepareCameraSync([j, n]);
    expect(prep.toImport.map((f) => f.filename).sort()).toEqual(['UP1.JPG', 'UP1.NEF']);
    expect(prep.attachPairs).toEqual([]);
    const rows = await db.importImages(prep.toImport);
    expect(rows).toHaveLength(1);
    const rec = db.getImageById(rows[0].id);
    expect(rec.hidden).toBe(0);
    expect(rec.filename).toBe('UP1.JPG');
    expect(path.basename(rec.raw_path)).toBe('UP1.NEF');
    expect(path.dirname(rec.raw_path)).toBe(path.dirname(rec.filepath));
    expect(fs.readFileSync(rec.raw_path, 'utf8')).toBe('uneffile');
  });
});

describe('失效记录维护', () => {
  it('findBrokenRecords 区分主文件缺失(main)与仅配对 raw 缺失(raw)', async () => {
    const dir = tmpDir('broken');
    const [missing] = await db.importImages([makeImage('missing.jpg', dir, 'm')]);
    const [paired] = await db.importImages([makeImage('paired.jpg', dir, 'p'), makeImage('paired.nef', dir, 'q')]);
    const [healthy] = await db.importImages([makeImage('healthy.jpg', dir, 'h')]);
    fs.unlinkSync(missing.filepath);
    fs.unlinkSync(paired.raw_path);
    const broken = db.findBrokenRecords();
    brokenIds = broken.map((r) => r.id);
    healthyId = healthy.id;
    missingId = missing.id;
    pairedId = paired.id;
    const byId = Object.fromEntries(broken.map((r) => [r.id, r.reason]));
    expect(byId[missing.id]).toBe('main');
    expect(byId[paired.id]).toBe('raw');
    expect(byId[healthy.id]).toBeUndefined();
    expect(broken[0]).toHaveProperty('raw_path');
  });

  it('deleteBrokenRecords：仅 raw 缺失只解绑保留记录，主文件缺失才删记录', () => {
    const healthy = db.getImageById(healthyId);
    expect(healthy).not.toBe(null);
    fs.mkdirSync(path.dirname(healthy.filepath), { recursive: true });
    fs.writeFileSync(healthy.filepath, 'h');
    const pairedBefore = db.getImageById(pairedId);
    expect(pairedBefore).not.toBe(null);
    const res = db.deleteBrokenRecords(brokenIds);
    expect(res.removed).toEqual([missingId]);
    expect(res.unbound).toEqual([pairedId]);
    expect(db.getImageById(missingId)).toBe(null);
    // 回归：可见图片仅配对 NEF 丢失时曾被整条删除——现在记录保留、只解绑 raw
    const pairedRec = db.getImageById(pairedId);
    expect(pairedRec).not.toBe(null);
    expect(pairedRec.raw_path).toBe('');
    expect(pairedRec.original_raw_path).toBe('');
    expect(fs.existsSync(pairedRec.filepath)).toBe(true);
    expect(db.getImageById(healthyId)).not.toBe(null);
    expect(fs.existsSync(healthy.filepath)).toBe(true);
    expect(db.deleteBrokenRecords('not-array')).toEqual({ removed: [], unbound: [] });
    expect(db.deleteBrokenRecords([99999999])).toEqual({ removed: [], unbound: [] });
  });

  it('删除时逐条重核验：扫描后文件回位的记录不被误删', async () => {
    const dir = tmpDir('restored');
    const [rec] = await db.importImages([makeImage('back.jpg', dir, 'b')]);
    fs.unlinkSync(rec.filepath);
    expect(db.findBrokenRecords().some((r) => r.id === rec.id)).toBe(true);
    fs.writeFileSync(rec.filepath, 'b'); // 扫描与点击之间文件回来了
    const res = db.deleteBrokenRecords([rec.id]);
    expect(res).toEqual({ removed: [], unbound: [] });
    expect(db.getImageById(rec.id)).not.toBe(null);
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

  it('旧根同前缀目录（images_backup）按目录边界判定越界，回退日期布局不逃出新根', async () => {
    const oldRoot = path.resolve(db.getImagesRoot());
    const dir = tmpDir('esc-src');
    const [img] = await db.importImages([makeImage('esc.jpg', dir, 'e')]);
    const outDir = path.join(oldRoot + '_backup', '2026-06');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'esc.jpg');
    fs.renameSync(img.filepath, outPath);
    db.__getDb().prepare('UPDATE images SET filepath = ? WHERE id = ?').run(outPath, img.id);
    const newRoot = path.resolve(tmpDir('esc-dst'));
    const res = await db.setImagesRoot(newRoot);
    expect(res.success).toBe(true);
    const rec = db.getImageById(img.id);
    // 旧实现 startsWith('…\\images') 误判 '…\\images_backup' 在旧根内，relative 出 '..' 逃到新根之外
    expect(rec.filepath.startsWith(newRoot + path.sep)).toBe(true);
    expect(fs.existsSync(rec.filepath)).toBe(true);
  });
});

describe('cleanupStaleBakeTemps 启动清扫（审查批 3）', () => {
  it('-temp 两种扩展形态与 .bake-tmp 残留清扫；受管文件与无匹配主名不动', async () => {
    const dir = tmpDir('baketemp');
    await db.importImages([
      makeImage('pair.jpg', dir, 'p'),
      makeImage('x.jpg', dir, 'x'),
      makeImage('x-temp.jpg', dir, 'xt'),
    ]);
    const rec = db.getAllImagePaths().find((r) => r.filepath.endsWith('pair.jpg'));
    const bdir = path.dirname(rec.filepath);
    const L = (n) => path.join(bdir, n);
    writeFile(L('pair-temp.jpg'), 't1');
    writeFile(L('pair-temp.jpeg.part'), 't2');
    writeFile(L('pair.jpg.bake-tmp'), 't3');
    writeFile(L('zombie-temp.jpg'), 'keep1'); // 主名 zombie 无对应图片：用户同名文件
    writeFile(L('w.nef.bake-tmp'), 'keep2'); // 主名 w 无对应图片
    expect(path.basename(bdir)).not.toBe('');

    const removed = db.cleanupStaleBakeTemps();
    expect(removed).toBeGreaterThanOrEqual(3);
    expect(fs.existsSync(L('pair-temp.jpg'))).toBe(false);
    expect(fs.existsSync(L('pair-temp.jpeg.part'))).toBe(false);
    expect(fs.existsSync(L('pair.jpg.bake-tmp'))).toBe(false);
    expect(fs.existsSync(L('zombie-temp.jpg'))).toBe(true);
    expect(fs.existsSync(L('w.nef.bake-tmp'))).toBe(true);
    expect(fs.existsSync(L('x-temp.jpg'))).toBe(true); // 受管文件：主名 x 命中但路径在管，跳过
    expect(fs.readFileSync(L('x-temp.jpg'), 'utf8')).toBe('xt');

    expect(db.cleanupStaleBakeTemps()).toBe(0); // 幂等：无残留可再删
  });
});

describe('审查批 7 O 链：唯一名连 DB 查重与改名/迁移一致性', () => {
  it('generateUniqueFilename：DB 占名但盘上无文件也派生 _1；excludeId 可豁免自身', async () => {
    const dir = tmpDir('taken');
    const [rec] = await db.importImages([makeImage('takenx.jpg', dir, 'tk')]);
    fs.unlinkSync(rec.filepath); // 记录仍占 filepath，盘上已无文件
    expect(db.generateUniqueFilename(path.dirname(rec.filepath), 'takenx.jpg')).toBe('takenx_1.jpg');
    expect(db.generateUniqueFilename(path.dirname(rec.filepath), 'takenx.jpg', { excludeId: rec.id })).toBe('takenx.jpg');
  });

  it('renameImage 拒绝改扩展名（含仅大小写漂移），等扩展名才放行', async () => {
    const dir = tmpDir('extguard');
    const [rec] = await db.importImages([makeImage('extg.jpg', dir, 'eg')]);
    expect(db.renameImage(rec.id, 'extg.png')).toEqual({ error: '不允许修改扩展名' });
    expect(db.renameImage(rec.id, 'extg.JPG')).toEqual({ error: '不允许修改扩展名' });
    expect(db.renameImage(rec.id, 'extg2.jpg')).toMatchObject({ success: true });
    expect(fs.existsSync(path.join(path.dirname(rec.filepath), 'extg2.jpg'))).toBe(true);
  });

  it('renameImage 目标名被失效记录占用（盘上不存在）时报同名冲突，文件不动', async () => {
    const dir = tmpDir('rmtaken');
    const [ghost] = await db.importImages([makeImage('ghostt.jpg', dir, 'gh')]);
    const [src] = await db.importImages([makeImage('srcmm.jpg', dir, 'sr')]);
    fs.unlinkSync(ghost.filepath);
    expect(db.renameImage(src.id, 'ghostt.jpg')).toEqual({ error: '同名文件已存在' });
    expect(fs.existsSync(src.filepath)).toBe(true);
    expect(db.getImageById(src.id).filepath).toBe(src.filepath);
  });

  it('改日期：目标 NEF 名被占位文件抢占时整体回滚，JPG/NEF 停在原位', async () => {
    const dir = tmpDir('datesquat');
    const [rec] = await db.importImages([makeImage('sq.jpg', dir, 's'), makeImage('sq.nef', dir, 'sn')]);
    const subDir = path.join(db.getImagesRoot(), '2032', '03', '03');
    writeFile(path.join(subDir, 'sq.nef'), 'squatter');
    const res = await db.updateImage(rec.id, { import_date: '2032-03-03' });
    expect(res.error).toContain('目标 NEF 文件名已被占用');
    expect(fs.existsSync(rec.filepath)).toBe(true);
    expect(fs.existsSync(rec.raw_path)).toBe(true);
    expect(db.getImageById(rec.id).filepath).toBe(rec.filepath);
    expect(fs.readFileSync(path.join(subDir, 'sq.nef'), 'utf8')).toBe('squatter');
  });

  it('迁移：主图缺失但 NEF 在盘——NEF 跟随迁移且绑定保留（旧实现 raw_path 写死空串）', async () => {
    const dir = tmpDir('mvraw');
    const [rec] = await db.importImages([makeImage('mvn.jpg', dir, 'm'), makeImage('mvn.nef', dir, 'mn')]);
    fs.unlinkSync(rec.filepath);
    const oldRaw = rec.raw_path;
    const newRoot = tmpDir('mvraw-dst');
    const res = await db.setImagesRoot(newRoot);
    expect(res.success).toBe(true);
    const after = db.getImageById(rec.id);
    expect(after.raw_path.startsWith(path.resolve(newRoot))).toBe(true);
    expect(fs.existsSync(after.raw_path)).toBe(true);
    expect(fs.readFileSync(after.raw_path, 'utf8')).toBe('mn');
    expect(fs.existsSync(oldRaw)).toBe(false);
    expect(fs.existsSync(after.filepath)).toBe(false);
  });

  it('迁移：两条记录规划到同一目标（一破一存）→ 后到者派生 _1，事务不再撞 UNIQUE', async () => {
    const dirA = tmpDir('dupA');
    const dirB = tmpDir('dupB');
    const [a] = await db.importImages([makeImage('dup.jpg', dirA, 'aaa')]);
    const [b] = await db.importImages([makeImage('dup.jpg', dirB, 'bbb')]);
    fs.unlinkSync(a.filepath);
    const raw = db.__getDb();
    const outA = path.join(dirA, 'ghost', 'dup.jpg');
    const outB = path.join(dirB, 'ghost', 'dup.jpg');
    writeFile(outB, 'bbb');
    raw.prepare('UPDATE images SET filepath = ?, import_date = ? WHERE id = ?').run(outA, '2034-01-01', a.id);
    raw.prepare('UPDATE images SET filepath = ?, import_date = ? WHERE id = ?').run(outB, '2034-01-01', b.id);
    const newRoot = tmpDir('dup-dst');
    const res = await db.setImagesRoot(newRoot);
    expect(res.success).toBe(true);
    const ra = db.getImageById(a.id);
    const rb = db.getImageById(b.id);
    expect(ra.filepath).toBe(path.join(path.resolve(newRoot), '2034', '01', '01', 'dup.jpg'));
    expect(rb.filepath).toBe(path.join(path.resolve(newRoot), '2034', '01', '01', 'dup_1.jpg'));
    expect(fs.existsSync(rb.filepath)).toBe(true);
    expect(fs.readFileSync(rb.filepath, 'utf8')).toBe('bbb');
    expect(fs.existsSync(ra.filepath)).toBe(false);
  });
});

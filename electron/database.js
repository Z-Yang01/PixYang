const path = require('path');
const { app } = require('electron');
const fs = require('fs');

let SQL;
let db;

const DB_PATH = path.join(app.getPath('userData'), 'pixyang.db');

// 图片统一存储目录（可从设置中覆盖）
let IMAGES_ROOT = path.join(app.getPath('userData'), 'images');

function getImagesRoot() {
  if (!fs.existsSync(IMAGES_ROOT)) {
    fs.mkdirSync(IMAGES_ROOT, { recursive: true });
  }
  return IMAGES_ROOT;
}

function getDatabasePath() {
  return DB_PATH;
}

function getObject(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

// Write sql.js WASM file to disk so it can be loaded
function getWasmPath() {
  const wasmDir = path.join(app.getPath('userData'), 'sqljs');
  if (!fs.existsSync(wasmDir)) {
    fs.mkdirSync(wasmDir, { recursive: true });
  }
  const sqljsPath = path.dirname(require.resolve('sql.js'));
  const wasmSource = path.join(sqljsPath, 'sql-wasm.wasm');
  const wasmDest = path.join(wasmDir, 'sql-wasm.wasm');
  if (!fs.existsSync(wasmDest) && fs.existsSync(wasmSource)) {
    fs.copyFileSync(wasmSource, wasmDest);
  }
  return wasmDest;
}

async function initDatabase() {
  const initSqlJs = require('sql.js');
  const wasmPath = getWasmPath();

  const SQLModule = await initSqlJs({ locateFile: () => wasmPath });
  SQL = SQLModule;

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');

  // ── 数据模型 v2 ──
  // images: 核心图片表
  //   - filepath: 本地管理目录中的路径（例如 images/2026/06/15/photo.jpg）
  //   - original_path: 导入时的原始路径（用于溯源）
  //   - import_date: 导入日期 YYYY-MM-DD（默认今天，可修改）
  //   - filename: 显示名称（可修改）
  //
  // tags + image_tags: 标签与图片的多对多关联
  //   - 这种设计使得一张图片可以有多个标签，一个标签可以关联多张图片
  //   - 未来可以轻松扩展：按标签组合筛选、标签统计、标签颜色等
  //
  // albums + album_images: 相册与图片的多对多关联
  //   - 一张图片可以属于多个相册

  db.run(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL UNIQUE,
      original_path TEXT DEFAULT '',
      raw_path TEXT DEFAULT '',
      original_raw_path TEXT DEFAULT '',
      hidden INTEGER DEFAULT 0,
      orientation INTEGER DEFAULT 1,
      rotation INTEGER DEFAULT 0,
      flip_h INTEGER DEFAULT 0,
      flip_v INTEGER DEFAULT 0,
      import_date TEXT NOT NULL DEFAULT '',
      taken_at TEXT DEFAULT '',
      size INTEGER DEFAULT 0,
      width INTEGER DEFAULT 0,
      height INTEGER DEFAULT 0,
      format TEXT DEFAULT '',
      thumbnail TEXT DEFAULT '',
      rating INTEGER DEFAULT 0,
      favorite INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#6366f1'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS image_tags (
      image_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (image_id, tag_id),
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      cover_image_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS album_images (
      album_id INTEGER NOT NULL,
      image_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      PRIMARY KEY (album_id, image_id),
      FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
    )
  `);

  // ── 设置表 (key-value) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 插入默认设置
  const defaults = {
    theme: 'dark',
    images_root: '',
    camera_folder: '',
    db_path: '',
    grid_rows: '3',
    grid_columns: '5',
    grid_gap: '12',
    content_padding: '16',
    orientation_backfilled: 'false',
  };
  for (const [k, v] of Object.entries(defaults)) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run([k, v]);
  }

  // 迁移旧表：如果不存在 import_date 列则添加
  migrateSchema();

  // 常用查询索引（hidden/import_date/favorite/taken_at）
  db.run('CREATE INDEX IF NOT EXISTS idx_images_hidden ON images(hidden)');
  db.run('CREATE INDEX IF NOT EXISTS idx_images_import_date ON images(import_date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_images_favorite ON images(favorite)');
  db.run('CREATE INDEX IF NOT EXISTS idx_images_taken_at ON images(taken_at)');

  // 从设置中读取自定义路径（如果有的话）
  const customImagesRoot = getSetting('images_root');
  if (customImagesRoot) {
    IMAGES_ROOT = customImagesRoot;
  }

  saveDatabase();
  console.log('[数据库] 已初始化:', DB_PATH);
  console.log('[数据库] 图片存储目录:', getImagesRoot());
  return db;
}

function migrateSchema() {
  try {
    // 检查是否需要添加新列
    const cols = db.exec('PRAGMA table_info(images)');
    if (cols.length > 0) {
      const colNames = cols[0].values.map(v => v[1]);
      if (!colNames.includes('import_date')) {
        db.run('ALTER TABLE images ADD COLUMN import_date TEXT DEFAULT ""');
      }
      if (!colNames.includes('taken_at')) {
        db.run('ALTER TABLE images ADD COLUMN taken_at TEXT DEFAULT ""');
      }
      if (!colNames.includes('original_path')) {
        db.run('ALTER TABLE images ADD COLUMN original_path TEXT DEFAULT ""');
      }
      if (!colNames.includes('raw_path')) {
        db.run('ALTER TABLE images ADD COLUMN raw_path TEXT DEFAULT ""');
      }
      if (!colNames.includes('original_raw_path')) {
        db.run('ALTER TABLE images ADD COLUMN original_raw_path TEXT DEFAULT ""');
      }
      if (!colNames.includes('hidden')) {
        db.run('ALTER TABLE images ADD COLUMN hidden INTEGER DEFAULT 0');
      }
      if (!colNames.includes('orientation')) {
        db.run('ALTER TABLE images ADD COLUMN orientation INTEGER DEFAULT 1');
      }
      if (!colNames.includes('rotation')) {
        db.run('ALTER TABLE images ADD COLUMN rotation INTEGER DEFAULT 0');
      }
      if (!colNames.includes('flip_h')) {
        db.run('ALTER TABLE images ADD COLUMN flip_h INTEGER DEFAULT 0');
      }
      if (!colNames.includes('flip_v')) {
        db.run('ALTER TABLE images ADD COLUMN flip_v INTEGER DEFAULT 0');
      }
      if (!colNames.includes('updated_at')) {
        db.run('ALTER TABLE images ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
      }
    }
  } catch (e) {
    console.log('[迁移] 可能是旧版数据库，尝试添加列:', e.message);
  }
}

let saveTimer = null;
// 防抖批量写入：大量连续操作（批量删除/回填/导入）只最终写盘一次，避免重复序列化整个数据库
function saveDatabase() {
  if (!db) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
      console.error('[数据库] 写入失败:', e.message);
    }
  }, 500);
}

// ── 图片存储路径生成 ──

function getImageSubDir(dateStr) {
  // dateStr: YYYY-MM-DD → 返回 YYYY/MM/DD
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return path.join(parts[0], parts[1], parts[2]);
  }
  // fallback: 今天
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return path.join(y, m, d);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function generateUniqueFilename(targetDir, originalName) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);

  let candidate = originalName;
  let counter = 1;
  while (fs.existsSync(path.join(targetDir, candidate))) {
    candidate = `${base}_${counter}${ext}`;
    counter++;
  }
  return candidate;
}

// ── Image Operations ──

function importImages(imageFiles) {
  // imageFiles: 从扫描结果传入，每项含 { filename, filepath(原始), size, format, ... }
  // 此函数负责：1.复制文件到管理目录 2.写入数据库
  // 同目录同主名的 jpg + nef 视为一对：jpg 作为可见记录，nef 复制到同目录并记入 raw_path
  const root = getImagesRoot();

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO images (filename, filepath, original_path, raw_path, original_raw_path, hidden, orientation, rotation, flip_h, flip_v, import_date, taken_at, size, width, height, format, thumbnail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const imported = [];

  // 按「源目录 + 主名」分组，找出 jpg/nef 配对
  const groups = new Map();
  for (const img of imageFiles) {
    const ext = path.extname(img.filename).toLowerCase();
    const base = path.basename(img.filename, ext).toLowerCase();
    const key = `${path.dirname(img.filepath)}::${base}`;
    if (!groups.has(key)) groups.set(key, { jpg: null, nef: null });
    const group = groups.get(key);
    if (ext === '.nef') {
      group.nef = img;
    } else {
      group.jpg = img;
      if (img.raw_source && !group.nef) {
        group.nef = { filename: img.raw_filename, filepath: img.raw_source, size: 0, format: '.nef' };
      }
    }
  }

  for (const group of groups.values()) {
    if (group.jpg) {
      const existing = getObject('SELECT * FROM images WHERE original_path = ?', [group.jpg.filepath]);
      if (existing) {
        if (!existing.raw_path && group.nef) {
          attachRawToImage(existing.id, group.nef.filepath, group.nef.filename);
        }
        continue;
      }
      const row = importOne(insertStmt, root, group.jpg, { pair: group.nef || null, hidden: false });
      if (row) imported.push(row);
    } else if (group.nef) {
      const asHidden = getObject('SELECT id FROM images WHERE original_path = ?', [group.nef.filepath]);
      const asPair = getObject('SELECT id FROM images WHERE original_raw_path = ?', [group.nef.filepath]);
      if (asHidden || asPair) continue;
      const row = importOne(insertStmt, root, group.nef, { pair: null, hidden: true });
      if (row) imported.push(row);
    }
  }

  insertStmt.free();
  saveDatabase();
  return imported;
}

function importOne(insertStmt, root, img, { pair, hidden }) {
  const dateStr = img.importDate || (() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  })();

  const subDir = path.join(root, ...dateStr.split('-'));
  ensureDir(subDir);

  const ext = path.extname(img.filename);
  const uniqueName = generateUniqueFilename(subDir, img.filename);
  const destPath = path.join(subDir, uniqueName);

  try {
    if (img.filepath !== destPath) {
      fs.copyFileSync(img.filepath, destPath);
    }
  } catch (err) {
    console.error('[导入] 复制失败:', img.filepath, err.message);
    return null;
  }

  let rawDestPath = '';
  let rawSourcePath = '';
  if (pair) {
    const rawName = `${path.basename(uniqueName, ext)}${path.extname(pair.filename)}`;
    rawDestPath = path.join(subDir, rawName);
    try {
      if (pair.filepath !== rawDestPath) {
        fs.copyFileSync(pair.filepath, rawDestPath);
      }
    } catch (err) {
      console.error('[导入] NEF 复制失败:', pair.filepath, err.message);
      rawDestPath = '';
      rawSourcePath = '';
    }
    rawSourcePath = pair.filepath;
  }

  insertStmt.run([
    uniqueName,
    destPath,
    img.filepath,
    rawDestPath,
    rawSourcePath,
    hidden ? 1 : 0,
    Number(img.orientation) || 1,
    0,
    0,
    0,
    dateStr,
    img.takenAt || '',
    img.size || 0,
    img.width || 0,
    img.height || 0,
    img.format || '',
    hidden ? '' : (img.thumbnail || ''),
  ]);

  return db.prepare('SELECT * FROM images WHERE filepath = ?').getAsObject([destPath]);
}

function getImages(options = {}) {
  const {
    tagId = null,
    albumId = null,
    dateFrom = '',       // YYYY-MM-DD
    dateTo = '',         // YYYY-MM-DD
    importDate = '',     // 精确匹配某一天的导入日期
    favorite = false,
    search = '',
    sortBy = 'import_date',
    sortOrder = 'DESC',
    limit = 200,
    offset = 0,
  } = options;

  let query = 'SELECT DISTINCT i.* FROM images i';
  const params = [];
  const conditions = [];
  const joins = [];

  conditions.push('i.hidden = 0');

  if (tagId) {
    joins.push('JOIN image_tags it ON i.id = it.image_id');
    conditions.push('it.tag_id = ?');
    params.push(tagId);
  }

  if (albumId) {
    joins.push('JOIN album_images ai ON i.id = ai.image_id');
    conditions.push('ai.album_id = ?');
    params.push(albumId);
  }

  if (importDate) {
    conditions.push('i.import_date = ?');
    params.push(importDate);
  } else {
    if (dateFrom) {
      conditions.push('i.import_date >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('i.import_date <= ?');
      params.push(dateTo);
    }
  }

  if (favorite) {
    conditions.push('i.favorite = 1');
  }

  if (search) {
    conditions.push('i.filename LIKE ?');
    params.push(`%${search}%`);
  }

  const joinClause = joins.join(' ');
  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  query += ` ${joinClause} ${whereClause}`;

  // Count total
  const countQuery = query.replace('SELECT DISTINCT i.*', 'SELECT COUNT(DISTINCT i.id) as total');
  const total = getObject(countQuery, params)?.total || 0;

  // Sort
  const allowedSorts = ['import_date', 'created_at', 'filename', 'size', 'rating'];
  const safeSort = allowedSorts.includes(sortBy) ? sortBy : 'import_date';
  const safeOrder = sortOrder === 'ASC' ? 'ASC' : 'DESC';

  // 日期排序优先用拍摄时间（taken_at，精确到分钟），无则回退导入日期；次级按 id 保证顺序稳定
  if (safeSort === 'import_date') {
    const tie = safeOrder === 'ASC' ? 'ASC' : 'DESC';
    query += ` ORDER BY CASE WHEN i.taken_at != '' THEN i.taken_at ELSE i.import_date END ${safeOrder}, i.id ${tie}`;
  } else {
    query += ` ORDER BY i.${safeSort} ${safeOrder}`;
  }
  query += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const images = [];
  const stmt = db.prepare(query);
  stmt.bind(params);
  while (stmt.step()) {
    images.push(stmt.getAsObject());
  }
  stmt.free();

  return { images, total };
}

function getImageById(id) {
  return getObject('SELECT * FROM images WHERE id = ?', [id]);
}

// 返回所有图片的 id 与 filepath（用于方向回填）
function getAllImagePaths() {
  const stmt = db.prepare('SELECT id, filepath FROM images');
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// 返回可见图片的 id 与 filepath；all=true 重建全部，否则只取缺失缩略图的
function getImagesForRebuild(all = false) {
  const where = all ? 'hidden = 0' : 'hidden = 0 AND thumbnail = ""';
  const stmt = db.prepare(`SELECT id, filepath, filename FROM images WHERE ${where}`);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// 更新单张图片的方向标记
function updateImageOrientation(id, orientation) {
  db.prepare('UPDATE images SET orientation = ? WHERE id = ?').run([orientation, id]);
  saveDatabase();
}

// 返回所有可见图片的 id（用于跨页全选）
function getAllVisibleIds(options = {}) {
  const { tagId, albumId, dateFrom, dateTo, importDate, favorite, search } = options;
  let query = 'SELECT DISTINCT i.id FROM images i';
  const params = [];
  const conditions = ['i.hidden = 0'];
  const joins = [];

  if (tagId) {
    joins.push('JOIN image_tags it ON i.id = it.image_id');
    conditions.push('it.tag_id = ?');
    params.push(tagId);
  }
  if (albumId) {
    joins.push('JOIN album_images ai ON i.id = ai.image_id');
    conditions.push('ai.album_id = ?');
    params.push(albumId);
  }
  if (importDate) {
    conditions.push('i.import_date = ?');
    params.push(importDate);
  } else {
    if (dateFrom) {
      conditions.push('i.import_date >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('i.import_date <= ?');
      params.push(dateTo);
    }
  }
  if (favorite) {
    conditions.push('i.favorite = 1');
  }
  if (search) {
    conditions.push('i.filename LIKE ?');
    params.push(`%${search}%`);
  }

  query += ` ${joins.join(' ')} WHERE ${conditions.join(' AND ')}`;

  const stmt = db.prepare(query);
  stmt.bind(params);
  const ids = [];
  while (stmt.step()) {
    ids.push(stmt.getAsObject().id);
  }
  stmt.free();
  return ids;
}

function updateImage(id, updates) {
  // 修改导入日期时，将文件移动到新日期目录（JPG 与配对 NEF 一起移动）
  if (updates.import_date) {
    const newDate = String(updates.import_date).trim();
    if (newDate && /^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      const img = getImageById(id);
      if (img && img.import_date !== newDate) {
        const root = getImagesRoot();
        const subDir = path.join(root, ...newDate.split('-'));
        ensureDir(subDir);
        const newName = generateUniqueFilename(subDir, img.filename);
        const newPath = path.join(subDir, newName);
        let newRawPath = img.raw_path || '';

        try {
          if (fs.existsSync(img.filepath) && img.filepath !== newPath) {
            moveFileSafe(img.filepath, newPath);
          }
          if (img.raw_path) {
            const targetBase = path.basename(newPath, path.extname(newPath));
            const rawExt = path.extname(img.raw_path);
            newRawPath = path.join(subDir, `${targetBase}${rawExt}`);
            if (fs.existsSync(img.raw_path) && img.raw_path !== newRawPath) {
              moveFileSafe(img.raw_path, newRawPath);
            }
          }
        } catch (err) {
          console.error('[日期] 移动文件失败:', err.message);
          return { error: `移动文件失败：${err.message}` };
        }

        db.prepare('UPDATE images SET filename = ?, filepath = ?, raw_path = ? WHERE id = ?')
          .run([path.basename(newPath), newPath, newRawPath, id]);
      }
    }
  }

  const allowed = ['filename', 'rating', 'favorite', 'notes', 'width', 'height', 'thumbnail', 'import_date', 'rotation', 'flipH', 'flipV'];
  const sets = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (sets.length === 0) return true;

  params.push(id);
  db.prepare(`UPDATE images SET ${sets.join(', ')} WHERE id = ?`).run(params);
  saveDatabase();
  return true;
}

function renameImage(id, newFilename) {
  const img = getImageById(id);
  if (!img) return false;

  const oldPath = img.filepath;
  const newPath = path.join(path.dirname(oldPath), newFilename);

  // 检查是否已存在同名文件
  if (fs.existsSync(newPath) && oldPath !== newPath) {
    return { error: '同名文件已存在' };
  }

  // 配对 NEF 跟随重命名，保持相同主名
  let newRawPath = img.raw_path || '';
  if (img.raw_path) {
    const oldExt = path.extname(img.filename);
    const rawExt = path.extname(img.raw_path);
    const newRawName = `${path.basename(newFilename, oldExt)}${rawExt}`;
    const candidateRaw = path.join(path.dirname(img.raw_path), newRawName);
    if (fs.existsSync(candidateRaw) && candidateRaw !== img.raw_path) {
      return { error: '同名文件已存在' };
    }
    newRawPath = candidateRaw;
  }

  try {
    if (oldPath !== newPath) {
      fs.renameSync(oldPath, newPath);
    }
    if (img.raw_path && newRawPath !== img.raw_path) {
      fs.renameSync(img.raw_path, newRawPath);
    }
  } catch (err) {
    return { error: '重命名失败: ' + err.message };
  }

  db.prepare('UPDATE images SET filename = ?, filepath = ?, raw_path = ? WHERE id = ?')
    .run([newFilename, newPath, newRawPath, id]);
  saveDatabase();
  return { success: true, newFilename, newPath };
}

function moveFileSafe(oldPath, newPath) {
  ensureDir(path.dirname(newPath));
  try {
    fs.renameSync(oldPath, newPath);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(oldPath, newPath);
    fs.unlinkSync(oldPath);
  }
}

function setImagesRoot(newRoot) {
  if (!newRoot || typeof newRoot !== 'string') {
    return { error: '保存路径无效' };
  }

  const oldRoot = getImagesRoot();
  const resolvedNewRoot = path.resolve(newRoot);
  ensureDir(resolvedNewRoot);

  if (path.resolve(oldRoot) === resolvedNewRoot) {
    setSetting('images_root', resolvedNewRoot);
    IMAGES_ROOT = resolvedNewRoot;
    return { success: true, path: resolvedNewRoot, moved: 0 };
  }

  const stmt = db.prepare('SELECT id, filename, filepath, raw_path, import_date FROM images');
  const images = [];
  while (stmt.step()) images.push(stmt.getAsObject());
  stmt.free();

  let moved = 0;
  for (const img of images) {
    let relativePath = '';
    const normalizedOldRoot = path.resolve(oldRoot);
    const normalizedFile = path.resolve(img.filepath);

    if (normalizedFile.startsWith(normalizedOldRoot)) {
      relativePath = path.relative(normalizedOldRoot, normalizedFile);
    } else {
      relativePath = path.join(getImageSubDir(img.import_date || ''), img.filename);
    }

    let targetPath = path.join(resolvedNewRoot, relativePath);
    const targetDir = path.dirname(targetPath);
    const uniqueName = generateUniqueFilename(targetDir, path.basename(targetPath));
    targetPath = path.join(targetDir, uniqueName);

    try {
      if (fs.existsSync(img.filepath)) {
        moveFileSafe(img.filepath, targetPath);
        moved++;
      }

      // 配对 NEF 跟随移动，保持与 JPG 相同主名
      let newRawPath = '';
      if (img.raw_path) {
        const targetBase = path.basename(targetPath, path.extname(targetPath));
        const rawExt = path.extname(img.raw_path);
        newRawPath = path.join(targetDir, `${targetBase}${rawExt}`);
        if (fs.existsSync(img.raw_path)) {
          moveFileSafe(img.raw_path, newRawPath);
        } else {
          newRawPath = '';
        }
      }

      db.prepare('UPDATE images SET filename = ?, filepath = ?, raw_path = ? WHERE id = ?')
        .run([path.basename(targetPath), targetPath, newRawPath, img.id]);
    } catch (err) {
      return { error: `移动失败：${img.filename} - ${err.message}` };
    }
  }

  IMAGES_ROOT = resolvedNewRoot;
  setSetting('images_root', resolvedNewRoot);
  saveDatabase();
  return { success: true, path: resolvedNewRoot, moved };
}

// ── 相机同步 ──

const VISIBLE_FORMATS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.tiff'];

function scanImageFiles(dirPath, includeRaw = false) {
  const supported = includeRaw ? [...VISIBLE_FORMATS, '.nef'] : VISIBLE_FORMATS;
  const files = [];

  (function scan(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (supported.includes(ext)) {
            const stat = fs.statSync(fullPath);
            files.push({
              filename: entry.name,
              filepath: fullPath,
              size: stat.size,
              format: ext,
              width: 0,
              height: 0,
            });
          }
        }
      }
    } catch (err) {
      console.error('[扫描] 错误:', dir, err.message);
    }
  })(dirPath);

  // 普通导入（不包含 .nef）时，为 JPG 检测同目录同名 NEF，便于导入时配对
  if (!includeRaw) {
    for (const f of files) {
      if (f.format === '.jpg' || f.format === '.jpeg') {
        const dir = path.dirname(f.filepath);
        const base = path.basename(f.filename, path.extname(f.filename)).toLowerCase();
        try {
          const match = fs.readdirSync(dir).find(n => {
            const ext = path.extname(n);
            return ext.toLowerCase() === '.nef' && path.basename(n, ext).toLowerCase() === base;
          });
          if (match) {
            const rawPath = path.join(dir, match);
            f.raw_source = rawPath;
            f.raw_filename = match;
          }
        } catch (err) {
          console.error('[扫描] 检测 NEF 失败:', dir, err.message);
        }
      }
    }
  }

  return files;
}

// 过滤相机文件夹中图库不存在的文件，返回待导入列表与需附加的 NEF
function prepareCameraSync(imageFiles) {
  const groups = new Map();
  for (const f of imageFiles) {
    const ext = path.extname(f.filename).toLowerCase();
    const base = path.basename(f.filename, ext).toLowerCase();
    const key = `${path.dirname(f.filepath)}::${base}`;
    if (!groups.has(key)) groups.set(key, { jpg: null, nef: null });
    const group = groups.get(key);
    if (ext === '.nef') group.nef = f;
    else group.jpg = f;
  }

  const toImport = [];
  const attachPairs = [];
  let skipped = 0;

  for (const group of groups.values()) {
    if (group.jpg) {
      const existing = getObject('SELECT * FROM images WHERE original_path = ?', [group.jpg.filepath]);
      if (existing) {
        if (!existing.raw_path && group.nef) {
          attachPairs.push({ jpgId: existing.id, nefSource: group.nef.filepath, nefFilename: group.nef.filename });
        }
        skipped++;
      } else {
        toImport.push(group.jpg);
        if (group.nef) toImport.push(group.nef);
      }
    } else if (group.nef) {
      const asHidden = getObject('SELECT id FROM images WHERE original_path = ?', [group.nef.filepath]);
      const asPair = getObject('SELECT id FROM images WHERE original_raw_path = ?', [group.nef.filepath]);
      if (asHidden || asPair) {
        skipped++;
      } else {
        toImport.push(group.nef);
      }
    }
  }

  return { toImport, attachPairs, skipped };
}

// 将已导入 JPG 的配对 NEF 复制到同目录并记录 raw_path
function attachRawToImage(imageId, nefSource, nefFilename) {
  const img = getImageById(imageId);
  if (!img || img.raw_path) return false;

  const ext = path.extname(nefFilename);
  const rawName = `${path.basename(img.filename, path.extname(img.filename))}${ext}`;
  const rawDest = path.join(path.dirname(img.filepath), rawName);
  ensureDir(path.dirname(rawDest));
  if (fs.existsSync(rawDest)) return false;

  try {
    fs.copyFileSync(nefSource, rawDest);
  } catch (err) {
    console.error('[相机同步] NEF 复制失败:', nefSource, err.message);
    return false;
  }

  db.prepare('UPDATE images SET raw_path = ?, original_raw_path = ? WHERE id = ?')
    .run([rawDest, nefSource, imageId]);
  saveDatabase();
  return true;
}

// 删除图片：硬删除（删除本地文件含配对 NEF + 清理 DB 关联）
function deleteImage(id) {
  const img = getImageById(id);
  if (!img) return false;

  const targets = [img.filepath, img.raw_path].filter(Boolean);
  for (const p of targets) {
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    } catch (e) {
      console.error('[删除] 删除文件失败:', e.message);
    }
  }

  db.prepare('DELETE FROM image_tags WHERE image_id = ?').run([id]);
  db.prepare('DELETE FROM album_images WHERE image_id = ?').run([id]);
  db.prepare('DELETE FROM images WHERE id = ?').run([id]);
  saveDatabase();
  return img;
}

// ── 日期相关 ──

function getImportDates() {
  // 返回所有有图片的导入日期（用于日期筛选器）
  const rows = db.exec(`
    SELECT import_date, COUNT(*) as count
    FROM images
    WHERE hidden = 0 AND import_date != ''
    GROUP BY import_date
    ORDER BY import_date DESC
  `);
  if (!rows.length || !rows[0].values.length) return [];
  return rows[0].values.map(v => ({ date: v[0], count: v[1] }));
}

// ── Tag Operations ──

function getTags() {
  const stmt = db.prepare(`
    SELECT t.*, COUNT(it.image_id) as image_count
    FROM tags t
    LEFT JOIN image_tags it ON t.id = it.tag_id
    GROUP BY t.id
    ORDER BY t.name
  `);
  const tags = [];
  while (stmt.step()) {
    tags.push(stmt.getAsObject());
  }
  stmt.free();
  return tags;
}

function createTag(name, color = '#6366f1') {
  try {
    db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run([name, color]);
    saveDatabase();
    return getObject('SELECT * FROM tags WHERE name = ?', [name]);
  } catch {
    return null; // 重名
  }
}

function deleteTag(id) {
  db.prepare('DELETE FROM image_tags WHERE tag_id = ?').run([id]);
  db.prepare('DELETE FROM tags WHERE id = ?').run([id]);
  saveDatabase();
}

function addTagToImage(imageId, tagId) {
  try {
    db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)').run([imageId, tagId]);
    saveDatabase();
    return true;
  } catch {
    return false;
  }
}

function removeTagFromImage(imageId, tagId) {
  db.prepare('DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?').run([imageId, tagId]);
  saveDatabase();
}

function getImageTags(imageId) {
  const stmt = db.prepare(`
    SELECT t.* FROM tags t
    JOIN image_tags it ON t.id = it.tag_id
    WHERE it.image_id = ?
  `);
  stmt.bind([imageId]);
  const tags = [];
  while (stmt.step()) {
    tags.push(stmt.getAsObject());
  }
  stmt.free();
  return tags;
}

// 批量查询多张图片的标签，返回 { [imageId]: [tag, ...] }（单次 SQL）
function getBatchImageTags(imageIds) {
  const result = {};
  if (!imageIds || imageIds.length === 0) return result;
  const placeholders = imageIds.map(() => '?').join(',');
  const stmt = db.prepare(`
    SELECT it.image_id, t.* FROM tags t
    JOIN image_tags it ON t.id = it.tag_id
    WHERE it.image_id IN (${placeholders})
  `);
  stmt.bind(imageIds);
  while (stmt.step()) {
    const row = stmt.getAsObject();
    if (!result[row.image_id]) result[row.image_id] = [];
    result[row.image_id].push(row);
  }
  stmt.free();
  return result;
}

// ── Album Operations ──

function getAlbums() {
  const stmt = db.prepare(`
    SELECT a.*, COUNT(ai.image_id) as image_count
    FROM albums a
    LEFT JOIN album_images ai ON a.id = ai.album_id
    GROUP BY a.id
    ORDER BY a.created_at DESC
  `);
  const albums = [];
  while (stmt.step()) {
    albums.push(stmt.getAsObject());
  }
  stmt.free();
  return albums;
}

function createAlbum(name, description = '') {
  db.prepare('INSERT INTO albums (name, description) VALUES (?, ?)').run([name, description]);
  saveDatabase();
  return getObject('SELECT * FROM albums WHERE name = ? ORDER BY id DESC LIMIT 1', [name]);
}

function renameAlbum(id, newName) {
  db.prepare('UPDATE albums SET name = ? WHERE id = ?').run([newName, id]);
  saveDatabase();
  return true;
}

function getAlbumImages(albumId) {
  const stmt = db.prepare('SELECT i.* FROM images i JOIN album_images ai ON i.id = ai.image_id WHERE ai.album_id = ? AND i.hidden = 0');
  stmt.bind([albumId]);
  const images = [];
  while (stmt.step()) images.push(stmt.getAsObject());
  stmt.free();
  return images;
}

function deleteAlbum(id) {
  db.prepare('DELETE FROM album_images WHERE album_id = ?').run([id]);
  db.prepare('DELETE FROM albums WHERE id = ?').run([id]);
  saveDatabase();
}

function addToAlbum(albumId, imageIds) {
  const stmt = db.prepare('INSERT OR IGNORE INTO album_images (album_id, image_id) VALUES (?, ?)');
  for (const imageId of imageIds) {
    stmt.run([albumId, imageId]);
  }
  stmt.free();
  saveDatabase();
}

function removeFromAlbum(albumId, imageId) {
  db.prepare('DELETE FROM album_images WHERE album_id = ? AND image_id = ?').run([albumId, imageId]);
  saveDatabase();
}

// ── Settings Operations ──

function getSetting(key) {
  const row = getObject('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run([key, value]);
  saveDatabase();
}

function getAllSettings() {
  const stmt = db.prepare('SELECT key, value FROM settings');
  const settings = {};
  while (stmt.step()) {
    const row = stmt.getAsObject();
    settings[row.key] = row.value;
  }
  stmt.free();
  return settings;
}

// ── Batch Delete ──

function batchDeleteImages(ids) {
  const results = [];
  for (const id of ids) {
    const r = deleteImage(id);
    if (r) results.push(r);
  }
  return results;
}

// ── Stats ──

function getStats() {
  const totalImages = getObject('SELECT COUNT(*) as count FROM images WHERE hidden = 0')?.count || 0;
  const totalTags = getObject('SELECT COUNT(*) as count FROM tags')?.count || 0;
  const totalAlbums = getObject('SELECT COUNT(*) as count FROM albums')?.count || 0;
  const favorites = getObject('SELECT COUNT(*) as count FROM images WHERE favorite = 1 AND hidden = 0')?.count || 0;
  return { totalImages, totalTags, totalAlbums, favorites };
}

module.exports = {
  initDatabase,
  saveDatabase,
  getImagesRoot,
  getDatabasePath,
  setImagesRoot,
  scanImageFiles,
  prepareCameraSync,
  attachRawToImage,
  getImageSubDir,
  ensureDir,
  generateUniqueFilename,
  importImages,
  getImages,
  getImageById,
  getAllVisibleIds,
  getAllImagePaths,
  getImagesForRebuild,
  updateImageOrientation,
  updateImage,
  renameImage,
  deleteImage,
  batchDeleteImages,
  getImportDates,
  getTags,
  createTag,
  deleteTag,
  addTagToImage,
  removeTagFromImage,
  getImageTags,
  getBatchImageTags,
  getAlbums,
  createAlbum,
  renameAlbum,
  deleteAlbum,
  addToAlbum,
  removeFromAlbum,
  getAlbumImages,
  getStats,
  getSetting,
  setSetting,
  getAllSettings,
};

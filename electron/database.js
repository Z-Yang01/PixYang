const crypto = require('crypto');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');
const Database = require('better-sqlite3');
const { upgradeEdits, DEFAULT_EDITS, HISTORY_LIMIT } = require('../shared/editSchema.cjs');

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

function getThumbnailsDir() {
  const dir = path.join(app.getPath('userData'), 'thumbnails');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getThumbnailFilePath(id) {
  return path.join(getThumbnailsDir(), `${id}.jpg`);
}

function getThumbnailSmallFilePath(id) {
  return path.join(getThumbnailsDir(), `${id}_s.jpg`);
}

function deleteThumbnailFile(id) {
  try {
    for (const p of [getThumbnailFilePath(id), getThumbnailSmallFilePath(id)]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch (e) {
    console.error('[缩略图] 删除文件失败:', e.message);
  }
}

function getObject(sql, params = []) {
  return db.prepare(sql).get(...params) || null;
}

// 批量 IN 查询的 id 分块，避免超出 SQLite 变量数上限
function chunkIds(ids, size = 900) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}


async function initDatabase() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);

  // WAL 模式：写操作即时持久化并具备崩溃恢复能力，不再整库序列化落盘
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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

  db.exec(`
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
      thumbnail_path TEXT DEFAULT '',
      thumbnail_small_path TEXT DEFAULT '',
      rating INTEGER DEFAULT 0,
      favorite INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#6366f1'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS image_tags (
      image_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (image_id, tag_id),
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      cover_image_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
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
  db.exec(`
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
    sort_by: 'import_date',
    sort_order: 'DESC',
  };
  for (const [k, v] of Object.entries(defaults)) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);
  }

  // 迁移旧表：如果不存在 import_date 列则添加
  migrateSchema();

  // ── 非破坏编辑：参数 / 历史 / 预设（LR-like，collections 复用 albums）──
  db.exec(`
    CREATE TABLE IF NOT EXISTS edits (
      image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 0,
      params_json TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS edit_history (
      image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      step INTEGER NOT NULL,
      command_json TEXT NOT NULL,
      PRIMARY KEY (image_id, step)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      params_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 旧库一次性迁移：base64 缩略图落盘为文件，避免数据库膨胀与查询携带大字段
  migrateThumbnailsToFiles();

  // 常用查询索引：隐藏过滤 + 排序/筛选字段组合，避免大库全表扫描
  db.exec('CREATE INDEX IF NOT EXISTS idx_images_hidden ON images(hidden)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_images_import_date ON images(import_date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_images_favorite ON images(favorite)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_images_taken_at ON images(taken_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_images_filename ON images(filename)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_images_original_path ON images(original_path)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_images_original_raw_path ON images(original_raw_path)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_images_hidden_import_date ON images(hidden, import_date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_images_hidden_taken_at ON images(hidden, taken_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_images_hidden_favorite ON images(hidden, favorite)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_image_tags_tag_id ON image_tags(tag_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_album_images_image_id ON album_images(image_id)');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_images_visible_sort_date ON images(hidden, CASE WHEN taken_at != \'\' THEN taken_at ELSE import_date END, id)'
  );

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
    const cols = db.pragma('table_info(images)');
    if (cols.length > 0) {
      const colNames = cols.map(v => v.name);
      if (!colNames.includes('import_date')) {
        db.exec('ALTER TABLE images ADD COLUMN import_date TEXT DEFAULT ""');
      }
      if (!colNames.includes('taken_at')) {
        db.exec('ALTER TABLE images ADD COLUMN taken_at TEXT DEFAULT ""');
      }
      if (!colNames.includes('original_path')) {
        db.exec('ALTER TABLE images ADD COLUMN original_path TEXT DEFAULT ""');
      }
      if (!colNames.includes('raw_path')) {
        db.exec('ALTER TABLE images ADD COLUMN raw_path TEXT DEFAULT ""');
      }
      if (!colNames.includes('original_raw_path')) {
        db.exec('ALTER TABLE images ADD COLUMN original_raw_path TEXT DEFAULT ""');
      }
      if (!colNames.includes('hidden')) {
        db.exec('ALTER TABLE images ADD COLUMN hidden INTEGER DEFAULT 0');
      }
      if (!colNames.includes('orientation')) {
        db.exec('ALTER TABLE images ADD COLUMN orientation INTEGER DEFAULT 1');
      }
      if (!colNames.includes('rotation')) {
        db.exec('ALTER TABLE images ADD COLUMN rotation INTEGER DEFAULT 0');
      }
      if (!colNames.includes('flip_h')) {
        db.exec('ALTER TABLE images ADD COLUMN flip_h INTEGER DEFAULT 0');
      }
      if (!colNames.includes('flip_v')) {
        db.exec('ALTER TABLE images ADD COLUMN flip_v INTEGER DEFAULT 0');
      }
      if (!colNames.includes('updated_at')) {
        db.exec('ALTER TABLE images ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
      }
      if (!colNames.includes('thumbnail_path')) {
        db.exec('ALTER TABLE images ADD COLUMN thumbnail_path TEXT DEFAULT ""');
      }
      if (!colNames.includes('thumbnail_small_path')) {
        db.exec('ALTER TABLE images ADD COLUMN thumbnail_small_path TEXT DEFAULT ""');
      }
      // 非破坏编辑：内容哈希（缓存失效/去重）与旗标
      if (!colNames.includes('hash')) {
        db.exec('ALTER TABLE images ADD COLUMN hash TEXT DEFAULT ""');
      }
      if (!colNames.includes('flag')) {
        db.exec('ALTER TABLE images ADD COLUMN flag INTEGER DEFAULT 0');
      }
    }
  } catch (e) {
    console.log('[迁移] 可能是旧版数据库，尝试添加列:', e.message);
  }
}

// 一次性迁移：把 thumbnail 列中的 base64 缩略图写入文件并清空该列
function migrateThumbnailsToFiles() {
  try {
    const rows = db.prepare("SELECT id, thumbnail FROM images WHERE thumbnail != ''").all();
    if (rows.length === 0) return;

    const dir = getThumbnailsDir();
    const updateStmt = db.prepare('UPDATE images SET thumbnail_path = ?, thumbnail = "" WHERE id = ?');
    const clearStmt = db.prepare('UPDATE images SET thumbnail = "" WHERE id = ?');
    for (const r of rows) {
      try {
        const raw = String(r.thumbnail || '');
        const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
        const buf = Buffer.from(base64, 'base64');
        if (buf.length === 0) {
          clearStmt.run(r.id);
          continue;
        }
        const thumbPath = path.join(dir, `${r.id}.jpg`);
        fs.writeFileSync(thumbPath, buf);
        updateStmt.run(thumbPath, r.id);
      } catch (e) {
        console.error('[迁移] 缩略图写文件失败:', r.id, e.message);
      }
    }
    console.log(`[迁移] 已将 ${rows.length} 张缩略图迁移为文件存储`);
  } catch (e) {
    console.error('[迁移] 缩略图迁移失败:', e.message);
  }
}

// WAL 模式下写操作即时持久化；保留入口以兼容既有调用点与测试
function saveDatabase() {}

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

async function importImages(imageFiles) {
  // imageFiles: 从扫描结果传入，每项含 { filename, filepath(原始), size, format, ... }
  // 此函数负责：1.复制文件到管理目录 2.写入数据库
  // 同目录同主名的 jpg + nef 视为一对：jpg 作为可见记录，nef 复制到同目录并记入 raw_path
  const root = getImagesRoot();

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
          await attachRawToImage(existing.id, group.nef.filepath, group.nef.filename);
        }
        continue;
      }
      const row = await importOne(root, group.jpg, { pair: group.nef || null, hidden: false });
      if (row) imported.push(row);
    } else if (group.nef) {
      const asHidden = getObject('SELECT id FROM images WHERE original_path = ?', [group.nef.filepath]);
      const asPair = getObject('SELECT id FROM images WHERE original_raw_path = ?', [group.nef.filepath]);
      if (asHidden || asPair) continue;
      const row = await importOne(root, group.nef, { pair: null, hidden: true });
      if (row) imported.push(row);
    }
  }

  saveDatabase();
  return imported;
}

async function importOne(root, img, { pair, hidden }) {
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
      await fs.promises.copyFile(img.filepath, destPath);
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
        await fs.promises.copyFile(pair.filepath, rawDestPath);
      }
    } catch (err) {
      console.error('[导入] NEF 复制失败:', pair.filepath, err.message);
      rawDestPath = '';
      rawSourcePath = '';
    }
    rawSourcePath = pair.filepath;
  }

  db.prepare(`
    INSERT OR IGNORE INTO images (filename, filepath, original_path, raw_path, original_raw_path, hidden, orientation, rotation, flip_h, flip_v, import_date, taken_at, size, width, height, format, thumbnail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
    hidden ? '' : (img.thumbnail || '')
  );

  return db.prepare('SELECT * FROM images WHERE filepath = ?').get(destPath) || null;
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
    conditions.push('(i.filename LIKE ? OR i.notes LIKE ? OR i.id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON t.id = it.tag_id WHERE t.name LIKE ?))');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
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

  const images = db.prepare(query).all(...params);

  return { images, total };
}

function getImageById(id) {
  return getObject('SELECT * FROM images WHERE id = ?', [id]);
}

// 返回所有图片的 id 与 filepath（用于方向回填）
function getAllImagePaths() {
  return db.prepare('SELECT id, filepath FROM images').all();
}

// 返回可见图片的 id 与 filepath；all=true 重建全部，否则只取缺失缩略图的
// （竖图现在也生成缩略图：worker 内 sharp .rotate() 按 EXIF 方向转正）
function getImagesForRebuild(all = false) {
  const where = all
    ? 'hidden = 0'
    : "hidden = 0 AND (thumbnail_path = '' OR thumbnail_small_path = '')";
  return db.prepare(`SELECT id, filepath, filename FROM images WHERE ${where}`).all();
}

// 更新单张图片的方向标记
function updateImageOrientation(id, orientation) {
  db.prepare('UPDATE images SET orientation = ? WHERE id = ?').run(orientation, id);
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
    conditions.push('(i.filename LIKE ? OR i.notes LIKE ? OR i.id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON t.id = it.tag_id WHERE t.name LIKE ?))');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ` ${joins.join(' ')} WHERE ${conditions.join(' AND ')}`;

  const ids = db.prepare(query).all(...params).map(r => r.id);
  return ids;
}

async function updateImage(id, updates) {
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
            await moveFileSafe(img.filepath, newPath);
          }
          if (img.raw_path) {
            const targetBase = path.basename(newPath, path.extname(newPath));
            const rawExt = path.extname(img.raw_path);
            newRawPath = path.join(subDir, `${targetBase}${rawExt}`);
            if (fs.existsSync(img.raw_path) && img.raw_path !== newRawPath) {
              await moveFileSafe(img.raw_path, newRawPath);
            }
          }
        } catch (err) {
          console.error('[日期] 移动文件失败:', err.message);
          return { error: `移动文件失败：${err.message}` };
        }

        db.prepare('UPDATE images SET filename = ?, filepath = ?, raw_path = ? WHERE id = ?')
          .run(path.basename(newPath), newPath, newRawPath, id);
      }
    }
  }

  const allowed = ['filename', 'rating', 'favorite', 'notes', 'width', 'height', 'thumbnail', 'thumbnail_path', 'thumbnail_small_path', 'import_date', 'rotation', 'flip_h', 'flip_v'];
  const aliases = { flipH: 'flip_h', flipV: 'flip_v' };
  const sets = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    const column = aliases[key] || key;
    if (allowed.includes(column)) {
      sets.push(`${column} = ?`);
      params.push(value);
    }
  }

  if (sets.length === 0) return true;

  params.push(id);
  db.prepare(`UPDATE images SET ${sets.join(', ')} WHERE id = ?`).run(...params);
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
    .run(newFilename, newPath, newRawPath, id);
  saveDatabase();
  return { success: true, newFilename, newPath };
}

async function moveFileSafe(oldPath, newPath) {
  ensureDir(path.dirname(newPath));
  try {
    await fs.promises.rename(oldPath, newPath);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fs.promises.copyFile(oldPath, newPath);
    await fs.promises.unlink(oldPath);
  }
}

function moveFileSafeSync(oldPath, newPath) {
  ensureDir(path.dirname(newPath));
  try {
    fs.renameSync(oldPath, newPath);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(oldPath, newPath);
    fs.unlinkSync(oldPath);
  }
}

async function setImagesRoot(newRoot) {
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

  const images = db.prepare('SELECT id, filename, filepath, raw_path, import_date FROM images').all();

  let moved = 0;
  // 整个迁移包在一个事务里：任何一步失败即回滚全部 DB 更新，避免半迁移状态
  const tx = db.transaction(() => {
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

      if (fs.existsSync(img.filepath)) {
        moveFileSafeSync(img.filepath, targetPath);
        moved++;
      }

      // 配对 NEF 跟随移动，保持与 JPG 相同主名
      let newRawPath = '';
      if (img.raw_path) {
        const targetBase = path.basename(targetPath, path.extname(targetPath));
        const rawExt = path.extname(img.raw_path);
        newRawPath = path.join(targetDir, `${targetBase}${rawExt}`);
        if (fs.existsSync(img.raw_path)) {
          moveFileSafeSync(img.raw_path, newRawPath);
        } else {
          newRawPath = '';
        }
      }

      db.prepare('UPDATE images SET filename = ?, filepath = ?, raw_path = ? WHERE id = ?')
        .run(path.basename(targetPath), targetPath, newRawPath, img.id);
    }
  });

  try {
    tx();
  } catch (err) {
    return { error: `移动失败：${err.message}` };
  }

  IMAGES_ROOT = resolvedNewRoot;
  setSetting('images_root', resolvedNewRoot);
  saveDatabase();
  return { success: true, path: resolvedNewRoot, moved };
}

// ── 相机同步 ──

const VISIBLE_FORMATS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.tiff'];

async function scanImageFiles(dirPath, includeRaw = false) {
  const supported = includeRaw ? [...VISIBLE_FORMATS, '.nef'] : VISIBLE_FORMATS;
  const files = [];

  async function scan(dir) {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (supported.includes(ext)) {
            const stat = await fs.promises.stat(fullPath);
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
  }

  await scan(dirPath);

  // 普通导入（不包含 .nef）时，为 JPG 检测同目录同名 NEF，便于导入时配对
  if (!includeRaw) {
    const dirEntries = new Map();
    for (const f of files) {
      if (f.format === '.jpg' || f.format === '.jpeg') {
        const dir = path.dirname(f.filepath);
        let names;
        try {
          if (!dirEntries.has(dir)) dirEntries.set(dir, await fs.promises.readdir(dir));
          names = dirEntries.get(dir);
        } catch (err) {
          console.error('[扫描] 检测 NEF 失败:', dir, err.message);
          continue;
        }
        const base = path.basename(f.filename, path.extname(f.filename)).toLowerCase();
        const match = names.find(n => {
          const ext = path.extname(n);
          return ext.toLowerCase() === '.nef' && path.basename(n, ext).toLowerCase() === base;
        });
        if (match) {
          f.raw_source = path.join(dir, match);
          f.raw_filename = match;
        }
      }
    }
  }

  return files;
}

// 收集拖拽导入的文件/目录：目录递归扫描，文件按扩展名过滤（含同目录 NEF 配对检测）
async function collectImportFiles(paths) {
  const files = [];
  const dirs = [];
  for (const p of paths || []) {
    if (!p || typeof p !== 'string') continue;
    try {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        dirs.push(p);
      } else {
        const ext = path.extname(p).toLowerCase();
        if (VISIBLE_FORMATS.includes(ext)) {
          files.push({ filename: path.basename(p), filepath: p, size: stat.size, format: ext, width: 0, height: 0 });
        }
      }
    } catch (e) {
      console.error('[拖拽导入] 路径无效:', p, e.message);
    }
  }
  for (const d of dirs) {
    files.push(...(await scanImageFiles(d, false)));
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
async function attachRawToImage(imageId, nefSource, nefFilename) {
  const img = getImageById(imageId);
  if (!img || img.raw_path) return false;

  const ext = path.extname(nefFilename);
  const rawName = `${path.basename(img.filename, path.extname(img.filename))}${ext}`;
  const rawDest = path.join(path.dirname(img.filepath), rawName);
  ensureDir(path.dirname(rawDest));
  if (fs.existsSync(rawDest)) return false;

  try {
    await fs.promises.copyFile(nefSource, rawDest);
  } catch (err) {
    console.error('[相机同步] NEF 复制失败:', nefSource, err.message);
    return false;
  }

  db.prepare('UPDATE images SET raw_path = ?, original_raw_path = ? WHERE id = ?').run(rawDest, nefSource, imageId);
  saveDatabase();
  return true;
}

// 删除图片：硬删除。先在事务内删除记录（保证 DB 一致），再清理磁盘文件与缩略图；
// 文件删除失败仅告警（残留文件无碍图库，失效记录扫描可兜底）
function deleteImage(id) {
  const img = getImageById(id);
  if (!img) return false;

  db.transaction(() => {
    db.prepare('DELETE FROM image_tags WHERE image_id = ?').run(id);
    db.prepare('DELETE FROM album_images WHERE image_id = ?').run(id);
    db.prepare('DELETE FROM images WHERE id = ?').run(id);
  })();

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

  deleteThumbnailFile(id);
  saveDatabase();
  return img;
}

// ── 日期相关 ──

function getImportDates() {
  // 返回所有有图片的导入日期（用于日期筛选器）
  return db
    .prepare(
      `
    SELECT import_date AS date, COUNT(*) as count
    FROM images
    WHERE hidden = 0 AND import_date != ''
    GROUP BY import_date
    ORDER BY import_date DESC
  `
    )
    .all();
}

// ── Tag Operations ──

function getTags() {
  return db
    .prepare(`
    SELECT t.*, COUNT(it.image_id) as image_count
    FROM tags t
    LEFT JOIN image_tags it ON t.id = it.tag_id
    GROUP BY t.id
    ORDER BY t.name
  `)
    .all();
}

function createTag(name, color = '#6366f1') {
  try {
    db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(name, color);
    saveDatabase();
    return getObject('SELECT * FROM tags WHERE name = ?', [name]);
  } catch {
    return null; // 重名
  }
}

function deleteTag(id) {
  db.prepare('DELETE FROM image_tags WHERE tag_id = ?').run(id);
  db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  saveDatabase();
}

function addTagToImage(imageId, tagId) {
  try {
    db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)').run(imageId, tagId);
    saveDatabase();
    return true;
  } catch {
    return false;
  }
}

function removeTagFromImage(imageId, tagId) {
  db.prepare('DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?').run(imageId, tagId);
  saveDatabase();
}

// 批量为多张图片添加同一标签
function addTagToImages(imageIds, tagId) {
  if (!Array.isArray(imageIds) || imageIds.length === 0) return 0;
  const stmt = db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)');
  let added = 0;
  const tx = db.transaction(() => {
    for (const id of imageIds) {
      const info = stmt.run(id, tagId);
      added += info.changes;
    }
  });
  tx();
  saveDatabase();
  return added;
}

function getImageTags(imageId) {
  return db
    .prepare(`
    SELECT t.* FROM tags t
    JOIN image_tags it ON t.id = it.tag_id
    WHERE it.image_id = ?
  `)
    .all(imageId);
}

// 批量查询多张图片的标签，返回 { [imageId]: [tag, ...] }（分块单次 SQL）
function getBatchImageTags(imageIds) {
  const result = {};
  if (!imageIds || imageIds.length === 0) return result;
  const stmt = db.prepare(`
    SELECT it.image_id, t.* FROM tags t
    JOIN image_tags it ON t.id = it.tag_id
    WHERE it.image_id IN (${imageIds.map(() => '?').join(',')})
  `);
  for (const chunk of chunkIds(imageIds)) {
    for (const row of stmt.all(...chunk)) {
      if (!result[row.image_id]) result[row.image_id] = [];
      result[row.image_id].push(row);
    }
  }
  return result;
}

// ── Album Operations ──

function getAlbums() {
  return db
    .prepare(`
    SELECT a.*,
      (SELECT i.thumbnail_path
         FROM images i
         JOIN album_images ai ON ai.image_id = i.id
        WHERE ai.album_id = a.id AND i.hidden = 0 AND i.thumbnail_path != ''
        ORDER BY ai.image_id DESC LIMIT 1) AS cover_path,
      COUNT(ai.image_id) as image_count
    FROM albums a
    LEFT JOIN album_images ai ON ai.album_id = a.id
    GROUP BY a.id
    ORDER BY a.created_at DESC
  `)
    .all();
}

function createAlbum(name, description = '') {
  db.prepare('INSERT INTO albums (name, description) VALUES (?, ?)').run(name, description);
  saveDatabase();
  return getObject('SELECT * FROM albums WHERE name = ? ORDER BY id DESC LIMIT 1', [name]);
}

function renameAlbum(id, newName) {
  db.prepare('UPDATE albums SET name = ? WHERE id = ?').run(newName, id);
  saveDatabase();
  return true;
}

function getAlbumImages(albumId) {
  return db
    .prepare('SELECT i.* FROM images i JOIN album_images ai ON i.id = ai.image_id WHERE ai.album_id = ? AND i.hidden = 0')
    .all(albumId);
}

function deleteAlbum(id) {
  db.prepare('DELETE FROM album_images WHERE album_id = ?').run(id);
  db.prepare('DELETE FROM albums WHERE id = ?').run(id);
  saveDatabase();
}

function addToAlbum(albumId, imageIds) {
  const stmt = db.prepare('INSERT OR IGNORE INTO album_images (album_id, image_id) VALUES (?, ?)');
  db.transaction(() => {
    for (const imageId of imageIds) {
      stmt.run(albumId, imageId);
    }
  })();
  saveDatabase();
}

function removeFromAlbum(albumId, imageId) {
  db.prepare('DELETE FROM album_images WHERE album_id = ? AND image_id = ?').run(albumId, imageId);
  saveDatabase();
}

// ── Settings Operations ──

function getSetting(key) {
  const row = getObject('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  saveDatabase();
}

function getAllSettings() {
  const settings = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    settings[row.key] = row.value;
  }
  return settings;
}

// ── Batch Delete ──

function batchDeleteImages(ids) {
  const results = [];
  const tx = db.transaction(() => {
    for (const id of ids) {
      const r = deleteImage(id);
      if (r) results.push(r);
    }
  });
  tx();
  return results;
}

// 编辑保存：用编辑产物（-temp 文件）原子替代原文件，重置已被烘焙的变换元数据并清空缩略图。
// 顺序：rename 成功后才更新 DB（rename 失败即无任何变化）；NEF 配对不动（主名不变）。
function saveEditedImage(id, tempPath, { width, height }) {
  const img = getImageById(id);
  if (!img) return { error: '图片不存在' };
  if (!fs.existsSync(tempPath)) return { error: '编辑产物不存在' };

  const size = fs.statSync(tempPath).size;
  try {
    fs.renameSync(tempPath, img.filepath);
  } catch (e) {
    return { error: `替代原文件失败：${e.message}` };
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE images
      SET width = ?, height = ?, size = ?,
          rotation = 0, flip_h = 0, flip_v = 0,
          thumbnail = '', thumbnail_path = '', thumbnail_small_path = '',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(width || img.width, height || img.height, size, id);
  })();

  deleteThumbnailFile(id);
  saveDatabase();

  // 烘焙后 orientation 已进像素：参数侧同步归零（其余参数保留），无参数行则不动
  const editRow = getEdits(id);
  if (editRow) {
    const zeroed = {
      ...editRow.params,
      orientation: { rotate: 0, flipH: false, flipV: false },
    };
    db.prepare('UPDATE edits SET params_json = ? WHERE image_id = ?').run(JSON.stringify(zeroed), id);
  }
  return getImageById(id);
}

// ── 非破坏编辑参数（LR-like）──
// 默认保存只写参数 JSON，像素不动；schema 校验/迁移在 shared/editSchema.cjs

function getEdits(id) {
  const row = getObject('SELECT version, params_json, updated_at FROM edits WHERE image_id = ?', [id]);
  if (!row) return null;
  let params;
  try {
    params = upgradeEdits(JSON.parse(row.params_json));
  } catch (e) {
    console.error('[编辑参数] 解析失败:', e.message);
    params = DEFAULT_EDITS();
  }
  return { version: row.version, updatedAt: row.updated_at, params };
}

// 保存参数：upsert 且 version+1；command = { label, before, after } 时推入历史（滑杆拖动全程一条）
function saveEdits(id, params, command) {
  if (!getImageById(id)) return { error: '图片不存在' };
  const normalized = upgradeEdits(params);
  const json = JSON.stringify(normalized);
  let version = 0;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO edits (image_id, version, params_json, updated_at)
      VALUES (?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(image_id) DO UPDATE SET
        version = version + 1,
        params_json = excluded.params_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(id, json);
    version = getObject('SELECT version FROM edits WHERE image_id = ?', [id]).version;

    if (command && command.label) {
      const last = getObject('SELECT MAX(step) AS m FROM edit_history WHERE image_id = ?', [id])?.m || 0;
      db.prepare('INSERT INTO edit_history (image_id, step, command_json) VALUES (?, ?, ?)')
        .run(id, last + 1, JSON.stringify({
          label: String(command.label).slice(0, 100),
          before: command.before ?? null,
          after: command.after ?? null,
          at: Date.now(),
        }));
      // 历史上限：只保留最近 HISTORY_LIMIT 步
      db.prepare(`
        DELETE FROM edit_history
        WHERE image_id = ? AND step <= (SELECT MAX(step) FROM edit_history WHERE image_id = ?) - ?
      `).run(id, id, HISTORY_LIMIT);
    }
  })();
  saveDatabase();
  return { version, params: normalized };
}

// 清空某图编辑参数（含历史）：烘焙替代后 orientation 归零时使用；查看态旋转双写在 updateImage 侧
function clearEdits(id) {
  db.transaction(() => {
    db.prepare('DELETE FROM edits WHERE image_id = ?').run(id);
    db.prepare('DELETE FROM edit_history WHERE image_id = ?').run(id);
  })();
  saveDatabase();
}

function getEditHistory(id) {
  return db.prepare('SELECT step, command_json FROM edit_history WHERE image_id = ? ORDER BY step')
    .all(id)
    .map(r => {
      let command = null;
      try { command = JSON.parse(r.command_json); } catch { /* 忽略坏行 */ }
      return { step: r.step, command };
    });
}

// ── 预设 ──

function getPresets() {
  return db.prepare('SELECT id, name, params_json, created_at FROM presets ORDER BY created_at DESC').all()
    .map(r => {
      let params = null;
      try { params = upgradeEdits(JSON.parse(r.params_json)); } catch { /* 忽略坏行 */ }
      return { id: r.id, name: r.name, params, createdAt: r.created_at };
    });
}

function createPreset(name, params) {
  const normalized = upgradeEdits(params);
  try {
    db.prepare('INSERT INTO presets (name, params_json) VALUES (?, ?)').run(String(name).slice(0, 100), JSON.stringify(normalized));
    saveDatabase();
    return getObject('SELECT id, name FROM presets WHERE name = ?', [String(name).slice(0, 100)]);
  } catch (e) {
    return { error: '同名预设已存在' };
  }
}

function deletePreset(id) {
  db.prepare('DELETE FROM presets WHERE id = ?').run(id);
  saveDatabase();
}

// 批量更新字段（仅限评分/收藏）
function updateImages(imageIds, updates) {
  const allowed = ['rating', 'favorite'];
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(updates || {})) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }
  if (sets.length === 0 || !Array.isArray(imageIds) || imageIds.length === 0) return 0;

  let changed = 0;
  const stmt = db.prepare(`UPDATE images SET ${sets.join(', ')} WHERE id IN (${imageIds.map(() => '?').join(',')})`);
  for (const chunk of chunkIds(imageIds)) {
    const info = stmt.run(...params, ...chunk);
    changed += info.changes;
  }
  saveDatabase();
  return changed;
}

// ── 失效记录维护 ──

// 找出文件已不存在的图片记录（主文件或配对 NEF 丢失都算）
function findBrokenRecords() {
  const rows = db.prepare('SELECT id, filename, filepath, raw_path FROM images').all();
  return rows.filter(r => !fs.existsSync(r.filepath) || (r.raw_path && !fs.existsSync(r.raw_path)));
}

// 清理失效记录：删除数据库条目与缩略图残留，不碰磁盘上仍存在的文件
function deleteBrokenRecords(ids) {
  if (!Array.isArray(ids)) return 0;
  let removed = 0;
  const tx = db.transaction(() => {
    for (const id of ids) {
      const img = getImageById(id);
      if (!img) continue;
      db.prepare('DELETE FROM image_tags WHERE image_id = ?').run(id);
      db.prepare('DELETE FROM album_images WHERE image_id = ?').run(id);
      db.prepare('DELETE FROM images WHERE id = ?').run(id);
      deleteThumbnailFile(id);
      removed++;
    }
  });
  tx();
  saveDatabase();
  return removed;
}

// 重复图片检测：按 (大小, 尺寸) 粗分组，组内用首尾 64KB 快速哈希精确验证
function findDuplicates() {
  const rows = db.prepare('SELECT id, filename, filepath, size, width, height, format, thumbnail_path FROM images WHERE hidden = 0').all();

  // 第一步：元数据粗分组
  const coarse = new Map();
  for (const r of rows) {
    if (!r.size) continue;
    const key = `${r.size}|${r.width}|${r.height}`;
    if (!coarse.has(key)) coarse.set(key, []);
    coarse.get(key).push(r);
  }

  // 第二步：组内快速哈希精确分组（跳过单文件组）
  const groups = [];
  for (const candidates of coarse.values()) {
    if (candidates.length < 2) continue;
    const byHash = new Map();
    for (const r of candidates) {
      const hash = quickHash(r.filepath, r.size);
      if (!hash) continue;
      if (!byHash.has(hash)) byHash.set(hash, []);
      byHash.get(hash).push(r);
    }
    for (const items of byHash.values()) {
      if (items.length >= 2) {
        groups.push({
          key: `g${groups.length + 1}`,
          items: items.map(i => ({
            id: i.id,
            filename: i.filename,
            filepath: i.filepath,
            size: i.size,
            width: i.width,
            height: i.height,
            thumbnail_path: i.thumbnail_path,
          })),
          wasted: (items.length - 1) * items[0].size,
        });
      }
    }
  }
  return groups;

  function quickHash(filepath, size) {
    try {
      const fd = fs.openSync(filepath, 'r');
      try {
        const head = Buffer.alloc(Math.min(65536, size));
        fs.readSync(fd, head, 0, head.length, 0);
        const hash = crypto.createHash('md5');
        hash.update(head);
        if (size > 65536) {
          const tail = Buffer.alloc(65536);
          fs.readSync(fd, tail, 0, 65536, size - 65536);
          hash.update(tail);
        }
        return hash.digest('hex');
      } finally {
        fs.closeSync(fd);
      }
    } catch (e) {
      console.error('[重复检测] 读取失败:', filepath, e.message);
      return null;
    }
  }
}

// ── Stats ──

function getStats() {
  const totalImages = getObject('SELECT COUNT(*) as count FROM images WHERE hidden = 0')?.count || 0;
  const totalTags = getObject('SELECT COUNT(*) as count FROM tags')?.count || 0;
  const totalAlbums = getObject('SELECT COUNT(*) as count FROM albums')?.count || 0;
  const favorites = getObject('SELECT COUNT(*) as count FROM images WHERE favorite = 1 AND hidden = 0')?.count || 0;
  return { totalImages, totalTags, totalAlbums, favorites };
}

// 退出前关闭数据库，确保 WAL 检查点完整落盘
function closeDatabase() {
  try {
    if (db) {
      db.close();
      db = null;
    }
  } catch (e) {
    console.error('[数据库] 关闭失败:', e.message);
  }
}

module.exports = {
  getThumbnailSmallFilePath,
  initDatabase,
  saveDatabase,
  closeDatabase,
  getImagesRoot,
  getDatabasePath,
  getThumbnailFilePath,
  deleteThumbnailFile,
  setImagesRoot,
  scanImageFiles,
  collectImportFiles,
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
  saveEditedImage,
  getEdits,
  saveEdits,
  clearEdits,
  getEditHistory,
  getPresets,
  createPreset,
  deletePreset,
  findBrokenRecords,
  deleteBrokenRecords,
  findDuplicates,
  getImportDates,
  getTags,
  createTag,
  deleteTag,
  addTagToImage,
  removeTagFromImage,
  getImageTags,
  getBatchImageTags,
  addTagToImages,
  updateImages,
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

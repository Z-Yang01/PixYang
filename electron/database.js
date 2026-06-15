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
      import_date TEXT NOT NULL DEFAULT '',
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
    db_path: '',
    grid_rows: '3',
    grid_columns: '5',
  };
  for (const [k, v] of Object.entries(defaults)) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run([k, v]);
  }

  // 迁移旧表：如果不存在 import_date 列则添加
  migrateSchema();

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
      if (!colNames.includes('original_path')) {
        db.run('ALTER TABLE images ADD COLUMN original_path TEXT DEFAULT ""');
      }
      if (!colNames.includes('updated_at')) {
        db.run('ALTER TABLE images ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
      }
    }
  } catch (e) {
    console.log('[迁移] 可能是旧版数据库，尝试添加列:', e.message);
  }
}

function saveDatabase() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
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
  const root = getImagesRoot();

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO images (filename, filepath, original_path, import_date, size, width, height, format, thumbnail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const imported = [];

  for (const img of imageFiles) {
    // 使用图片 EXIF 日期或文件修改时间，降级为今天
    const dateStr = img.importDate || (() => {
      const today = new Date();
      return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    })();

    // 目标子目录: images/YYYY/MM/DD/
    const subDir = path.join(root, ...dateStr.split('-'));
    ensureDir(subDir);

    // 处理重名
    const uniqueName = generateUniqueFilename(subDir, img.filename);
    const destPath = path.join(subDir, uniqueName);

    // 复制文件
    try {
      if (img.filepath !== destPath) {
        fs.copyFileSync(img.filepath, destPath);
      }
    } catch (err) {
      console.error('[导入] 复制失败:', img.filepath, err.message);
      continue;
    }

    // 写入数据库
    insertStmt.run([
      uniqueName,
      destPath,
      img.filepath,           // original_path
      dateStr,                // import_date = 今天
      img.size || 0,
      img.width || 0,
      img.height || 0,
      img.format || '',
      img.thumbnail || '',    // base64 缩略图
    ]);

    // 验证插入
    const row = db.prepare('SELECT * FROM images WHERE filepath = ?').get([destPath]);
    if (row) {
      const obj = {};
      const cols = db.prepare('SELECT * FROM images WHERE filepath = ?').getAsObject([destPath]);
      // sql.js getAsObject might need columns
      imported.push({
        id: row[0],
        filename: uniqueName,
        filepath: destPath,
        original_path: img.filepath,
        import_date: dateStr,
        size: img.size,
        format: img.format,
        thumbnail: img.thumbnail,
      });
    }
  }

  insertStmt.free();
  saveDatabase();
  return imported;
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

  query += ` ORDER BY i.${safeSort} ${safeOrder}`;
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

function updateImage(id, updates) {
  const allowed = ['filename', 'rating', 'favorite', 'notes', 'width', 'height', 'thumbnail', 'import_date'];
  const sets = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (sets.length === 0) return false;

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

  try {
    if (oldPath !== newPath) {
      fs.renameSync(oldPath, newPath);
    }
  } catch (err) {
    return { error: '重命名失败: ' + err.message };
  }

  db.prepare('UPDATE images SET filename = ?, filepath = ? WHERE id = ?')
    .run([newFilename, newPath, id]);
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

  const stmt = db.prepare('SELECT id, filename, filepath, import_date FROM images');
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
      db.prepare('UPDATE images SET filename = ?, filepath = ? WHERE id = ?')
        .run([path.basename(targetPath), targetPath, img.id]);
    } catch (err) {
      return { error: `移动失败：${img.filename} - ${err.message}` };
    }
  }

  IMAGES_ROOT = resolvedNewRoot;
  setSetting('images_root', resolvedNewRoot);
  saveDatabase();
  return { success: true, path: resolvedNewRoot, moved };
}

function deleteImage(id) {
  const img = getImageById(id);
  if (!img) return false;

  // 删除本地文件
  try {
    if (fs.existsSync(img.filepath)) {
      fs.unlinkSync(img.filepath);
    }
  } catch (e) {
    console.error('[删除] 删除文件失败:', e.message);
  }

  // 清除关联
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
    WHERE import_date != ''
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
  const stmt = db.prepare('SELECT i.* FROM images i JOIN album_images ai ON i.id = ai.image_id WHERE ai.album_id = ?');
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
  const totalImages = getObject('SELECT COUNT(*) as count FROM images')?.count || 0;
  const totalTags = getObject('SELECT COUNT(*) as count FROM tags')?.count || 0;
  const totalAlbums = getObject('SELECT COUNT(*) as count FROM albums')?.count || 0;
  const favorites = getObject('SELECT COUNT(*) as count FROM images WHERE favorite = 1')?.count || 0;
  return { totalImages, totalTags, totalAlbums, favorites };
}

module.exports = {
  initDatabase,
  saveDatabase,
  getImagesRoot,
  setImagesRoot,
  getImageSubDir,
  ensureDir,
  generateUniqueFilename,
  importImages,
  getImages,
  getImageById,
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

const path = require('path');
const { app } = require('electron');
const fs = require('fs');

let SQL;
let db;

const DB_PATH = path.join(app.getPath('userData'), 'pixyang.db');

// Write sql.js WASM file to disk so it can be loaded
function getWasmPath() {
  const wasmDir = path.join(app.getPath('userData'), 'sqljs');
  if (!fs.existsSync(wasmDir)) {
    fs.mkdirSync(wasmDir, { recursive: true });
  }
  // sql.js ships its WASM file; we locate it from the module
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

  // Load existing or create new database
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Enable WAL mode for better performance
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL UNIQUE,
      directory TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      width INTEGER DEFAULT 0,
      height INTEGER DEFAULT 0,
      format TEXT DEFAULT '',
      thumbnail TEXT DEFAULT '',
      rating INTEGER DEFAULT 0,
      favorite INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  saveDatabase();
  console.log('[Database] Initialized at', DB_PATH);
  return db;
}

function saveDatabase() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ── Image Operations ──

function importImages(imageFiles) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO images (filename, filepath, directory, size, width, height, format)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const inserted = [];
  for (const img of imageFiles) {
    const { filename, filepath, directory, size, width, height, format } = img;
    stmt.run([filename, filepath, directory, size || 0, width || 0, height || 0, format || '']);

    // Check if it was actually inserted (not ignored due to UNIQUE)
    const row = db.prepare('SELECT id FROM images WHERE filepath = ?').get([filepath]);
    if (row) {
      inserted.push({ ...img, id: row.id });
    }
  }
  stmt.free();
  saveDatabase();
  return inserted;
}

function getImages(options = {}) {
  const {
    directory = '',
    tagId = null,
    albumId = null,
    favorite = false,
    search = '',
    sortBy = 'created_at',
    sortOrder = 'DESC',
    limit = 100,
    offset = 0
  } = options;

  let query = 'SELECT DISTINCT i.* FROM images i';
  const params = [];
  const joins = [];

  if (tagId) {
    joins.push('JOIN image_tags it ON i.id = it.image_id');
    params.push(tagId);
    query += ` ${joins.join(' ')} WHERE it.tag_id = ?`;
  } else if (albumId) {
    joins.push('JOIN album_images ai ON i.id = ai.image_id');
    params.push(albumId);
    query += ` ${joins.join(' ')} WHERE ai.album_id = ?`;
  } else {
    query += ' WHERE 1=1';
  }

  if (directory) {
    query += ' AND i.directory LIKE ?';
    params.push(`%${directory}%`);
  }

  if (favorite) {
    query += ' AND i.favorite = 1';
  }

  if (search) {
    query += ' AND (i.filename LIKE ? OR i.notes LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  // Count total
  const countQuery = query.replace('SELECT DISTINCT i.*', 'SELECT COUNT(DISTINCT i.id) as total');
  const total = db.prepare(countQuery).get(params)?.total || 0;

  // Sort and paginate
  const allowedSorts = ['created_at', 'filename', 'size', 'rating', 'directory'];
  const safeSort = allowedSorts.includes(sortBy) ? sortBy : 'created_at';
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
  return db.prepare('SELECT * FROM images WHERE id = ?').get([id]);
}

function updateImage(id, updates) {
  const allowed = ['rating', 'favorite', 'notes', 'width', 'height', 'thumbnail'];
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

function deleteImage(id) {
  const img = getImageById(id);
  if (!img) return false;

  db.prepare('DELETE FROM image_tags WHERE image_id = ?').run([id]);
  db.prepare('DELETE FROM album_images WHERE image_id = ?').run([id]);
  db.prepare('DELETE FROM images WHERE id = ?').run([id]);
  saveDatabase();
  return img;
}

function getAllDirectories() {
  const rows = db.exec('SELECT DISTINCT directory FROM images ORDER BY directory');
  if (!rows.length) return [];
  return rows[0].values.map(v => v[0]);
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
    return db.prepare('SELECT * FROM tags WHERE name = ?').get([name]);
  } catch {
    return null; // duplicate name
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
  return db.prepare('SELECT * FROM albums WHERE name = ? ORDER BY id DESC LIMIT 1').get([name]);
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

// ── Stats ──

function getStats() {
  const totalImages = db.prepare('SELECT COUNT(*) as count FROM images').get([])?.count || 0;
  const totalTags = db.prepare('SELECT COUNT(*) as count FROM tags').get([])?.count || 0;
  const totalAlbums = db.prepare('SELECT COUNT(*) as count FROM albums').get([])?.count || 0;
  const favorites = db.prepare('SELECT COUNT(*) as count FROM images WHERE favorite = 1').get([])?.count || 0;
  return { totalImages, totalTags, totalAlbums, favorites };
}

module.exports = {
  initDatabase,
  saveDatabase,
  importImages,
  getImages,
  getImageById,
  updateImage,
  deleteImage,
  getAllDirectories,
  getTags,
  createTag,
  deleteTag,
  addTagToImage,
  removeTagFromImage,
  getImageTags,
  getAlbums,
  createAlbum,
  deleteAlbum,
  addToAlbum,
  removeFromAlbum,
  getStats,
};

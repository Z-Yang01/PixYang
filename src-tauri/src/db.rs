// SQLite 内核（rusqlite，WAL）。库文件与旧版（Electron，2026-09-21 R36 退役）共用
// userData/pixyang.db——schema 由本文件 ensure_business_schema 自举（R41 起，
// 旧 migrateSchema 已失去承接方）；旧位置到便携 data 的一次性快照迁移见
// migrate_legacy_snapshot。

pub use crate::error::PixError;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone)]
pub struct Db {
    write: std::sync::Arc<Mutex<Connection>>,
    path: PathBuf,
}

impl Db {
    /// 唯一写连接的中毒恢复锁：任一命令 panic 不应让后续所有命令连锁闪退
    pub fn write_lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.write.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// WAL 只读连接：写连接持锁（长任务）期间读命令照常并发；
    /// :memory:（测试夹具）退回独立内存库，仅保证 settings 表可读，不含业务表
    pub fn open_read(&self) -> Result<Connection, rusqlite::Error> {
        if self.path.as_os_str().is_empty() {
            let conn = Connection::open_in_memory()?;
            ensure_settings_table(&conn)?;
            return Ok(conn);
        }
        let conn = Connection::open(&self.path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(conn)
    }
}

impl Db {
    pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        let stored = if path == Path::new(":memory:") {
            PathBuf::new()
        } else {
            path.to_path_buf()
        };
        // 写连接同设 busy_timeout：CLI 与 GUI 是两个进程各持一条写连接（WAL），
        // 无 handler 时写-写冲突立即 SQLITE_BUSY，与 CLI 文档「最多等 5s」的承诺不符
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        if path != Path::new(":memory:") {
            conn.pragma_update(None, "journal_mode", "WAL")?;
        }
        ensure_settings_table(&conn)?;
        ensure_business_schema(&conn)?;
        Ok(Self {
            write: std::sync::Arc::new(Mutex::new(conn)),
            path: stored,
        })
    }

    pub fn from_connection(conn: Connection) -> Self {
        ensure_settings_table(&conn).expect("settings 表创建失败");
        Self {
            write: std::sync::Arc::new(Mutex::new(conn)),
            path: PathBuf::new(),
        }
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, rusqlite::Error> {
        let conn = self.write_lock();
        conn.query_row("SELECT value FROM settings WHERE key = ?", [key], |r| {
            r.get(0)
        })
        .optional()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), rusqlite::Error> {
        let conn = self.write_lock();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            [key, value],
        )?;
        Ok(())
    }
}

/// 对象形态（镜像 JS getAllSettings 的 {key: value}），读命令经 open_read 连接调用
pub fn all_settings_map(
    conn: &Connection,
) -> Result<std::collections::BTreeMap<String, String>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let mut map = std::collections::BTreeMap::new();
    for row in rows {
        let (k, v) = row?;
        map.insert(k, v);
    }
    Ok(map)
}

fn ensure_settings_table(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
    )
}

// 业务表唯一自举（R41）：R36 删 Electron 后旧 migrateSchema 失去承接方，全新安装曾因
// no such table 全链路不可用。语义逐句移植自 electron/database.js（git 90df410）。
const BUSINESS_TABLES: &str = "
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
  thumbnail_edit_path TEXT DEFAULT '',
  rating INTEGER DEFAULT 0,
  favorite INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  hash TEXT DEFAULT '',
  flag INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#6366f1'
);
CREATE TABLE IF NOT EXISTS image_tags (
  image_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (image_id, tag_id),
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  cover_image_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS album_images (
  album_id INTEGER NOT NULL,
  image_id INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (album_id, image_id),
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS edits (
  image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0,
  params_json TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS edit_history (
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  command_json TEXT NOT NULL,
  PRIMARY KEY (image_id, step)
);
CREATE TABLE IF NOT EXISTS presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  params_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  params_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (image_id, name)
);
";

// 旧库逐列回迁清单：任意旧形态 images 表收敛到终态 28 列（超集含 legacy
// CREATE+migrateSchema 全部列）；updated_at 用可空+回填
// （SQLite 禁止对有数据行的表添加非常量默认列）
fn migrate_images_columns(conn: &Connection) {
    let has_filename: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('images') WHERE name = 'filename'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if has_filename == 0 {
        return;
    }
    let cols: [(&str, &str); 23] = [
        (
            "import_date",
            "ALTER TABLE images ADD COLUMN import_date TEXT DEFAULT ''",
        ),
        (
            "taken_at",
            "ALTER TABLE images ADD COLUMN taken_at TEXT DEFAULT ''",
        ),
        (
            "original_path",
            "ALTER TABLE images ADD COLUMN original_path TEXT DEFAULT ''",
        ),
        (
            "raw_path",
            "ALTER TABLE images ADD COLUMN raw_path TEXT DEFAULT ''",
        ),
        (
            "original_raw_path",
            "ALTER TABLE images ADD COLUMN original_raw_path TEXT DEFAULT ''",
        ),
        (
            "hidden",
            "ALTER TABLE images ADD COLUMN hidden INTEGER DEFAULT 0",
        ),
        (
            "orientation",
            "ALTER TABLE images ADD COLUMN orientation INTEGER DEFAULT 1",
        ),
        (
            "rotation",
            "ALTER TABLE images ADD COLUMN rotation INTEGER DEFAULT 0",
        ),
        (
            "flip_h",
            "ALTER TABLE images ADD COLUMN flip_h INTEGER DEFAULT 0",
        ),
        (
            "flip_v",
            "ALTER TABLE images ADD COLUMN flip_v INTEGER DEFAULT 0",
        ),
        (
            "updated_at",
            "ALTER TABLE images ADD COLUMN updated_at DATETIME",
        ),
        (
            "size",
            "ALTER TABLE images ADD COLUMN size INTEGER DEFAULT 0",
        ),
        (
            "width",
            "ALTER TABLE images ADD COLUMN width INTEGER DEFAULT 0",
        ),
        (
            "height",
            "ALTER TABLE images ADD COLUMN height INTEGER DEFAULT 0",
        ),
        (
            "format",
            "ALTER TABLE images ADD COLUMN format TEXT DEFAULT ''",
        ),
        (
            "thumbnail",
            "ALTER TABLE images ADD COLUMN thumbnail TEXT DEFAULT ''",
        ),
        (
            "thumbnail_path",
            "ALTER TABLE images ADD COLUMN thumbnail_path TEXT DEFAULT ''",
        ),
        (
            "thumbnail_small_path",
            "ALTER TABLE images ADD COLUMN thumbnail_small_path TEXT DEFAULT ''",
        ),
        (
            "thumbnail_edit_path",
            "ALTER TABLE images ADD COLUMN thumbnail_edit_path TEXT DEFAULT ''",
        ),
        (
            "rating",
            "ALTER TABLE images ADD COLUMN rating INTEGER DEFAULT 0",
        ),
        (
            "favorite",
            "ALTER TABLE images ADD COLUMN favorite INTEGER DEFAULT 0",
        ),
        (
            "notes",
            "ALTER TABLE images ADD COLUMN notes TEXT DEFAULT ''",
        ),
        ("hash", "ALTER TABLE images ADD COLUMN hash TEXT DEFAULT ''"),
    ];
    for (name, ddl) in cols {
        // 存在性查询失败不能当「已存在」跳过（R153 审计④：unwrap_or(1) 会把异常
        // 当列已存在 → 迁移静默漏做）。回退 0 = 尝试 DDL：列真存在时 DDL 报重复列
        // （下方已按失败容错继续），异常时至少落到日志而非无声跳过
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('images') WHERE name = ?1",
                [name],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if exists > 0 {
            continue;
        }
        if let Err(e) = conn.execute_batch(ddl) {
            eprintln!("[db migrate] 添加列 {name} 失败: {e}");
            continue;
        }
        if name == "updated_at" {
            let _ = conn.execute_batch(
                "UPDATE images SET updated_at = COALESCE(created_at, '1970-01-01 00:00:00') WHERE updated_at IS NULL",
            );
        }
    }
    let has_flag: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('images') WHERE name = 'flag'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(1);
    if has_flag == 0 {
        if let Err(e) = conn.execute_batch("ALTER TABLE images ADD COLUMN flag INTEGER DEFAULT 0") {
            eprintln!("[db migrate] 添加列 flag 失败: {e}");
        }
    }
}

// 常用查询索引：隐藏过滤+排序/筛选组合列，避免大库每页全表扫；
// NOCASE 表达式索引服务 Windows 路径去重（BINARY 索引不被 NOCASE 比较命中）
const BUSINESS_INDEXES: &str = "
CREATE INDEX IF NOT EXISTS idx_images_hidden ON images(hidden);
CREATE INDEX IF NOT EXISTS idx_images_import_date ON images(import_date);
CREATE INDEX IF NOT EXISTS idx_images_favorite ON images(favorite);
CREATE INDEX IF NOT EXISTS idx_images_taken_at ON images(taken_at);
CREATE INDEX IF NOT EXISTS idx_images_filename ON images(filename);
CREATE INDEX IF NOT EXISTS idx_images_original_path ON images(original_path);
CREATE INDEX IF NOT EXISTS idx_images_original_raw_path ON images(original_raw_path);
CREATE INDEX IF NOT EXISTS idx_images_original_path_nc ON images(original_path COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_images_original_raw_path_nc ON images(original_raw_path COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_images_hidden_import_date ON images(hidden, import_date);
CREATE INDEX IF NOT EXISTS idx_images_hidden_taken_at ON images(hidden, taken_at);
CREATE INDEX IF NOT EXISTS idx_images_hidden_favorite ON images(hidden, favorite);
CREATE INDEX IF NOT EXISTS idx_image_tags_tag_id ON image_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_album_images_image_id ON album_images(image_id);
CREATE INDEX IF NOT EXISTS idx_images_visible_sort_date ON images(hidden, CASE WHEN taken_at != '' THEN taken_at ELSE import_date END, id);
CREATE INDEX IF NOT EXISTS idx_snapshots_image_id ON snapshots(image_id);
";

const SETTINGS_DEFAULTS: &str = "
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('theme', 'dark'),
  ('images_root', ''),
  ('camera_folder', ''),
  ('db_path', ''),
  ('grid_rows', '3'),
  ('grid_columns', '5'),
  ('grid_gap', '12'),
  ('content_padding', '16'),
  ('sort_by', 'import_date'),
  ('sort_order', 'DESC');
";

pub fn ensure_business_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(BUSINESS_TABLES)?;
    migrate_images_columns(conn);
    conn.execute_batch(SETTINGS_DEFAULTS)?;
    // 索引是纯性能面：极端旧库/外来形状的 images 表（缺 filename 时逐列回迁守卫主动
    // 放弃改表）必然让部分索引建不出来——此前 Db::open 整体失败，应用被钉死在启动屏
    // 且无任何自救入口。降级为无索引运行 + 日志留档（与 delete_image_files 单文件
    // 失败吞掉继续同一哲学）；正常库建索引失败仍会在日志可见，不静默。
    if let Err(e) = conn.execute_batch(BUSINESS_INDEXES) {
        eprintln!("[db migrate] 索引创建失败（降级为无索引运行）: {e}");
    }
    Ok(())
}

/// 旧版（Electron）userData 路径（app name 'pixyang'）——迁移来源，保留只读兼容
pub fn legacy_data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(dir) = std::env::var_os("APPDATA") {
            return PathBuf::from(dir).join("pixyang");
        }
    }
    #[cfg(not(windows))]
    {
        if let Some(dir) = std::env::var_os("HOME") {
            return PathBuf::from(dir).join(".config").join("pixyang");
        }
    }
    PathBuf::from(".")
}

/// 标准用户数据目录（不随程序安装位置走）：
/// Windows `%LOCALAPPDATA%\PixYang`；macOS `~/Library/Application Support/PixYang`；
/// Linux `$XDG_DATA_HOME/PixYang` 或 `~/.local/share/PixYang`。
/// 选 Local（而非 Roaming/%APPDATA%）是因为 DB 与缩略图体积大，不适合随域账户漫游。
#[cfg(windows)]
pub fn standard_data_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(|d| PathBuf::from(d).join("PixYang"))
        .unwrap_or_else(legacy_data_dir)
}

#[cfg(target_os = "macos")]
pub fn standard_data_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(|h| {
            PathBuf::from(h)
                .join("Library")
                .join("Application Support")
                .join("PixYang")
        })
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn standard_data_dir() -> PathBuf {
    std::env::var_os("XDG_DATA_HOME")
        .map(|d| PathBuf::from(d).join("PixYang"))
        .or_else(|| {
            std::env::var_os("HOME").map(|h| {
                PathBuf::from(h)
                    .join(".local")
                    .join("share")
                    .join("PixYang")
            })
        })
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 数据目录：固定标准位置（不再优先「安装目录\data」的便携模式）。
pub fn resolve_data_dir() -> PathBuf {
    standard_data_dir()
}

/// 首次迁移候选源：便携 `<exe目录>\data` 优先，其次旧版 `%APPDATA%\pixyang`。
pub fn migration_sources() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("data"));
        }
    }
    out.push(legacy_data_dir());
    out
}

/// 纯函数（可测）：目标无库时，按 sources 顺序把首个可用源的 db/缩略图复制过来。
/// 非破坏：只复制、不删除源；目标已有库直接跳过。返回迁移来源。
pub fn migrate_from_sources(data_dir: &Path, sources: &[PathBuf]) -> Option<PathBuf> {
    if data_dir.join("pixyang.db").exists() {
        return None;
    }
    for src in sources {
        if src == data_dir || !src.join("pixyang.db").exists() {
            continue;
        }
        let _ = std::fs::create_dir_all(data_dir);
        for name in ["pixyang.db", "pixyang.db-wal", "pixyang.db-shm"] {
            let from = src.join(name);
            if from.exists() && std::fs::copy(&from, data_dir.join(name)).is_err() {
                return None;
            }
        }
        let (src_thumbs, dst_thumbs) = (src.join("thumbnails"), data_dir.join("thumbnails"));
        if src_thumbs.is_dir() {
            let _ = std::fs::create_dir_all(&dst_thumbs);
            if let Ok(entries) = std::fs::read_dir(&src_thumbs) {
                for e in entries.flatten() {
                    let to = dst_thumbs.join(e.file_name());
                    if !to.exists() {
                        let _ = std::fs::copy(e.path(), &to);
                    }
                }
            }
        }
        return Some(src.clone());
    }
    None
}

/// 启动期迁移：标准目录无库时，从便携 data / 旧 %APPDATA% 复制。
pub fn migrate_to_standard_dir(data_dir: &Path) -> Option<PathBuf> {
    migrate_from_sources(data_dir, &migration_sources())
}

/// 缩略图路径归一：DB 里存的是绝对路径，数据目录迁移（便携 data / %APPDATA% → 标准 Local 目录）后
/// 这些路径会指向上级目录之外，新实例的 asset 白名单不放行 → 胶片条/网格破图。
/// 启动时逐行把缩略图复制进当前 `thumbs_dir` 并改写列；文件已不在的列清空（交由重建补）。
/// 幂等、只读缺失项；833 行量级开销可忽略。
pub fn normalize_thumbnail_paths(conn: &Connection, thumbs_dir: &Path) {
    let _ = std::fs::create_dir_all(thumbs_dir);
    let mut updates: Vec<(i64, String, String, String)> = Vec::new();
    {
        let Ok(mut stmt) = conn.prepare(
            "SELECT id, COALESCE(thumbnail_path,''), COALESCE(thumbnail_small_path,''), COALESCE(thumbnail_edit_path,'') FROM images",
        ) else {
            return;
        };
        let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        }) else {
            return;
        };
        for row in rows.flatten() {
            let (id, t1, t2, t3) = row;
            let fix = |v: String| -> String {
                if v.is_empty() {
                    return v;
                }
                let p = Path::new(&v);
                let Some(name) = p.file_name() else {
                    return String::new();
                };
                let dest = thumbs_dir.join(name);
                if p.parent() == Some(thumbs_dir) && p.exists() {
                    return v;
                }
                if !dest.exists() && p.exists() {
                    let _ = std::fs::copy(p, &dest);
                }
                if dest.exists() {
                    dest.to_string_lossy().to_string()
                } else {
                    String::new()
                }
            };
            let n1 = fix(t1.clone());
            let n2 = fix(t2.clone());
            let n3 = fix(t3.clone());
            if n1 != t1 || n2 != t2 || n3 != t3 {
                updates.push((id, n1, n2, n3));
            }
        }
    }
    for (id, a, b, c) in updates {
        let _ = conn.execute(
            "UPDATE images SET thumbnail_path=?, thumbnail_small_path=?, thumbnail_edit_path=? WHERE id=?",
            rusqlite::params![a, b, c, id],
        );
    }
}

pub fn default_db_path() -> PathBuf {
    resolve_data_dir().join("pixyang.db")
}

/// 托管状态：连接 + 宿主派生路径（缩略图目录、删除暂存区、默认图片根）。
/// thumbs_dir 走 RwLock：set_thumbs_root 迁移后即时生效（新导入/重建/编辑器都读它），
/// 与 images_root 的「DB 设置即真相」同款运行时语义，不必重启。
#[derive(Clone)]
pub struct AppPaths {
    thumbs_dir: std::sync::Arc<std::sync::RwLock<PathBuf>>,
    pub trash_dir: PathBuf,
    pub default_images_dir: PathBuf,
}

impl AppPaths {
    pub fn new(thumbs_dir: PathBuf, trash_dir: PathBuf, default_images_dir: PathBuf) -> Self {
        Self {
            thumbs_dir: std::sync::Arc::new(std::sync::RwLock::new(thumbs_dir)),
            trash_dir,
            default_images_dir,
        }
    }

    /// 当前生效的缩略图目录（克隆快照；持锁仅拷贝一个 PathBuf）
    pub fn thumbs_dir(&self) -> PathBuf {
        self.thumbs_dir
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    /// 迁移成功后由 set_thumbs_root 调用：后续写入立即落到新目录
    pub fn set_thumbs_dir(&self, dir: PathBuf) {
        *self.thumbs_dir.write().unwrap_or_else(|p| p.into_inner()) = dir;
    }
}

/// 解析生效的缩略图目录：设置优先（thumbs_root，可为 E 盘），未设置/为空/不可用时
/// 回退 `<data_dir>/thumbnails`。非法设置（如指向一个已存在且为文件）不静默失败，
/// 回退默认并告警，保证启动不因坏设置破图。
pub fn resolve_thumbs_dir(data_dir: &Path, setting: Option<&str>) -> PathBuf {
    let fallback = data_dir.join("thumbnails");
    let Some(raw) = setting.map(str::trim).filter(|s| !s.is_empty()) else {
        return fallback;
    };
    let candidate = PathBuf::from(raw);
    if candidate == fallback {
        return fallback;
    }
    if candidate.is_file() {
        eprintln!(
            "[thumbs] thumbs_root 指向已存在的文件，回退默认: {}",
            candidate.display()
        );
        return fallback;
    }
    if std::fs::create_dir_all(&candidate).is_err() {
        eprintln!(
            "[thumbs] thumbs_root 无法创建目录，回退默认: {}",
            candidate.display()
        );
        return fallback;
    }
    candidate
}

/// 切换缩略图根目录：把旧目录里的缩略图文件整体搬到新目录（跨盘走 copy+delete），
/// 并把 DB 三列里父目录等于旧目录的绝对路径改写到新目录。返回搬迁文件数。
/// 目录按约定是平的（`{id}.jpg` / `{id}_s.jpg` / `edit-*`），子目录不搬（告警跳过）。
pub fn migrate_thumbs_root(
    conn: &Connection,
    old_dir: &Path,
    new_dir: &Path,
) -> Result<usize, PixError> {
    if old_dir == new_dir {
        return Ok(0);
    }
    std::fs::create_dir_all(new_dir)
        .map_err(|e| PixError::Io(format!("创建缩略图目录失败: {e}")))?;
    let mut moved = 0usize;
    if old_dir.is_dir() {
        let entries = std::fs::read_dir(old_dir)
            .map_err(|e| PixError::Io(format!("读取缩略图目录失败: {e}")))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                eprintln!("[thumbs] 跳过子目录（不搬迁）: {}", path.display());
                continue;
            }
            let Some(name) = path.file_name() else {
                continue;
            };
            let dest = new_dir.join(name);
            if dest.exists() {
                // 目标已有同名文件：保留目标，源仅在不冲突时才有价值，直接跳过
                continue;
            }
            crate::file_ops::move_file_safe(&path, &dest)?;
            moved += 1;
        }
    }
    // DB 三列改写：只动父目录恰为旧目录的行（越界引用不猜，交由启动归一处理）
    let rows: Vec<(i64, String, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, COALESCE(thumbnail_path,''), COALESCE(thumbnail_small_path,''), COALESCE(thumbnail_edit_path,'') FROM images",
        )?;
        let collected = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<_>>()?;
        collected
    };
    let rewrite = |v: &str| -> Option<String> {
        if v.is_empty() {
            return None;
        }
        let p = Path::new(v);
        if p.parent() == Some(old_dir) {
            p.file_name()
                .map(|n| new_dir.join(n).to_string_lossy().to_string())
        } else {
            None
        }
    };
    for (id, t1, t2, t3) in rows {
        let n1 = rewrite(&t1);
        let n2 = rewrite(&t2);
        let n3 = rewrite(&t3);
        if n1.is_none() && n2.is_none() && n3.is_none() {
            continue;
        }
        conn.execute(
            "UPDATE images SET thumbnail_path=?, thumbnail_small_path=?, thumbnail_edit_path=? WHERE id=?",
            rusqlite::params![
                n1.unwrap_or(t1),
                n2.unwrap_or(t2),
                n3.unwrap_or(t3),
                id
            ],
        )?;
    }
    Ok(moved)
}

/// 孤儿缩略图：目录里符合 `{id}.jpg` / `{id}_s.jpg` 命名、但 images 表已无对应 id 的文件。
/// 只认数字命名（编辑会话的 `edit-*` 边车不碰），这些文件任何界面都引用不到，
/// 删除后可由「重建缩略图」按需再生。返回 [{path,size,id}]。
pub fn scan_orphan_thumbnails(conn: &Connection, thumbs_dir: &Path) -> Result<Value, PixError> {
    let mut live_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();
    {
        let mut stmt = conn.prepare("SELECT id FROM images")?;
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0))?;
        for id in rows.flatten() {
            live_ids.insert(id);
        }
    }
    let mut orphans = Vec::new();
    if thumbs_dir.is_dir() {
        let entries = std::fs::read_dir(thumbs_dir)
            .map_err(|e| PixError::Io(format!("读取缩略图目录失败: {e}")))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let Some(id) = numeric_thumb_id(name) else {
                continue; // edit-* / 其他命名：非候选
            };
            if live_ids.contains(&id) {
                continue;
            }
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            orphans.push(json!({
                "path": path.to_string_lossy(),
                "size": size,
                "id": id,
            }));
        }
    }
    Ok(json!({ "orphans": orphans, "thumbsDir": thumbs_dir.to_string_lossy() }))
}

/// 从 `{id}.jpg` / `{id}_s.jpg` 文件名解析图片 id；其他命名（edit-*、meta）返回 None。
pub fn numeric_thumb_id(name: &str) -> Option<i64> {
    let stem = name.strip_suffix(".jpg")?;
    let stem = stem.strip_suffix("_s").unwrap_or(stem);
    if stem.is_empty() || !stem.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    stem.parse::<i64>().ok()
}

/// 清理孤儿缩略图：对传入路径逐一复核——必须位于 thumbs_dir 内、数字命名、
/// 且 images 表已无对应 id（防前端传回活 id / 越界路径）。返回 {removed, freed}。
pub fn clean_orphan_thumbnails(
    conn: &Connection,
    paths: &[String],
    thumbs_dir: &Path,
) -> Result<Value, PixError> {
    let mut live_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();
    {
        let mut stmt = conn.prepare("SELECT id FROM images")?;
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0))?;
        for id in rows.flatten() {
            live_ids.insert(id);
        }
    }
    let mut removed = 0usize;
    let mut freed = 0u64;
    for p in paths {
        let path = Path::new(p);
        let id = path
            .parent()
            .filter(|parent| *parent == thumbs_dir)
            .and(path.file_name())
            .and_then(|n| n.to_str())
            .and_then(numeric_thumb_id);
        // 三重兜底：目录内 + 数字命名 + 确无对应图片记录
        let Some(id) = id else { continue };
        if live_ids.contains(&id) {
            continue;
        }
        if let Ok(meta) = std::fs::metadata(path) {
            freed += meta.len();
        }
        if std::fs::remove_file(path).is_ok() {
            removed += 1;
        }
    }
    Ok(json!({ "removed": removed, "freed": freed }))
}

pub fn get_setting_raw(conn: &Connection, key: &str) -> Result<Option<String>, PixError> {
    conn.query_row("SELECT value FROM settings WHERE key = ?", [key], |r| {
        r.get(0)
    })
    .optional()
    .map_err(PixError::Db)
}

/// 图片托管根：设置 images_root 优先，否则默认 userData/images；目录缺失即建（镜像 getImagesRoot）
pub fn images_root(conn: &Connection, default_dir: &Path) -> Result<PathBuf, PixError> {
    let custom = get_setting_raw(conn, "images_root")?;
    let root = match custom.filter(|s| !s.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => default_dir.to_path_buf(),
    };
    std::fs::create_dir_all(&root).map_err(|e| PixError::Io(format!("创建托管目录失败: {e}")))?;
    Ok(root)
}

/// 镜像 isManagedPath + exists：路径位于托管根（图片根或库目录）内且真实存在
pub fn managed_file_exists(
    conn: &Connection,
    default_images_dir: &Path,
    filepath: &str,
) -> Result<bool, PixError> {
    let target = Path::new(filepath);
    let images = images_root(conn, default_images_dir)?;
    let roots = [
        images,
        default_db_path()
            .parent()
            .unwrap_or(Path::new("."))
            .to_path_buf(),
    ];
    for root in &roots {
        if target.starts_with(root) {
            return Ok(target.exists());
        }
    }
    Ok(false)
}

// ── 删除通道（迁移接缝 4b）：镜像 deleteImageRecord/deleteImageFiles/deleteImage/batchDeleteImages ──

fn delete_image_record_statements(conn: &Connection, id: i64) -> rusqlite::Result<usize> {
    let mut n = conn.execute("DELETE FROM image_tags WHERE image_id = ?1", [id])?;
    n += conn.execute("DELETE FROM album_images WHERE image_id = ?1", [id])?;
    n += conn.execute("DELETE FROM edits WHERE image_id = ?1", [id])?;
    n += conn.execute("DELETE FROM edit_history WHERE image_id = ?1", [id])?;
    n += conn.execute("DELETE FROM snapshots WHERE image_id = ?1", [id])?;
    n += conn.execute("DELETE FROM images WHERE id = ?1", [id])?;
    Ok(n)
}

/// 事务内清理记录：image_tags/album_images/edits/edit_history/snapshots/images 六表；图不存在返回 None
pub fn delete_image_record(
    conn: &Connection,
    id: i64,
) -> Result<Option<crate::images_query::ImageRow>, PixError> {
    let img = crate::images_query::get_image_by_id(conn, id)?;
    if img.is_none() {
        return Ok(None);
    }
    let tx = conn.unchecked_transaction()?;
    delete_image_record_statements(&tx, id)?;
    tx.commit()?;
    Ok(img)
}

/// 文件清理：原图 + 配对 NEF + 双档缩略图 + 编辑派生文件（预览/缓存元数据/底图缓存，
/// 镜像 Electron cleanupEditDerivedFiles 的文件侧）；单个失败吞掉继续（与 JS 同策略），
/// 不回滚记录删除
pub fn delete_image_files(
    filepath: Option<&str>,
    raw_path: Option<&str>,
    thumbs_dir: &Path,
    id: i64,
) {
    for p in [filepath, raw_path].into_iter().flatten() {
        let path = Path::new(p);
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }
    for name in [
        format!("{id}.jpg"),
        format!("{id}_s.jpg"),
        format!("edit-{id}.jpg"),
        format!("edit-{id}.jpg.meta.json"),
        format!("edit-{id}-base.jpg"),
        format!("edit-{id}-base.png"),
    ] {
        let _ = std::fs::remove_file(thumbs_dir.join(name));
    }
}

pub fn delete_image(
    conn: &Connection,
    id: i64,
    thumbs_dir: &Path,
) -> Result<Option<crate::images_query::ImageRow>, PixError> {
    let img = delete_image_record(conn, id)?;
    if let Some(img) = &img {
        delete_image_files(
            Some(img.filepath.as_str()),
            img.raw_path.as_deref(),
            thumbs_dir,
            id,
        );
    }
    Ok(img)
}

pub fn batch_delete_images(
    conn: &Connection,
    ids: &[i64],
    thumbs_dir: &Path,
) -> Result<Vec<crate::images_query::ImageRow>, PixError> {
    let tx = conn.unchecked_transaction()?;
    let mut results = Vec::new();
    for id in ids {
        let img = crate::images_query::get_image_by_id(conn, *id)?;
        if let Some(img) = img {
            delete_image_record_statements(&tx, *id)?;
            results.push(img);
        }
    }
    tx.commit()?;
    for img in &results {
        delete_image_files(
            Some(img.filepath.as_str()),
            img.raw_path.as_deref(),
            thumbs_dir,
            img.id,
        );
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> Db {
        Db::from_connection(Connection::open_in_memory().unwrap())
    }

    #[test]
    fn 数据目录_固定为标准用户目录_不再随exe位置() {
        let d = resolve_data_dir();
        assert!(
            d.to_string_lossy().ends_with("PixYang"),
            "应落在标准用户目录: {}",
            d.display()
        );
        #[cfg(windows)]
        {
            let expect = PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap()).join("PixYang");
            assert_eq!(d, expect, "Windows 应为 %LOCALAPPDATA%\\PixYang");
        }
    }

    #[test]
    fn 缩略图路径归一_旧路径复制到新目录并改写_缺失则清空() {
        let root = std::env::temp_dir().join(format!("pixyang_thumbnorm_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let old = root.join("old_thumbs");
        let new = root.join("new_thumbs");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("1.jpg"), b"T").unwrap();
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE images (id INTEGER PRIMARY KEY, thumbnail_path TEXT DEFAULT '',
             thumbnail_small_path TEXT DEFAULT '', thumbnail_edit_path TEXT DEFAULT '');",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO images (id, thumbnail_path) VALUES (1, ?1)",
            [old.join("1.jpg").to_string_lossy().to_string()],
        )
        .unwrap();
        normalize_thumbnail_paths(&conn, &new);
        let p: String = conn
            .query_row("SELECT thumbnail_path FROM images WHERE id=1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(Path::new(&p).parent().unwrap(), new.as_path());
        assert!(Path::new(&p).exists());

        conn.execute(
            "INSERT INTO images (id, thumbnail_path) VALUES (2, ?1)",
            [old.join("missing.jpg").to_string_lossy().to_string()],
        )
        .unwrap();
        normalize_thumbnail_paths(&conn, &new);
        let p2: String = conn
            .query_row("SELECT thumbnail_path FROM images WHERE id=2", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(p2.is_empty(), "文件不存在应清空列: {p2}");
        let _ = std::fs::remove_dir_all(&root);
    }

    fn thumb_rows_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE images (id INTEGER PRIMARY KEY, thumbnail_path TEXT DEFAULT '',
             thumbnail_small_path TEXT DEFAULT '', thumbnail_edit_path TEXT DEFAULT '');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn resolve_thumbs_dir_设置优先_空值与坏目录回退默认() {
        let root =
            std::env::temp_dir().join(format!("pixyang_thumbsresolve_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let data = root.join("data");
        std::fs::create_dir_all(&data).unwrap();
        let custom = root.join("custom_thumbs");

        assert_eq!(
            resolve_thumbs_dir(&data, Some("  ")),
            data.join("thumbnails"),
            "空白设置回退默认"
        );
        assert_eq!(
            resolve_thumbs_dir(&data, Some(custom.to_string_lossy().as_ref())),
            custom,
            "合法自定义目录生效（并创建）"
        );
        assert!(custom.is_dir(), "自定义目录应被创建");

        // 已存在的文件路径：不可用作目录，回退默认
        let file_path = root.join("not_a_dir");
        std::fs::write(&file_path, b"x").unwrap();
        assert_eq!(
            resolve_thumbs_dir(&data, Some(file_path.to_string_lossy().as_ref())),
            data.join("thumbnails"),
            "指向文件的设置回退默认"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn 迁移缩略图目录_搬移文件并改写三列_目标已有同名则跳过() {
        let root = std::env::temp_dir().join(format!("pixyang_thumbsmig_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let old = root.join("old");
        let new = root.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("1.jpg"), b"M").unwrap();
        std::fs::write(old.join("1_s.jpg"), b"S").unwrap();
        std::fs::write(old.join("edit-1.jpg"), b"E").unwrap();

        let conn = thumb_rows_conn();
        conn.execute(
            "INSERT INTO images (id, thumbnail_path, thumbnail_small_path, thumbnail_edit_path) VALUES (1, ?1, ?2, ?3)",
            rusqlite::params![
                old.join("1.jpg").to_string_lossy().to_string(),
                old.join("1_s.jpg").to_string_lossy().to_string(),
                old.join("edit-1.jpg").to_string_lossy().to_string(),
            ],
        )
        .unwrap();
        // 第二条记录的缩略图在目录外：不应被改写
        conn.execute(
            "INSERT INTO images (id, thumbnail_path) VALUES (2, ?1)",
            [root
                .join("elsewhere")
                .join("2.jpg")
                .to_string_lossy()
                .to_string()],
        )
        .unwrap();

        let moved = migrate_thumbs_root(&conn, &old, &new).unwrap();
        assert_eq!(moved, 3, "三个文件都应搬迁");
        assert!(new.join("1.jpg").exists() && new.join("1_s.jpg").exists());
        assert!(new.join("edit-1.jpg").exists());
        assert!(!old.join("1.jpg").exists(), "旧目录应已搬空");

        let (p1, p2, p3): (String, String, String) = conn
            .query_row(
                "SELECT thumbnail_path, thumbnail_small_path, thumbnail_edit_path FROM images WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(Path::new(&p1).parent().unwrap(), new.as_path());
        assert_eq!(Path::new(&p2).parent().unwrap(), new.as_path());
        assert_eq!(Path::new(&p3).parent().unwrap(), new.as_path());
        let outside: String = conn
            .query_row("SELECT thumbnail_path FROM images WHERE id=2", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(
            Path::new(&outside).parent().unwrap() != new.as_path(),
            "目录外引用不猜不改写"
        );

        // 幂等：同目录再迁返回 0
        assert_eq!(migrate_thumbs_root(&conn, &new, &new).unwrap(), 0);

        // 目标已有同名文件：保留目标、跳过源（不覆盖）
        let old2 = root.join("old2");
        let new2 = root.join("new2");
        std::fs::create_dir_all(&old2).unwrap();
        std::fs::create_dir_all(&new2).unwrap();
        std::fs::write(old2.join("7.jpg"), b"OLD").unwrap();
        std::fs::write(new2.join("7.jpg"), b"KEEP").unwrap();
        assert_eq!(migrate_thumbs_root(&conn, &old2, &new2).unwrap(), 0);
        assert_eq!(std::fs::read(new2.join("7.jpg")).unwrap(), b"KEEP");
        assert!(old2.join("7.jpg").exists(), "跳过的源文件不删");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn 孤儿缩略图_只认数字命名_活id不删_清理兜底校验() {
        let root = std::env::temp_dir().join(format!("pixyang_thumbsorph_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let thumbs = root.join("thumbs");
        std::fs::create_dir_all(&thumbs).unwrap();
        // 活 id 1 的缩略图 + 已删 id 9 的残留 + 编辑会话边车 + 非法命名
        std::fs::write(thumbs.join("1.jpg"), b"M").unwrap();
        std::fs::write(thumbs.join("1_s.jpg"), b"S").unwrap();
        std::fs::write(thumbs.join("9.jpg"), b"X").unwrap();
        std::fs::write(thumbs.join("9_s.jpg"), b"X").unwrap();
        std::fs::write(thumbs.join("edit-1.jpg"), b"E").unwrap();
        std::fs::write(thumbs.join("abc.jpg"), b"A").unwrap();
        std::fs::write(thumbs.join("2_s.jpg"), b"Y").unwrap(); // id 2 不在表里

        let conn = thumb_rows_conn();
        conn.execute("INSERT INTO images (id) VALUES (1)", [])
            .unwrap();

        let scan = scan_orphan_thumbnails(&conn, &thumbs).unwrap();
        let orphans = scan["orphans"].as_array().unwrap();
        let names: Vec<String> = orphans
            .iter()
            .map(|o| {
                Path::new(o["path"].as_str().unwrap())
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        assert_eq!(names.len(), 3, "仅 9/9_s/2_s 是孤儿: {names:?}");
        assert!(names.contains(&"9.jpg".to_string()));
        assert!(names.contains(&"9_s.jpg".to_string()));
        assert!(names.contains(&"2_s.jpg".to_string()));
        assert!(!names.contains(&"edit-1.jpg".to_string()), "编辑边车不碰");
        assert!(!names.contains(&"abc.jpg".to_string()), "非数字命名不碰");

        // 清理：传入活 id 的文件与目录外路径都应被拒绝
        let evil = root.join("outside.jpg");
        std::fs::write(&evil, b"Z").unwrap();
        let cleaned = clean_orphan_thumbnails(
            &conn,
            &[
                thumbs.join("9.jpg").to_string_lossy().to_string(),
                thumbs.join("1.jpg").to_string_lossy().to_string(), // 活 id：拒绝
                evil.to_string_lossy().to_string(),                 // 目录外：拒绝
            ],
            &thumbs,
        )
        .unwrap();
        assert_eq!(cleaned["removed"], 1, "只有 9.jpg 应被删");
        assert!(!thumbs.join("9.jpg").exists());
        assert!(thumbs.join("1.jpg").exists(), "活 id 缩略图必须保留");
        assert!(evil.exists(), "目录外文件必须保留");
        assert!(thumbs.join("9_s.jpg").exists(), "未传入的不动");

        assert_eq!(numeric_thumb_id("12_s.jpg"), Some(12));
        assert_eq!(numeric_thumb_id("12.jpg"), Some(12));
        assert_eq!(numeric_thumb_id("edit-1.jpg"), None);
        assert_eq!(numeric_thumb_id("1.jpg.bak"), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn 迁移_无目标库时从首个可用源复制db与缩略图_已有库则跳过() {
        let root = std::env::temp_dir().join(format!("pixyang_mig_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let empty_src = root.join("portable_data"); // 无 db → 跳过
        let real_src = root.join("legacy");
        let dst = root.join("local");
        std::fs::create_dir_all(&empty_src).unwrap();
        std::fs::create_dir_all(real_src.join("thumbnails")).unwrap();
        std::fs::write(real_src.join("pixyang.db"), b"DB").unwrap();
        std::fs::write(real_src.join("thumbnails").join("1.jpg"), b"T").unwrap();

        let got = migrate_from_sources(&dst, &[empty_src, real_src.clone()]);
        assert_eq!(got, Some(real_src.clone()), "应跳过无库源，落到第二个源");
        assert_eq!(std::fs::read(dst.join("pixyang.db")).unwrap(), b"DB");
        assert_eq!(
            std::fs::read(dst.join("thumbnails").join("1.jpg")).unwrap(),
            b"T"
        );

        // 目标已有库：再次迁移直接跳过（不覆盖）
        assert_eq!(migrate_from_sources(&dst, &[real_src]), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn 设置读写回路_缺失返回none() {
        let db = mem_db();
        assert_eq!(db.get_setting("theme").unwrap(), None);
        db.set_setting("theme", "dark").unwrap();
        assert_eq!(db.get_setting("theme").unwrap().as_deref(), Some("dark"));
        db.set_setting("theme", "light").unwrap();
        assert_eq!(db.get_setting("theme").unwrap().as_deref(), Some("light"));
    }

    #[test]
    fn 全量设置按键排序返回映射() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_settings_table(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO settings (key, value) VALUES ('b', '2'), ('a', '1'), ('theme', 'dark');",
        )
        .unwrap();
        assert_eq!(
            all_settings_map(&conn)
                .unwrap()
                .into_iter()
                .collect::<Vec<_>>(),
            vec![
                ("a".into(), "1".into()),
                ("b".into(), "2".into()),
                ("theme".into(), "dark".into())
            ]
        );
    }

    #[test]
    fn open_文件库建缺表且可写() {
        let dir = std::env::temp_dir().join("pixyang_db_test");
        let _ = std::fs::remove_dir_all(&dir);
        let db = Db::open(&dir.join("t.db")).unwrap();
        db.set_setting("k", "v").unwrap();
        assert_eq!(db.get_setting("k").unwrap().as_deref(), Some("v"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_read_文件库读到已提交数据() {
        let dir = std::env::temp_dir().join("pixyang_db_readconn");
        let _ = std::fs::remove_dir_all(&dir);
        let db = Db::open(&dir.join("t.db")).unwrap();
        db.set_setting("k", "v1").unwrap();
        let conn = db.open_read().unwrap();
        assert_eq!(get_setting_raw(&conn, "k").unwrap().as_deref(), Some("v1"));
        db.set_setting("k", "v2").unwrap();
        assert_eq!(get_setting_raw(&conn, "k").unwrap().as_deref(), Some("v2"));
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 写连接持锁期间_open_read读不被阻塞() {
        let dir = std::env::temp_dir().join("pixyang_db_conc");
        let _ = std::fs::remove_dir_all(&dir);
        let db = Db::open(&dir.join("c.db")).unwrap();
        db.set_setting("k", "v").unwrap();
        let guard = db.write_lock();
        let db2 = db.clone();
        let reader = std::thread::spawn(move || {
            let conn = db2.open_read().unwrap();
            conn.query_row("SELECT value FROM settings WHERE key = 'k'", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap()
        });
        assert_eq!(reader.join().unwrap(), "v");
        drop(guard);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod delete_tests {
    use super::*;
    use crate::images_query::tests::mem_db as full_mem_db;

    #[test]
    fn 删除图片_六表清理_源文件与缩略图删除() {
        let dir = std::env::temp_dir().join("pixyang_del_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("thumbs")).unwrap();
        let f1 = dir.join("a.jpg");
        let raw = dir.join("a.nef");
        std::fs::write(&f1, b"x").unwrap();
        std::fs::write(&raw, b"y").unwrap();

        let conn = full_mem_db();
        conn.execute_batch(&format!(
            "INSERT INTO images (id, filename, filepath, import_date, raw_path) VALUES (1, 'a.jpg', '{}', '2026-01-01', '{}');
             INSERT INTO tags (id, name) VALUES (1, 't'); INSERT INTO image_tags VALUES (1, 1);
             INSERT INTO albums (id, name) VALUES (1, 'al'); INSERT INTO album_images VALUES (1, 1, 0);
             INSERT INTO edits (image_id) VALUES (1); INSERT INTO edit_history (image_id) VALUES (1);
             INSERT INTO snapshots (image_id, name, params_json) VALUES (1, '我的快照', '{{}}');",
            f1.to_string_lossy().replace("\\", "/"),
            raw.to_string_lossy().replace("\\", "/")
        ))
        .unwrap();
        std::fs::write(dir.join("thumbs").join("1.jpg"), b"t").unwrap();
        std::fs::write(dir.join("thumbs").join("1_s.jpg"), b"t").unwrap();

        let thumbs = dir.join("thumbs");
        let img = delete_image(&conn, 1, &thumbs).unwrap().unwrap();
        assert_eq!(img.id, 1);
        assert!(!f1.exists());
        assert!(!raw.exists());
        assert!(!thumbs.join("1.jpg").exists());
        assert!(!thumbs.join("1_s.jpg").exists());
        let tag_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM image_tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tag_count, 0);
        let snapshot_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM snapshots", [], |r| r.get(0))
            .unwrap();
        assert_eq!(snapshot_count, 0, "快照须随图片删除清理");
        assert!(delete_image(&conn, 1, &thumbs).unwrap().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 批量删除_缺失id跳过_仅删存在的() {
        let dir = std::env::temp_dir().join("pixyang_bdel_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let conn = full_mem_db();
        conn.execute_batch(&format!(
            "INSERT INTO images (id, filename, filepath, import_date) VALUES
               (1, 'a.jpg', '{}', '2026-01-01'), (2, 'b.jpg', '{}', '2026-01-01');",
            dir.join("a.jpg").to_string_lossy().replace("\\", "/"),
            dir.join("b.jpg").to_string_lossy().replace("\\", "/")
        ))
        .unwrap();
        std::fs::write(dir.join("a.jpg"), b"a").unwrap();
        std::fs::write(dir.join("b.jpg"), b"b").unwrap();

        let results = batch_delete_images(&conn, &[1, 999, 2], &dir).unwrap();
        assert_eq!(results.len(), 2);
        assert!(!dir.join("a.jpg").exists());
        assert!(!dir.join("b.jpg").exists());
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM images", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod path_tests {
    use super::*;

    #[test]
    fn images_root_默认创建_设置覆盖生效() {
        let dir = std::env::temp_dir().join("pixyang_root_test");
        let _ = std::fs::remove_dir_all(&dir);
        let conn = crate::images_query::tests::mem_db();
        let default_dir = dir.join("images");
        let root = images_root(&conn, &default_dir).unwrap();
        assert!(root.exists());
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('images_root', ?1)",
            [dir.join("custom").to_str().unwrap()],
        )
        .unwrap();
        let root2 = images_root(&conn, &default_dir).unwrap();
        assert!(root2.ends_with("custom"));
        assert!(root2.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 托管文件判定_根外存在也判false() {
        let dir = std::env::temp_dir().join("pixyang_managed_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("images")).unwrap();
        let conn = crate::images_query::tests::mem_db();
        let inside = dir.join("images").join("a.jpg");
        std::fs::write(&inside, b"x").unwrap();
        let outside = dir.join("outside.jpg");
        std::fs::write(&outside, b"x").unwrap();
        assert!(managed_file_exists(&conn, &dir.join("images"), inside.to_str().unwrap()).unwrap());
        assert!(
            !managed_file_exists(&conn, &dir.join("images"), outside.to_str().unwrap()).unwrap()
        );
        assert!(!managed_file_exists(
            &conn,
            &dir.join("images"),
            dir.join("images").join("no.jpg").to_str().unwrap()
        )
        .unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn 文件清理_含编辑派生文件() {
        let dir = std::env::temp_dir().join("pixyang_delete_files");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("thumbs")).unwrap();
        let id = 42;
        let original = dir.join("keep_nothing").join("a.jpg");
        let _ = std::fs::remove_dir_all(original.parent().unwrap());
        std::fs::create_dir_all(original.parent().unwrap()).unwrap();
        std::fs::write(&original, b"orig").unwrap();
        let mut existing = std::collections::BTreeSet::new();
        for name in [
            format!("{id}.jpg"),
            format!("{id}_s.jpg"),
            format!("edit-{id}.jpg"),
            format!("edit-{id}.jpg.meta.json"),
            format!("edit-{id}-base.jpg"),
            format!("edit-{id}-base.png"),
        ] {
            let p = dir.join("thumbs").join(&name);
            std::fs::write(&p, b"x").unwrap();
            existing.insert(name);
        }
        delete_image_files(
            Some(original.to_str().unwrap()),
            None,
            &dir.join("thumbs"),
            id,
        );
        assert!(!original.exists());
        for name in &existing {
            assert!(!dir.join("thumbs").join(name).exists(), "应被清理: {name}");
        }
        // 缺失文件静默跳过：重复调用不报错
        delete_image_files(None, None, &dir.join("thumbs"), id);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_全新库自举业务表与索引() {
        let dir = std::env::temp_dir().join("pixyang_db_schema_fresh");
        let _ = std::fs::remove_dir_all(&dir);
        let db = Db::open(&dir.join("t.db")).unwrap();
        let conn = db.open_read().unwrap();
        for t in [
            "images",
            "tags",
            "image_tags",
            "albums",
            "album_images",
            "edits",
            "edit_history",
            "presets",
            "snapshots",
            "settings",
        ] {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
                    [t],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "缺业务表: {t}");
        }
        let idx: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT name) FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(idx >= 15, "索引数不足: {idx}");
        conn.execute(
            "INSERT INTO images (filename, filepath, import_date) VALUES ('a.jpg', '/x/a.jpg', '2026-01-01')",
            [],
        )
        .unwrap();
        let stats = crate::images_query::get_stats(&conn).unwrap();
        assert_eq!(stats.total_images, 1);
        let plan: String = conn
            .query_row(
                "EXPLAIN QUERY PLAN SELECT id FROM images WHERE hidden = 0 ORDER BY CASE WHEN taken_at != '' THEN taken_at ELSE import_date END DESC, id DESC LIMIT 15 OFFSET 0",
                [],
                |r| r.get(3),
            )
            .unwrap();
        assert!(
            plan.contains("idx_images_visible_sort_date"),
            "日期翻页未命中表达式索引: {plan}"
        );
        drop(conn);
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_旧库缺列回迁并回填更新时间且可重复打开() {
        let dir = std::env::temp_dir().join("pixyang_db_schema_legacy");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.db");
        {
            let conn = Connection::open(&p).unwrap();
            conn.execute_batch(
                "CREATE TABLE images (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL,
                    filepath TEXT UNIQUE,
                    notes TEXT DEFAULT '',
                    created_at DATETIME
                 );
                 INSERT INTO images (filename, filepath, created_at) VALUES ('a', '/a', '2020-01-02 03:04:05');",
            )
            .unwrap();
        }
        let db = Db::open(&p).unwrap();
        let cols_after_first: i64;
        {
            let conn = db.write_lock();
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('images') WHERE name IN ('hidden','taken_at','thumbnail_edit_path','hash','updated_at')",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 5, "缺列未回迁齐");
            let ua: String = conn
                .query_row(
                    "SELECT updated_at FROM images WHERE filename = 'a'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(ua, "2020-01-02 03:04:05", "updated_at 应按 created_at 回填");
            cols_after_first = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('images')",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
        }
        drop(db);
        let db2 = Db::open(&p).unwrap();
        let conn = db2.open_read().unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('images')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, cols_after_first, "重复打开不得再加列");
        drop(conn);
        drop(db2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── R102 跨模块集成审计：极端旧库（异形 images 表）× 索引自举 ──
    // images 表缺 filename 时逐列回迁守卫主动放弃改表（防把外来表改坏），随后
    // BUSINESS_INDEXES 引用的 import_date 等列必然缺失——索引是纯性能面，失败不得
    // 让 Db::open 整体报错把应用钉死在启动屏（降级运行 + 日志留档，与
    // delete_image_files 单文件失败吞掉继续同一哲学）。变异验证：回退容错分支本条先红。

    #[test]
    fn open_异形images表缺filename_降级启动_外来数据原样保留() {
        let dir = std::env::temp_dir().join("pixyang_db_schema_alien");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.db");
        {
            let conn = Connection::open(&p).unwrap();
            conn.execute_batch(
                "CREATE TABLE images (x INTEGER);
                 INSERT INTO images VALUES (7);",
            )
            .unwrap();
        }
        let db = Db::open(&p).expect("异形 images 表不得阻断启动（索引可降级）");
        // settings / tags / albums 等其余业务面照常自举可用
        db.set_setting("theme", "dark").unwrap();
        assert_eq!(db.get_setting("theme").unwrap().as_deref(), Some("dark"));
        let conn = db.open_read().unwrap();
        for t in ["tags", "albums", "image_tags", "album_images", "presets"] {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
                    [t],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "缺业务表: {t}");
        }
        // 外来表数据一行不少：异形表绝不被改写
        let x: i64 = conn
            .query_row("SELECT x FROM images", [], |r| r.get(0))
            .unwrap();
        assert_eq!(x, 7);
        drop(conn);
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_多列错型旧库_缺列回迁额外列保留_错型列经亲和仍可查() {
        let dir = std::env::temp_dir().join("pixyang_db_schema_weird");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.db");
        {
            let conn = Connection::open(&p).unwrap();
            // 列序打乱 + 额外列 legacy_col + 错型列（rating TEXT）：
            // 回迁只补缺列、绝不动既有列（含错型与额外列）
            conn.execute_batch(
                "CREATE TABLE images (
                    legacy_extra TEXT DEFAULT '',
                    rating TEXT DEFAULT '0',
                    filepath TEXT UNIQUE,
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL
                 );
                 INSERT INTO images (filename, filepath, rating, legacy_extra)
                 VALUES ('a.jpg', '/a.jpg', '3', 'keep');",
            )
            .unwrap();
        }
        let db = Db::open(&p).unwrap();
        let conn = db.open_read().unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('images') WHERE name IN
                 ('hidden','taken_at','import_date','hash','updated_at','flag')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 6, "缺列应全部回迁");
        // 额外列与旧数据原样保留；错型 rating 列不做任何改写
        let row: (String, String, String) = conn
            .query_row(
                "SELECT legacy_extra, rating, filename FROM images WHERE filepath = '/a.jpg'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(row, ("keep".into(), "3".into(), "a.jpg".into()));
        // TEXT 亲和列上的评分谓词（TEXT 存值亲和转换后照常匹配）
        let hit: i64 = conn
            .query_row("SELECT COUNT(*) FROM images WHERE rating >= 3", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(hit, 1);
        drop(conn);
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 默认设置只补缺不覆盖既有值() {
        let dir = std::env::temp_dir().join("pixyang_db_schema_defaults");
        let _ = std::fs::remove_dir_all(&dir);
        let p = dir.join("t.db");
        let db = Db::open(&p).unwrap();
        assert_eq!(db.get_setting("theme").unwrap().as_deref(), Some("dark"));
        db.set_setting("theme", "midnight").unwrap();
        drop(db);
        let db2 = Db::open(&p).unwrap();
        assert_eq!(
            db2.get_setting("theme").unwrap().as_deref(),
            Some("midnight"),
            "INSERT OR IGNORE 不得覆盖用户设置"
        );
        drop(db2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

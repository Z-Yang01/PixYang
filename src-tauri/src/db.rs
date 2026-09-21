// SQLite 内核：迁移窗口内与 Electron 共用同一库文件（userData/pixyang.db，WAL）。
// 表结构由 Electron 侧 migrateSchema 拥有；这里只做 settings 读写，缺表时按同式补齐。

pub use crate::error::PixError;
use rusqlite::{Connection, OptionalExtension};
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
        if path != Path::new(":memory:") {
            conn.pragma_update(None, "journal_mode", "WAL")?;
        }
        ensure_settings_table(&conn)?;
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

    pub fn get_all_settings(&self) -> Result<Vec<(String, String)>, rusqlite::Error> {
        let conn = self.write_lock();
        all_settings(&conn)
    }

    /// 对象形态（镜像 JS getAllSettings 的 {key: value}），命令层直接序列化
    pub fn get_all_settings_map(
        &self,
    ) -> Result<std::collections::BTreeMap<String, String>, rusqlite::Error> {
        let conn = self.write_lock();
        all_settings_map(&conn)
    }
}

pub fn all_settings(conn: &Connection) -> Result<Vec<(String, String)>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
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

/// 便携数据目录：安装目录\data（可写探测通过才启用）；失败回退旧版 %APPDATA% 位置
pub fn exe_portable_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.join("data");
    std::fs::create_dir_all(&dir).ok()?;
    let probe = dir.join(".write-test");
    std::fs::write(&probe, b"1").ok()?;
    std::fs::remove_file(&probe).ok()?;
    Some(dir)
}

pub fn resolve_data_dir() -> PathBuf {
    exe_portable_dir().unwrap_or_else(legacy_data_dir)
}

/// 一次性快照迁移：旧位置（Electron userData）的库/缩略图复制进便携 data（非破坏，
/// 旧版应用仍可读原位置；目标已有库视为已迁移跳过）。返回是否执行了复制。
pub fn migrate_legacy_snapshot(data_dir: &Path) -> bool {
    let legacy = legacy_data_dir();
    if legacy == data_dir {
        return false;
    }
    let src_db = legacy.join("pixyang.db");
    let dst_db = data_dir.join("pixyang.db");
    if !src_db.exists() || dst_db.exists() {
        return false;
    }
    let _ = std::fs::create_dir_all(data_dir);
    for name in ["pixyang.db", "pixyang.db-wal", "pixyang.db-shm"] {
        let from = legacy.join(name);
        if from.exists() {
            let _ = std::fs::copy(&from, data_dir.join(name));
        }
    }
    let (src_thumbs, dst_thumbs) = (legacy.join("thumbnails"), data_dir.join("thumbnails"));
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
    true
}

pub fn default_db_path() -> PathBuf {
    resolve_data_dir().join("pixyang.db")
}

/// 缩略图目录随数据目录（便携模式=安装目录\data\thumbnails）
pub fn default_thumbnails_dir() -> PathBuf {
    let mut base = default_db_path();
    base.set_file_name("thumbnails");
    base
}

/// 托管状态：连接 + 宿主派生路径（缩略图目录、默认图片根）
#[derive(Clone)]
pub struct AppPaths {
    pub thumbs_dir: PathBuf,
    pub default_images_dir: PathBuf,
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
    n += conn.execute("DELETE FROM images WHERE id = ?1", [id])?;
    Ok(n)
}

/// 事务内清理记录：image_tags/album_images/edits/edit_history/images 五表；图不存在返回 None
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
    fn 设置读写回路_缺失返回none() {
        let db = mem_db();
        assert_eq!(db.get_setting("theme").unwrap(), None);
        db.set_setting("theme", "dark").unwrap();
        assert_eq!(db.get_setting("theme").unwrap().as_deref(), Some("dark"));
        db.set_setting("theme", "light").unwrap();
        assert_eq!(db.get_setting("theme").unwrap().as_deref(), Some("light"));
    }

    #[test]
    fn 全量设置返回键值对列表() {
        let db = mem_db();
        db.set_setting("a", "1").unwrap();
        db.set_setting("b", "2").unwrap();
        let mut all = db.get_all_settings().unwrap();
        all.sort();
        assert_eq!(
            all,
            vec![("a".into(), "1".into()), ("b".into(), "2".into())]
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
    fn 删除图片_五表清理_源文件与缩略图删除() {
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
             INSERT INTO edits (image_id) VALUES (1); INSERT INTO edit_history (image_id) VALUES (1);",
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
}

// SQLite 内核：迁移窗口内与 Electron 共用同一库文件（userData/pixyang.db，WAL）。
// 表结构由 Electron 侧 migrateSchema 拥有；这里只做 settings 读写，缺表时按同式补齐。

use rusqlite::{Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        if path != Path::new(":memory:") {
            conn.pragma_update(None, "journal_mode", "WAL")?;
        }
        ensure_settings_table(&conn)?;
        Ok(Self(Mutex::new(conn)))
    }

    pub fn from_connection(conn: Connection) -> Self {
        ensure_settings_table(&conn).expect("settings 表创建失败");
        Self(Mutex::new(conn))
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, rusqlite::Error> {
        let conn = self.0.lock().unwrap();
        conn.query_row("SELECT value FROM settings WHERE key = ?", [key], |r| {
            r.get(0)
        })
        .optional()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), rusqlite::Error> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            [key, value],
        )?;
        Ok(())
    }

    pub fn get_all_settings(&self) -> Result<Vec<(String, String)>, rusqlite::Error> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect()
    }
}

fn ensure_settings_table(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
    )
}

/// 镜像 Electron userData 路径（app name 'pixyang'），迁移窗口内双栈读写同一库文件
pub fn default_db_path() -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(dir) = std::env::var_os("APPDATA") {
            return PathBuf::from(dir).join("pixyang").join("pixyang.db");
        }
    }
    #[cfg(not(windows))]
    {
        if let Some(dir) = std::env::var_os("HOME") {
            return PathBuf::from(dir)
                .join(".config")
                .join("pixyang")
                .join("pixyang.db");
        }
    }
    PathBuf::from("pixyang.db")
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
}

// 统一错误类型：文件操作类内核使用；命令层统一 to_string() 过 IPC。

use std::fmt;

#[derive(Debug)]
pub enum PixError {
    Db(rusqlite::Error),
    Io(String),
}

impl fmt::Display for PixError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PixError::Db(e) => write!(f, "数据库错误: {e}"),
            PixError::Io(msg) => write!(f, "文件操作失败: {msg}"),
        }
    }
}

impl std::error::Error for PixError {}

impl From<rusqlite::Error> for PixError {
    fn from(e: rusqlite::Error) -> Self {
        PixError::Db(e)
    }
}

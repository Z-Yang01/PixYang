// 引擎错误原文 → 中文上屏文案：Rust 侧命令边界的唯一出口。
// 与前端 src/lib/errorText.js 同语义（前端兜 JS/WebView 侧错误），两份实现由
// shared/errorCorpus.json 逐条对拍锁住（cargo 侧 err_cn::tests + vitest 侧 parity 用例）。
// 未命中规则的英文原文一律 eprintln! 留档后上屏「操作未成功」，避免英文泄漏。

pub fn text<T: std::fmt::Display>(e: &T) -> String {
    line(&e.to_string())
}

pub fn line(raw: &str) -> String {
    let mut prefixes: Vec<&str> = Vec::new();
    let mut rest = raw.trim();
    loop {
        match split_prefix(rest) {
            Some((head, tail)) => {
                prefixes.push(head);
                rest = tail.trim();
                if rest.is_empty() {
                    break;
                }
            }
            None => break,
        }
    }
    let body = translate(rest);
    let mut out = body;
    for head in prefixes.iter().rev() {
        out = format!("{head}：{out}");
    }
    out
}

fn split_prefix(raw: &str) -> Option<(&str, &str)> {
    let (idx, sep_len) = raw
        .char_indices()
        .find(|(_, c)| *c == ':' || *c == '：')
        .map(|(i, c)| (i, c.len_utf8()))?;
    let head = raw[..idx].trim();
    if head.is_empty() || !has_cjk(head) {
        return None;
    }
    Some((head, &raw[idx + sep_len..]))
}

fn translate(body: &str) -> String {
    let body = body.trim();
    if body.is_empty() {
        return String::new();
    }
    if has_cjk(body) {
        return body.to_string();
    }
    let low = body.to_lowercase();
    let code = os_code(&low);
    let known: Option<(&str, bool)> = match low.as_str() {
        _ if contains_any(&low, &["already exists", "file exists"]) => Some(("文件已存在", false)),
        _ if contains_any(&low, &["directory not empty"]) => Some(("目录非空", false)),
        _ if contains_any(&low, &["is a directory", "not a directory"]) => {
            Some(("路径类型不符", false))
        }
        _ if contains_any(
            &low,
            &[
                "access is denied",
                "permission denied",
                "being used by another process",
                "sharing violation",
                "would block",
            ],
        ) =>
        {
            Some(("文件被占用或权限不足", true))
        }
        _ if contains_any(
            &low,
            &[
                "no such file or directory",
                "cannot find the file",
                "cannot find the path",
                "path not found",
                "notfound",
                "entity not found",
            ],
        ) =>
        {
            Some(("文件或路径不存在", true))
        }
        _ if contains_any(
            &low,
            &[
                "name too long",
                "path too long",
                "invalidfilename",
                "filename or extension is too long",
            ],
        ) =>
        {
            Some(("路径过长", true))
        }
        _ if contains_any(
            &low,
            &[
                "no space left",
                "not enough space",
                "disk full",
                "insufficient disk",
            ],
        ) =>
        {
            Some(("磁盘空间不足", true))
        }
        _ if code == Some(5) || code == Some(32) => Some(("文件被占用或权限不足", true)),
        _ if code == Some(2) || code == Some(3) => Some(("文件或路径不存在", true)),
        _ if code == Some(36) || code == Some(206) => Some(("路径过长", true)),
        _ if code == Some(112) => Some(("磁盘空间不足", true)),
        _ if contains_any(
            &low,
            &[
                "database is locked",
                "database table is locked",
                "sqlite_busy",
            ],
        ) =>
        {
            Some(("数据库正被其他程序占用", false))
        }
        _ if low.contains("no such table") => Some(("数据库表缺失", false)),
        _ if low.contains("no such column") || low.contains("invalid column name") => {
            Some(("数据库字段缺失", false))
        }
        _ if low.contains("unique constraint") => Some(("记录已存在", false)),
        _ if low.contains("foreign key constraint") => Some(("关联记录不存在", false)),
        _ if low.contains("query returned no rows") => Some(("记录不存在", false)),
        _ if contains_any(&low, &["rusqlite", "sqlite", "database"]) => {
            Some(("数据库操作失败", false))
        }
        _ if contains_any(
            &low,
            &[
                "could not autodetect",
                "could not auto-detect",
                "image format",
                "unknown image type",
                "unsupported image",
                "could not be parsed",
                "image error",
                "decode",
                "corrupt",
            ],
        ) =>
        {
            Some(("图片无法解码", false))
        }
        _ if contains_any(&low, &["teximage2d", "webgl", "gl_invalid", "framebuffer"]) => {
            Some(("图形预览失败，已回退基础预览", false))
        }
        _ if contains_any(
            &low,
            &[
                "cannot read properties of",
                "is not a function",
                "of undefined",
                "of null",
            ],
        ) =>
        {
            Some(("内部数据不完整", false))
        }
        _ if contains_any(
            &low,
            &["failed to fetch", "networkerror", "load failed", "err_"],
        ) =>
        {
            Some(("本地文件读取失败", false))
        }
        _ if contains_any(
            &low,
            &[
                "failed to join task",
                "task cancelled",
                "sender channel closed",
            ],
        ) =>
        {
            Some(("任务被中断", false))
        }
        _ if contains_any(&low, &["timed out", "timeout"]) => Some(("操作超时", false)),
        _ => None,
    };
    match known {
        Some((cn, with_code)) => {
            if with_code {
                if let Some(n) = code {
                    return format!("{cn}（错误码 {n}）");
                }
            }
            cn.to_string()
        }
        None => {
            eprintln!("[err_cn] 未收录的引擎错误原文，上屏已降级为通用文案：{body}");
            "操作未成功".to_string()
        }
    }
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| haystack.contains(n))
}

fn os_code(low: &str) -> Option<u32> {
    for key in ["os error ", "code:", "code ", "error 0x"] {
        let mut at = 0usize;
        while let Some(found) = low[at..].find(key) {
            let start = at + found + key.len();
            let tail = low[start..].trim_start();
            let digits: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(n) = digits.parse::<u32>() {
                return Some(n);
            }
            at = start;
            if at >= low.len() {
                break;
            }
        }
    }
    None
}

fn has_cjk(s: &str) -> bool {
    s.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 共享语料逐条对拍() {
        let raw = include_str!("../../shared/errorCorpus.json");
        let value: serde_json::Value =
            serde_json::from_str(raw).expect("errorCorpus.json 必须是合法 JSON");
        let pairs = value.as_array().expect("errorCorpus.json 顶层必须是数组");
        assert!(pairs.len() >= 16, "语料条数意外变少：{}", pairs.len());
        for pair in pairs {
            let input = pair[0].as_str().expect("语料首项必须是字符串");
            let expected = pair[1].as_str().expect("语料次项必须是字符串");
            assert_eq!(line(input).as_str(), expected, "语料失配：{input}");
        }
    }

    #[test]
    fn 上屏文案不含英文单词且保留错误码() {
        let s = line(
            "文件操作失败: Os { code: 32, kind: PermissionDenied, message: \"Sharing violation\" }",
        );
        assert_eq!(s, "文件操作失败：文件被占用或权限不足（错误码 32）");
        for case in [
            "IoError for script segment (\\??\\E:\\PicX\\a.nef)",
            "failed to fill whole buffer",
            "tried to parse timestamp",
        ] {
            let out = line(case);
            assert_eq!(out, "操作未成功", "未命中语料须降级：{case} → {out}");
        }
    }

    #[test]
    fn 中文正文与嵌套前缀不被覆写() {
        assert_eq!(
            line("文件操作失败: 建目录失败: Os { code: 5, kind: PermissionDenied }"),
            "文件操作失败：建目录失败：文件被占用或权限不足（错误码 5）"
        );
        assert_eq!(
            line("编辑失败：隐藏的 NEF 记录不支持编辑"),
            "编辑失败：隐藏的 NEF 记录不支持编辑"
        );
        assert_eq!(line(""), "");
        assert_eq!(
            text(&std::io::Error::from(std::io::ErrorKind::NotFound)),
            "文件或路径不存在"
        );
    }

    #[test]
    fn 盘符冒号不误判为前缀() {
        assert_eq!(line("IoError for E:\\PicX\\x.jpg"), "操作未成功");
    }

    #[test]
    fn 真实rusqlite错误过完链路只剩中文() {
        let conn = crate::images_query::tests::mem_db();
        let missing_table = conn
            .execute("SELECT 1 FROM table_that_does_not_exist", [])
            .unwrap_err();
        assert_eq!(text(&missing_table), "数据库表缺失");
        let missing_column = conn
            .execute("SELECT nope_column FROM images", [])
            .unwrap_err();
        assert_eq!(text(&missing_column), "数据库字段缺失");
        let wrapped = PixErrorWrap(missing_column.to_string());
        assert_eq!(line(&wrapped.0), "数据库字段缺失");
    }

    struct PixErrorWrap(String);
    impl std::fmt::Display for PixErrorWrap {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "数据库错误: {}", self.0)
        }
    }
}

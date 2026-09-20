// 移植 electron/database.js importImages/importOne 的纯函数部分：
// jpg/nef 配对分组（键 = dirname::pair_base，保持首次出现顺序）、
// 导入日期围栏（^\d{4}-\d{2}-\d{2}$ 否则回退今天）、安全文件名（basename 且拒 ''/'.'/'..'）。
// DB 查重/落库/复制不进内核，由宿主命令层编排。

use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq)]
pub struct ImportFile {
    pub filename: String,
    pub filepath: String,
    pub raw_source: Option<String>,
    pub raw_filename: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct PairGroup {
    pub jpg: Option<ImportFile>,
    pub nef: Option<ImportFile>,
}

fn ext_lower(filename: &str) -> String {
    crate::naming::extname(filename).to_lowercase()
}

/// 镜像 node path.dirname 的常用情形：无分隔符 → '.'；仅根分隔符 → 该根；保留盘符
pub fn dirname(p: &str) -> String {
    let bytes = p.as_bytes();
    match (0..bytes.len())
        .rev()
        .find(|&i| bytes[i] == b'/' || bytes[i] == b'\\')
    {
        None => ".".into(),
        Some(0) => p[..1].into(),
        Some(i) => {
            let head = &p[..i];
            if head.ends_with(':') {
                format!("{}\\", head)
            } else {
                head.into()
            }
        }
    }
}

/// 镜像 node path.basename：剥尾部分隔符后取末段
pub fn basename(p: &str) -> String {
    let trimmed = p.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return p.chars().take(1).collect();
    }
    match trimmed.rfind(['/', '\\']) {
        Some(i) => trimmed[i + 1..].to_string(),
        None => trimmed.to_string(),
    }
}

/// 导入文件名围栏：非法（''/'.'/'..'）返回 None，宿主跳过该文件
pub fn safe_basename(filename: &str) -> Option<String> {
    match basename(filename).as_str() {
        "" | "." | ".." => None,
        s => Some(s.to_string()),
    }
}

/// 导入日期围栏：非法日期会拼出任意目录名逃出托管根，只接受 YYYY-MM-DD 否则回退今天
pub fn effective_import_date(raw: &str, today: &str) -> String {
    let b = raw.as_bytes();
    let valid = b.len() == 10
        && b.iter().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        });
    if valid {
        raw.to_string()
    } else {
        today.to_string()
    }
}

/// 'YYYY-MM-DD' → 托管根下的相对目录 yyyy/MM/dd；非三段返回 None（调用方回退今天再调）
pub fn date_dir(date_str: &str) -> Option<PathBuf> {
    let parts: Vec<&str> = date_str.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    Some(parts.iter().collect())
}

/// jpg/nef 分组：同目录同主名（pair_base 小写归并）一组；.nef（小写判定）入 nef 槽，
/// 其余入 jpg 槽；jpg 自带 raw_source 且组内无 nef 时合成配对项（size 0 占位，同 JS）。
/// 返回按首次出现顺序排列的 (组键, 组)。
pub fn group_import_files(files: &[ImportFile]) -> Vec<(String, PairGroup)> {
    let mut order: Vec<(String, PairGroup)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for img in files {
        let key = format!(
            "{}::{}",
            dirname(&img.filepath),
            crate::naming::pair_base(&img.filename)
        );
        let slot = match index.get(&key) {
            Some(&i) => &mut order[i].1,
            None => {
                order.push((key.clone(), PairGroup::default()));
                let i = order.len() - 1;
                index.insert(key, i);
                &mut order[i].1
            }
        };
        if ext_lower(&img.filename) == ".nef" {
            slot.nef = Some(img.clone());
        } else {
            let has_nef = slot.nef.is_some();
            let raw_pair = match (&img.raw_source, &img.raw_filename) {
                (Some(src), Some(name)) if !has_nef => Some(ImportFile {
                    filename: name.clone(),
                    filepath: src.clone(),
                    raw_source: None,
                    raw_filename: None,
                }),
                _ => None,
            };
            slot.jpg = Some(img.clone());
            if let Some(pair) = raw_pair {
                slot.nef = Some(pair);
            }
        }
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(filename: &str, filepath: &str) -> ImportFile {
        ImportFile {
            filename: filename.into(),
            filepath: filepath.into(),
            raw_source: None,
            raw_filename: None,
        }
    }

    #[test]
    fn 同目录同主名jpg与nef归并一组() {
        let groups = group_import_files(&[
            f("DSC_1.jpg", r"E:\cam\DSC_1.jpg"),
            f("DSC_1.NEF", r"E:\cam\DSC_1.NEF"),
        ]);
        assert_eq!(groups.len(), 1);
        assert!(groups[0].0.ends_with(r"E:\cam::dsc_1"));
        assert!(groups[0].1.jpg.is_some());
        assert!(groups[0].1.nef.is_some());
    }

    #[test]
    fn 大小写混排与不同目录各自成组() {
        let groups = group_import_files(&[
            f("dsc_1.jpg", r"E:\cam\dsc_1.jpg"),
            f("DSC_1.NEF", r"E:\other\DSC_1.NEF"),
        ]);
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn jpg自带raw_source时合成配对() {
        let mut img = f("a.jpg", r"E:\cam\a.jpg");
        img.raw_source = Some(r"E:\cam\a.nef".into());
        img.raw_filename = Some("a.nef".into());
        let groups = group_import_files(&[img]);
        let nef = groups[0].1.nef.as_ref().unwrap();
        assert_eq!(nef.filepath, r"E:\cam\a.nef");
        assert_eq!(nef.filename, "a.nef");
    }

    #[test]
    fn 组内已有nef时不覆盖() {
        let mut img = f("a.jpg", r"E:\cam\a.jpg");
        img.raw_source = Some(r"E:\cam\b.nef".into());
        img.raw_filename = Some("b.nef".into());
        let groups = group_import_files(&[f("a.NEF", r"E:\cam\a.NEF"), img]);
        assert_eq!(groups[0].1.nef.as_ref().unwrap().filepath, r"E:\cam\a.NEF");
    }

    #[test]
    fn 同槽后者覆盖保持插入序() {
        let groups = group_import_files(&[
            f("x.jpg", r"E:\d\x.jpg"),
            f("y.jpg", r"E:\d\y.jpg"),
            f("x.jpg", r"E:\d\x.jpg"),
        ]);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].1.jpg.as_ref().unwrap().filename, "x.jpg");
    }

    #[test]
    fn 仅nef无jpg成组() {
        let groups = group_import_files(&[f("lone.NEF", r"E:\cam\lone.NEF")]);
        assert!(groups[0].1.jpg.is_none());
        assert!(groups[0].1.nef.is_some());
    }

    #[test]
    fn 导入日期围栏_非法回退今天() {
        assert_eq!(
            effective_import_date("2026-09-20", "2026-01-01"),
            "2026-09-20"
        );
        assert_eq!(effective_import_date("../../x", "2026-01-01"), "2026-01-01");
        assert_eq!(
            effective_import_date("2026-9-2", "2026-01-01"),
            "2026-01-01"
        );
        assert_eq!(
            effective_import_date("2026/09/20", "2026-01-01"),
            "2026-01-01"
        );
    }

    #[test]
    fn 日期目录三段拼接() {
        assert_eq!(
            date_dir("2026-09-20"),
            Some(PathBuf::from("2026").join("09").join("20"))
        );
        assert_eq!(date_dir("bad"), None);
    }

    #[test]
    fn 安全文件名_路径逃逸被剥到末段() {
        assert_eq!(safe_basename("../../x.jpg").as_deref(), Some("x.jpg"));
        assert_eq!(safe_basename("a/b.jpg").as_deref(), Some("b.jpg"));
        assert_eq!(safe_basename(""), None);
        assert_eq!(safe_basename("."), None);
        assert_eq!(safe_basename(".."), None);
    }

    #[test]
    fn dirname_镜像常用情形() {
        assert_eq!(dirname(r"E:\a\b.jpg"), r"E:\a");
        assert_eq!(dirname("/a/b.jpg"), "/a");
        assert_eq!(dirname("b.jpg"), ".");
        assert_eq!(dirname(r"E:\a.jpg"), r"E:\");
    }
}

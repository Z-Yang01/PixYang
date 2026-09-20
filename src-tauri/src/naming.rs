// 移植 electron/database.js 的唯一命名语义（generateUniqueFilename / isPathTaken / pairBase）。
// 占用判定与 JS 一致为「合并集 ∪ 磁盘」：合并集由调用方把 DB 行（filepath/raw_path）
// 与磁盘扫描结果统一为小写全路径传入；DB 逐条查询不进纯函数内核。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// 镜像 node path.extname：取末段最后一个点，段首点不算扩展名（'.hidden' → ''，'a.' → '.'）
pub fn extname(filename: &str) -> &str {
    let bytes = filename.as_bytes();
    let mut dot = None;
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'.' {
            let starts_segment = i == 0 || bytes[i - 1] == b'/' || bytes[i - 1] == b'\\';
            if !starts_segment {
                dot = Some(i);
            }
        }
    }
    match dot {
        Some(i) => &filename[i..],
        None => "",
    }
}

/// 镜像 node path.basename(name, ext)：后缀匹配区分大小写，只剥真实扩展名
pub fn basename_no_ext(filename: &str) -> &str {
    match extname(filename) {
        "" => filename,
        ext => &filename[..filename.len() - ext.len()],
    }
}

/// jpg/nef 配对主名：先剥真实扩展名再小写（先剥后小写才能把 DSC_1.NEF 与 dsc_1.jpg 归并同组）
pub fn pair_base(filename: &str) -> String {
    basename_no_ext(filename).to_lowercase()
}

/// 生成目标目录内不占用的文件名：原名可用即原名，否则派生 `主名_N 扩展名`（N 从 1 起）。
/// `taken` 为小写全路径合并集（盘∪库）；`disk_exists` 由宿主注入以保持内核纯函数可测。
pub fn generate_unique_filename(
    target_dir: &Path,
    original_name: &str,
    taken: &HashSet<String>,
    disk_exists: impl Fn(&Path) -> bool,
) -> String {
    let ext = extname(original_name);
    let base = basename_no_ext(original_name);
    let is_taken = |name: &str| -> bool {
        let full: PathBuf = target_dir.join(name);
        taken.contains(&full.to_string_lossy().to_lowercase()) || disk_exists(&full)
    };
    let mut candidate = original_name.to_string();
    let mut counter = 1;
    while is_taken(&candidate) {
        candidate = format!("{}_{}{}", base, counter, ext);
        counter += 1;
    }
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    fn taken_set(items: &[&str]) -> HashSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    // taken 键与实现同约定：join 后小写。测试不硬编码分隔符，保持平台中性
    fn key(dir: &Path, name: &str) -> String {
        dir.join(name).to_string_lossy().to_lowercase()
    }

    fn no_disk(_: &Path) -> bool {
        false
    }

    #[test]
    fn extname_镜像_node_path_extname() {
        assert_eq!(extname("a.jpg"), ".jpg");
        assert_eq!(extname("a.TAR.gz"), ".gz");
        assert_eq!(extname("a"), "");
        assert_eq!(extname(".hidden"), "");
        assert_eq!(extname("a."), ".");
    }

    #[test]
    fn pair_base_与_js_同语义() {
        assert_eq!(pair_base("DSC_1.NEF"), "dsc_1");
        assert_eq!(pair_base("photo.JPG"), "photo");
        assert_eq!(pair_base("noext"), "noext");
        assert_eq!(pair_base(".hidden"), ".hidden");
    }

    #[test]
    fn 无占用时返回原名() {
        let dir = Path::new(r"E:\pics\2026-09-20");
        assert_eq!(
            generate_unique_filename(dir, "a.jpg", &taken_set(&[]), no_disk),
            "a.jpg"
        );
    }

    #[test]
    fn 占用时派生_1_2_递增() {
        let dir = Path::new("E:\\pics");
        let taken = taken_set(&[&key(dir, "a.jpg"), &key(dir, "a_1.jpg")]);
        let disk = |p: &Path| p.to_string_lossy().ends_with("a_2.jpg");
        assert_eq!(
            generate_unique_filename(dir, "a.jpg", &taken, disk),
            "a_3.jpg"
        );
    }

    #[test]
    fn taken_查找前先小写完整路径() {
        let dir = Path::new("E:\\pics");
        let taken = taken_set(&[&key(dir, "dsc_1.jpg")]);
        assert_eq!(
            generate_unique_filename(dir, "dsc_1.jpg", &taken, no_disk),
            "dsc_1_1.jpg"
        );
    }

    #[test]
    fn 无扩展名文件同样派生_1() {
        let dir = Path::new("E:\\pics");
        let taken = taken_set(&[&key(dir, "a")]);
        assert_eq!(generate_unique_filename(dir, "a", &taken, no_disk), "a_1");
    }
}

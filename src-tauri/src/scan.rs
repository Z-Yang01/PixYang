// 目录扫描/导入收集内核：镜像 electron/database.js 的 scanImageFiles/annotateRawPairs/
// collectImportFiles。可见格式集合、递归深度与数量上限、扩展名大小写不敏感、
// 同目录同名 jpg+nef 配对归并（pair_base 先剥后小写）均与 JS 一致。

use crate::error::PixError;
use crate::naming;
use serde::Serialize;
use std::path::{Path, PathBuf};

pub const VISIBLE_FORMATS: [&str; 8] = [
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".tiff",
];

const SCAN_MAX_DEPTH: usize = 12;
const SCAN_MAX_FILES: usize = 20000;

#[derive(Debug, Clone, Serialize)]
pub struct CollectedFile {
    pub filename: String,
    pub filepath: String,
    pub size: u64,
    pub format: String,
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_filename: Option<String>,
}

fn collected(filename: String, filepath: String, size: u64, format: String) -> CollectedFile {
    CollectedFile {
        filename,
        filepath,
        size,
        format,
        width: 0,
        height: 0,
        raw_source: None,
        raw_filename: None,
    }
}

/// 镜像 fs:scan-directory（scanImageFiles(dir, false)）：递归扫描可见图片并为
/// jpg 检测同目录同名 NEF。路径无效/非目录/读失败均返回空集（与 JS 一致）。
pub fn scan_directory(dir: &Path) -> Result<Vec<CollectedFile>, PixError> {
    Ok(scan_directory_inner(dir, false))
}

/// include_raw = true 时 NEF 作为独立条目收集（相机同步口径）
fn scan_directory_inner(dir: &Path, include_raw: bool) -> Vec<CollectedFile> {
    if !dir.is_absolute() {
        eprintln!("[扫描] 目录路径无效: {}", dir.display());
        return vec![];
    }
    match std::fs::metadata(dir) {
        Ok(meta) if meta.is_dir() => {}
        _ => return vec![],
    }
    let mut files = Vec::new();
    scan_into(&mut files, dir, 0, include_raw);
    if !include_raw {
        annotate_raw_pairs(&mut files);
    }
    files
}

fn scan_into(files: &mut Vec<CollectedFile>, dir: &Path, depth: usize, include_raw: bool) {
    if depth > SCAN_MAX_DEPTH || files.len() >= SCAN_MAX_FILES {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            eprintln!("[扫描] 错误: {} {e}", dir.display());
            return;
        }
    };
    for entry in entries.flatten() {
        if files.len() >= SCAN_MAX_FILES {
            eprintln!("[扫描] 达到上限，截断: {SCAN_MAX_FILES}");
            break;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let full_path = entry.path();
        if file_type.is_dir() {
            scan_into(files, &full_path, depth + 1, include_raw);
        } else if file_type.is_file() {
            let name = entry.file_name().to_string_lossy().to_string();
            let ext = naming::extname(&name).to_lowercase();
            let supported =
                VISIBLE_FORMATS.contains(&ext.as_str()) || (include_raw && ext == ".nef");
            if supported {
                let size = std::fs::metadata(&full_path).map(|m| m.len()).unwrap_or(0);
                files.push(collected(
                    name,
                    full_path.to_string_lossy().to_string(),
                    size,
                    ext,
                ));
            }
        }
    }
}

/// 镜像 annotateRawPairs：为 jpg/jpeg 条目按 pair_base（大小写不敏感）在同目录
/// 查找 NEF，命中补 raw_source/raw_filename
fn annotate_raw_pairs(files: &mut [CollectedFile]) {
    for f in files.iter_mut() {
        if f.format != ".jpg" && f.format != ".jpeg" {
            continue;
        }
        let dir = crate::image_group::dirname(&f.filepath);
        let names = match std::fs::read_dir(Path::new(&dir)) {
            Ok(entries) => entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect::<Vec<String>>(),
            Err(e) => {
                eprintln!("[扫描] 检测 NEF 失败: {dir} {e}");
                continue;
            }
        };
        let base = naming::pair_base(&f.filename);
        let matched = names
            .iter()
            .find(|n| naming::extname(n).to_lowercase() == ".nef" && naming::pair_base(n) == base);
        if let Some(nef_name) = matched {
            f.raw_source = Some(Path::new(&dir).join(nef_name).to_string_lossy().to_string());
            f.raw_filename = Some(nef_name.clone());
        }
    }
}

/// 镜像 collectImportFiles：支持文件或目录混合，目录递归扫描，文件按扩展名
/// 过滤，最后统一做同目录 NEF 配对检测
pub fn collect_import_files(paths: &[PathBuf]) -> Result<Vec<CollectedFile>, PixError> {
    let mut files: Vec<CollectedFile> = Vec::new();
    let mut dirs: Vec<PathBuf> = Vec::new();
    for p in paths {
        let meta = match std::fs::metadata(p) {
            Ok(meta) => meta,
            Err(e) => {
                eprintln!("[拖拽导入] 路径无效: {} {e}", p.display());
                continue;
            }
        };
        if meta.is_dir() {
            dirs.push(p.clone());
        } else {
            let pstr = p.to_string_lossy().to_string();
            let ext = naming::extname(&pstr).to_lowercase();
            if VISIBLE_FORMATS.contains(&ext.as_str()) {
                files.push(collected(
                    crate::image_group::basename(&pstr),
                    pstr,
                    meta.len(),
                    ext,
                ));
            }
        }
    }
    for d in dirs {
        files.extend(scan_directory_inner(&d, false));
    }
    annotate_raw_pairs(&mut files);
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pixyang_scan_{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn put(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, bytes).unwrap();
        p
    }

    fn filenames(files: &[CollectedFile]) -> Vec<String> {
        files.iter().map(|f| f.filename.clone()).collect()
    }

    #[test]
    fn 扩展名过滤与大小写归一() {
        let dir = temp_dir("ext");
        put(&dir, "a.JPG", b"jpg");
        put(&dir, "b.png", b"png");
        put(&dir, "c.txt", b"text");
        put(&dir, "d.webp", b"webp");
        put(&dir, "noext", b"bin");
        put(&dir, "e.Tiff", b"tiff");
        let files = scan_directory(&dir).unwrap();
        let mut names = filenames(&files);
        names.sort();
        assert_eq!(names, vec!["a.JPG", "b.png", "d.webp", "e.Tiff"]);
        let jpg = files.iter().find(|f| f.filename == "a.JPG").unwrap();
        assert_eq!(jpg.format, ".jpg");
        assert_eq!(jpg.width, 0);
        assert_eq!(jpg.height, 0);
        assert_eq!(jpg.size, 3);
        assert_eq!(
            jpg.filepath,
            dir.join("a.JPG").to_string_lossy().into_owned()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn nef条目被排除且jpg补配对() {
        let dir = temp_dir("nef");
        put(&dir, "x.jpg", b"jpg");
        put(&dir, "x.NEF", b"nef");
        put(&dir, "lone.nef", b"nef");
        let files = scan_directory(&dir).unwrap();
        assert_eq!(filenames(&files), vec!["x.jpg"]);
        assert_eq!(
            files[0].raw_source.as_deref(),
            Some(dir.join("x.NEF").to_string_lossy().as_ref())
        );
        assert_eq!(files[0].raw_filename.as_deref(), Some("x.NEF"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 配对按主名小写归并_不配对的nef不挂载() {
        let dir = temp_dir("pair");
        put(&dir, "DSC_1.jpg", b"a");
        put(&dir, "dsc_1.NEF", b"a-nef");
        put(&dir, "p.jpg", b"b");
        put(&dir, "q.NEF", b"q-nef");
        let files = scan_directory(&dir).unwrap();
        assert_eq!(files.len(), 2);
        let dsc = files.iter().find(|f| f.filename == "DSC_1.jpg").unwrap();
        assert_eq!(dsc.raw_filename.as_deref(), Some("dsc_1.NEF"));
        let p = files.iter().find(|f| f.filename == "p.jpg").unwrap();
        assert!(p.raw_source.is_none());
        assert!(p.raw_filename.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn jpeg扩展名同样配对() {
        let dir = temp_dir("jpegpair");
        put(&dir, "i.jpeg", b"j");
        put(&dir, "i.nef", b"n");
        let files = scan_directory(&dir).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].format, ".jpeg");
        assert_eq!(files[0].raw_filename.as_deref(), Some("i.nef"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 递归子目录且深度超限截断() {
        let dir = temp_dir("depth");
        let mut chain = dir.clone();
        for i in 1..=13 {
            chain = chain.join(format!("d{i}"));
        }
        std::fs::create_dir_all(&chain).unwrap();
        let mut level = dir.clone();
        for i in 1..=12 {
            level = level.join(format!("d{i}"));
        }
        put(&level, "deep_ok.jpg", b"a");
        put(&chain, "deep_over.jpg", b"b");
        put(&dir, "top.jpg", b"c");
        let files = scan_directory(&dir).unwrap();
        let names = filenames(&files);
        assert!(names.contains(&"top.jpg".to_string()));
        assert!(names.contains(&"deep_ok.jpg".to_string()));
        assert!(!names.contains(&"deep_over.jpg".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 空目录与无效目录返回空集() {
        let dir = temp_dir("empty");
        assert!(scan_directory(&dir).unwrap().is_empty());
        let nested = dir.join("missing_sub");
        assert!(scan_directory(&nested).unwrap().is_empty());
        assert!(scan_directory(Path::new("relative/dir"))
            .unwrap()
            .is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn collect_文件与目录混合_过滤与配对() {
        let dir = temp_dir("collect");
        put(&dir, "keep.jpg", b"a");
        put(&dir, "skip.txt", b"b");
        put(&dir, "drop.nef", b"c");
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        put(&sub, "y.jpg", b"d");
        put(&sub, "y.NEF", b"e");
        put(&sub, "z.png", b"f");
        put(&sub, "z.NEF", b"g");
        let files = collect_import_files(&[
            dir.join("keep.jpg"),
            dir.join("skip.txt"),
            dir.join("drop.nef"),
            dir.join("missing.jpg"),
            sub.clone(),
        ])
        .unwrap();
        let mut names = filenames(&files);
        names.sort();
        assert_eq!(names, vec!["keep.jpg", "y.jpg", "z.png"]);
        let jpg = files.iter().find(|f| f.filename == "y.jpg").unwrap();
        assert_eq!(
            jpg.raw_source.as_deref(),
            Some(sub.join("y.NEF").to_string_lossy().as_ref())
        );
        let png = files.iter().find(|f| f.filename == "z.png").unwrap();
        assert!(png.raw_source.is_none());
        assert!(png.raw_filename.is_none());
        let keep = files.iter().find(|f| f.filename == "keep.jpg").unwrap();
        assert!(keep.raw_source.is_none());
        assert_eq!(keep.size, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn collect_单拖jpg补同目录nef配对() {
        let dir = temp_dir("collectpair");
        let jpg = put(&dir, "cam.jpg", b"a");
        put(&dir, "cam.NEF", b"n");
        let files = collect_import_files(&[jpg]).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].raw_filename.as_deref(), Some("cam.NEF"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn collect_大写扩展名文件照常收集() {
        let dir = temp_dir("collectcase");
        let gif = put(&dir, "pic.GIF", b"g");
        let files = collect_import_files(&[gif]).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].format, ".gif");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

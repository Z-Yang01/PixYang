// Tauri 命令壳：薄封装内核模块（naming/image_group），编排宿主关注点（磁盘 I/O、DTO）。
// 命令不内嵌业务逻辑；错误统一 String（跨 IPC 序列化最简形态）。

use crate::image_group::{self, ImportFile, PairGroup};
use crate::naming;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct UniqueFilenameArgs {
    pub dir: String,
    pub name: String,
    #[serde(default)]
    pub taken: Vec<String>,
}

#[tauri::command]
pub fn unique_filename(args: UniqueFilenameArgs) -> Result<String, String> {
    let taken: HashSet<String> = args.taken.into_iter().collect();
    Ok(naming::generate_unique_filename(
        Path::new(&args.dir),
        &args.name,
        &taken,
        |p| p.exists(),
    ))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportFileDto {
    pub filename: String,
    pub filepath: String,
    #[serde(default)]
    pub raw_source: Option<String>,
    #[serde(default)]
    pub raw_filename: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GroupDto {
    pub key: String,
    pub jpg: Option<ImportFileDto>,
    pub nef: Option<ImportFileDto>,
}

impl From<&ImportFile> for ImportFileDto {
    fn from(f: &ImportFile) -> Self {
        Self {
            filename: f.filename.clone(),
            filepath: f.filepath.clone(),
            raw_source: f.raw_source.clone(),
            raw_filename: f.raw_filename.clone(),
        }
    }
}

#[tauri::command]
pub fn group_import_files(files: Vec<ImportFileDto>) -> Result<Vec<GroupDto>, String> {
    let owned: Vec<ImportFile> = files
        .into_iter()
        .map(|f| ImportFile {
            filename: f.filename,
            filepath: f.filepath,
            raw_source: f.raw_source,
            raw_filename: f.raw_filename,
        })
        .collect();
    let groups: Vec<(String, PairGroup)> = image_group::group_import_files(&owned);
    Ok(groups
        .into_iter()
        .map(|(key, g)| GroupDto {
            key,
            jpg: g.jpg.as_ref().map(Into::into),
            nef: g.nef.as_ref().map(Into::into),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 唯一命名命令_磁盘占用派生避让() {
        let dir = std::env::temp_dir().join("pixyang_cmd_test_r3");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), b"x").unwrap();
        let out = unique_filename(UniqueFilenameArgs {
            dir: dir.to_string_lossy().into_owned(),
            name: "a.txt".into(),
            taken: vec![],
        })
        .unwrap();
        assert_eq!(out, "a_1.txt");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 分组命令_nef小写归并到组() {
        let out = group_import_files(vec![
            ImportFileDto {
                filename: "dsc_1.jpg".into(),
                filepath: r"E:\c\dsc_1.jpg".into(),
                raw_source: None,
                raw_filename: None,
            },
            ImportFileDto {
                filename: "DSC_1.NEF".into(),
                filepath: r"E:\c\DSC_1.NEF".into(),
                raw_source: None,
                raw_filename: None,
            },
        ])
        .unwrap();
        assert_eq!(out.len(), 1);
        assert!(out[0].jpg.is_some() && out[0].nef.is_some());
    }
}

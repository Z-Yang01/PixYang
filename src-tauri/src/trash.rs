// 删除暂存区（round 73 用户拍板「轻量替代先行」）：用户手动删除的延迟物理化。
// 删除确认后只删库记录，磁盘文件（原图 + 配对 NEF + 双档缩略图/编辑派生）移入
// <数据目录>/trash/，manifest（{id}__record.json）保存全 28 列记录快照；撤销窗口内
// restore 整链还原（记录回库 + 文件回位），超期（24h）由启动/每日清扫物理删除。
// 「损坏记录清理」「重复删除」不走本模块，仍为直删（db::delete_image 系/派生清单镜像）。

use crate::error::PixError;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

pub const RETENTION_SECS: u64 = 24 * 60 * 60;

/// 暂存清单：images 全 28 列快照（get_image_by_id 投影 ImageRow 缺
/// thumbnail_edit_path/hash/flag，撤销不能依赖前端回传行，必须落盘 manifest）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TrashRecord {
    pub id: i64,
    pub filename: String,
    pub filepath: String,
    pub original_path: Option<String>,
    pub raw_path: Option<String>,
    pub original_raw_path: Option<String>,
    pub hidden: Option<i64>,
    pub orientation: Option<i64>,
    pub rotation: Option<i64>,
    pub flip_h: Option<i64>,
    pub flip_v: Option<i64>,
    pub import_date: String,
    pub taken_at: Option<String>,
    pub size: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub format: Option<String>,
    pub thumbnail: Option<String>,
    pub thumbnail_path: Option<String>,
    pub thumbnail_small_path: Option<String>,
    pub thumbnail_edit_path: Option<String>,
    pub rating: Option<i64>,
    pub favorite: Option<i64>,
    pub notes: Option<String>,
    pub hash: Option<String>,
    pub flag: Option<i64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct EditSnapshot {
    version: i64,
    params_json: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct HistorySnapshot {
    step: i64,
    command_json: String,
}

/// 完整撤销快照：主记录 + 标签/相册/编辑关联（delete_image_record 五表清理的逆）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TrashManifest {
    pub image: TrashRecord,
    pub tag_ids: Vec<i64>,
    pub album_ids: Vec<i64>,
    pub edit: Option<EditSnapshot>,
    pub edit_history: Vec<HistorySnapshot>,
    /// 移入暂存的文件清单（显式角色/回位路径/原始 mtime）：还原按此遍历，
    /// 不从 trash 文件名反推角色；mtime_ms 回写恢复真实修改时间。
    /// 旧 manifest（无 files）serde default 兜底继续按文件名解析
    #[serde(default)]
    pub files: Vec<TrashedFile>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TrashedFile {
    /// 原图 original / 配对 NEF raw / 派生缩略图 thumb
    pub role: String,
    pub trash_name: String,
    pub restore_to: String,
    #[serde(default)]
    pub mtime_ms: u64,
}

fn read_manifest_data(conn: &Connection, id: i64) -> Result<TrashManifest, PixError> {
    let image = read_full_record(conn, id)?.ok_or_else(|| PixError::Io("图片记录不存在".into()))?;
    let mut tag_ids = Vec::new();
    let mut stmt = conn
        .prepare("SELECT tag_id FROM image_tags WHERE image_id = ?1 ORDER BY tag_id")
        .map_err(PixError::from)?;
    let rows = stmt.query_map([id], |r| r.get(0)).map_err(PixError::from)?;
    for r in rows {
        tag_ids.push(r.map_err(PixError::from)?);
    }
    let mut album_ids = Vec::new();
    let mut stmt = conn
        .prepare("SELECT album_id FROM album_images WHERE image_id = ?1 ORDER BY album_id")
        .map_err(PixError::from)?;
    let rows = stmt.query_map([id], |r| r.get(0)).map_err(PixError::from)?;
    for r in rows {
        album_ids.push(r.map_err(PixError::from)?);
    }
    let edit = conn
        .query_row(
            "SELECT version, params_json FROM edits WHERE image_id = ?1",
            [id],
            |r| {
                Ok(EditSnapshot {
                    version: r.get(0)?,
                    params_json: r.get(1)?,
                })
            },
        )
        .optional()
        .map_err(PixError::from)?;
    let mut edit_history = Vec::new();
    let mut stmt = conn
        .prepare("SELECT step, command_json FROM edit_history WHERE image_id = ?1 ORDER BY step")
        .map_err(PixError::from)?;
    let rows = stmt
        .query_map([id], |r| {
            Ok(HistorySnapshot {
                step: r.get(0)?,
                command_json: r.get(1)?,
            })
        })
        .map_err(PixError::from)?;
    for r in rows {
        edit_history.push(r.map_err(PixError::from)?);
    }
    Ok(TrashManifest {
        image,
        tag_ids,
        album_ids,
        edit,
        edit_history,
        files: Vec::new(), // move_image_to_trash 移入时按实际存在的文件填充
    })
}

fn read_full_record(conn: &Connection, id: i64) -> Result<Option<TrashRecord>, PixError> {
    conn.query_row(
        "SELECT id, filename, filepath, original_path, raw_path, original_raw_path, hidden,
                orientation, rotation, flip_h, flip_v, import_date, taken_at, size, width,
                height, format, thumbnail, thumbnail_path, thumbnail_small_path,
                thumbnail_edit_path, rating, favorite, notes, hash, flag, created_at, updated_at
         FROM images WHERE id = ?1",
        [id],
        |r| {
            Ok(TrashRecord {
                id: r.get(0)?,
                filename: r.get(1)?,
                filepath: r.get(2)?,
                original_path: r.get(3)?,
                raw_path: r.get(4)?,
                original_raw_path: r.get(5)?,
                hidden: r.get(6)?,
                orientation: r.get(7)?,
                rotation: r.get(8)?,
                flip_h: r.get(9)?,
                flip_v: r.get(10)?,
                import_date: r.get(11)?,
                taken_at: r.get(12)?,
                size: r.get(13)?,
                width: r.get(14)?,
                height: r.get(15)?,
                format: r.get(16)?,
                thumbnail: r.get(17)?,
                thumbnail_path: r.get(18)?,
                thumbnail_small_path: r.get(19)?,
                thumbnail_edit_path: r.get(20)?,
                rating: r.get(21)?,
                favorite: r.get(22)?,
                notes: r.get(23)?,
                hash: r.get(24)?,
                flag: r.get(25)?,
                created_at: r.get(26)?,
                updated_at: r.get(27)?,
            })
        },
    )
    .optional()
    .map_err(PixError::from)
}

/// 编辑派生文件名清单（与 db::delete_image_files 的删除面保持一致）
fn derived_file_names(id: i64) -> [String; 6] {
    [
        format!("{id}.jpg"),
        format!("{id}_s.jpg"),
        format!("edit-{id}.jpg"),
        format!("edit-{id}.jpg.meta.json"),
        format!("edit-{id}-base.jpg"),
        format!("edit-{id}-base.png"),
    ]
}

fn file_name_of(p: &Path) -> String {
    p.file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "unnamed".into())
}

fn rollback_moves(moved: &[(PathBuf, PathBuf)]) {
    for (src, dst) in moved.iter().rev() {
        if let Err(e) = move_file(dst, src) {
            eprintln!("[trash] 回滚移动失败 {dst:?} -> {src:?}: {e}");
        }
    }
}

/// 跨卷安全移动：rename 优先（同卷），失败回退 copy+remove（images_root 与数据目录可不同盘）
fn move_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    if let Some(parent) = dst.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(_) => {
            std::fs::copy(src, dst)?;
            std::fs::remove_file(src)
        }
    }
}

fn mtime_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// Windows CopyFileEx/rename 会保留源 mtime（老照片可能是多年前），而清扫按 mtime 判期；
// 移入时刻必须把暂存文件 mtime 归一，否则刚移入的文件会被下一轮清扫立即误删。
fn normalize_mtime(path: &Path) {
    let Ok(f) = std::fs::OpenOptions::new().write(true).open(path) else {
        return;
    };
    let _ = f.set_times(std::fs::FileTimes::new().set_modified(SystemTime::now()));
}

fn move_file_into_trash(src: &Path, dest: &Path) -> Result<(), PixError> {
    // trash 内 {id}__ 前缀同名即同物（同 id 重复删除前的中断残留），先清再移
    let _ = std::fs::remove_file(dest);
    move_file(src, dest)
        .map_err(|e| PixError::Io(format!("无法移入暂存区（文件可能被占用）: {e}")))?;
    normalize_mtime(dest);
    Ok(())
}

/// 移入暂存区：原图/NEF/派生文件改名带 `{id}__` 前缀搬入 trash，最后写 manifest。
/// 任一步失败则回滚已移动文件并返回 Err（记录保持未删，删除中止）。
pub fn move_image_to_trash(
    manifest: &TrashManifest,
    thumbs_dir: &Path,
    trash: &Path,
) -> Result<Vec<(PathBuf, PathBuf)>, PixError> {
    let record = &manifest.image;
    std::fs::create_dir_all(trash).map_err(|e| PixError::Io(format!("暂存目录创建失败: {e}")))?;
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();

    let mut files: Vec<TrashedFile> = Vec::new();
    let orig = PathBuf::from(&record.filepath);
    if orig.exists() {
        let dest = trash.join(format!("{}__{}", record.id, file_name_of(&orig)));
        let src_mtime = mtime_ms(&orig);
        move_file_into_trash(&orig, &dest)?;
        files.push(TrashedFile {
            role: "original".into(),
            trash_name: file_name_of(&dest),
            restore_to: orig.to_string_lossy().into_owned(),
            mtime_ms: src_mtime,
        });
        moved.push((orig, dest));
    }
    if let Some(raw) = record.raw_path.as_deref().filter(|s| !s.is_empty()) {
        let raw = PathBuf::from(raw);
        if raw.exists() {
            let dest = trash.join(format!("{}__raw__{}", record.id, file_name_of(&raw)));
            let src_mtime = mtime_ms(&raw);
            move_file_into_trash(&raw, &dest)?;
            files.push(TrashedFile {
                role: "raw".into(),
                trash_name: file_name_of(&dest),
                restore_to: raw.to_string_lossy().into_owned(),
                mtime_ms: src_mtime,
            });
            moved.push((raw, dest));
        }
    }
    for name in derived_file_names(record.id) {
        let p = thumbs_dir.join(&name);
        if p.exists() {
            let dest = trash.join(format!("{}__thumb__{}", record.id, name));
            move_file_into_trash(&p, &dest)?;
            files.push(TrashedFile {
                role: "thumb".into(),
                trash_name: file_name_of(&dest),
                restore_to: p.to_string_lossy().into_owned(),
                mtime_ms: 0, // 派生缩略图可再生，mtime 无外部语义
            });
            moved.push((p, dest));
        }
    }

    let manifest_path = trash.join(format!("{}__record.json", record.id));
    let mut manifest_with_files = manifest.clone();
    manifest_with_files.files = files;
    let manifest_json = serde_json::to_string_pretty(&manifest_with_files)
        .map_err(|e| PixError::Io(format!("暂存记录序列化失败: {e}")))?;
    if let Err(e) = std::fs::write(&manifest_path, manifest_json) {
        rollback_moves(&moved);
        return Err(PixError::Io(format!("暂存记录写入失败: {e}")));
    }
    normalize_mtime(&manifest_path);
    Ok(moved)
}

/// 用户手动删除主链路：移入暂存区成功后才删库记录（五表）；
/// 记录删除失败则清 manifest + 文件回位，保持「要么全不动、要么已入暂存」。
pub fn delete_image_to_trash_core(
    conn: &Connection,
    id: i64,
    thumbs_dir: &Path,
    trash: &Path,
) -> Result<Option<crate::images_query::ImageRow>, PixError> {
    if read_full_record(conn, id)?.is_none() {
        return Ok(None);
    }
    let manifest = read_manifest_data(conn, id)?;
    let moved = move_image_to_trash(&manifest, thumbs_dir, trash)?;
    match crate::db::delete_image_record(conn, id) {
        Ok(row) => Ok(row),
        Err(e) => {
            let _ = std::fs::remove_file(trash.join(format!("{id}__record.json")));
            rollback_moves(&moved);
            Err(e)
        }
    }
}

/// 批量：逐 id 独立原子（单 id 失败跳过计为失败行，不整体中止），返回成功行
pub fn batch_delete_images_to_trash_core(
    conn: &Connection,
    ids: &[i64],
    thumbs_dir: &Path,
    trash: &Path,
) -> Result<Vec<crate::images_query::ImageRow>, PixError> {
    let mut rows = Vec::new();
    for id in ids {
        match delete_image_to_trash_core(conn, *id, thumbs_dir, trash) {
            Ok(Some(row)) => rows.push(row),
            Ok(None) => {}
            Err(e) => eprintln!("[批量删除] id {id} 移入暂存区失败，跳过: {e}"),
        }
    }
    Ok(rows)
}

fn read_manifest(trash: &Path, id: i64) -> Result<Option<TrashManifest>, PixError> {
    let p = trash.join(format!("{id}__record.json"));
    if !p.exists() {
        return Ok(None);
    }
    let raw =
        std::fs::read_to_string(&p).map_err(|e| PixError::Io(format!("暂存记录读取失败: {e}")))?;
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|e| PixError::Io(format!("暂存记录损坏: {e}")))
}

fn trash_entry_suffixes(trash: &Path, id: i64) -> Vec<String> {
    let prefix = format!("{id}__");
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(trash) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if let Some(suffix) = name.strip_prefix(&prefix) {
                out.push(suffix.to_string());
            }
        }
    }
    out.sort();
    out
}

/// 冲突命名：原名被占用时取第一个空闲的「stem (恢复N).ext」文件名，绝不覆盖既有文件
fn free_name_in_dir(dir: &Path, conflict: &Path) -> String {
    let stem = conflict
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let ext = conflict
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let mut n = 1;
    loop {
        let tag = if n == 1 {
            " (恢复)".to_string()
        } else {
            format!(" (恢复{n})")
        };
        let name = format!("{stem}{tag}{ext}");
        if !dir.join(&name).exists() {
            return name;
        }
        n += 1;
    }
}

/// 只换文件名、保留原字符串的目录前缀与分隔符风格（库内路径分隔符并非恒为 `/`）
fn splice_name(orig_filepath: &str, new_name: &str) -> String {
    match orig_filepath.rfind(|c| c == '/' || c == '\\') {
        Some(i) => format!("{}{}", &orig_filepath[..=i], new_name),
        None => new_name.to_string(),
    }
}

/// 撤销：manifest 全列记录回库（磁盘冲突走「(恢复N)」改名，库内路径被新导入占用则拒绝），
/// 原图/NEF/派生文件回位；NEF 跟随还原后主文件的同主名（相机配对约定）。
pub fn restore_image_from_trash_core(
    conn: &Connection,
    id: i64,
    thumbs_dir: &Path,
    trash: &Path,
) -> Result<(), PixError> {
    let Some(manifest) = read_manifest(trash, id)? else {
        return Err(PixError::Io("暂存记录不存在或已超期清理，无法撤销".into()));
    };
    let record = &manifest.image;
    let id_taken: i64 = conn
        .query_row("SELECT COUNT(*) FROM images WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .map_err(PixError::from)?;
    if id_taken > 0 {
        return Err(PixError::Io("该图片已存在于图库，无法重复撤销".into()));
    }
    let path_taken: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM images WHERE filepath = ?1",
            params![record.filepath],
            |r| r.get(0),
        )
        .map_err(PixError::from)?;
    if path_taken > 0 {
        return Err(PixError::Io(
            "原路径已被新导入的图片占用，无法撤销；暂存文件将保留到超期自动清理".into(),
        ));
    }

    let orig_path = PathBuf::from(&record.filepath);
    let parent = orig_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let _ = std::fs::create_dir_all(&parent);
    let mut final_filepath_str = record.filepath.clone();
    if orig_path.exists() {
        let new_name = free_name_in_dir(&parent, &orig_path);
        final_filepath_str = splice_name(&record.filepath, &new_name);
    }
    let final_filename = final_filepath_str
        .rsplit(|c| c == '/' || c == '\\')
        .next()
        .unwrap_or(&record.filename)
        .to_string();

    let mut final_raw_path = record.raw_path.clone();
    if let Some(raw) = record.raw_path.as_deref().filter(|s| !s.is_empty()) {
        let raw_path = PathBuf::from(raw);
        let raw_parent = raw_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        let _ = std::fs::create_dir_all(&raw_parent);
        // 配对约定：NEF 与 JPG 同主名 → 还原后的主文件若改名，NEF 跟随新主名
        let mut desired_name =
            if raw_path.file_stem().is_some() && raw_path.file_stem() == orig_path.file_stem() {
                let ext = raw_path
                    .extension()
                    .map(|e| format!(".{}", e.to_string_lossy()))
                    .unwrap_or_default();
                let final_stem = Path::new(&final_filename)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| final_filename.clone());
                format!("{final_stem}{ext}")
            } else {
                file_name_of(&raw_path)
            };
        let candidate = raw_parent.join(&desired_name);
        if candidate.exists() {
            desired_name = free_name_in_dir(&raw_parent, &candidate);
        }
        final_raw_path = Some(splice_name(raw, &desired_name));
    }

    let suffixes = trash_entry_suffixes(trash, id);
    let mut moved_back: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut failure = None;
    // manifest 原始文件名精确匹配优先于前缀判别（审查 M1）：原图名以 raw__/thumb__ 开头时
    // （如 raw__x.jpg），纯前缀解析会把原图条目误判为 NEF——无配对时被 continue 跳过留在
    // 暂存（下一轮 sweep 物理删除，撤销「成功」但文件永久丢失）；有配对时双条目映射到同
    // 一 raw 目标互相覆盖。暂存入位名 = file_name_of(manifest.filepath)，可精确重建，故
    // 全等匹配命中必为原图；NEF 与原图同名同主名不同扩展，全等不会互相劫持。
    let orig_suffix = file_name_of(&orig_path);
    for suffix in &suffixes {
        let src = trash.join(format!("{id}__{suffix}"));
        // is_thumb = 派生文件条目（可再生，同名残留直接丢弃）；原图条目即使文件名
        // 恰以 thumb__ 开头也不是派生文件，不可进丢弃分支
        let dest = if suffix == "record.json" {
            continue;
        } else if *suffix == orig_suffix {
            Some((PathBuf::from(&final_filepath_str), false))
        } else if let Some(raw_name) = suffix.strip_prefix("raw__") {
            match &final_raw_path {
                Some(p) if !raw_name.is_empty() => Some((PathBuf::from(p), false)),
                _ => continue,
            }
        } else if let Some(name) = suffix.strip_prefix("thumb__") {
            Some((thumbs_dir.join(name), true))
        } else {
            Some((PathBuf::from(&final_filepath_str), false))
        };
        let Some((dest, is_thumb)) = dest else {
            continue;
        };
        if !src.exists() {
            continue;
        }
        if is_thumb && dest.exists() {
            // 派生文件按 id 命名且可再生：同名视为残留副本，直接丢弃暂存份
            let _ = std::fs::remove_file(&src);
            continue;
        }
        if let Err(e) = move_file(&src, &dest) {
            failure = Some(PixError::Io(format!("无法从暂存区还原: {e}")));
            break;
        }
        moved_back.push((src, dest));
    }
    if let Some(e) = failure {
        rollback_moves(&moved_back);
        return Err(e);
    }

    // 原始 mtime 回写（L1）：入暂存时 mtime 归一为移入时刻（清扫按 mtime 判期，
    // 老照片会被立即误删），撤销回位后经 manifest.files 恢复真实修改时间。
    // 旧 manifest（无 files 或 mtime_ms=0）跳过——保持旧路径行为
    for f in &manifest.files {
        if f.mtime_ms == 0 {
            continue;
        }
        let target = match f.role.as_str() {
            "original" => Some(PathBuf::from(&final_filepath_str)),
            "raw" => final_raw_path.as_ref().map(PathBuf::from),
            _ => None,
        };
        if let Some(p) = target.filter(|p| p.exists()) {
            if let Ok(fh) = std::fs::OpenOptions::new().write(true).open(&p) {
                let _ = fh.set_times(std::fs::FileTimes::new().set_modified(
                    std::time::UNIX_EPOCH + std::time::Duration::from_millis(f.mtime_ms),
                ));
            }
        }
    }

    let filepath_out = final_filepath_str;
    let insert = conn.execute(
        "INSERT INTO images (id, filename, filepath, original_path, raw_path, original_raw_path,
            hidden, orientation, rotation, flip_h, flip_v, import_date, taken_at, size, width,
            height, format, thumbnail, thumbnail_path, thumbnail_small_path, thumbnail_edit_path,
            rating, favorite, notes, hash, flag, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                 ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28)",
        params![
            record.id,
            final_filename,
            filepath_out,
            record.original_path,
            final_raw_path,
            record.original_raw_path,
            record.hidden,
            record.orientation,
            record.rotation,
            record.flip_h,
            record.flip_v,
            record.import_date,
            record.taken_at,
            record.size,
            record.width,
            record.height,
            record.format,
            record.thumbnail,
            record.thumbnail_path,
            record.thumbnail_small_path,
            record.thumbnail_edit_path,
            record.rating,
            record.favorite,
            record.notes,
            record.hash,
            record.flag,
            record.created_at,
            record.updated_at,
        ],
    );
    if let Err(e) = insert {
        rollback_moves(&moved_back);
        return Err(PixError::from(e));
    }
    // 关联表还原：标签/相册/编辑快照逐条回插（OR IGNORE：期间标签/相册可能已被单独删除）
    for tag_id in &manifest.tag_ids {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?1, ?2)",
            params![id, tag_id],
        );
    }
    for album_id in &manifest.album_ids {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO album_images (album_id, image_id, sort_order) VALUES (?1, ?2, 0)",
            params![album_id, id],
        );
    }
    if let Some(edit) = &manifest.edit {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO edits (image_id, version, params_json) VALUES (?1, ?2, ?3)",
            params![id, edit.version, edit.params_json],
        );
    }
    for h in &manifest.edit_history {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO edit_history (image_id, step, command_json) VALUES (?1, ?2, ?3)",
            params![id, h.step, h.command_json],
        );
    }
    let _ = std::fs::remove_file(trash.join(format!("{id}__record.json")));
    Ok(())
}

/// 清扫：物理删除 mtime 早于 retention 的暂存文件（启动 + 每 24h 各一轮）。
/// metadata 不可读/未来时间一律视为未过期（宁留勿删）。
pub fn sweep_trash(trash: &Path, now: SystemTime, retention: Duration) -> usize {
    let mut removed = 0;
    let Ok(entries) = std::fs::read_dir(trash) else {
        return 0;
    };
    for e in entries.flatten() {
        let p = e.path();
        if !p.is_file() {
            continue;
        }
        let expired = std::fs::metadata(&p)
            .and_then(|m| m.modified())
            .map(|m| now.duration_since(m).unwrap_or(Duration::ZERO) > retention)
            .unwrap_or(false);
        if expired && std::fs::remove_file(&p).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .unwrap();
        crate::db::ensure_business_schema(&conn).unwrap();
        conn
    }

    fn setup(tag: &str) -> (Connection, PathBuf, PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("pixyang_trash_{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("thumbs")).unwrap();
        std::fs::create_dir_all(dir.join("pics")).unwrap();
        let conn = mem_db();
        (
            conn,
            dir.join("pics"),
            dir.join("thumbs"),
            dir.join("trash"),
        )
    }

    fn insert_image(conn: &Connection, pics: &Path, raw: bool) {
        let raw_col = if raw {
            format!("{}/a.nef", pics.to_string_lossy().replace('\\', "/"))
        } else {
            String::new()
        };
        conn.execute_batch(&format!(
            "INSERT INTO images (id, filename, filepath, import_date, raw_path, hash, flag, thumbnail_edit_path, notes)
             VALUES (1, 'a.jpg', '{}/a.jpg', '2026-01-01', '{}', 'h1', 1, 'C:/edit/x.png', 'n1');
             INSERT INTO tags (id, name) VALUES (1, 't'); INSERT INTO image_tags VALUES (1, 1);
             INSERT INTO albums (id, name) VALUES (1, 'al'); INSERT INTO album_images VALUES (1, 1, 0);
             INSERT INTO edits (image_id, params_json) VALUES (1, '{{}}');",
            pics.to_string_lossy().replace('\\', "/"),
            raw_col
        ))
        .unwrap();
        std::fs::write(pics.join("a.jpg"), b"old").unwrap();
        if raw {
            std::fs::write(pics.join("a.nef"), b"raw").unwrap();
        }
    }

    fn write_thumbs(thumbs: &Path) {
        for name in ["1.jpg", "1_s.jpg", "edit-1.jpg"] {
            std::fs::write(thumbs.join(name), b"t").unwrap();
        }
    }

    fn trash_exists(trash: &Path, name: &str) -> bool {
        trash.join(name).exists()
    }

    #[test]
    fn 单图删除_移入暂存区_记录删除_文件离开原位_manifest保全列() {
        let (conn, pics, thumbs, trash) = setup("del");
        insert_image(&conn, &pics, true);
        write_thumbs(&thumbs);

        let row = delete_image_to_trash_core(&conn, 1, &thumbs, &trash)
            .unwrap()
            .unwrap();
        assert_eq!(row.id, 1);
        assert!(crate::images_query::get_image_by_id(&conn, 1)
            .unwrap()
            .is_none());
        assert!(!pics.join("a.jpg").exists());
        assert!(!pics.join("a.nef").exists());
        assert!(!thumbs.join("1.jpg").exists());
        assert!(!thumbs.join("1_s.jpg").exists());
        assert!(trash_exists(&trash, "1__a.jpg"));
        assert!(trash_exists(&trash, "1__raw__a.nef"));
        assert!(trash_exists(&trash, "1__thumb__1.jpg"));
        assert!(trash_exists(&trash, "1__thumb__1_s.jpg"));
        assert!(trash_exists(&trash, "1__thumb__edit-1.jpg"));
        assert!(trash_exists(&trash, "1__record.json"));

        // manifest 快照含 ImageRow 投影丢失的列（thumbnail_edit_path/hash/flag/notes）
        let rec: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(trash.join("1__record.json")).unwrap())
                .unwrap();
        assert_eq!(rec["image"]["hash"], "h1");
        assert_eq!(rec["image"]["flag"], 1);
        assert_eq!(rec["image"]["thumbnail_edit_path"], "C:/edit/x.png");
        assert_eq!(rec["image"]["notes"], "n1");
        assert_eq!(rec["tag_ids"], serde_json::json!([1]));
        assert_eq!(rec["album_ids"], serde_json::json!([1]));

        // 再删不存在的 id：None
        assert!(delete_image_to_trash_core(&conn, 1, &thumbs, &trash)
            .unwrap()
            .is_none());
        let _ = std::fs::remove_dir_all(pics.parent().unwrap());
    }

    #[test]
    fn 撤销还原_记录回库_文件回位_含NEF与派生_暂存清空() {
        let (conn, pics, thumbs, trash) = setup("restore");
        insert_image(&conn, &pics, true);
        write_thumbs(&thumbs);
        conn.execute_batch(
            "INSERT INTO edit_history (image_id, step, command_json) VALUES (1, 1, '{\"op\":1}');",
        )
        .unwrap();
        delete_image_to_trash_core(&conn, 1, &thumbs, &trash).unwrap();

        restore_image_from_trash_core(&conn, 1, &thumbs, &trash).unwrap();

        let img = crate::images_query::get_image_by_id(&conn, 1)
            .unwrap()
            .unwrap();
        assert_eq!(
            img.filepath,
            format!("{}/a.jpg", pics.to_string_lossy().replace('\\', "/"))
        );
        assert!(pics.join("a.jpg").exists());
        assert_eq!(std::fs::read(pics.join("a.jpg")).unwrap(), b"old");
        assert!(pics.join("a.nef").exists());
        assert_eq!(std::fs::read(pics.join("a.nef")).unwrap(), b"raw");
        assert!(thumbs.join("1.jpg").exists());
        assert!(thumbs.join("1_s.jpg").exists());
        assert!(thumbs.join("edit-1.jpg").exists());
        assert!(!trash_exists(&trash, "1__record.json"));
        assert!(trash_entry_suffixes(&trash, 1).is_empty());

        // 关联表（标签/相册/编辑/历史）与全列快照一并还原
        let tags: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM image_tags WHERE image_id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tags, 1);
        let albums: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM album_images WHERE image_id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(albums, 1);
        let edit_params: String = conn
            .query_row(
                "SELECT params_json FROM edits WHERE image_id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(edit_params, "{}");
        let history: String = conn
            .query_row(
                "SELECT command_json FROM edit_history WHERE image_id = 1 AND step = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(history, "{\"op\":1}");
        let full: (String, String, i64, i64) = conn
            .query_row(
                "SELECT hash, thumbnail_edit_path, flag, rating FROM images WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(full.0, "h1");
        assert_eq!(full.1, "C:/edit/x.png");
        assert_eq!(full.2, 1);
        let _ = std::fs::remove_dir_all(pics.parent().unwrap());
    }

    #[test]
    fn 撤销_新manifest回位后原始mtime恢复_审查L1() {
        let (conn, pics, thumbs, trash) = setup("restore_mtime");
        let orig = pics.join("a.jpg");
        std::fs::write(&orig, b"old").unwrap();
        let stamp = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_592_222_400);
        {
            let f = std::fs::OpenOptions::new().write(true).open(&orig).unwrap();
            f.set_times(std::fs::FileTimes::new().set_modified(stamp))
                .unwrap();
        }
        conn.execute_batch(&format!(
            "INSERT INTO images (id, filename, filepath, import_date, hash) VALUES
             (1, 'a.jpg', '{}', '2026-01-01', 'h1');",
            orig.to_string_lossy().replace("\\", "/")
        ))
        .unwrap();
        delete_image_to_trash_core(&conn, 1, &thumbs, &trash).unwrap();

        // 入暂存后 trash 文件 mtime 已被归一（≠ 原始值）
        let trashed = trash.join("1__a.jpg");
        let trashed_mtime = std::fs::metadata(&trashed).unwrap().modified().unwrap();
        assert_ne!(trashed_mtime, stamp, "入暂存应归一 mtime（清扫判期需要）");

        restore_image_from_trash_core(&conn, 1, &thumbs, &trash).unwrap();

        // 回位后原始 mtime 经 manifest.files 回写恢复
        let after = std::fs::metadata(&orig).unwrap().modified().unwrap();
        assert_eq!(after, stamp, "撤销回位应恢复原始 mtime");
        let _ = std::fs::remove_dir_all(pics.parent().unwrap());
    }

    #[test]
    fn 撤销_原路径被新文件占用_改名还原_不覆盖新文件() {
        let (conn, pics, thumbs, trash) = setup("conflict_disk");
        insert_image(&conn, &pics, true);
        write_thumbs(&thumbs);
        delete_image_to_trash_core(&conn, 1, &thumbs, &trash).unwrap();

        // 撤销前同路径出现了新文件（内容不同），NEF 路径仍空闲
        std::fs::write(pics.join("a.jpg"), b"new-import").unwrap();

        restore_image_from_trash_core(&conn, 1, &thumbs, &trash).unwrap();

        // 新文件原样保留；旧文件以 (恢复) 名回位，记录同步改名
        assert_eq!(std::fs::read(pics.join("a.jpg")).unwrap(), b"new-import");
        assert!(pics.join("a (恢复).jpg").exists());
        assert_eq!(std::fs::read(pics.join("a (恢复).jpg")).unwrap(), b"old");
        let img = crate::images_query::get_image_by_id(&conn, 1)
            .unwrap()
            .unwrap();
        assert_eq!(
            img.filepath,
            format!("{}/a (恢复).jpg", pics.to_string_lossy().replace('\\', "/"))
        );
        assert_eq!(img.filename, "a (恢复).jpg");
        // NEF 跟随还原后主文件主名（相机配对约定）
        assert!(pics.join("a (恢复).nef").exists());
        let _ = std::fs::remove_dir_all(pics.parent().unwrap());
    }

    #[test]
    fn 撤销_原路径已被库内新记录占用_拒绝且暂存保留() {
        let (conn, pics, thumbs, trash) = setup("conflict_db");
        insert_image(&conn, &pics, false);
        delete_image_to_trash_core(&conn, 1, &thumbs, &trash).unwrap();
        conn.execute_batch(&format!(
            "INSERT INTO images (id, filename, filepath, import_date) VALUES (2, 'a.jpg', '{}', '2026-01-02')",
            pics.join("a.jpg").to_string_lossy().replace('\\', "/")
        ))
        .unwrap();

        let err = restore_image_from_trash_core(&conn, 1, &thumbs, &trash).unwrap_err();
        assert!(err.to_string().contains("原路径已被新导入"), "{err}");
        // 拒绝后：暂存文件与 manifest 保留（超期清扫兜底），id=1 不在库
        assert!(trash_exists(&trash, "1__a.jpg"));
        assert!(trash_exists(&trash, "1__record.json"));
        assert!(crate::images_query::get_image_by_id(&conn, 1)
            .unwrap()
            .is_none());
        let _ = std::fs::remove_dir_all(pics.parent().unwrap());
    }

    #[test]
    fn 清扫_未超期保留_超期物理删_含manifest() {
        let (conn, pics, thumbs, trash) = setup("sweep");
        insert_image(&conn, &pics, false);
        delete_image_to_trash_core(&conn, 1, &thumbs, &trash).unwrap();

        let now = SystemTime::now();
        assert_eq!(
            sweep_trash(&trash, now, Duration::from_secs(RETENTION_SECS)),
            0
        );
        assert!(trash_exists(&trash, "1__a.jpg"));
        assert!(trash_exists(&trash, "1__record.json"));

        let later = now + Duration::from_secs(RETENTION_SECS + 3600);
        let removed = sweep_trash(&trash, later, Duration::from_secs(RETENTION_SECS));
        assert!(removed >= 2, "原图+manifest 应一起清除: {removed}");
        assert!(!trash_exists(&trash, "1__a.jpg"));
        assert!(!trash_exists(&trash, "1__record.json"));
        let _ = std::fs::remove_dir_all(pics.parent().unwrap());
    }

    #[test]
    fn 批量删除_移入暂存区_ghost跳过_直删通道不受影响() {
        let (conn, pics, thumbs, trash) = setup("batch");
        insert_image(&conn, &pics, false);
        conn.execute_batch(&format!(
            "INSERT INTO images (id, filename, filepath, import_date) VALUES (2, 'b.jpg', '{}', '2026-01-01')",
            pics.join("b.jpg").to_string_lossy().replace('\\', "/")
        ))
        .unwrap();
        std::fs::write(pics.join("b.jpg"), b"b").unwrap();

        let rows = batch_delete_images_to_trash_core(&conn, &[1, 999, 2], &thumbs, &trash).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(trash_exists(&trash, "1__a.jpg"));
        assert!(trash_exists(&trash, "2__b.jpg"));
        assert!(crate::images_query::get_image_by_id(&conn, 1)
            .unwrap()
            .is_none());
        assert!(crate::images_query::get_image_by_id(&conn, 2)
            .unwrap()
            .is_none());

        // 直删通道（损坏记录清理/重复删除仍走）行为不变：物理删除不留暂存
        conn.execute_batch(&format!(
            "INSERT INTO images (id, filename, filepath, import_date) VALUES (3, 'c.jpg', '{}', '2026-01-01')",
            pics.join("c.jpg").to_string_lossy().replace('\\', "/")
        ))
        .unwrap();
        std::fs::write(pics.join("c.jpg"), b"c").unwrap();
        crate::db::delete_image(&conn, 3, &thumbs).unwrap();
        assert!(!pics.join("c.jpg").exists());
        assert!(!trash_exists(&trash, "3__c.jpg"));
        let _ = std::fs::remove_dir_all(pics.parent().unwrap());
    }

    #[cfg(windows)]
    #[test]
    fn 删除_文件被占用时中止_记录保留_无残留() {
        use std::os::windows::fs::OpenOptionsExt;
        let (conn, pics, thumbs, trash) = setup("locked");
        insert_image(&conn, &pics, false);
        let _guard = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(pics.join("a.jpg"))
            .unwrap();

        let err = delete_image_to_trash_core(&conn, 1, &thumbs, &trash).unwrap_err();
        assert!(err.to_string().contains("无法移入暂存区"), "{err}");
        assert!(pics.join("a.jpg").exists());
        assert!(crate::images_query::get_image_by_id(&conn, 1)
            .unwrap()
            .is_some());
        assert!(!trash_exists(&trash, "1__record.json"));
        let _ = std::fs::remove_dir_all(pics.parent().unwrap());
    }

    // ── 审查 M1 回归锁：原图名以 raw__/thumb__ 开头的歧义名，撤销回位不丢 ──
    // 角色解析必须 manifest 原始文件名精确匹配优先于前缀判别：纯前缀解析把原图条目
    // 误判为 NEF——无配对时留在暂存（下轮 sweep 物理删除＝撤销成功但文件永久丢失），
    // 有配对时与真实 NEF 条目映射到同一目标互相覆盖。

    #[test]
    fn 撤销_原图名以raw__开头_无配对_回位不丢暂存() {
        let (conn, pics, thumbs, trash) = setup("amb_raw_solo");
        let name = "raw__solo.jpg";
        conn.execute_batch(&format!(
            "INSERT INTO images (id, filename, filepath, import_date, raw_path, hash, flag)
             VALUES (1, '{name}', '{}/{name}', '2026-01-01', '', 'h1', 1);",
            pics.to_string_lossy().replace('\\', "/"),
        ))
        .unwrap();
        std::fs::write(pics.join(name), b"orig").unwrap();

        delete_image_to_trash_core(&conn, 1, &thumbs, &trash).unwrap();
        assert!(trash_exists(&trash, "1__raw__solo.jpg"));

        restore_image_from_trash_core(&conn, 1, &thumbs, &trash).unwrap();

        // 原图回原位且内容原样；暂存不留残条（残条 = 下一轮 sweep 物理删除）
        assert_eq!(std::fs::read(pics.join(name)).unwrap(), b"orig");
        assert!(trash_entry_suffixes(&trash, 1).is_empty());
        let _ = std::fs::remove_dir_all(pics.parent().unwrap());
    }

    #[test]
    fn 撤销_原图名raw__开头_配对NEF_回位各归其位不互相覆盖() {
        let (conn, pics, thumbs, trash) = setup("amb_raw_pair");
        let jpg = "raw__p.jpg";
        let nef = "raw__p.nef";
        let base = pics.to_string_lossy().replace('\\', "/");
        conn.execute_batch(&format!(
            "INSERT INTO images (id, filename, filepath, import_date, raw_path, hash, flag)
             VALUES (1, '{jpg}', '{base}/{jpg}', '2026-01-01', '{base}/{nef}', 'h1', 1);"
        ))
        .unwrap();
        std::fs::write(pics.join(jpg), b"orig").unwrap();
        std::fs::write(pics.join(nef), b"raw").unwrap();

        delete_image_to_trash_core(&conn, 1, &thumbs, &trash).unwrap();
        assert!(trash_exists(&trash, "1__raw__p.jpg"));
        assert!(trash_exists(&trash, "1__raw__raw__p.nef"));

        restore_image_from_trash_core(&conn, 1, &thumbs, &trash).unwrap();

        // 原图与 NEF 各自回位且内容不互换（前缀误判会把两条都映射到 NEF 目标互相覆盖）
        assert_eq!(std::fs::read(pics.join(jpg)).unwrap(), b"orig");
        assert_eq!(std::fs::read(pics.join(nef)).unwrap(), b"raw");
        assert!(trash_entry_suffixes(&trash, 1).is_empty());
        let _ = std::fs::remove_dir_all(pics.parent().unwrap());
    }

    #[test]
    fn 撤销_原图名以thumb__开头_回位原图_不落缩略图目录() {
        let (conn, pics, thumbs, trash) = setup("amb_thumb_orig");
        let name = "thumb__v.jpg";
        conn.execute_batch(&format!(
            "INSERT INTO images (id, filename, filepath, import_date, raw_path, hash, flag)
             VALUES (1, '{name}', '{}/{name}', '2026-01-01', '', 'h1', 1);",
            pics.to_string_lossy().replace('\\', "/"),
        ))
        .unwrap();
        std::fs::write(pics.join(name), b"orig").unwrap();

        delete_image_to_trash_core(&conn, 1, &thumbs, &trash).unwrap();
        restore_image_from_trash_core(&conn, 1, &thumbs, &trash).unwrap();

        // 原图按 manifest 精确匹配回原位，不进缩略图目录（可再生派生文件的丢弃分支
        // 也不得命中原图条目）
        assert_eq!(std::fs::read(pics.join(name)).unwrap(), b"orig");
        assert!(!thumbs.join("v.jpg").exists());
        assert!(trash_entry_suffixes(&trash, 1).is_empty());
        let _ = std::fs::remove_dir_all(pics.parent().unwrap());
    }
}

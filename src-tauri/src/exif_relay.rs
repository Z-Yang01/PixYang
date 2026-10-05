// EXIF 回接基建（迁移接缝 5 阶段 2）：image-rs 编码不保留元数据，编辑产物需把原图 EXIF
// 字节段级注回（JPEG APP1 "Exif\0\0" 载荷 / PNG eXIf 块），镜像 sharp composite 保元数据的
// 用户可见行为（拍摄时间等）。仅在源/产物同格式时回接（与执行器编码跟随原图格式一致）。

use crate::error::PixError;
use std::path::Path;

const PNG_SIG: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/// 解析 JPEG：跳过 SOI 后逐段走 marker，收集 APP1 中以 "Exif\0\0" 开头的载荷。
/// 到 SOS 即停（熵编码区可能出现任意字节，禁止盲扫）。
pub fn jpeg_exif_segments(jpeg: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    if jpeg.len() < 4 || jpeg[0] != 0xff || jpeg[1] != 0xd8 {
        return out;
    }
    let mut i = 2usize;
    while i + 4 <= jpeg.len() {
        if jpeg[i] != 0xff {
            break;
        }
        let marker = jpeg[i + 1];
        match marker {
            0xd8 | 0x01 | 0xd0..=0xd7 => {
                i += 2;
                continue;
            }
            0xd9 => break,
            0xda => break,
            _ => {}
        }
        let len = u16::from_be_bytes([jpeg[i + 2], jpeg[i + 3]]) as usize;
        if len < 2 || i + 2 + len > jpeg.len() {
            break;
        }
        let payload = &jpeg[i + 4..i + 2 + len];
        if marker == 0xe1 && payload.starts_with(b"Exif\0\0") {
            out.push(payload.to_vec());
        }
        i += 2 + len;
    }
    out
}

/// 在 SOI 之后插入 APP1 段（载荷含 "Exif\0\0" 头；段长含 2 字节长度域，上限 65533）
pub fn inject_jpeg_exif(jpeg: &[u8], payloads: &[Vec<u8>]) -> Vec<u8> {
    if jpeg.len() < 2 || jpeg[0] != 0xff || jpeg[1] != 0xd8 {
        return jpeg.to_vec();
    }
    let mut out =
        Vec::with_capacity(jpeg.len() + payloads.iter().map(|p| p.len() + 4).sum::<usize>());
    out.extend_from_slice(&jpeg[..2]);
    for p in payloads {
        if p.len() + 2 > 65533 {
            continue; // 超 APP1 段容量（真实 EXIF 远小于此），跳过不注
        }
        out.extend_from_slice(&[0xff, 0xe1]);
        out.extend_from_slice(&((p.len() + 2) as u16).to_be_bytes());
        out.extend_from_slice(p);
    }
    out.extend_from_slice(&jpeg[2..]);
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xffff_ffff;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

fn png_chunk_iter(png: &[u8]) -> Vec<(usize, usize, [u8; 4])> {
    // 返回 (data 起始, data 长度, 类型)；签名 + IHDR 之后逐块，带边界校验
    let mut chunks = Vec::new();
    if png.len() < 8 || png[..8] != PNG_SIG {
        return chunks;
    }
    let mut i = 8usize;
    while i + 12 <= png.len() {
        let len = u32::from_be_bytes([png[i], png[i + 1], png[i + 2], png[i + 3]]) as usize;
        let mut ty = [0u8; 4];
        ty.copy_from_slice(&png[i + 4..i + 8]);
        if i + 12 + len > png.len() {
            break;
        }
        chunks.push((i + 8, len, ty));
        i += 12 + len;
    }
    chunks
}

/// 取 PNG 的 eXIf 块数据（裸 TIFF，无 "Exif\0\0" 头）
pub fn png_exif_tiff(png: &[u8]) -> Option<Vec<u8>> {
    png_chunk_iter(png)
        .into_iter()
        .find(|(_, _, ty)| *ty == *b"eXIf")
        .map(|(start, len, _)| png[start..start + len].to_vec())
}

/// 在 IHDR 之后插入 eXIf 块（type+data 的 CRC32）
pub fn inject_png_exif(png: &[u8], tiff: &[u8]) -> Vec<u8> {
    if png.len() < 8 || png[..8] != PNG_SIG {
        return png.to_vec();
    }
    let first_len = u32::from_be_bytes([png[8], png[9], png[10], png[11]]) as usize;
    let insert_at = 8 + 12 + first_len; // 签名 + IHDR 块之后
    if insert_at > png.len() {
        return png.to_vec();
    }
    let mut chunk = Vec::with_capacity(tiff.len() + 12);
    chunk.extend_from_slice(&(tiff.len() as u32).to_be_bytes());
    chunk.extend_from_slice(b"eXIf");
    chunk.extend_from_slice(tiff);
    chunk.extend_from_slice(&crc32(&chunk[4..]).to_be_bytes());
    let mut out = Vec::with_capacity(png.len() + chunk.len());
    out.extend_from_slice(&png[..insert_at]);
    out.extend_from_slice(&chunk);
    out.extend_from_slice(&png[insert_at..]);
    out
}

/// 按源格式分派回接：jpeg→jpeg / png→png；跨格式或源无 EXIF 时产物原样返回
pub fn relay_exif(src: &[u8], dst: &[u8]) -> Vec<u8> {
    if src.starts_with(&[0xff, 0xd8]) && dst.starts_with(&[0xff, 0xd8]) {
        let segs = jpeg_exif_segments(src);
        if !segs.is_empty() {
            return inject_jpeg_exif(dst, &segs);
        }
        return dst.to_vec();
    }
    if src.starts_with(&PNG_SIG) && dst.starts_with(&PNG_SIG) {
        if let Some(tiff) = png_exif_tiff(src) {
            return inject_png_exif(dst, &tiff);
        }
    }
    dst.to_vec()
}

/// 文件便捷封装：读源/产物、回接、写回产物路径
pub fn relay_exif_files(src_path: &Path, dst_path: &Path) -> Result<(), PixError> {
    let src = std::fs::read(src_path).map_err(|e| PixError::Io(format!("读取原图失败: {e}")))?;
    let dst = std::fs::read(dst_path).map_err(|e| PixError::Io(format!("读取产物失败: {e}")))?;
    let out = relay_exif(&src, &dst);
    if out != dst {
        std::fs::write(dst_path, out).map_err(|e| PixError::Io(format!("写回失败: {e}")))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_jpeg(exif_payload: Option<&[u8]>) -> Vec<u8> {
        let mut v = vec![0xff, 0xd8];
        if let Some(p) = exif_payload {
            v.extend_from_slice(&[0xff, 0xe1]);
            v.extend_from_slice(&((p.len() + 2) as u16).to_be_bytes());
            v.extend_from_slice(p);
        }
        v.extend_from_slice(&[0xff, 0xe0, 0x00, 0x10, b'J', b'F', b'I', b'F']);
        v.extend_from_slice(&[0xff, 0xda, 0x00, 0x02]);
        v.extend_from_slice(&[0x00, 0xff, 0xe1, 0xaa, 0xaa]); // 熵区伪造段，不得误收
        v.extend_from_slice(&[0xff, 0xd9]);
        v
    }

    const EXIF: &[u8] = b"Exif\0\0MM\x00\x2a-fake-tiff";

    #[test]
    fn jpeg段解析_只收SOI后EXIF_APP1_跳过熵区伪造() {
        let segs = jpeg_exif_segments(&fake_jpeg(Some(EXIF)));
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0], EXIF);
        assert!(jpeg_exif_segments(&fake_jpeg(None)).is_empty());
    }

    #[test]
    fn jpeg注入_紧跟SOI_可再解析往返() {
        let dst = fake_jpeg(None);
        let out = inject_jpeg_exif(&dst, &[EXIF.to_vec()]);
        assert_eq!(jpeg_exif_segments(&out), vec![EXIF.to_vec()]);
        assert_eq!(out[out.len() - 2..], [0xff, 0xd9]);
        let no_sig: Vec<u8> = vec![1, 2, 3];
        assert_eq!(inject_jpeg_exif(&no_sig, &[EXIF.to_vec()]), no_sig);
    }

    #[test]
    fn png_eXIf_注入往返_crc有效() {
        let mut png = PNG_SIG.to_vec();
        let ihdr_data = [0u8; 13];
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&(13u32).to_be_bytes());
        ihdr.extend_from_slice(b"IHDR");
        ihdr.extend_from_slice(&ihdr_data);
        ihdr.extend_from_slice(&crc32(b"IHDR").to_be_bytes());
        png.extend_from_slice(&ihdr);
        // 补一个合法 IDAT + IEND
        let idat_start = png.len();
        png.extend_from_slice(&(0u32).to_be_bytes());
        png.extend_from_slice(b"IDAT");
        png.extend_from_slice(&crc32(b"IDAT").to_be_bytes());
        assert!(idat_start > 8);
        png.extend_from_slice(&(0u32).to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&crc32(b"IEND").to_be_bytes());

        assert!(png_exif_tiff(&png).is_none());
        let out = inject_png_exif(&png, EXIF);
        assert_eq!(png_exif_tiff(&out).as_deref(), Some(EXIF));
        // eXIf 必须位于 IHDR 之后、IDAT 之前
        let pos_exif = out.windows(4).position(|w| w == b"eXIf").unwrap();
        let pos_idat = out.windows(4).position(|w| w == b"IDAT").unwrap();
        let pos_ihdr = out.windows(4).position(|w| w == b"IHDR").unwrap();
        assert!(pos_ihdr < pos_exif && pos_exif < pos_idat);
    }

    #[test]
    fn relay_按格式分派_跨格式原样() {
        let jpeg_src = fake_jpeg(Some(EXIF));
        let jpeg_dst = fake_jpeg(None);
        assert_eq!(
            jpeg_exif_segments(&relay_exif(&jpeg_src, &jpeg_dst)),
            vec![EXIF.to_vec()]
        );
        // 跨格式（jpeg 源 → 非 jpeg 产物）：不回接
        assert_eq!(relay_exif(&jpeg_src, &png_stub()), png_stub());
    }

    // ── R102 跨模块集成审计：畸形 EXIF 源 × convert 导出回接 ──
    // 长度域撒谎/非法段长/非 Exif APP1 的源不得让解析越界或误收，畸形源经 relay
    // 原样放行产物（不炸、不产出半截段）；超 APP1 容量的载荷注入时跳过不注。

    #[test]
    fn 畸形exif源_长度域越界_非法段长_非exif_app1_不误收不炸() {
        // len=0xff=255 但缓冲只剩数字节：必须在段边界安全截停
        let mut truncated = vec![0xff, 0xd8];
        truncated.extend_from_slice(&[0xff, 0xe1, 0x00, 0xff, 0x45, 0x78]);
        assert!(jpeg_exif_segments(&truncated).is_empty());
        // len < 2：非法段长直接截停
        let short_len = vec![0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00, 0xff, 0xd9];
        assert!(jpeg_exif_segments(&short_len).is_empty());
        // APP1 但非 "Exif\0\0" 头（如 JPX 载荷）：不误收
        let mut jpx = vec![0xff, 0xd8];
        jpx.extend_from_slice(&[0xff, 0xe1, 0x00, 0x0a, b'J', b'P', b'X', b' ', 0x00, 0x00]);
        jpx.extend_from_slice(&[0xff, 0xd9]);
        assert!(jpeg_exif_segments(&jpx).is_empty());
        // 畸形源经 relay：解析为空 → 产物原样返回（不炸、不改字节）
        let dst = fake_jpeg(None);
        assert_eq!(relay_exif(&truncated, &dst), dst);
        // PNG 侧：截断的 eXIf 块长度域越界 → 不取不炸
        let mut evil_png = png_stub();
        evil_png.extend_from_slice(&[0x00, 0xff, 0xff, 0xff]); // len 巨大
        evil_png.extend_from_slice(b"eXIf");
        assert!(png_exif_tiff(&evil_png).is_none());
        assert_eq!(relay_exif(&evil_png, &png_stub()), png_stub());
    }

    #[test]
    fn 注入_超app1容量载荷跳过_正常载荷不受影响() {
        let dst = fake_jpeg(None);
        let huge = vec![0xaau8; 65540];
        let out = inject_jpeg_exif(&dst, &[huge, EXIF.to_vec()]);
        // 超限载荷跳过，正常 EXIF 照注
        assert_eq!(jpeg_exif_segments(&out), vec![EXIF.to_vec()]);
    }

    fn png_stub() -> Vec<u8> {
        let mut png = PNG_SIG.to_vec();
        png.extend_from_slice(&(13u32).to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&[0u8; 13]);
        png.extend_from_slice(&crc32(b"IHDR").to_be_bytes());
        png
    }
}

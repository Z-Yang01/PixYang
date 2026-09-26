// 缩略图内核（迁移接缝 5 阶段 1）：镜像 electron/thumbWorker.js 的 generateTiers/
// findLargestJpeg/extractNefPreview/image-meta。已知分歧（SEAM5_DECISION.md 记录）：
// - NEF 的 sharp 直读分支不可移植，仅走内嵌 JPEG 预览段提取（主流 NEF 均含预览）；
// - resize 用 Lanczos3（近似 sharp lanczos3），解码器不同导致缩略图像素级细微差异。

use crate::error::PixError;
use image::imageops::{self, FilterType};
use image::{DynamicImage, GenericImageView, RgbaImage};
use std::io::BufReader;
use std::path::Path;

// 高 DPI（2x）下网格卡片物理像素可达 470px：small 160 源会放大 3 倍发糊。
// R72：small 320（普通屏 2 列也够）、medium 640（2x 屏 1:1），质量 80→85。
pub const THUMB_SMALL_SIZE: u32 = 320;
pub const THUMB_MEDIUM_SIZE: u32 = 640;

/// 镜像 EXIF orientation 2-8 的像素转正（sharp .rotate() 无参语义）
pub fn apply_orientation(img: &DynamicImage, orientation: u32) -> DynamicImage {
    use image::imageops;
    match orientation {
        2 => DynamicImage::from(imageops::flip_horizontal(img)),
        3 => DynamicImage::from(imageops::rotate180(img)),
        4 => DynamicImage::from(imageops::flip_vertical(img)),
        5 => DynamicImage::from(imageops::flip_horizontal(&imageops::rotate90(img))),
        6 => DynamicImage::from(imageops::rotate90(img)),
        7 => DynamicImage::from(imageops::flip_horizontal(&imageops::rotate270(img))),
        8 => DynamicImage::from(imageops::rotate270(img)),
        _ => img.clone(),
    }
}

/// 含 alpha 输入压平到白底（JPEG 输出必去 alpha）
pub fn flatten_white(img: &DynamicImage) -> DynamicImage {
    if !img.has_alpha() {
        return img.clone();
    }
    let rgba: RgbaImage = img.to_rgba8();
    let mut out = image::RgbImage::new(rgba.width(), rgba.height());
    for (x, y, px) in rgba.enumerate_pixels() {
        let a = px.0[3] as f32 / 255.0;
        let blend = |c: u8| (c as f32 * a + 255.0 * (1.0 - a)).round() as u8;
        out.put_pixel(
            x,
            y,
            image::Rgb([blend(px.0[0]), blend(px.0[1]), blend(px.0[2])]),
        );
    }
    DynamicImage::from(out)
}

/// fit:'inside' 缩放（含放大，与 sharp 无 withoutEnlargement 一致）
fn resize_inside(img: &DynamicImage, max_side: u32) -> DynamicImage {
    let (w, h) = img.dimensions();
    let long = w.max(h);
    let scale = max_side as f32 / long as f32;
    let nw = ((w as f32 * scale).round() as u32).max(1);
    let nh = ((h as f32 * scale).round() as u32).max(1);
    DynamicImage::from(imageops::resize(img, nw, nh, FilterType::Lanczos3))
}

fn encode_jpeg(img: &DynamicImage, quality: u8) -> Result<Vec<u8>, PixError> {
    let mut buf = std::io::Cursor::new(Vec::new());
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
    img.write_with_encoder(encoder)
        .map_err(|e| PixError::Io(format!("JPEG 编码失败: {e}")))?;
    Ok(buf.into_inner())
}

fn read_exif_orientation(path: &Path) -> u32 {
    read_exif_orientation_impl(path).unwrap_or(1)
}

fn read_exif_orientation_impl(path: &Path) -> Option<u32> {
    let file = std::fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let ex = exif::Reader::new().read_from_container(&mut reader).ok()?;
    let field = ex.get_field(exif::Tag::Orientation, exif::In::PRIMARY)?;
    field.value.get_uint(0)
}

fn decode(path: &Path) -> Result<DynamicImage, PixError> {
    image::ImageReader::open(path)
        .map_err(|e| PixError::Io(format!("打开图片失败: {e}")))?
        .with_guessed_format()
        .map_err(|e| PixError::Io(format!("识别格式失败: {e}")))?
        .decode()
        .map_err(|e| PixError::Io(format!("解码失败: {e}")))
}

/// 双档缩略图：转正→压平白底→两档缩放→jpeg q85。返回 (small, medium, 显示宽, 显示高)
pub fn generate_tiers(filepath: &Path) -> Result<(Vec<u8>, Vec<u8>, u32, u32), PixError> {
    let orientation = read_exif_orientation(filepath);
    let img = decode(filepath)?;
    let (raw_w, raw_h) = img.dimensions();
    let upright = apply_orientation(&img, orientation);
    let flat = flatten_white(&upright);
    let small = encode_jpeg(&resize_inside(&flat, THUMB_SMALL_SIZE), 85)?;
    let medium = encode_jpeg(&resize_inside(&flat, THUMB_MEDIUM_SIZE), 85)?;
    let swapped = orientation >= 5;
    let (w, h) = if swapped {
        (raw_h, raw_w)
    } else {
        (raw_w, raw_h)
    };
    Ok((small, medium, w, h))
}

/// 探测尺寸/方向/alpha（镜像 worker 的 meta 消息）
pub fn image_meta(filepath: &Path) -> Result<(u32, u32, u32, bool), PixError> {
    let img = decode(filepath)?;
    let orientation = read_exif_orientation(filepath).max(1);
    Ok((
        img.dimensions().0,
        img.dimensions().1,
        orientation,
        img.has_alpha(),
    ))
}

/// 扫描 buffer 中所有完整 JPEG 段（SOI…EOI），返回最大的一个（NEF 全尺寸预览为最大段）
pub fn find_largest_jpeg(buffer: &[u8]) -> Option<(usize, usize)> {
    const SOI: [u8; 3] = [0xff, 0xd8, 0xff];
    const EOI: [u8; 2] = [0xff, 0xd9];
    let mut largest: Option<(usize, usize)> = None;
    let mut pos = 0usize;
    while pos + 3 < buffer.len() {
        let soi = match find_sub(buffer, &SOI, pos) {
            Some(i) => i,
            None => break,
        };
        let eoi = match find_sub(buffer, &EOI, soi + 3) {
            Some(i) => i,
            None => break,
        };
        let size = eoi + 2 - soi;
        if largest.map(|(_, s)| size > s).unwrap_or(true) {
            largest = Some((soi, size));
        }
        pos = soi + 3;
    }
    largest
}

fn find_sub(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if from >= haystack.len() {
        return None;
    }
    haystack[from..]
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|i| i + from)
}

/// 提取 NEF 内嵌全尺寸 JPEG 预览并重写为规范 JPEG（q92），过小（<320 宽）返回 None
pub fn extract_nef_preview(
    nef_path: &Path,
    out_path: &Path,
) -> Result<Option<(u32, u32)>, PixError> {
    let buf = std::fs::read(nef_path).map_err(|e| PixError::Io(format!("读取 NEF 失败: {e}")))?;
    let seg = match find_largest_jpeg(&buf) {
        Some((start, size)) => &buf[start..start + size],
        None => return Ok(None),
    };
    let img = match image::load_from_memory(seg) {
        Ok(img) => img,
        Err(_) => return Ok(None),
    };
    if img.dimensions().0 < 320 {
        return Ok(None);
    }
    let upright = apply_orientation(&img, read_exif_orientation_from_bytes(seg));
    let rotated = encode_jpeg(&upright, 92)?;
    let (w, h) = image::load_from_memory(&rotated)
        .map(|i| i.dimensions())
        .map_err(|e| PixError::Io(format!("复核编码失败: {e}")))?;
    std::fs::write(out_path, rotated).map_err(|e| PixError::Io(format!("写入失败: {e}")))?;
    Ok(Some((w, h)))
}

fn read_exif_orientation_from_bytes(bytes: &[u8]) -> u32 {
    let cursor = std::io::Cursor::new(bytes);
    let mut reader = BufReader::new(cursor);
    exif::Reader::new()
        .read_from_container(&mut reader)
        .ok()
        .and_then(|ex| {
            ex.get_field(exif::Tag::Orientation, exif::In::PRIMARY)
                .and_then(|f| f.value.get_uint(0))
        })
        .unwrap_or(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_rgba(w: u32, h: u32, rgba: [u8; 4]) -> DynamicImage {
        let mut img = RgbaImage::new(w, h);
        for (_, _, px) in img.enumerate_pixels_mut() {
            *px = image::Rgba(rgba);
        }
        DynamicImage::from(img)
    }

    #[test]
    fn 方向6顺时针转正_宽高互换() {
        let img = solid_rgba(3, 1, [255, 0, 0, 255]);
        let rotated = apply_orientation(&img, 6);
        assert_eq!(rotated.dimensions(), (1, 3));
        assert_eq!(apply_orientation(&img, 1).dimensions(), (3, 1));
        assert_eq!(apply_orientation(&img, 3).dimensions(), (3, 1));
    }

    #[test]
    fn 半透明压平白底() {
        let img = solid_rgba(1, 1, [0, 0, 0, 128]);
        let flat = flatten_white(&img);
        assert!(!flat.has_alpha());
        let rgb = flat.to_rgb8();
        assert_eq!(rgb.get_pixel(0, 0).0, [127, 127, 127]);
        let opaque = solid_rgba(1, 1, [10, 20, 30, 255]);
        let flat_opaque = flatten_white(&opaque).to_rgb8();
        assert_eq!(flat_opaque.get_pixel(0, 0).0, [10, 20, 30]);
    }

    #[test]
    fn 双档缩略图_长边钳制与放大() {
        let dir = std::env::temp_dir().join("pixyang_tiers_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("in.jpg");
        let small_img = solid_rgba(60, 40, [200, 100, 50, 255]);
        small_img.save(&src).unwrap();
        let (small, medium, w, h) = generate_tiers(&src).unwrap();
        assert_eq!((w, h), (60, 40));
        let sd = image::load_from_memory(&small).unwrap();
        assert_eq!(sd.dimensions(), (320, 213));
        let md = image::load_from_memory(&medium).unwrap();
        assert_eq!(md.dimensions(), (640, 427));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 最大jpeg段提取() {
        let small_jpeg = encode_jpeg(&solid_rgba(10, 10, [1, 2, 3, 255]), 80).unwrap();
        let big_jpeg = encode_jpeg(&solid_rgba(300, 200, [1, 2, 3, 255]), 80).unwrap();
        let mut buf = vec![0xde, 0xad];
        buf.extend_from_slice(&small_jpeg);
        buf.extend_from_slice(&[0x00, 0x11]);
        buf.extend_from_slice(&big_jpeg);
        buf.extend_from_slice(&[0xbe, 0xef]);
        let (start, size) = find_largest_jpeg(&buf).unwrap();
        assert_eq!(&buf[start..start + size], big_jpeg.as_slice());
    }

    #[test]
    fn nef预览提取_过小拒收() {
        let dir = std::env::temp_dir().join("pixyang_nef_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let tiny = encode_jpeg(&solid_rgba(100, 60, [1, 2, 3, 255]), 80).unwrap();
        let mut nef = vec![0xaa; 1024];
        nef.extend_from_slice(&tiny);
        let nef_path = dir.join("x.nef");
        std::fs::write(&nef_path, &nef).unwrap();
        let out = dir.join("x.jpg");
        assert!(extract_nef_preview(&nef_path, &out).unwrap().is_none());
        let big = encode_jpeg(&solid_rgba(320, 200, [1, 2, 3, 255]), 80).unwrap();
        let mut nef2 = vec![0xaa; 2048];
        nef2.extend_from_slice(&big);
        std::fs::write(&nef_path, &nef2).unwrap();
        let (w, h) = extract_nef_preview(&nef_path, &out).unwrap().unwrap();
        assert_eq!((w, h), (320, 200));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

// EXIF 读取内核：镜像 electron/main.js 的 parseFullExif（fs:get-exif，exifr 原始值
// reviveValues/translateValues 均为 false）与 readExifInfo 的 taken_at 语义。
// 字段格式化（f/2.8、1/125s、50mm、曝光档位中文名等）逐条对齐 JS。

use crate::error::PixError;
use exif::{Exif, In, Tag, Value};
use serde_json::{json, Value as Json};
use std::io::BufReader;
use std::path::Path;

/// 镜像 fs:get-exif → parseFullExif：无 EXIF 或解析失败返回全空字段对象；
/// 文件不可读返回 Io 错误（JS 侧 catch 后同样得到空对象，由命令层决定转空）
pub fn exif_fields(path: &Path) -> Result<Json, PixError> {
    let buf = std::fs::read(path).map_err(|e| PixError::Io(format!("读取图片失败: {e}")))?;
    let fields = exif_from_jpeg_bytes(&buf)
        .or_else(|| exif_from_container_bytes(&buf))
        .map(|ex| exif_to_json(&ex))
        .unwrap_or_else(empty_fields);
    Ok(fields)
}

/// JPEG APP1 段提取（Exif\0\0 后的 TIFF 裸数据）→ 解析为 Exif
fn exif_from_jpeg_bytes(buf: &[u8]) -> Option<Exif> {
    let tiff = exif::get_exif_attr_from_jpeg(&mut std::io::Cursor::new(buf)).ok()?;
    exif_from_tiff_bytes(&tiff)
}

fn exif_from_tiff_bytes(tiff: &[u8]) -> Option<Exif> {
    exif::Reader::new().read_raw(tiff.to_vec()).ok()
}

/// 非 JPEG 容器兜底（TIFF/PNG/WEBP/ISOBMFF，与 exifr 支持面对齐）
fn exif_from_container_bytes(buf: &[u8]) -> Option<Exif> {
    exif::Reader::new()
        .read_from_container(&mut BufReader::new(std::io::Cursor::new(buf)))
        .ok()
}

fn empty_fields() -> Json {
    json!({
        "camera": "", "lens": "", "iso": "", "fNumber": "", "exposure": "",
        "focalLength": "", "dateTime": "", "focal35mm": "", "flash": "",
        "whiteBalance": "", "exposureProgram": "", "meteringMode": "",
        "exposureBias": "", "software": "", "artist": "", "copyright": "",
        "colorSpace": "", "sceneCapture": "",
    })
}

fn ascii_field(ex: &Exif, tag: Tag) -> Option<String> {
    match &ex.get_field(tag, In::PRIMARY)?.value {
        Value::Ascii(v) => v.first().map(|b| {
            String::from_utf8_lossy(b)
                .trim_end_matches('\0')
                .to_string()
        }),
        _ => None,
    }
}

fn uint_field(ex: &Exif, tag: Tag) -> Option<u32> {
    ex.get_field(tag, In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
}

fn rational_field(ex: &Exif, tag: Tag) -> Option<f64> {
    match &ex.get_field(tag, In::PRIMARY)?.value {
        Value::Rational(v) => v
            .first()
            .map(|r| r.num as f64 / r.denom as f64)
            .filter(|f| f.is_finite()),
        _ => None,
    }
}

fn srational_field(ex: &Exif, tag: Tag) -> Option<f64> {
    match &ex.get_field(tag, In::PRIMARY)?.value {
        Value::SRational(v) => v
            .first()
            .map(|r| r.num as f64 / r.denom as f64)
            .filter(|f| f.is_finite()),
        _ => None,
    }
}

fn format_exposure(t: f64) -> String {
    if t >= 1.0 {
        format!("{t:.1}s")
    } else {
        format!("1/{}s", (1.0 / t).round() as i64)
    }
}

/// 镜像 parseFullExif 的字段拼装（truthy/presence 判定与 JS 逐字段一致）
pub fn exif_to_json(ex: &Exif) -> Json {
    let make = ascii_field(ex, Tag::Make).unwrap_or_default();
    let model = ascii_field(ex, Tag::Model).unwrap_or_default();
    let camera = if !make.is_empty() && !model.is_empty() && model.starts_with(&make) {
        model
    } else {
        let mut parts: Vec<&str> = Vec::new();
        if !make.is_empty() {
            parts.push(&make);
        }
        if !model.is_empty() {
            parts.push(&model);
        }
        parts.join(" ")
    };
    let iso = uint_field(ex, Tag::PhotographicSensitivity)
        .map(|v| v.to_string())
        .unwrap_or_default();
    let f_number = rational_field(ex, Tag::FNumber)
        .filter(|f| *f != 0.0)
        .map(|f| format!("f/{f:.1}"))
        .unwrap_or_default();
    let exposure = rational_field(ex, Tag::ExposureTime)
        .filter(|t| *t != 0.0)
        .map(format_exposure)
        .unwrap_or_default();
    let focal_length = rational_field(ex, Tag::FocalLength)
        .filter(|f| *f != 0.0)
        .map(|f| format!("{}mm", f.round() as i64))
        .unwrap_or_default();
    let focal35 = uint_field(ex, Tag::FocalLengthIn35mmFilm)
        .filter(|v| *v != 0)
        .map(|v| format!("{v}mm"))
        .unwrap_or_default();
    let flash = uint_field(ex, Tag::Flash)
        .map(|v| {
            if v & 0x01 != 0 {
                "已闪光"
            } else {
                "未闪光"
            }
        })
        .unwrap_or_default();
    let white_balance = uint_field(ex, Tag::WhiteBalance)
        .map(|v| if v == 0 { "自动" } else { "手动" })
        .unwrap_or_default();
    let exposure_bias = srational_field(ex, Tag::ExposureBiasValue)
        .map(|f| format!("{}{f:.1} EV", if f > 0.0 { "+" } else { "" }))
        .unwrap_or_default();
    let exposure_program = uint_field(ex, Tag::ExposureProgram)
        .map(|v| match v {
            0 => "未定义".to_string(),
            1 => "手动".to_string(),
            2 => "程序自动".to_string(),
            3 => "光圈优先".to_string(),
            4 => "快门优先".to_string(),
            5 => "创意".to_string(),
            6 => "运动".to_string(),
            7 => "肖像".to_string(),
            8 => "风景".to_string(),
            other => other.to_string(),
        })
        .unwrap_or_default();
    let metering_mode = uint_field(ex, Tag::MeteringMode)
        .map(|v| match v {
            0 => "未知".to_string(),
            1 => "平均".to_string(),
            2 => "中央重点".to_string(),
            3 => "点测光".to_string(),
            4 => "多点".to_string(),
            5 => "矩阵".to_string(),
            6 => "局部".to_string(),
            255 => "其他".to_string(),
            other => other.to_string(),
        })
        .unwrap_or_default();
    let color_space = uint_field(ex, Tag::ColorSpace)
        .map(|v| match v {
            1 => "sRGB".to_string(),
            0xFFFF => "Uncalibrated".to_string(),
            other => other.to_string(),
        })
        .unwrap_or_default();
    let scene_capture = uint_field(ex, Tag::SceneCaptureType)
        .map(|v| match v {
            0 => "标准".to_string(),
            1 => "风景".to_string(),
            2 => "人像".to_string(),
            3 => "夜景".to_string(),
            4 => "运动".to_string(),
            other => other.to_string(),
        })
        .unwrap_or_default();
    let ascii_or_empty = |tag: Tag| -> String { ascii_field(ex, tag).unwrap_or_default() };
    json!({
        "camera": camera,
        // 手动导入日期链（file_ops apply_date_override）消费：YYYY-MM-DD HH:MM 归一格式
        "taken_at": taken_at(ex).unwrap_or_default(),
        "lens": ascii_or_empty(Tag::LensModel),
        "iso": iso,
        "fNumber": f_number,
        "exposure": exposure,
        "focalLength": focal_length,
        "dateTime": ascii_or_empty(Tag::DateTimeOriginal),
        "focal35mm": focal35,
        "flash": flash,
        "whiteBalance": white_balance,
        "exposureProgram": exposure_program,
        "meteringMode": metering_mode,
        "exposureBias": exposure_bias,
        "software": ascii_or_empty(Tag::Software),
        "artist": ascii_or_empty(Tag::Artist),
        "copyright": ascii_or_empty(Tag::Copyright),
        "colorSpace": color_space,
        "sceneCapture": scene_capture,
    })
}

/// 镜像 readExifInfo 的 taken_at：DateTimeOriginal 优先，缺失（非存在但无效）
/// 才回退 CreateDate（EXIF DateTimeDigitized，0x9004）
pub fn taken_at(ex: &Exif) -> Option<String> {
    let raw = match ascii_field(ex, Tag::DateTimeOriginal) {
        Some(s) => Some(s),
        None => ascii_field(ex, Tag::DateTimeDigitized),
    };
    taken_at_from_raw(&raw?)
}

/// 'YYYY:MM:DD[ HH:MM]' 前缀解析：月 1-12 日 1-31 强校验（占位日期视为无效），
/// 时间部分不校验范围；'T' 分隔符同接受；尾随多余内容忽略
pub fn taken_at_from_raw(raw: &str) -> Option<String> {
    let b = raw.as_bytes();
    let two_digits = |s: &[u8]| s.len() == 2 && s.iter().all(u8::is_ascii_digit);
    let num = |s: &[u8]| -> Option<u32> {
        if two_digits(s) {
            Some((s[0] - b'0') as u32 * 10 + (s[1] - b'0') as u32)
        } else {
            None
        }
    };
    if b.len() < 10
        || !b[0..4].iter().all(u8::is_ascii_digit)
        || b[4] != b':'
        || num(&b[5..7]).is_none()
        || b[7] != b':'
        || num(&b[8..10]).is_none()
    {
        return None;
    }
    let month = num(&b[5..7]).unwrap_or(0);
    let day = num(&b[8..10]).unwrap_or(0);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let date = format!("{}-{}-{}", &raw[0..4], &raw[5..7], &raw[8..10]);
    if b.len() >= 16
        && (b[10] == b' ' || b[10] == b'T')
        && two_digits(&b[11..13])
        && b[13] == b':'
        && two_digits(&b[14..16])
    {
        Some(format!("{date} {}:{}", &raw[11..13], &raw[14..16]))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ascii_f(tag: Tag, s: &str) -> exif::Field {
        exif::Field {
            tag,
            ifd_num: In::PRIMARY,
            value: Value::Ascii(vec![s.as_bytes().to_vec()]),
        }
    }

    fn short_f(tag: Tag, v: u16) -> exif::Field {
        exif::Field {
            tag,
            ifd_num: In::PRIMARY,
            value: Value::Short(vec![v]),
        }
    }

    fn rational_f(tag: Tag, num: u32, denom: u32) -> exif::Field {
        exif::Field {
            tag,
            ifd_num: In::PRIMARY,
            value: Value::Rational(vec![exif::Rational { num, denom }]),
        }
    }

    fn srational_f(tag: Tag, num: i32, denom: i32) -> exif::Field {
        exif::Field {
            tag,
            ifd_num: In::PRIMARY,
            value: Value::SRational(vec![exif::SRational { num, denom }]),
        }
    }

    fn build_tiff(fields: &[exif::Field]) -> Vec<u8> {
        let mut writer = exif::experimental::Writer::new();
        for f in fields {
            writer.push_field(f);
        }
        let mut buf = std::io::Cursor::new(Vec::new());
        writer.write(&mut buf, false).unwrap();
        buf.into_inner()
    }

    fn parse_fields(fields: &[exif::Field]) -> Exif {
        exif_from_tiff_bytes(&build_tiff(fields)).unwrap()
    }

    #[test]
    fn 字段映射_完整字段与_taken_at() {
        let ex = parse_fields(&[
            ascii_f(Tag::Make, "NIKON"),
            ascii_f(Tag::Model, "NIKON Z 6_2"),
            ascii_f(Tag::LensModel, "NIKKOR Z 50mm f/1.8 S"),
            short_f(Tag::PhotographicSensitivity, 100),
            rational_f(Tag::FNumber, 28, 10),
            rational_f(Tag::ExposureTime, 1, 125),
            rational_f(Tag::FocalLength, 50, 1),
            short_f(Tag::FocalLengthIn35mmFilm, 75),
            ascii_f(Tag::DateTimeOriginal, "2026:09:20 14:30:05"),
            short_f(Tag::Flash, 1),
            short_f(Tag::WhiteBalance, 0),
            srational_f(Tag::ExposureBiasValue, 1, 3),
            short_f(Tag::ExposureProgram, 3),
            short_f(Tag::MeteringMode, 5),
            short_f(Tag::ColorSpace, 1),
            short_f(Tag::SceneCaptureType, 2),
            ascii_f(Tag::Software, "PixYang"),
            ascii_f(Tag::Artist, "张三"),
            ascii_f(Tag::Copyright, "(c) 2026"),
        ]);
        let v = exif_to_json(&ex);
        assert_eq!(v["camera"], "NIKON Z 6_2");
        assert_eq!(v["lens"], "NIKKOR Z 50mm f/1.8 S");
        assert_eq!(v["iso"], "100");
        assert_eq!(v["fNumber"], "f/2.8");
        assert_eq!(v["exposure"], "1/125s");
        assert_eq!(v["focalLength"], "50mm");
        assert_eq!(v["focal35mm"], "75mm");
        assert_eq!(v["dateTime"], "2026:09:20 14:30:05");
        assert_eq!(v["flash"], "已闪光");
        assert_eq!(v["whiteBalance"], "自动");
        assert_eq!(v["exposureBias"], "+0.3 EV");
        assert_eq!(v["exposureProgram"], "光圈优先");
        assert_eq!(v["meteringMode"], "矩阵");
        assert_eq!(v["colorSpace"], "sRGB");
        assert_eq!(v["sceneCapture"], "人像");
        assert_eq!(v["software"], "PixYang");
        assert_eq!(v["artist"], "张三");
        assert_eq!(v["copyright"], "(c) 2026");
        assert_eq!(taken_at(&ex).as_deref(), Some("2026-09-20 14:30"));
    }

    #[test]
    fn 字段映射_相机拼接零值与未知档位() {
        let ex = parse_fields(&[
            ascii_f(Tag::Make, "Apple"),
            ascii_f(Tag::Model, "iPhone 15"),
            short_f(Tag::PhotographicSensitivity, 0),
            rational_f(Tag::FNumber, 0, 10),
            rational_f(Tag::ExposureTime, 2, 1),
            rational_f(Tag::FocalLength, 0, 1),
            short_f(Tag::FocalLengthIn35mmFilm, 0),
            short_f(Tag::Flash, 0),
            short_f(Tag::WhiteBalance, 1),
            srational_f(Tag::ExposureBiasValue, 0, 1),
            short_f(Tag::ExposureProgram, 9),
            short_f(Tag::MeteringMode, 99),
            short_f(Tag::ColorSpace, 2),
            short_f(Tag::SceneCaptureType, 9),
            ascii_f(Tag::LensModel, ""),
        ]);
        let v = exif_to_json(&ex);
        assert_eq!(v["camera"], "Apple iPhone 15");
        assert_eq!(v["iso"], "0");
        assert_eq!(v["fNumber"], "");
        assert_eq!(v["exposure"], "2.0s");
        assert_eq!(v["focalLength"], "");
        assert_eq!(v["focal35mm"], "");
        assert_eq!(v["flash"], "未闪光");
        assert_eq!(v["whiteBalance"], "手动");
        assert_eq!(v["exposureBias"], "0.0 EV");
        assert_eq!(v["exposureProgram"], "9");
        assert_eq!(v["meteringMode"], "99");
        assert_eq!(v["colorSpace"], "2");
        assert_eq!(v["sceneCapture"], "9");
        assert_eq!(v["lens"], "");
    }

    #[test]
    fn 字段映射_仅型号时相机为型号_全空字段对象() {
        let ex = parse_fields(&[ascii_f(Tag::ImageDescription, "desc")]);
        let v = exif_to_json(&ex);
        assert_eq!(v["camera"], "");
        for key in [
            "camera",
            "lens",
            "iso",
            "fNumber",
            "exposure",
            "focalLength",
            "dateTime",
            "focal35mm",
            "flash",
            "whiteBalance",
            "exposureProgram",
            "meteringMode",
            "exposureBias",
            "software",
            "artist",
            "copyright",
            "colorSpace",
            "sceneCapture",
        ] {
            assert_eq!(v[key], "", "字段 {key} 应为空");
        }
        assert_eq!(taken_at(&ex), None);
    }

    #[test]
    fn exif_fields_输出含_taken_at键_手动导入日期链接线() {
        // 回归锁：file_ops apply_date_override 消费 fields["taken_at"]——
        // 此前 exif_to_json 漏该键导致手动导入的 EXIF 拍摄日期分支为死代码
        let ex = parse_fields(&[ascii_f(Tag::DateTimeOriginal, "2026:09:20 14:30:05")]);
        let fields = exif_to_json(&ex);
        assert_eq!(fields["taken_at"], "2026-09-20 14:30");
    }

    #[test]
    fn taken_at_解析_时间分隔与校验边界() {
        assert_eq!(
            taken_at_from_raw("2026:09:20 14:30:05").as_deref(),
            Some("2026-09-20 14:30")
        );
        assert_eq!(
            taken_at_from_raw("2026:09:20T14:30:05").as_deref(),
            Some("2026-09-20 14:30")
        );
        assert_eq!(
            taken_at_from_raw("2026:09:20 14:30:05.123").as_deref(),
            Some("2026-09-20 14:30")
        );
        assert_eq!(taken_at_from_raw("2026:09:20"), None);
        assert_eq!(taken_at_from_raw("0000:00:00 00:00:00"), None);
        assert_eq!(taken_at_from_raw("2026:13:01 10:00:00"), None);
        assert_eq!(taken_at_from_raw("2026:00:10 10:00:00"), None);
        assert_eq!(taken_at_from_raw("2026:09:00 10:00:00"), None);
        assert_eq!(taken_at_from_raw("2026:09:32 10:00:00"), None);
        assert_eq!(
            taken_at_from_raw("2026:09:20 25:99:00").as_deref(),
            Some("2026-09-20 25:99")
        );
        assert_eq!(taken_at_from_raw("2026-09-20 14:30:00"), None);
        assert_eq!(taken_at_from_raw("2026:09:20  14:30:00"), None);
        assert_eq!(taken_at_from_raw("garbage"), None);
        assert_eq!(taken_at_from_raw(""), None);
    }

    #[test]
    fn taken_at_仅CreateDate时回退_占位日期不回退() {
        let ex = parse_fields(&[ascii_f(Tag::DateTimeDigitized, "2025:01:02 03:04:05")]);
        assert_eq!(taken_at(&ex).as_deref(), Some("2025-01-02 03:04"));
        let ex2 = parse_fields(&[
            ascii_f(Tag::DateTimeOriginal, "0000:00:00 00:00:00"),
            ascii_f(Tag::DateTimeDigitized, "2025:01:02 03:04:05"),
        ]);
        assert_eq!(taken_at(&ex2), None);
    }

    #[test]
    fn jpeg_app1提取与解析链路() {
        let tiff = build_tiff(&[ascii_f(Tag::Model, "TEST CAM")]);
        let mut jpg = vec![0xff, 0xd8];
        let seg_len = (2 + 6 + tiff.len()) as u16;
        jpg.extend_from_slice(&[0xff, 0xe1]);
        jpg.extend_from_slice(&seg_len.to_be_bytes());
        jpg.extend_from_slice(b"Exif\0\0");
        jpg.extend_from_slice(&tiff);
        jpg.extend_from_slice(&[0xff, 0xd9]);
        let ex = exif_from_jpeg_bytes(&jpg).unwrap();
        assert_eq!(exif_to_json(&ex)["camera"], "TEST CAM");
        assert!(exif_from_jpeg_bytes(b"not a jpeg").is_none());
    }

    #[test]
    fn 无exif图片返回空对象() {
        let dir = std::env::temp_dir().join("pixyang_exif_noexif");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("plain.jpg");
        image::DynamicImage::new_rgb8(8, 6).save(&p).unwrap();
        let v = exif_fields(&p).unwrap();
        for key in [
            "camera",
            "lens",
            "iso",
            "fNumber",
            "exposure",
            "focalLength",
            "dateTime",
            "focal35mm",
            "flash",
            "whiteBalance",
            "exposureProgram",
            "meteringMode",
            "exposureBias",
            "software",
            "artist",
            "copyright",
            "colorSpace",
            "sceneCapture",
        ] {
            assert_eq!(v[key], "", "字段 {key} 应为空");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 损坏文件回空对象_缺失文件报错() {
        let dir = std::env::temp_dir().join("pixyang_exif_broken");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("bad.jpg");
        std::fs::write(&p, b"\x00\x01\x02 broken").unwrap();
        let v = exif_fields(&p).unwrap();
        assert_eq!(v["camera"], "");
        assert_eq!(v["iso"], "");
        assert!(exif_fields(&dir.join("missing.jpg")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

// 渲染执行器（迁移接缝 5 阶段 3-2）：RenderSpec JSON → image-rs 解码 → 阶段调度 → 编码。
// 逐语义镜像 electron/render/renderSpecToSharp.cjs：仿射累积（白平衡/曝光/影调线性复合为单次
// linear）、非线性边界物化（curves/hsl/grading/saturation/masks/lens/detail 前先 flush）、
// 蒙版 pre-crop 坐标系、crop 经 geometry 映射 + 钳制、EXIF 经 exif_relay 注回产物。
// libvips 探测结论（NIGHTLY_LOG）：linear/gamma 对 uchar 均 truncate；gamma(1,g) =
// trunc(255·(x/255)^(1/g))。
// 已记录分歧（SEAM5_DECISION.md）：灰度源按 RGBA 解码；detail.sharpness 用近似 USM；
// ICC 不回接；非 90° 倍数旋转跳过；代理分辨率直接编码（无元数据回接，同 JS）。

use crate::error::PixError;
use crate::exif_relay::relay_exif_files;
use crate::render::{
    apply_color_grading_in_place, apply_hsl_in_place, apply_saturation_in_place,
    apply_vignette_in_place, build_curve_luts, normalize_masks,
};
use image::{DynamicImage, GenericImageView, RgbaImage};
use serde_json::Value;
use std::path::Path;

#[derive(Clone)]
pub struct BufferImage {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub channels: usize,
}

pub struct RenderOutput {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy)]
struct Affine {
    slope: [f64; 3],
    offset: [f64; 3],
}

impl Affine {
    fn identity() -> Self {
        Self {
            slope: [1.0; 3],
            offset: [0.0; 3],
        }
    }
    fn is_identity(&self) -> bool {
        self.slope == [1.0; 3] && self.offset == [0.0; 3]
    }
    fn mul(&self, a: f64, b: f64) -> Self {
        Self {
            slope: self.slope.map(|s| s * a),
            offset: self.offset.map(|o| a * o + b),
        }
    }
    fn mul_per_channel(&self, a: [f64; 3]) -> Self {
        let slope = [
            self.slope[0] * a[0],
            self.slope[1] * a[1],
            self.slope[2] * a[2],
        ];
        Self {
            slope,
            offset: self.offset,
        }
    }
}

/// libvips uchar 线性：截断 + 钳 0..255
fn linear_byte(x: u8, a: f64, b: f64) -> u8 {
    (x as f64 * a + b).clamp(0.0, 255.0).trunc() as u8
}

/// libvips gamma：trunc(255·(x/255)^(1/gamma_out))
fn gamma_byte(x: u8, gamma_out: f64) -> u8 {
    (255.0 * (x as f64 / 255.0).powf(1.0 / gamma_out)).trunc() as u8
}

fn apply_affine(buf: &mut [u8], affine: &Affine, channels: usize) {
    if affine.is_identity() {
        return;
    }
    let c_count = if channels >= 3 { 3 } else { 1 };
    let mut i = 0;
    while i + c_count <= buf.len() {
        for c in 0..c_count {
            buf[i + c] = linear_byte(buf[i + c], affine.slope[c], affine.offset[c]);
        }
        i += channels;
    }
}

fn apply_gamma(buf: &mut [u8], gamma_out: f64, channels: usize) {
    let c_count = if channels >= 3 { 3 } else { 1 };
    let mut i = 0;
    while i + c_count <= buf.len() {
        for c in 0..c_count {
            buf[i + c] = gamma_byte(buf[i + c], gamma_out);
        }
        i += channels;
    }
}

fn negate_linear(buf: &mut [u8], channels: usize) {
    let c_count = if channels >= 3 { 3 } else { 1 };
    let mut i = 0;
    while i + c_count <= buf.len() {
        for c in 0..c_count {
            buf[i + c] = linear_byte(buf[i + c], -1.0, 255.0);
        }
        i += channels;
    }
}

fn apply_curve_luts_in_place(data: &mut [u8], luts: &crate::render::CurveLuts, channels: usize) {
    if channels < 3 {
        return;
    }
    let mut i = 0;
    while i + 2 < data.len() {
        data[i] = luts.r[data[i] as usize];
        data[i + 1] = luts.g[data[i + 1] as usize];
        data[i + 2] = luts.b[data[i + 2] as usize];
        i += channels;
    }
}

fn has_hsl_data(v: &Value) -> bool {
    for key in ["hue", "sat", "lum"] {
        if let Some(arr) = v.get(key).and_then(|x| x.as_array()) {
            if arr
                .iter()
                .any(|n| n.as_f64().map(|f| f != 0.0).unwrap_or(false))
            {
                return true;
            }
        }
    }
    false
}

/// 近似 USM：out = clamp(x + (x − blur) × k)，blur 为 sigma 缩放的高斯。
/// 与 libvips sharpen 算法不同源（SEAM5_DECISION.md 分歧项），golden 若含 detail 需重锁。
fn apply_unsharp_approx(
    data: &mut [u8],
    width: u32,
    height: u32,
    sigma: f64,
    channels: usize,
) -> Result<(), PixError> {
    let img = RgbaImage::from_raw(width, height, data.to_vec())
        .ok_or_else(|| PixError::Io("buffer 尺寸不匹配".into()))?;
    let blurred = DynamicImage::from(img.clone()).blur(sigma.max(0.1) as f32);
    let blur_rgba = blurred.to_rgba8();
    let k = 1.0;
    for (i, px) in data.chunks_exact_mut(channels).enumerate() {
        for c in 0..3.min(channels) {
            let x = px[c] as f64;
            let b = blur_rgba.get_pixel(i as u32 % width, (i as u32) / width).0[c] as f64;
            px[c] = (x + (x - b) * k).clamp(0.0, 255.0).round() as u8;
        }
    }
    Ok(())
}

fn apply_geometry(
    p: &mut BufferImage,
    rotate: f64,
    flip_h: bool,
    flip_v: bool,
) -> Result<(), PixError> {
    // 镜像 sharp rotate(θ).flip().flop() 的实测语义：先翻转后旋转（T = R∘F）
    use image::imageops;
    let img = RgbaImage::from_raw(p.width, p.height, p.data.clone())
        .ok_or_else(|| PixError::Io("buffer 尺寸不匹配".into()))?;
    let mut out: DynamicImage = DynamicImage::from(img);
    if flip_v {
        out = DynamicImage::from(imageops::flip_vertical(&out));
    }
    if flip_h {
        out = DynamicImage::from(imageops::flip_horizontal(&out));
    }
    let rot = ((rotate.round() as i64 % 360) + 360) % 360;
    out = match rot {
        90 => DynamicImage::from(imageops::rotate90(&out)),
        180 => DynamicImage::from(imageops::rotate180(&out)),
        270 => DynamicImage::from(imageops::rotate270(&out)),
        other => {
            if other != 0 {
                eprintln!(
                    "[render] 非 90° 倍数旋转（{other}°）暂不支持，已跳过（参数保留在 spec 中）"
                );
            }
            out
        }
    };
    p.width = out.dimensions().0;
    p.height = out.dimensions().1;
    p.data = out.to_rgba8().into_raw();
    Ok(())
}

fn crop_in_place(p: &mut BufferImage, left: u32, top: u32, w: u32, h: u32) -> Result<(), PixError> {
    let img = RgbaImage::from_raw(p.width, p.height, p.data.clone())
        .ok_or_else(|| PixError::Io("buffer 尺寸不匹配".into()))?;
    let cropped = image::imageops::crop_imm(&img, left, top, w, h).to_image();
    p.width = w;
    p.height = h;
    p.data = cropped.into_raw();
    Ok(())
}

fn resize_inside_no_enlarge(p: &BufferImage, max_side: u32) -> BufferImage {
    let long = p.width.max(p.height);
    if long <= max_side {
        return p.clone();
    }
    let img = RgbaImage::from_raw(p.width, p.height, p.data.clone()).expect("buffer 尺寸匹配");
    let scaled =
        DynamicImage::from(img).resize(max_side, max_side, image::imageops::FilterType::Lanczos3);
    BufferImage {
        data: scaled.to_rgba8().into_raw(),
        width: scaled.dimensions().0,
        height: scaled.dimensions().1,
        channels: 4,
    }
}

/// 底图（geometry 前）裁剪矩形 → 变换后坐标系。翻转先于旋转（T = R∘F，与执行器几何同序）
fn map_crop_through_geometry(
    p: &Value,
    base_w: u32,
    base_h: u32,
    rotate: f64,
    flip_h: bool,
    flip_v: bool,
) -> Value {
    let get = |k: &str| p.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
    let (mut x, mut y, mut w, mut h) = (get("x"), get("y"), get("w"), get("h"));
    let (mut bw, mut bh) = (base_w as f64, base_h as f64);
    if flip_v {
        y = bh - y - h;
    }
    if flip_h {
        x = bw - x - w;
    }
    let rot = ((rotate.round() as i64 % 360) + 360) % 360;
    if rot == 90 || rot == 270 {
        let nx = if rot == 90 { bh - y - h } else { y };
        let ny = if rot == 90 { x } else { bw - x - w };
        x = nx;
        y = ny;
        std::mem::swap(&mut w, &mut h);
        std::mem::swap(&mut bw, &mut bh);
    } else if rot == 180 {
        x = bw - x - w;
        y = bh - y - h;
    }
    serde_json::json!({ "x": x, "y": y, "w": w, "h": h })
}

/// 裁剪矩形按当前图像尺寸钳制：优先保留尺寸拉回边界内，尺寸超图收敛到图像大小
fn clamp_crop(p: &Value, img_w: u32, img_h: u32) -> Option<(u32, u32, u32, u32)> {
    if img_w < 1 || img_h < 1 {
        return None;
    }
    let get = |k: &str| p.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
    let width = (get("w").round() as i64).clamp(1, img_w as i64) as u32;
    let height = (get("h").round() as i64).clamp(1, img_h as i64) as u32;
    let left = (get("x").round() as i64).clamp(0, img_w as i64 - width as i64) as u32;
    let top = (get("y").round() as i64).clamp(0, img_h as i64 - height as i64) as u32;
    Some((left, top, width, height))
}

fn flush_affine(
    pixels: &mut Option<BufferImage>,
    affine: &mut Affine,
    input: &Path,
) -> Result<(), PixError> {
    if affine.is_identity() {
        *affine = Affine::identity();
        return Ok(());
    }
    // JS flushAffine 语义：仿射待应用时从原图物化像素再应用——不得静默丢弃 pending 仿射
    ensure_decoded(pixels, input)?;
    if let Some(p) = pixels.as_mut() {
        apply_affine(&mut p.data, affine, p.channels);
    }
    *affine = Affine::identity();
    Ok(())
}

fn guess_format(output: &Path) -> &'static str {
    match output
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
    {
        Some(e) if e == "png" => "png",
        Some(e) if e == "tiff" => "tiff",
        Some(e) if e == "webp" => "webp",
        _ => "jpeg",
    }
}

fn clamp_int(v: Option<f64>, min: i64, max: i64, default: i64) -> i64 {
    match v {
        Some(n) if n.is_finite() => (n.round() as i64).clamp(min, max),
        _ => default,
    }
}

fn encode_buffer(
    p: &BufferImage,
    format: &str,
    quality: i64,
    resize_w: Option<u64>,
    resize_h: Option<u64>,
) -> Result<Vec<u8>, PixError> {
    let img = RgbaImage::from_raw(p.width, p.height, p.data.clone())
        .ok_or_else(|| PixError::Io("buffer 尺寸不匹配".into()))?;
    let mut dyn_img = DynamicImage::from(img);
    // encode.resize：fit inside，不放大（镜像 encodeStage.params.resize）
    if let Some(_w) = resize_w.or(resize_h) {
        let target_w = resize_w.map(|x| x as u32);
        let target_h = resize_h.map(|x| x as u32);
        let (sw, sh) = dyn_img.dimensions();
        let scale_w = target_w
            .map(|tw| tw as f64 / sw as f64)
            .unwrap_or(f64::INFINITY);
        let scale_h = target_h
            .map(|th| th as f64 / sh as f64)
            .unwrap_or(f64::INFINITY);
        let scale = scale_w.min(scale_h);
        if scale < 1.0 {
            let nw = ((sw as f64 * scale).round() as u32).max(1);
            let nh = ((sh as f64 * scale).round() as u32).max(1);
            dyn_img = dyn_img.resize_exact(nw, nh, image::imageops::FilterType::Lanczos3);
        }
    }
    let mut out = std::io::Cursor::new(Vec::new());
    match format {
        "png" => {
            dyn_img
                .write_to(&mut out, image::ImageFormat::Png)
                .map_err(|e| PixError::Io(format!("PNG 编码失败: {e}")))?;
        }
        "webp" => {
            use image::ImageEncoder;
            let encoder = image::codecs::webp::WebPEncoder::new_lossless(&mut out);
            let rgba = dyn_img.to_rgba8();
            encoder
                .write_image(
                    rgba.as_raw(),
                    rgba.width(),
                    rgba.height(),
                    image::ExtendedColorType::Rgba8,
                )
                .map_err(|e| PixError::Io(format!("WebP 编码失败: {e}")))?;
        }
        "tiff" => {
            dyn_img
                .write_to(&mut out, image::ImageFormat::Tiff)
                .map_err(|e| PixError::Io(format!("TIFF 编码失败: {e}")))?;
        }
        _ => {
            let rgba = dyn_img.to_rgba8();
            let mut flat = image::RgbImage::new(rgba.width(), rgba.height());
            for (x, y, px) in rgba.enumerate_pixels() {
                let a = px.0[3] as f32 / 255.0;
                let blend = |c: u8| (c as f32 * a + 255.0 * (1.0 - a)).round() as u8;
                flat.put_pixel(
                    x,
                    y,
                    image::Rgb([blend(px.0[0]), blend(px.0[1]), blend(px.0[2])]),
                );
            }
            let encoder =
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality as u8);
            flat.write_with_encoder(encoder)
                .map_err(|e| PixError::Io(format!("JPEG 编码失败: {e}")))?;
        }
    }
    Ok(out.into_inner())
}

fn write_encoded(
    pixels: Option<&BufferImage>,
    input: &Path,
    output: &Path,
    format: &str,
    quality: i64,
    resize_w: Option<u64>,
    resize_h: Option<u64>,
) -> Result<(), PixError> {
    let bytes = match pixels {
        Some(p) => encode_buffer(p, format, quality, resize_w, resize_h)?,
        None => std::fs::read(input).map_err(|e| PixError::Io(format!("读取原图失败: {e}")))?,
    };
    // 原子落盘：part 文件 + fsync + rename（烘焙/导出不可逆替换，掉电不留半文件）
    let part = {
        let mut s = output.as_os_str().to_os_string();
        s.push(".part");
        std::path::PathBuf::from(s)
    };
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&part)
            .map_err(|e| PixError::Io(format!("创建临时文件失败: {e}")))?;
        f.write_all(&bytes)
            .map_err(|e| PixError::Io(format!("写入失败: {e}")))?;
        f.sync_all()
            .map_err(|e| PixError::Io(format!("fsync 失败: {e}")))?;
    }
    std::fs::rename(&part, output).map_err(|e| PixError::Io(format!("原子替换失败: {e}")))?;
    // EXIF 回接：源/产物同格式时把原图 EXIF 注入产物（镜像 keepExif/composite 元数据行为）
    relay_exif_files(input, output)?;
    Ok(())
}

pub fn render_spec_to_file(
    spec: &Value,
    input: &Path,
    output: &Path,
) -> Result<RenderOutput, PixError> {
    if spec.get("specVersion").and_then(|v| v.as_i64()) != Some(1) {
        return Err(PixError::Io("[render] spec 或 specVersion 非法".into()));
    }
    let stages = spec
        .get("stages")
        .and_then(|s| s.as_array())
        .ok_or_else(|| PixError::Io("[render] spec.stages 缺失或不是数组".into()))?;

    let (mut width, mut height) = {
        let img = image::ImageReader::open(input)
            .map_err(|e| PixError::Io(format!("底图读取失败: {e}")))?
            .with_guessed_format()
            .map_err(|e| PixError::Io(format!("识别格式失败: {e}")))?
            .into_dimensions()
            .map_err(|e| PixError::Io(format!("解码失败: {e}")))?;
        (img.0, img.1)
    };
    let mut pixels: Option<BufferImage> = None;
    let mut affine = Affine::identity();
    let mut base_geom: Option<(u32, u32, f64, bool, bool)> = None;
    let mut effective_crop: Option<(u32, u32, u32, u32)> = None;

    for stage in stages {
        let kind = stage.get("kind").and_then(|k| k.as_str()).unwrap_or("");
        let params = stage.get("params").cloned().unwrap_or(Value::Null);
        match kind {
            "decode" => {
                if let Some(edge) = params.get("proxyLongEdge").and_then(|v| v.as_u64()) {
                    ensure_decoded(&mut pixels, input)?;
                    let p = pixels.as_mut().unwrap();
                    *p = resize_inside_no_enlarge(p, edge as u32);
                    width = p.width;
                    height = p.height;
                }
            }
            "whiteBalance" => {
                let temp = params.get("temp").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let tint = params.get("tint").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if temp != 0.0 || tint != 0.0 {
                    let tk = temp / 100.0;
                    let gk = tint / 100.0;
                    affine =
                        affine.mul_per_channel([1.0 + tk * 0.1, 1.0 - gk * 0.06, 1.0 - tk * 0.1]);
                }
            }
            "exposure" => {
                let ev = params.get("ev").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if ev != 0.0 {
                    affine = affine.mul((2.0f64).powf(ev), 0.0);
                }
            }
            "tone" => {
                let g = |k: &str| params.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
                let (contrast, highlights, shadows, whites, blacks) = (
                    g("contrast"),
                    g("highlights"),
                    g("shadows"),
                    g("whites"),
                    g("blacks"),
                );
                if contrast == 0.0
                    && highlights == 0.0
                    && shadows == 0.0
                    && whites == 0.0
                    && blacks == 0.0
                {
                    continue;
                }
                let cf = 1.0 + contrast / 50.0;
                let whites_f = 1.0 + whites / 250.0;
                let blacks_off = -blacks * 0.35;
                affine = affine.mul(whites_f * cf, cf * blacks_off + 127.5 * (1.0 - cf));
                let highlight_slope = if highlights != 0.0 {
                    (1.0 - highlights / 400.0).clamp(0.75, 1.15)
                } else {
                    1.0
                };
                if shadows == 0.0 {
                    if highlight_slope != 1.0 {
                        affine = affine.mul(highlight_slope, 0.0);
                    }
                    continue;
                }
                flush_affine(&mut pixels, &mut affine, input)?;
                ensure_decoded(&mut pixels, input)?;
                let p = pixels.as_mut().unwrap();
                if shadows > 0.0 {
                    let e = (1.0 - shadows / 220.0).clamp(0.55, 1.0);
                    apply_gamma(&mut p.data, 1.0 / e, p.channels);
                    if highlight_slope != 1.0 {
                        affine = Affine::identity().mul(highlight_slope, 0.0);
                    }
                } else {
                    let e = (1.0 + (-shadows) / 220.0).clamp(1.0, 1.45);
                    negate_linear(&mut p.data, p.channels);
                    apply_gamma(&mut p.data, e, p.channels);
                    affine = if highlight_slope != 1.0 {
                        Affine {
                            slope: [-highlight_slope; 3],
                            offset: [255.0 * highlight_slope; 3],
                        }
                    } else {
                        Affine {
                            slope: [-1.0; 3],
                            offset: [255.0; 3],
                        }
                    };
                }
            }
            "curves" => {
                let Some(luts) = build_curve_luts(&params) else {
                    continue;
                };
                flush_affine(&mut pixels, &mut affine, input)?;
                ensure_decoded(&mut pixels, input)?;
                let p = pixels.as_mut().unwrap();
                apply_curve_luts_in_place(&mut p.data, &luts, p.channels);
            }
            "hsl" => {
                if !has_hsl_data(&params) {
                    continue;
                }
                flush_affine(&mut pixels, &mut affine, input)?;
                ensure_decoded(&mut pixels, input)?;
                let p = pixels.as_mut().unwrap();
                apply_hsl_in_place(&mut p.data, &params, p.channels);
            }
            "colorGrading" => {
                if crate::render::build_grade_luts(&params).is_empty() {
                    continue;
                }
                flush_affine(&mut pixels, &mut affine, input)?;
                ensure_decoded(&mut pixels, input)?;
                let p = pixels.as_mut().unwrap();
                apply_color_grading_in_place(&mut p.data, &params, p.channels);
            }
            "saturation" => {
                let mono = params
                    .get("mono")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let value = params.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if !mono && value == 0.0 {
                    continue;
                }
                flush_affine(&mut pixels, &mut affine, input)?;
                ensure_decoded(&mut pixels, input)?;
                let p = pixels.as_mut().unwrap();
                apply_saturation_in_place(&mut p.data, &params, p.channels);
            }
            "masks" => {
                let list = params.get("list").cloned().unwrap_or(Value::Null);
                let masks = normalize_masks(&list);
                if masks.is_empty() {
                    continue;
                }
                flush_affine(&mut pixels, &mut affine, input)?;
                ensure_decoded(&mut pixels, input)?;
                let p = pixels.as_mut().unwrap();
                crate::render::apply_masks_in_place(
                    &mut p.data,
                    p.width as usize,
                    p.height as usize,
                    &masks,
                    p.channels,
                );
            }
            "detail" => {
                let sharpness = params
                    .get("sharpness")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let noise = params.get("noise").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if noise != 0.0 {
                    eprintln!("[render] 降噪（detail.noise）尚未实现，已跳过");
                }
                if sharpness > 0.0 {
                    flush_affine(&mut pixels, &mut affine, input)?;
                    ensure_decoded(&mut pixels, input)?;
                    let p = pixels.as_mut().unwrap();
                    apply_unsharp_approx(
                        &mut p.data,
                        p.width,
                        p.height,
                        0.8 + sharpness / 50.0,
                        p.channels,
                    )?;
                }
            }
            "lens" => {
                let vignette = params
                    .get("vignette")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                if vignette == 0.0 {
                    continue;
                }
                flush_affine(&mut pixels, &mut affine, input)?;
                ensure_decoded(&mut pixels, input)?;
                let p = pixels.as_mut().unwrap();
                apply_vignette_in_place(
                    &mut p.data,
                    p.width as usize,
                    p.height as usize,
                    vignette,
                    p.channels,
                );
            }
            "geometry" => {
                flush_affine(&mut pixels, &mut affine, input)?;
                ensure_decoded(&mut pixels, input)?;
                let rotate = params.get("rotate").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let flip_h = params
                    .get("flipH")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let flip_v = params
                    .get("flipV")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if rotate % 360.0 != 0.0 || flip_h || flip_v {
                    base_geom = Some((width, height, rotate, flip_h, flip_v));
                    let p = pixels.as_mut().unwrap();
                    apply_geometry(p, rotate, flip_h, flip_v)?;
                    width = p.width;
                    height = p.height;
                }
            }
            "crop" => {
                flush_affine(&mut pixels, &mut affine, input)?;
                ensure_decoded(&mut pixels, input)?;
                let cw = params.get("w").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let ch = params.get("h").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if cw > 0.0 && ch > 0.0 {
                    let mapped = match base_geom {
                        Some((bw, bh, rotate, flip_h, flip_v)) => {
                            map_crop_through_geometry(&params, bw, bh, rotate, flip_h, flip_v)
                        }
                        None => params.clone(),
                    };
                    if let Some((left, top, c_width, c_height)) = clamp_crop(&mapped, width, height)
                    {
                        effective_crop = Some((left, top, c_width, c_height));
                        let p = pixels.as_mut().unwrap();
                        crop_in_place(p, left, top, c_width, c_height)?;
                        width = c_width;
                        height = c_height;
                    }
                }
            }
            "encode" => {
                flush_affine(&mut pixels, &mut affine, input)?;
                ensure_decoded(&mut pixels, input)?;
                let format = params
                    .get("format")
                    .and_then(|v| v.as_str())
                    .unwrap_or("jpeg");
                let quality = clamp_int(params.get("quality").and_then(|v| v.as_f64()), 1, 100, 92);
                let resize = params.get("resize");
                let resize_w = resize.and_then(|r| r.get("width")).and_then(|v| v.as_u64());
                let resize_h = resize
                    .and_then(|r| r.get("height"))
                    .and_then(|v| v.as_u64());
                if effective_crop.is_none() && base_geom.is_none() {
                    // 代理分辨率渲染（decode.proxyLongEdge）：直接编码代理像素，无元数据回接
                    let _ = proxy_marker();
                }
                write_encoded(
                    pixels.as_ref(),
                    input,
                    output,
                    format,
                    quality,
                    resize_w,
                    resize_h,
                )?;
                return Ok(RenderOutput { width, height });
            }
            other => {
                return Err(PixError::Io(format!("[render] 未登记的渲染阶段: {other}")));
            }
        }
    }
    flush_affine(&mut pixels, &mut affine, input)?;
    let format = guess_format(output);
    write_encoded(pixels.as_ref(), input, output, format, 92, None, None)?;
    Ok(RenderOutput { width, height })
}

fn proxy_marker() {}

fn ensure_decoded(pixels: &mut Option<BufferImage>, input: &Path) -> Result<(), PixError> {
    if pixels.is_none() {
        let img = image::ImageReader::open(input)
            .map_err(|e| PixError::Io(format!("底图读取失败: {e}")))?
            .with_guessed_format()
            .map_err(|e| PixError::Io(format!("识别格式失败: {e}")))?
            .decode()
            .map_err(|e| PixError::Io(format!("解码失败: {e}")))?;
        let (w, h) = img.dimensions();
        *pixels = Some(BufferImage {
            data: img.to_rgba8().into_raw(),
            width: w,
            height: h,
            channels: 4,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_test_png(path: &std::path::Path, pixels: &[u8], w: u32, h: u32) {
        let mut img = RgbaImage::new(w, h);
        for (i, (_, _, px)) in img.enumerate_pixels_mut().enumerate() {
            px.0 = [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2], 255];
        }
        image::DynamicImage::from(img).save(path).unwrap();
    }

    fn read_pixels(path: &std::path::Path) -> Vec<u8> {
        image::ImageReader::open(path)
            .unwrap()
            .with_guessed_format()
            .unwrap()
            .decode()
            .unwrap()
            .to_rgba8()
            .into_raw()
    }

    const PIXELS: [u8; 36] = [
        0, 5, 10, 15, 50, 100, 101, 150, 200, 250, 255, 1, 2, 3, 4, 6, 12, 24, 48, 96, 128, 160,
        192, 224, 30, 60, 90, 120, 140, 170, 210, 240, 8, 16, 32, 64,
    ];

    #[test]
    fn 曝光1ev_仿射trunc语义_png无损() {
        let dir = std::env::temp_dir().join("pixyang_exec_exp");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("in.png");
        let out = dir.join("out.png");
        write_test_png(&src, &PIXELS, 9, 1);
        let spec: Value = serde_json::from_str(
            r#"{"specVersion":1,"stages":[
                {"kind":"exposure","params":{"ev":1}},
                {"kind":"encode","params":{"format":"png"}}]}"#,
        )
        .unwrap();
        render_spec_to_file(&spec, &src, &out).unwrap();
        let got = read_pixels(&out);
        for (bi, &x) in PIXELS.iter().enumerate() {
            if bi % 4 == 3 {
                continue; // alpha 不参与仿射（sharp linear 3 值仅作用 RGB）
            }
            let expected = (x as f64 * 2.0).clamp(0.0, 255.0).trunc() as u8;
            assert_eq!(got[bi], expected, "字节 {bi} 曝光不符");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 阴影提升_gamma_trunc与libvips探测表一致() {
        let dir = std::env::temp_dir().join("pixyang_exec_gamma");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("in.png");
        let out = dir.join("out.png");
        // 探测表的 16 个输入值（NIGHTLY_LOG gamma(1,2) ⇔ shadows=110 → e=0.5）
        let vals: [u8; 16] = [
            0, 5, 10, 15, 50, 100, 101, 150, 200, 250, 255, 1, 2, 3, 4, 6,
        ];
        let mut px = Vec::new();
        for &v in &vals {
            px.extend_from_slice(&[v, v, v, 255]);
        }
        write_test_png(&src, &px, 16, 1);
        let spec: Value = serde_json::from_str(
            r#"{"specVersion":1,"stages":[
                {"kind":"tone","params":{"shadows":110}},
                {"kind":"encode","params":{"format":"png"}}]}"#,
        )
        .unwrap();
        render_spec_to_file(&spec, &src, &out).unwrap();
        let got = read_pixels(&out);
        // 与 libvips 实测（node 探测 gamma(1,1/0.55)，NIGHTLY_LOG）逐值一致：
        // trunc(255·(x/255)^0.55)——shadows=110 时指数被 clampNum(…, 0.55, 1) 钳到 0.55
        let libvips: [u8; 16] = [
            0, 29, 42, 53, 104, 152, 153, 190, 223, 252, 255, 12, 17, 22, 25, 32,
        ];
        for i in 0..16 {
            assert_eq!(
                got[i * 4],
                libvips[i],
                "gamma 阴影提升 像素 {i} 与 libvips 不符"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 几何rot90_flip与crop映射() {
        let dir = std::env::temp_dir().join("pixyang_exec_geom");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("in.png");
        // 2×1：左红 (255,0,0)，右蓝 (0,0,255)
        write_test_png(&src, &[255, 0, 0, 255, 0, 0, 255, 255], 2, 1);
        let out = dir.join("out.png");
        let spec: Value = serde_json::from_str(
            r#"{"specVersion":1,"stages":[
                {"kind":"geometry","params":{"rotate":90}},
                {"kind":"crop","params":{"x":0,"y":0,"w":1,"h":1}},
                {"kind":"encode","params":{"format":"png"}}]}"#,
        )
        .unwrap();
        render_spec_to_file(&spec, &src, &out).unwrap();
        let got = read_pixels(&out);
        assert_eq!(got.len(), 4);
        // rot90 后 2×1 → 1×2：顶=左红下=右蓝；crop 左上 1×1 → 红
        assert_eq!(&got[..3], &[255, 0, 0]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 裁剪超尺寸钳制到图像大小() {
        let dir = std::env::temp_dir().join("pixyang_exec_clamp");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("in.png");
        write_test_png(&src, &PIXELS, 9, 1);
        let out = dir.join("out.png");
        let spec: Value = serde_json::from_str(
            r#"{"specVersion":1,"stages":[
                {"kind":"crop","params":{"x":-50,"y":-50,"w":500,"h":500}},
                {"kind":"encode","params":{"format":"png"}}]}"#,
        )
        .unwrap();
        let r = render_spec_to_file(&spec, &src, &out).unwrap();
        assert_eq!((r.width, r.height), (9, 1));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn exif回接_源APP1进入渲染产物() {
        use crate::exif_relay::{inject_jpeg_exif, jpeg_exif_segments};
        let dir = std::env::temp_dir().join("pixyang_exec_exif");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let plain = encode_buffer(
            &BufferImage {
                data: PIXELS[..12].to_vec(),
                width: 3,
                height: 1,
                channels: 4,
            },
            "jpeg",
            92,
            None,
            None,
        )
        .unwrap();
        let with_exif = inject_jpeg_exif(&plain, &[b"Exif\0\0MM\x00\x2a-test".to_vec()]);
        let src = dir.join("in.jpg");
        let out = dir.join("out.jpg");
        std::fs::write(&src, &with_exif).unwrap();
        let spec: Value = serde_json::from_str(
            r#"{"specVersion":1,"stages":[
                {"kind":"exposure","params":{"ev":0.3}},
                {"kind":"encode","params":{"format":"jpeg","quality":100}}]}"#,
        )
        .unwrap();
        render_spec_to_file(&spec, &src, &out).unwrap();
        let out_bytes = std::fs::read(&out).unwrap();
        assert!(!jpeg_exif_segments(&out_bytes).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

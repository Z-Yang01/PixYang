// 渲染像素内核（迁移接缝 5 阶段 3）：shared/*.cjs 各阶段原位函数的 Rust 直译。
// 数值语义逐行镜像（含 JS Number 强转/`|| 0`/Math.round 非负域等价 round-half-up），
// 测试用 node 跑真实 shared 函数生成的对拍向量逐字节校验（tests/render_vectors.json）。
// 参数以 serde_json::Value 传入（镜像 JS 的动态归一化行为），执行器直接透传 spec.stages.params。

use serde_json::Value;

fn clamp01(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

fn clamp255(v: f64) -> f64 {
    v.clamp(0.0, 255.0)
}

fn num_or(v: Option<&Value>, fallback: f64) -> f64 {
    v.and_then(|x| x.as_f64()).unwrap_or(fallback)
}

// ── 饱和度/黑白（shared/saturation.cjs） ──

const SATURATION_LUMA: [f64; 3] = [0.213, 0.715, 0.072];
const HSL_LUMA: [f64; 3] = [0.2126, 0.7152, 0.0722];

pub fn sat_factor(params: &Value) -> f64 {
    let mono = params
        .get("mono")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if mono {
        return 0.0;
    }
    match params.get("value").and_then(|v| v.as_f64()) {
        Some(v) => 1.0 + v.clamp(-100.0, 100.0) / 100.0,
        None => 1.0,
    }
}

pub fn apply_saturation_in_place(data: &mut [u8], params: &Value, channels: usize) {
    let k = sat_factor(params);
    if k == 1.0 || channels < 3 {
        return;
    }
    let mut i = 0;
    while i + 2 < data.len() {
        let (r, g, b) = (data[i] as f64, data[i + 1] as f64, data[i + 2] as f64);
        let y = SATURATION_LUMA[0] * r + SATURATION_LUMA[1] * g + SATURATION_LUMA[2] * b;
        data[i] = (y + (r - y) * k).clamp255_round();
        data[i + 1] = (y + (g - y) * k).clamp255_round();
        data[i + 2] = (y + (b - y) * k).clamp255_round();
        i += channels;
    }
}

trait Round255 {
    fn clamp255_round(self) -> u8;
}
impl Round255 for f64 {
    fn clamp255_round(self) -> u8 {
        clamp255(self).round() as u8
    }
}

// ── 暗角（shared/lens.cjs） ──

fn vignette_falloff(d: f64) -> f64 {
    ((d - 0.5) / 0.5).clamp(0.0, 1.0)
}

/// 镜头几何校正：径向畸变（k）+ 横向色散（ca）逆映射，双线性采样。
/// 语义与 shared/lens.cjs lensGeomScale 同式（半宽/半高椭圆归一；色散随 r² 增长）。
/// 逐像素逐通道独立采样（R/G/B 各自半径），src 出界钳到边界。全零参数恒等。
pub fn apply_lens_geometry_in_place(
    data: &mut [u8],
    width: usize,
    height: usize,
    distortion: f64,
    chromatic: f64,
    channels: usize,
) {
    let d = distortion.clamp(-100.0, 100.0);
    let ca = chromatic.clamp(-100.0, 100.0);
    let k = (d / 100.0) * 0.25;
    let caf = (ca / 100.0) * 0.01;
    if (k == 0.0 && caf == 0.0) || width < 2 || height < 2 || channels < 3 {
        return;
    }
    let src = data.to_vec();
    let half_w = width as f64 / 2.0;
    let half_h = height as f64 / 2.0;
    let c_count = 3.min(channels);
    let at = |x: usize, y: usize, c: usize| src[(y * width + x) * channels + c] as f64;
    for y in 0..height {
        let ny = (y as f64 + 0.5 - half_h) / half_h;
        for x in 0..width {
            let nx = (x as f64 + 0.5 - half_w) / half_w;
            let r2 = nx * nx + ny * ny;
            let i = (y * width + x) * channels;
            for c in 0..c_count {
                // 通道缩放因子（lensGeomScale 同式）
                let radial = 1.0 + k * r2;
                let scale = match c {
                    0 => radial * (1.0 + caf * r2),
                    2 => radial * (1.0 - caf * r2),
                    _ => radial,
                };
                // 源位置（椭圆归一空间缩放后转回像素坐标）
                let sx = nx * scale * half_w + half_w - 0.5;
                let sy = ny * scale * half_h + half_h - 0.5;
                // 出界填不透明黑（与拉直 rotate_by_angle 同口径 [0,0,0,255]）：
                // 校正产生的边缘空白由用户裁剪去除
                if sx < 0.0 || sy < 0.0 || sx > (width - 1) as f64 || sy > (height - 1) as f64 {
                    data[i + c] = 0;
                    // RGBA 出界补 alpha=255：此前保留源 alpha，透明源图出界区非「不透明黑」，
                    // 与同段注释及 rotate_by_angle 填充口径漂移（R85）
                    if channels == 4 {
                        data[i + 3] = 255;
                    }
                    continue;
                }
                let x0 = sx.floor() as usize;
                let y0 = sy.floor() as usize;
                let x1 = (x0 + 1).min(width - 1);
                let y1 = (y0 + 1).min(height - 1);
                let fx = (sx - x0 as f64).clamp(0.0, 1.0);
                let fy = (sy - y0 as f64).clamp(0.0, 1.0);
                let top = at(x0, y0, c) * (1.0 - fx) + at(x1, y0, c) * fx;
                let bot = at(x0, y1, c) * (1.0 - fx) + at(x1, y1, c) * fx;
                data[i + c] = (top * (1.0 - fy) + bot * fy).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

pub fn apply_vignette_in_place(
    data: &mut [u8],
    width: usize,
    height: usize,
    vignette: f64,
    channels: usize,
) {
    let v = vignette.clamp(-100.0, 100.0);
    if v == 0.0 || width == 0 || height == 0 {
        return;
    }
    let half_w = width as f64 / 2.0;
    let half_h = height as f64 / 2.0;
    let k = v / 100.0;
    for y in 0..height {
        let ny = (y as f64 + 0.5 - half_h) / half_h;
        for x in 0..width {
            let nx = (x as f64 + 0.5 - half_w) / half_w;
            let falloff = vignette_falloff((nx * nx + ny * ny).sqrt());
            if falloff <= 0.0 {
                continue;
            }
            let i = (y * width + x) * channels;
            let c_count = if channels >= 3 { 3 } else { 1 };
            if v < 0.0 {
                let factor = 1.0 + k * falloff;
                for c in 0..c_count {
                    data[i + c] = (data[i + c] as f64 * factor).round() as u8;
                }
            } else {
                let t = k * falloff;
                for c in 0..c_count {
                    let px = data[i + c] as f64;
                    data[i + c] = (px + t * (255.0 - px)).round() as u8;
                }
            }
        }
    }
}

// ── 颜色分级（shared/colorGrading.cjs） ──

fn normalize_range(v: Option<&Value>) -> Option<(f64, f64)> {
    let arr = v?.as_array()?;
    if arr.len() < 2 {
        return None;
    }
    let hue = arr[0].as_f64()?;
    let sat = arr[1].as_f64()?;
    let h = hue.rem_euclid(360.0);
    Some((h, sat.clamp(0.0, 100.0)))
}

fn tint_rgb(hue: f64) -> [f64; 3] {
    let h = hue.rem_euclid(360.0) / 60.0;
    let i = h.floor();
    let f = h - i;
    match i as usize % 6 {
        0 => [1.0, f, 0.0],
        1 => [1.0 - f, 1.0, 0.0],
        2 => [0.0, 1.0, f],
        3 => [0.0, 1.0 - f, 1.0],
        4 => [f, 0.0, 1.0],
        _ => [1.0, 0.0, 1.0 - f],
    }
}

pub fn weight_for(range: GradeKey, l: f64) -> f64 {
    let w = match range {
        GradeKey::Shadows => (1.0 - l / 0.5).clamp(0.0, 1.0),
        GradeKey::Highlights => ((l - 0.5) / 0.5).clamp(0.0, 1.0),
        GradeKey::Midtones => (1.0 - (l - 0.5).abs() / 0.35).clamp(0.0, 1.0),
    };
    w * w
}

#[derive(Clone, Copy)]
pub enum GradeKey {
    Shadows,
    Midtones,
    Highlights,
}

pub struct GradeRange {
    pub key: GradeKey,
    pub scale: f64,
    pub delta: [f64; 3],
    pub lum_delta: f64,
}

pub fn build_grade_luts(grading: &Value) -> Vec<GradeRange> {
    let keys = [
        (GradeKey::Shadows, "shadows"),
        (GradeKey::Midtones, "midtones"),
        (GradeKey::Highlights, "highlights"),
    ];
    let mut ranges = Vec::new();
    for (key, name) in keys {
        if let Some((hue, sat)) = normalize_range(grading.get(name)) {
            if sat <= 0.0 {
                continue;
            }
            let rgb = tint_rgb(hue);
            let scale = (sat / 100.0) * 60.0;
            let delta = [rgb[0] - 0.5, rgb[1] - 0.5, rgb[2] - 0.5];
            let lum_delta = 0.2126 * delta[0] + 0.7152 * delta[1] + 0.0722 * delta[2];
            ranges.push(GradeRange {
                key,
                scale,
                delta,
                lum_delta,
            });
        }
    }
    ranges
}

pub fn apply_color_grading_in_place(data: &mut [u8], grading: &Value, channels: usize) {
    let luts = build_grade_luts(grading);
    if luts.is_empty() {
        return;
    }
    if channels < 3 {
        let stride = if channels == 2 { 2 } else { 1 };
        let mut i = 0;
        while i < data.len() {
            let l = data[i] as f64 / 255.0;
            let mut d = 0.0;
            for r in &luts {
                d += weight_for(r.key, l) * r.scale * r.lum_delta;
            }
            data[i] = (data[i] as f64 + d).clamp255_round();
            i += stride;
        }
        return;
    }
    let mut i = 0;
    while i + 2 < data.len() {
        let l =
            (0.2126 * data[i] as f64 + 0.7152 * data[i + 1] as f64 + 0.0722 * data[i + 2] as f64)
                / 255.0;
        let (mut dr, mut dg, mut db) = (0.0, 0.0, 0.0);
        for r in &luts {
            let w = weight_for(r.key, l) * r.scale;
            if w <= 0.0 {
                continue;
            }
            dr += w * r.delta[0];
            dg += w * r.delta[1];
            db += w * r.delta[2];
        }
        data[i] = (data[i] as f64 + dr).clamp255_round();
        data[i + 1] = (data[i + 1] as f64 + dg).clamp255_round();
        data[i + 2] = (data[i + 2] as f64 + db).clamp255_round();
        i += channels;
    }
}

// ── HSL 8 色相带（shared/hsl.cjs） ──

const HSL_BANDS: [f64; 8] = [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0];
const BAND_RADIUS: f64 = 60.0;
const HUE_MAX_DEG: f64 = 30.0;
const LUM_MAX: f64 = 0.3;

fn wrap_deg(v: f64) -> f64 {
    v.rem_euclid(360.0)
}

fn normalize_channel(v: Option<&Value>) -> [f64; 8] {
    let mut out = [0.0f64; 8];
    if let Some(arr) = v.and_then(|x| x.as_array()) {
        for (i, item) in arr.iter().take(8).enumerate() {
            if let Some(n) = item.as_f64() {
                out[i] = n.clamp(-100.0, 100.0);
            }
        }
    }
    out
}

fn band_weight(center_deg: f64, hue_deg: f64) -> f64 {
    let mut d = wrap_deg(hue_deg - center_deg).abs();
    if d > 180.0 {
        d = 360.0 - d;
    }
    (1.0 - d / BAND_RADIUS).max(0.0)
}

fn weighted_adjust(adj: &[f64; 8], hue_deg: f64) -> f64 {
    let mut sum = 0.0;
    let mut wsum = 0.0;
    for (i, &center) in HSL_BANDS.iter().enumerate() {
        let w = band_weight(center, hue_deg);
        if w <= 0.0 {
            continue;
        }
        wsum += w;
        sum += adj[i] * w;
    }
    if wsum > 0.0 {
        sum / wsum
    } else {
        0.0
    }
}

fn rgb_to_hsl(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let max = r.max(g.max(b));
    let min = r.min(g.min(b));
    let l = (max + min) / 2.0;
    if max == min {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.0 && l < 1.0 {
        d / (1.0 - (2.0 * l - 1.0).abs())
    } else {
        0.0
    };
    let h = if max == r {
        60.0 * ((g - b) / d % 6.0)
    } else if max == g {
        60.0 * ((b - r) / d + 2.0)
    } else {
        60.0 * ((r - g) / d + 4.0)
    };
    (wrap_deg(h), s, l)
}

fn hue_to_rgb(p: f64, q: f64, t: f64) -> f64 {
    let mut tt = t;
    if tt < 0.0 {
        tt += 1.0;
    }
    if tt > 1.0 {
        tt -= 1.0;
    }
    if tt < 1.0 / 6.0 {
        return p + (q - p) * 6.0 * tt;
    }
    if tt < 1.0 / 2.0 {
        return q;
    }
    if tt < 2.0 / 3.0 {
        return p + (q - p) * (2.0 / 3.0 - tt) * 6.0;
    }
    p
}

fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (f64, f64, f64) {
    if s == 0.0 {
        return (l, l, l);
    }
    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;
    let base = wrap_deg(h) / 360.0;
    (
        hue_to_rgb(p, q, base + 1.0 / 3.0),
        hue_to_rgb(p, q, base),
        hue_to_rgb(p, q, base - 1.0 / 3.0),
    )
}

pub fn apply_hsl_in_place(data: &mut [u8], hsl: &Value, channels: usize) {
    if channels < 3 {
        return;
    }
    let hue = normalize_channel(hsl.get("hue"));
    let sat = normalize_channel(hsl.get("sat"));
    let lum = normalize_channel(hsl.get("lum"));
    if hue.iter().all(|&v| v == 0.0)
        && sat.iter().all(|&v| v == 0.0)
        && lum.iter().all(|&v| v == 0.0)
    {
        return;
    }
    let mut i = 0;
    while i + 2 < data.len() {
        let (r, g, b) = (
            data[i] as f64 / 255.0,
            data[i + 1] as f64 / 255.0,
            data[i + 2] as f64 / 255.0,
        );
        let (h, s, l) = rgb_to_hsl(r, g, b);
        let hue_adj = weighted_adjust(&hue, h) / 100.0 * HUE_MAX_DEG;
        let sat_adj = weighted_adjust(&sat, h) / 100.0;
        let lum_adj = weighted_adjust(&lum, h) / 100.0 * LUM_MAX;
        let h2 = wrap_deg(h + hue_adj);
        let s2 = clamp01(s * (1.0 + sat_adj));
        let l2 = clamp01(l + lum_adj);
        let (r2, g2, b2) = hsl_to_rgb(h2, s2, l2);
        data[i] = (clamp01(r2) * 255.0).round() as u8;
        data[i + 1] = (clamp01(g2) * 255.0).round() as u8;
        data[i + 2] = (clamp01(b2) * 255.0).round() as u8;
        i += channels;
    }
}

// ── 色调曲线（shared/curves.cjs） ──

pub fn normalize_points(arr: &[f64]) -> Vec<(f64, f64)> {
    let mut pts: Vec<(f64, f64)> = arr
        .chunks(2)
        .filter(|c| c.len() == 2)
        .map(|c| (clamp01(c[0]), clamp01(c[1])))
        .collect();
    pts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut out: Vec<(f64, f64)> = Vec::new();
    for p in pts {
        match out.last_mut() {
            Some(last) if last.0 == p.0 => last.1 = p.1,
            _ => out.push(p),
        }
    }
    if out.len() >= 2 {
        out
    } else {
        Vec::new()
    }
}

pub fn eval_at(pts: &[(f64, f64)], x: f64) -> f64 {
    if pts.is_empty() {
        return x;
    }
    if x <= pts[0].0 {
        return pts[0].1;
    }
    let last = pts[pts.len() - 1];
    if x >= last.0 {
        return last.1;
    }
    for i in 1..pts.len() {
        if x <= pts[i].0 {
            let (x0, y0) = pts[i - 1];
            let (x1, y1) = pts[i];
            let t = if x1 == x0 { 0.0 } else { (x - x0) / (x1 - x0) };
            return y0 + t * (y1 - y0);
        }
    }
    last.1
}

fn build_lut(pts: &[(f64, f64)]) -> [u8; 256] {
    let mut lut = [0u8; 256];
    for (i, slot) in lut.iter_mut().enumerate() {
        *slot = (255.0 * clamp01(eval_at(pts, i as f64 / 255.0))).round() as u8;
    }
    lut
}

fn compose_lut(a: Option<[u8; 256]>, b: Option<[u8; 256]>) -> Option<[u8; 256]> {
    match (a, b) {
        (None, b) => b,
        (a, None) => a,
        (Some(a), Some(b)) => {
            let mut out = [0u8; 256];
            for (i, slot) in out.iter_mut().enumerate() {
                *slot = b[a[i] as usize];
            }
            Some(out)
        }
    }
}

fn points_from_value(v: Option<&Value>) -> Vec<f64> {
    v.and_then(|x| x.as_array())
        .map(|arr| arr.iter().filter_map(|n| n.as_f64()).collect())
        .unwrap_or_default()
}

pub struct CurveLuts {
    pub r: [u8; 256],
    pub g: [u8; 256],
    pub b: [u8; 256],
}

/// rgb 曲线先作用全部通道，通道曲线再叠加；恒等组返回 None
pub fn build_curve_luts(curves: &Value) -> Option<CurveLuts> {
    let rgb = normalize_points(&points_from_value(curves.get("rgb")));
    let rgb_identity = {
        let chan = |name: &str| normalize_points(&points_from_value(curves.get(name)));
        rgb.is_empty() && chan("r").is_empty() && chan("g").is_empty() && chan("b").is_empty()
    };
    let rgb_lut = if rgb_identity {
        None
    } else {
        Some(build_lut(&rgb))
    };
    let mut any = rgb_lut.is_some();
    let mut out = CurveLuts {
        r: [0; 256],
        g: [0; 256],
        b: [0; 256],
    };
    for (name, slot) in [("r", &mut out.r), ("g", &mut out.g), ("b", &mut out.b)] {
        let pts = normalize_points(&points_from_value(curves.get(name)));
        if pts.is_empty() {
            if let Some(rgb_lut) = rgb_lut {
                slot.copy_from_slice(&rgb_lut);
                any = true;
            }
            continue;
        }
        any = true;
        let chan_lut = build_lut(&pts);
        let composed = compose_lut(rgb_lut, Some(chan_lut)).unwrap_or(chan_lut);
        slot.copy_from_slice(&composed);
    }
    if any {
        Some(out)
    } else {
        None
    }
}

// ── 蒙版（shared/masks.cjs） ──

#[derive(Default, Clone, Copy)]
pub struct MaskAdjustments {
    pub exposure: f64,
    pub contrast: f64,
    pub saturation: f64,
    pub temperature: f64,
    pub tint: f64,
}

#[derive(Clone)]
pub enum MaskShape {
    Radial {
        cx: f64,
        cy: f64,
        rx: f64,
        ry: f64,
        rotation: f64,
        feather: f64,
        invert: bool,
    },
    Linear {
        x0: f64,
        y0: f64,
        x1: f64,
        y1: f64,
        feather: f64,
        invert: bool,
    },
    Range {
        center: f64,
        range: f64,
        feather: f64,
        invert: bool,
    },
}

#[derive(Clone)]
pub struct Mask {
    pub shape: MaskShape,
    pub adjustments: MaskAdjustments,
}

fn clamp01_num(v: Option<&Value>, fallback: f64) -> f64 {
    clamp01(num_or(v, fallback))
}

pub fn normalize_masks(v: &Value) -> Vec<Mask> {
    let mut out = Vec::new();
    let Some(list) = v.as_array() else {
        return out;
    };
    for m in list {
        let Some(obj) = m.as_object() else { continue };
        let mtype = obj.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let adjustments = obj.get("adjustments");
        let adj = MaskAdjustments {
            exposure: num_or(adjustments.and_then(|a| a.get("exposure")), 0.0).clamp(-2.0, 2.0),
            contrast: num_or(adjustments.and_then(|a| a.get("contrast")), 0.0).clamp(-50.0, 50.0),
            saturation: num_or(adjustments.and_then(|a| a.get("saturation")), 0.0)
                .clamp(-100.0, 100.0),
            temperature: num_or(adjustments.and_then(|a| a.get("temperature")), 0.0)
                .clamp(-100.0, 100.0),
            tint: num_or(adjustments.and_then(|a| a.get("tint")), 0.0).clamp(-100.0, 100.0),
        };
        let invert = obj.get("invert").and_then(|x| x.as_bool()).unwrap_or(false);
        let feather = |f: f64| f.clamp(0.0, 1.0);
        match mtype {
            "radial" => {
                let (Some(cx), Some(cy)) = (
                    obj.get("cx").and_then(|x| x.as_f64()),
                    obj.get("cy").and_then(|x| x.as_f64()),
                ) else {
                    continue;
                };
                let rx = num_or(obj.get("rx"), 0.0).max(1.0);
                let ry = num_or(obj.get("ry"), 0.0).max(1.0);
                out.push(Mask {
                    shape: MaskShape::Radial {
                        cx,
                        cy,
                        rx,
                        ry,
                        rotation: num_or(obj.get("rotation"), 0.0),
                        feather: feather(num_or(obj.get("feather"), 0.0)),
                        invert,
                    },
                    adjustments: adj,
                });
            }
            "range" => {
                out.push(Mask {
                    shape: MaskShape::Range {
                        center: clamp01_num(obj.get("center"), 0.5),
                        range: clamp01_num(obj.get("range"), 0.25),
                        feather: feather(clamp01_num(obj.get("feather"), 0.25)),
                        invert,
                    },
                    adjustments: adj,
                });
            }
            "linear" => {
                out.push(Mask {
                    shape: MaskShape::Linear {
                        x0: num_or(obj.get("x0"), 0.0),
                        y0: num_or(obj.get("y0"), 0.0),
                        x1: num_or(obj.get("x1"), 0.0),
                        y1: num_or(obj.get("y1"), 0.0),
                        feather: feather(num_or(obj.get("feather"), 0.0)),
                        invert,
                    },
                    adjustments: adj,
                });
            }
            _ => continue,
        }
    }
    out.truncate(8);
    out
}

fn radial_weight(m: &Mask, x: f64, y: f64) -> f64 {
    let MaskShape::Radial {
        cx,
        cy,
        rx,
        ry,
        rotation,
        feather,
        invert,
    } = &m.shape
    else {
        return 0.0;
    };
    let dx = x - cx;
    let dy = y - cy;
    let a = rotation * std::f64::consts::PI / 180.0;
    let ux = dx * a.cos() + dy * a.sin();
    let uy = -dx * a.sin() + dy * a.cos();
    let d = ((ux / rx).powi(2) + (uy / ry).powi(2)).sqrt();
    let mut w = if *feather > 0.0 {
        clamp01((1.0 - d) / feather)
    } else if d < 1.0 {
        1.0
    } else {
        0.0
    };
    if *invert {
        w = 1.0 - w;
    }
    w
}

fn linear_weight(m: &Mask, x: f64, y: f64) -> f64 {
    let MaskShape::Linear {
        x0,
        y0,
        x1,
        y1,
        invert,
        ..
    } = &m.shape
    else {
        return 0.0;
    };
    let dx = x1 - x0;
    let dy = y1 - y0;
    let len2 = dx * dx + dy * dy;
    if len2 <= 0.0 {
        return if *invert { 1.0 } else { 0.0 };
    }
    let t = ((x - x0) * dx + (y - y0) * dy) / len2;
    let mut w = clamp01(t);
    if *invert {
        w = 1.0 - w;
    }
    w
}

fn range_weight(m: &Mask, l: f64) -> f64 {
    let MaskShape::Range {
        center,
        range,
        feather,
        invert,
    } = &m.shape
    else {
        return 0.0;
    };
    let dd = (l - center).abs();
    let mut w = if *feather > 0.0 {
        clamp01((range + feather - dd) / feather)
    } else if dd <= *range {
        1.0
    } else {
        0.0
    };
    if *invert {
        w = 1.0 - w;
    }
    w
}

fn apply_masked_adjustment(
    r: f64,
    g: f64,
    b: f64,
    adj: &MaskAdjustments,
    w: f64,
) -> (f64, f64, f64) {
    let (mut r, mut g, mut b) = (r, g, b);
    let gain = (2.0f64).powf(adj.exposure * w);
    r *= gain;
    g *= gain;
    b *= gain;
    let tk = (adj.temperature / 100.0) * w;
    let gk = (adj.tint / 100.0) * w;
    if tk != 0.0 || gk != 0.0 {
        r *= 1.0 + tk * 0.1;
        g *= 1.0 - gk * 0.06;
        b *= 1.0 - tk * 0.1;
    }
    if adj.contrast != 0.0 {
        let cf = 1.0 + (adj.contrast / 50.0) * w;
        r = (r - 0.5) * cf + 0.5;
        g = (g - 0.5) * cf + 0.5;
        b = (b - 0.5) * cf + 0.5;
    }
    if adj.saturation != 0.0 {
        let y = HSL_LUMA[0] * r + HSL_LUMA[1] * g + HSL_LUMA[2] * b;
        let s = 1.0 + (adj.saturation / 100.0) * w;
        r = y + (r - y) * s;
        g = y + (g - y) * s;
        b = y + (b - y) * s;
    }
    (clamp01(r), clamp01(g), clamp01(b))
}

pub fn apply_masks_in_place(
    data: &mut [u8],
    width: usize,
    height: usize,
    masks: &[Mask],
    channels: usize,
) {
    if masks.is_empty() || channels < 3 || width == 0 || height == 0 {
        return;
    }
    for y in 0..height {
        for x in 0..width {
            let i = (y * width + x) * channels;
            let mut r = data[i] as f64 / 255.0;
            let mut g = data[i + 1] as f64 / 255.0;
            let mut b = data[i + 2] as f64 / 255.0;
            let mut touched = false;
            for m in masks {
                let w = match &m.shape {
                    MaskShape::Range { .. } => {
                        let l = HSL_LUMA[0] * r + HSL_LUMA[1] * g + HSL_LUMA[2] * b;
                        range_weight(m, l)
                    }
                    _ => {
                        if matches!(m.shape, MaskShape::Radial { .. }) {
                            radial_weight(m, x as f64, y as f64)
                        } else {
                            linear_weight(m, x as f64, y as f64)
                        }
                    }
                };
                if w <= 0.0 {
                    continue;
                }
                (r, g, b) = apply_masked_adjustment(r, g, b, &m.adjustments, w);
                touched = true;
            }
            if touched {
                data[i] = (clamp01(r) * 255.0).round() as u8;
                data[i + 1] = (clamp01(g) * 255.0).round() as u8;
                data[i + 2] = (clamp01(b) * 255.0).round() as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::from_str;

    const VECTORS: &str = include_str!("../tests/render_vectors.json");

    fn apply_case(name_case: &str, f: impl Fn(&mut [u8], &Value)) {
        let v: Value = from_str(VECTORS).unwrap();
        let case = &v[name_case];
        let mut data: Vec<u8> = case["input"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_u64().unwrap() as u8)
            .collect();
        f(&mut data, case);
        let expected: Vec<u8> = case["output"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_u64().unwrap() as u8)
            .collect();
        assert_eq!(data, expected, "case {name_case} 对拍不一致");
    }

    #[test]
    fn 对拍_饱和度() {
        apply_case("saturation", |d, c| {
            apply_saturation_in_place(d, &c["params"], c["channels"].as_u64().unwrap() as usize)
        });
    }

    #[test]
    fn 对拍_饱和度黑白() {
        apply_case("saturationMono", |d, c| {
            apply_saturation_in_place(d, &c["params"], c["channels"].as_u64().unwrap() as usize)
        });
    }

    #[test]
    fn 对拍_暗角负压暗() {
        apply_case("vignette", |d, c| {
            apply_vignette_in_place(
                d,
                c["width"].as_u64().unwrap() as usize,
                c["height"].as_u64().unwrap() as usize,
                c["vignette"].as_f64().unwrap(),
                c["channels"].as_u64().unwrap() as usize,
            )
        });
    }

    #[test]
    fn 对拍_暗角正提亮() {
        apply_case("vignettePos", |d, c| {
            apply_vignette_in_place(
                d,
                c["width"].as_u64().unwrap() as usize,
                c["height"].as_u64().unwrap() as usize,
                c["vignette"].as_f64().unwrap(),
                c["channels"].as_u64().unwrap() as usize,
            )
        });
    }

    #[test]
    fn 对拍_颜色分级() {
        apply_case("grading", |d, c| {
            apply_color_grading_in_place(d, &c["grading"], c["channels"].as_u64().unwrap() as usize)
        });
    }

    #[test]
    fn 对拍_hsl() {
        apply_case("hsl", |d, c| {
            apply_hsl_in_place(d, &c["hsl"], c["channels"].as_u64().unwrap() as usize)
        });
    }

    #[test]
    fn 对拍_蒙版() {
        apply_case("masks", |d, c| {
            let masks = normalize_masks(&c["masks"]);
            apply_masks_in_place(
                d,
                c["width"].as_u64().unwrap() as usize,
                c["height"].as_u64().unwrap() as usize,
                &masks,
                c["channels"].as_u64().unwrap() as usize,
            )
        });
    }

    #[test]
    fn 对拍_曲线luts() {
        let v: Value = from_str(VECTORS).unwrap();
        let curves = &v["curves"];
        let luts = build_curve_luts(curves).expect("向量组非恒等");
        for ch in ["r", "g", "b"] {
            let expected: Vec<u8> = curves["luts"][ch]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x.as_u64().unwrap() as u8)
                .collect();
            let actual: Vec<u8> = match ch {
                "r" => luts.r.to_vec(),
                "g" => luts.g.to_vec(),
                _ => luts.b.to_vec(),
            };
            assert_eq!(actual, expected, "曲线 {ch} LUT 对拍不一致");
        }
    }
}

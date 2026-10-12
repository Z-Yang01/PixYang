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

// ── 饱和度/黑白（shared/saturation.js） ──

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

// ── 鲜艳度（shared/saturation.js vibrance01） ──
// 智能饱和度：增益随像素 chroma（max−min/255）自适应——正向低饱和多提/高饱和少提，
// 负向高饱和多降/近灰少动；围绕 luma 缩放保持亮度。与上方均匀 k 的饱和度是两个算子。
pub fn apply_vibrance_in_place(data: &mut [u8], vibrance: f64, channels: usize) {
    let v = vibrance.clamp(-100.0, 100.0);
    if v == 0.0 || channels < 3 {
        return;
    }
    let amt = v / 100.0;
    let mut i = 0;
    while i + 2 < data.len() {
        let (r, g, b) = (data[i] as f64, data[i + 1] as f64, data[i + 2] as f64);
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let chroma = (max - min) / 255.0;
        let k = 1.0 + amt * if amt > 0.0 { 1.0 - chroma } else { chroma };
        let y = SATURATION_LUMA[0] * r + SATURATION_LUMA[1] * g + SATURATION_LUMA[2] * b;
        data[i] = (y + (r - y) * k).clamp255_round();
        data[i + 1] = (y + (g - y) * k).clamp255_round();
        data[i + 2] = (y + (b - y) * k).clamp255_round();
        i += channels;
    }
}

// ── 清晰度（shared/clarity.js） ──
// 中间调对比：w = 1−|2L−1| 三角窗（Rec.709 L，与 apply_tone_masked 同系数），
// f = (x−0.5)k+0.5 不预钳，out = x+(f−x)w 段末写回 clamp——与 shader「mix 后整体钳」同口径。
// ±100 → k∈[0,2]；k=1 恒等跳过。
pub fn apply_clarity_in_place(data: &mut [u8], clarity: f64, channels: usize) {
    let k = 1.0 + clarity.clamp(-100.0, 100.0) / 100.0;
    if k == 1.0 {
        return;
    }
    let c_count = if channels >= 3 { 3 } else { 1 };
    let mut i = 0;
    while i + c_count <= data.len() {
        let l = if c_count >= 3 {
            (0.2126 * data[i] as f64 + 0.7152 * data[i + 1] as f64 + 0.0722 * data[i + 2] as f64)
                / 255.0
        } else {
            data[i] as f64 / 255.0
        };
        let w = 1.0 - (2.0 * l - 1.0).abs();
        for cc in 0..c_count {
            let x = data[i + cc] as f64 / 255.0;
            let f = (x - 0.5) * k + 0.5;
            let out = x + (f - x) * w;
            data[i + cc] = (out * 255.0).clamp(0.0, 255.0).trunc() as u8;
        }
        i += channels;
    }
}

// ── 胶片颗粒（shared/grain.js） ──
// cell = max(w,h)/256 网格，u32 wrapping hash 单色抖动：h = (gx·1973 + gy·9277 + 26699)
// → h = (h ^ h>>13) · 1274126177（全 wrapping）→ n = (h & 0xFFFF)/65535 − 0.5。
// 与 GLSL/JS 用 u32 整数运算逐位一致（勿改浮点 hash——f64/f32 必分叉）；amount=0 恒等。
pub fn apply_grain_in_place(
    data: &mut [u8],
    width: usize,
    height: usize,
    amount: f64,
    channels: usize,
) {
    let v = amount.clamp(0.0, 100.0);
    if v == 0.0 || width == 0 || height == 0 {
        return;
    }
    let k = (v / 100.0) * 0.15 * 255.0;
    let long = width.max(height) as f64;
    let cell = long / 256.0;
    let c_count = channels.min(3);
    let hash = |gx: u32, gy: u32| -> f64 {
        let mut h = gx
            .wrapping_mul(1973)
            .wrapping_add(gy.wrapping_mul(9277))
            .wrapping_add(26699);
        h = (h ^ (h >> 13)).wrapping_mul(1274126177);
        (h & 0xFFFF) as f64 / 65535.0 - 0.5
    };
    for y in 0..height {
        let gy = (y as f64 / cell) as u32;
        for x in 0..width {
            let gx = (x as f64 / cell) as u32;
            let n = hash(gx, gy);
            let delta = n * k;
            let i = (y * width + x) * channels;
            for cc in 0..c_count {
                let out = data[i + cc] as f64 + delta;
                data[i + cc] = out.clamp(0.0, 255.0).round() as u8;
            }
        }
    }
}

// ── 去朦胧（shared/dehaze.js） ──
// 三步同式：黑场回压窗 x(1−x)（暗部多动白端不动）→ 三角窗中调对比 → 饱和回拉。
// luma 用 0.213 族（饱和度家族系数，与 shared 实现一致——非 clarity 的 0.2126 族）；
// 每步不预钳段末统一 clamp；d=0 恒等。
pub fn apply_dehaze_in_place(data: &mut [u8], dehaze: f64, channels: usize) {
    let d = dehaze.clamp(-100.0, 100.0) / 100.0;
    if d == 0.0 || channels < 3 {
        return;
    }
    let mut i = 0;
    while i + 2 < data.len() {
        let (r, g, b) = (data[i] as f64, data[i + 1] as f64, data[i + 2] as f64);
        let l0 = (0.213 * r + 0.715 * g + 0.072 * b) / 255.0;
        let w = 1.0 - (2.0 * l0 - 1.0).abs();
        let step = |x: f64| -> f64 {
            let x1 = x - 0.3 * d * x * (1.0 - x);
            x1 + ((x1 - 0.5) * (1.0 + 0.4 * d) + 0.5 - x1) * w
        };
        let (x2r, x2g, x2b) = (step(r / 255.0), step(g / 255.0), step(b / 255.0));
        let y = 0.213 * x2r + 0.715 * x2g + 0.072 * x2b;
        let k = 1.0 + 0.25 * d;
        data[i] = ((y + (x2r - y) * k).clamp(0.0, 1.0) * 255.0).round() as u8;
        data[i + 1] = ((y + (x2g - y) * k).clamp(0.0, 1.0) * 255.0).round() as u8;
        data[i + 2] = ((y + (x2b - y) * k).clamp(0.0, 1.0) * 255.0).round() as u8;
        i += channels;
    }
}

// ── 暗角（shared/lens.js） ──

fn vignette_falloff(d: f64) -> f64 {
    ((d - 0.5) / 0.5).clamp(0.0, 1.0)
}

/// 镜头几何校正：径向畸变（k）+ 横向色散（ca）逆映射，双线性采样。
/// 语义与 shared/lens.js lensGeomScale 同式（半宽/半高椭圆归一；色散随 r² 增长）。
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

// ── 颜色分级（shared/colorGrading.js） ──

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

// ── HSL 8 色相带（shared/hsl.js） ──

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

// ── 色调曲线（shared/curves.js） ──

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

// ── 蒙版（shared/masks.js） ──

#[derive(Default, Clone, Copy)]
pub struct MaskAdjustments {
    pub exposure: f64,
    pub contrast: f64,
    pub saturation: f64,
    pub vibrance: f64,
    pub clarity: f64,
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
            vibrance: num_or(adjustments.and_then(|a| a.get("vibrance")), 0.0)
                .clamp(-100.0, 100.0),
            clarity: num_or(adjustments.and_then(|a| a.get("clarity")), 0.0).clamp(-100.0, 100.0),
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
    // 清晰度（shared/masks.js 同式：三角窗 Rec.709，蒙版权重并入 k）
    if adj.clarity != 0.0 {
        let k = 1.0 + (adj.clarity / 100.0) * w;
        let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        let wt = 1.0 - (2.0 * l - 1.0).abs();
        r += ((r - 0.5) * k + 0.5 - r) * wt;
        g += ((g - 0.5) * k + 0.5 - g) * wt;
        b += ((b - 0.5) * k + 0.5 - b) * wt;
    }
    if adj.saturation != 0.0 {
        let y = HSL_LUMA[0] * r + HSL_LUMA[1] * g + HSL_LUMA[2] * b;
        let s = 1.0 + (adj.saturation / 100.0) * w;
        r = y + (r - y) * s;
        g = y + (g - y) * s;
        b = y + (b - y) * s;
    }
    // 鲜艳度（shared/masks.js 同式：chroma 自适应增益，蒙版权重并入 amt）
    if adj.vibrance != 0.0 {
        let amt = (adj.vibrance / 100.0) * w;
        let mx = r.max(g).max(b);
        let mn = r.min(g).min(b);
        let chroma = mx - mn;
        let s = 1.0 + amt * if amt > 0.0 { 1.0 - chroma } else { chroma };
        let y = HSL_LUMA[0] * r + HSL_LUMA[1] * g + HSL_LUMA[2] * b;
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

    // ── 鲜艳度/清晰度手算锁（shared/saturation.js vibrance01、shared/clarity.js 同式）──

    #[test]
    fn 鲜艳度_灰像素恒等_低饱和增益高于高饱和_亮度保持() {
        // 纯灰 (128,128,128)：chroma=0 → 正向增益 k=1+1·(1−0)=2，但 r=g=b ⇒ mix(y,c,k)=c 恒等
        let mut gray = [128u8, 128, 128];
        apply_vibrance_in_place(&mut gray[..], 100.0, 3);
        assert_eq!(gray, [128, 128, 128]);

        // 低饱和 (130,128,126) vs 高饱和 (200,128,56)，同 +100：
        // 低饱和 chroma=4/255 → k=2−4/255≈1.9843；高饱和 chroma=144/255 → k=2−144/255≈1.4353
        // y_low = .213·130+.715·128+.072·126 = 128.428（round 钳制后手算）
        let low = &mut [130u8, 128, 126];
        apply_vibrance_in_place(&mut low[..], 100.0, 3);
        let y_low: f64 = 0.213 * 130.0 + 0.715 * 128.0 + 0.072 * 126.0;
        let k_low: f64 = 1.0 + (1.0 - 4.0 / 255.0);
        // r: y+(130−y)k；方向锁：低饱和像素的 |Δr| 增幅比例高于高饱和像素
        let exp_low_r = (y_low + (130.0 - y_low) * k_low).round();
        assert_eq!(low[0] as f64, exp_low_r, "低饱和 R 手算");

        let hi = &mut [200u8, 128, 56];
        apply_vibrance_in_place(&mut hi[..], 100.0, 3);
        let y_hi: f64 = 0.213 * 200.0 + 0.715 * 128.0 + 0.072 * 56.0;
        let k_hi: f64 = 1.0 + (1.0 - 144.0 / 255.0);
        let exp_hi_r = (y_hi + (200.0 - y_hi) * k_hi).round();
        assert_eq!(hi[0] as f64, exp_hi_r, "高饱和 R 手算");
        // 增益对比：低饱和 k > 高饱和 k（智能性核心，防退化成均匀饱和度）
        assert!(k_low > k_hi);

        // 亮度保持（luma 不动）：y_hi 与像素无关地保存于输出（mix 围绕 y）
        let out_y = 0.213 * hi[0] as f64 + 0.715 * hi[1] as f64 + 0.072 * hi[2] as f64;
        assert!((out_y - y_hi).abs() <= 0.5, "亮度漂移 {out_y} vs {y_hi}");
    }

    #[test]
    fn 鲜艳度_负向_高饱和多降_近灰少动() {
        // −100：gain = 1 − chroma——高饱和 (200,128,56) chroma=144/255 → k≈0.4353 大幅去饱和；
        // 近灰 (130,128,126) chroma=4/255 → k≈0.9843 几乎不动
        let hi = &mut [200u8, 128, 56];
        apply_vibrance_in_place(&mut hi[..], -100.0, 3);
        let y: f64 = 0.213 * 200.0 + 0.715 * 128.0 + 0.072 * 56.0;
        let k: f64 = 1.0 - 144.0 / 255.0;
        assert_eq!(hi[0] as f64, (y + (200.0 - y) * k).round());

        let near_gray = &mut [130u8, 128, 126];
        apply_vibrance_in_place(&mut near_gray[..], -100.0, 3);
        // 近灰只微动（防「去鲜艳」把中性色啃掉）
        assert!((near_gray[0] as i32 - 130).abs() <= 1);
    }

    #[test]
    fn 清晰度_中间调动_纯黑纯白不动_方向与手算() {
        // 纯黑/纯白：L=0/1 → w=0，恒等
        let mut ends = [0u8, 255, 0, 255, 0, 255];
        apply_clarity_in_place(&mut ends[..], 100.0, 3);
        assert_eq!(ends, [0, 255, 0, 255, 0, 255]);

        // 中灰 (128,128,128) +100：k=2，w=1（L≈0.502），f=(x−.5)·2+.5 → 对比拉开
        let mid = &mut [128u8, 128, 128];
        apply_clarity_in_place(&mut mid[..], 100.0, 3);
        // x=128/255≈0.50196，f=x·2−0.5≈0.50392 → out≈0.50392·255→128.5→trunc 128？
        // 手算：x=0.501961，f=0.503922，w=1−|2·0.501961−1|=0.996078，
        // out=0.501961+(0.503922−0.501961)·0.996078=0.503914 → trunc(128.498)=128
        assert_eq!(mid[0], 128);
        // 用明显中调色 (96,128,160)：L=0.7152·128+…≈0.5024? 手算 y=0.2126·96+0.7152·128+0.0722·160
        let y: f64 = (0.2126 * 96.0 + 0.7152 * 128.0 + 0.0722 * 160.0) / 255.0;
        let w: f64 = 1.0 - (2.0 * y - 1.0).abs();
        let px = &mut [96u8, 128, 160];
        apply_clarity_in_place(&mut px[..], 100.0, 3);
        let x0: f64 = 96.0 / 255.0;
        let f0: f64 = (x0 - 0.5) * 2.0 + 0.5;
        let exp = ((x0 + (f0 - x0) * w) * 255.0).trunc();
        assert_eq!(px[0] as f64, exp, "中调手算 R");
        // 方向锁：+清晰度让暗侧中调更暗
        assert!(px[0] < 96, "中调暗侧应更暗");
        assert!(px[2] > 160, "中调亮侧应更亮");

        // −100：k=0 → f=0.5，中调向 0.5 收（柔化）
        let soft = &mut [96u8, 128, 160];
        apply_clarity_in_place(&mut soft[..], -100.0, 3);
        assert!(soft[0] > 96 && soft[2] < 160, "负清晰度=柔化（向中灰收）");
    }

    #[test]
    fn 清晰度_零值恒等() {
        let mut data = [10u8, 200, 77, 1, 2, 3];
        let before = data;
        apply_clarity_in_place(&mut data[..], 0.0, 3);
        assert_eq!(data, before);
        let mut v = [10u8, 200, 77];
        let before = v;
        apply_vibrance_in_place(&mut v[..], 0.0, 3);
        assert_eq!(v, before);
    }

    // ── 胶片颗粒手算锁（shared/grain.js 同式）──

    #[test]
    fn 颗粒_hash_与_js_逐位一致_手算三点() {
        // 手算（u32 wrapping）：
        // (0,0): h=26699 → h^h>>13=26699^3=26696 → ×1274126177 (wrapping) = ?
        // 直接锁 JS 侧 grainNoiseAt 的既有输出（tests/unit/shared/grain.test.js 同表）
        let cases: [(u32, u32, f64); 3] = [
            (0, 0, -0.2684290837),
            (3, 5, 0.0989166094),
            (100, 77, 0.3395208667),
        ];
        for (gx, gy, expect) in cases {
            let mut h = gx
                .wrapping_mul(1973)
                .wrapping_add(gy.wrapping_mul(9277))
                .wrapping_add(26699);
            h = (h ^ (h >> 13)).wrapping_mul(1274126177);
            let n = (h & 0xFFFF) as f64 / 65535.0 - 0.5;
            assert!(
                (n - expect).abs() < 1e-9,
                "({gx},{gy}) n={n} expect={expect}"
            );
        }
    }

    #[test]
    fn 颗粒_单色同网格_零值恒等_alpha_不动() {
        // 512×1 图（cell = 512/256 = 2）：x=0/1 同属 gx=0 网格 → 两像素同 n；
        // x=2 起进入 gx=1 网格（值应与 gx=0 不同才证明网格生效）
        let mut data = vec![100u8; 512 * 4];
        let before = data.clone();
        apply_grain_in_place(&mut data, 512, 1, 0.0, 4);
        assert_eq!(data, before, "amount=0 恒等");

        apply_grain_in_place(&mut data, 512, 1, 50.0, 4);
        let px = |i: usize| [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
        let p0 = px(0);
        assert_eq!(p0[0], p0[1], "单色：R=G");
        assert_eq!(p0[1], p0[2], "单色：G=B");
        assert_eq!(p0, px(1), "同网格（cell=2 内两像素同值）");
        assert_ne!(p0, px(2), "跨网格值不同（hash 生效）");
        assert_eq!(data[3], 100, "alpha 不动（初始 100 亦不被触碰）");
        assert_ne!(p0[0], 100, "非零强度必有变化");
    }

    #[test]
    fn 颗粒_量值单调_满档幅度() {
        // 同点不同强度：|Δ| 随 amount 单调不减（n 同号）
        let base = 128u8;
        let mut prev_delta = 0.0f64;
        for amount in [10.0f64, 50.0, 100.0] {
            let mut d = [base, base, base];
            apply_grain_in_place(&mut d[..], 1, 1, amount, 3);
            let delta = (d[0] as f64 - base as f64).abs();
            assert!(delta >= prev_delta, "量值单调");
            prev_delta = delta;
        }
        // 满档幅度 ≤ 0.15·255 ≈ 38.25
        let mut d = [0u8, 0, 0];
        apply_grain_in_place(&mut d[..], 1, 1, 100.0, 3);
        assert!(d[0] <= 39, "满档幅度上界");
    }

    #[test]
    fn 去朦胧_三步手算_黑白端恒等_零值恒等() {
        // 灰输入 (153,153,153)（=0.6）：L=0.6 → w=0.8；x1=0.6−0.3·0.6·0.4=0.528；
        // x2=0.528+((0.028·1.4)+0.5−0.528)·0.8；灰输入饱和步恒等 → 输出=x2（同 shared 表）
        let x = 0.6f64;
        let d = 1.0f64;
        let x1 = x - 0.3 * d * x * (1.0 - x);
        let w: f64 = 1.0 - (2.0f64 * 0.6 - 1.0).abs();
        let x2 = x1 + ((x1 - 0.5) * (1.0 + 0.4 * d) + 0.5 - x1) * w;
        let expect = (x2 * 255.0).round() as u8;
        let mut px = [153u8, 153, 153];
        apply_dehaze_in_place(&mut px[..], 100.0, 3);
        assert_eq!(px[0], expect, "中调手算");

        // 纯黑纯白不动
        let mut ends = [0u8, 255, 0, 255, 0, 255];
        apply_dehaze_in_place(&mut ends[..], 100.0, 3);
        assert_eq!(ends, [0, 255, 0, 255, 0, 255]);

        // 零值恒等
        let mut z = [7u8, 200, 99];
        let before = z;
        apply_dehaze_in_place(&mut z[..], 0.0, 3);
        assert_eq!(z, before);

        // 负向加雾：抬亮（均值）
        let mut neg = [100u8, 100, 100];
        apply_dehaze_in_place(&mut neg[..], -50.0, 3);
        assert!(neg[0] > 100, "加雾应抬亮：{}", neg[0]);
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

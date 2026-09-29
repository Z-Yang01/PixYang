// 图像统计内核（agent 调色的观测面）：解码后的图像长边缩至 256，产出 64 桶 RGB/亮度
// 直方图、通道均值、亮度分位与两端裁切占比。直方图桶移位与亮度通道语义同前端
// src/lib/histogram.js（8-bit >> 2 进 64 桶；亮度桶 = (r6+g6+b6)/3 取整），分位/裁切
// 用 8-bit 平均亮度 (r+g+b)/3 计算。纯函数无库依赖，analyze_image 命令经它出数。

use image::DynamicImage;
use image::GenericImageView;
use serde::Serialize;

const ANALYZE_LONG_EDGE: u32 = 256;
const BIN_SHIFT: u32 = 2;
const CLIP_SHADOW: u8 = 5;
const CLIP_HIGHLIGHT: u8 = 250;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ChannelBins {
    pub r: Vec<u64>,
    pub g: Vec<u64>,
    pub b: Vec<u64>,
    pub l: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ChannelMeans {
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub l: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageStats {
    pub width: u32,
    pub height: u32,
    pub histogram: ChannelBins,
    pub mean: ChannelMeans,
    pub p05: f64,
    pub p50: f64,
    pub p95: f64,
    pub shadow_clip_pct: f64,
    pub highlight_clip_pct: f64,
}

fn round6(v: f64) -> f64 {
    (v * 1e6).round() / 1e6
}

/// 累积占比首次达到 fraction 的 8-bit 亮度值（0..1 归一）
fn percentile(lum_bins: &[u64; 256], total: u64, fraction: f64) -> f64 {
    let threshold = (total as f64 * fraction).ceil() as u64;
    let mut cum = 0u64;
    for (v, &count) in lum_bins.iter().enumerate() {
        cum += count;
        if cum >= threshold {
            return round6(v as f64 / 255.0);
        }
    }
    1.0
}

fn zero_bins() -> ChannelBins {
    ChannelBins {
        r: vec![0; 64],
        g: vec![0; 64],
        b: vec![0; 64],
        l: vec![0; 64],
    }
}

pub fn compute_stats(img: &DynamicImage) -> ImageStats {
    let (w, h) = img.dimensions();
    let long = w.max(h);
    let scaled = if long > ANALYZE_LONG_EDGE {
        let scale = ANALYZE_LONG_EDGE as f64 / long as f64;
        let nw = ((w as f64 * scale).round() as u32).max(1);
        let nh = ((h as f64 * scale).round() as u32).max(1);
        img.resize_exact(nw, nh, image::imageops::FilterType::Triangle)
    } else {
        img.clone()
    };
    let rgba = scaled.to_rgba8();
    let (sw, sh) = rgba.dimensions();

    let mut bins = zero_bins();
    let mut lum_bins = [0u64; 256];
    let mut sum = (0u64, 0u64, 0u64);
    let mut clip_shadow = 0u64;
    let mut clip_highlight = 0u64;
    let mut total = 0u64;
    for px in rgba.pixels() {
        let (r, g, b) = (px.0[0], px.0[1], px.0[2]);
        bins.r[(r >> BIN_SHIFT) as usize] += 1;
        bins.g[(g >> BIN_SHIFT) as usize] += 1;
        bins.b[(b >> BIN_SHIFT) as usize] += 1;
        let lum8 = (r as u32 + g as u32 + b as u32) / 3;
        let lum8 = u8::try_from(lum8).unwrap_or(255);
        bins.l[((r >> BIN_SHIFT) + (g >> BIN_SHIFT) + (b >> BIN_SHIFT)) as usize / 3] += 1;
        lum_bins[lum8 as usize] += 1;
        if lum8 < CLIP_SHADOW {
            clip_shadow += 1;
        }
        if lum8 > CLIP_HIGHLIGHT {
            clip_highlight += 1;
        }
        sum.0 += r as u64;
        sum.1 += g as u64;
        sum.2 += b as u64;
        total += 1;
    }

    let n = total.max(1) as f64;
    let mean = ChannelMeans {
        r: round6(sum.0 as f64 / n / 255.0),
        g: round6(sum.1 as f64 / n / 255.0),
        b: round6(sum.2 as f64 / n / 255.0),
        l: round6((sum.0 + sum.1 + sum.2) as f64 / n / 3.0 / 255.0),
    };

    ImageStats {
        width: sw,
        height: sh,
        histogram: bins,
        mean,
        p05: if total == 0 {
            0.0
        } else {
            percentile(&lum_bins, total, 0.05)
        },
        p50: if total == 0 {
            0.0
        } else {
            percentile(&lum_bins, total, 0.5)
        },
        p95: if total == 0 {
            0.0
        } else {
            percentile(&lum_bins, total, 0.95)
        },
        shadow_clip_pct: round6(clip_shadow as f64 / n),
        highlight_clip_pct: round6(clip_highlight as f64 / n),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbaImage;

    fn stats_of(img: &DynamicImage) -> ImageStats {
        compute_stats(img)
    }

    #[test]
    fn 纯红图_直方图与均值锁定() {
        let img = DynamicImage::from(RgbaImage::from_fn(4, 4, |_, _| {
            image::Rgba([255, 0, 0, 255])
        }));
        let s = stats_of(&img);
        assert_eq!((s.width, s.height), (4, 4));
        assert_eq!(s.histogram.r[63], 16);
        assert_eq!(s.histogram.g[0], 16);
        assert_eq!(s.histogram.b[0], 16);
        // 亮度桶 = (63+0+0)/3 = 21（与前端 histogram.js 同式）
        assert_eq!(s.histogram.l[21], 16);
        assert_eq!(s.mean.r, 1.0);
        assert_eq!(s.mean.g, 0.0);
        assert_eq!(s.mean.b, 0.0);
        assert_eq!(s.mean.l, 0.333333);
        // p50：亮度 85/255
        assert_eq!(s.p50, 0.333333);
        assert_eq!(s.p05, 0.333333);
        assert_eq!(s.shadow_clip_pct, 0.0);
        assert_eq!(s.highlight_clip_pct, 0.0);
    }

    #[test]
    fn 灰阶梯度_分位逐值锁定() {
        let img = DynamicImage::from(RgbaImage::from_fn(256, 1, |x, _| {
            image::Rgba([x as u8, x as u8, x as u8, 255])
        }));
        let s = stats_of(&img);
        // total=256：阈值 ceil(256*0.05)=13 → 累积到 v=12 处达成；中位 ceil(128) → v=127；95% → v=243
        assert_eq!(s.p05, round6(12.0 / 255.0));
        assert_eq!(s.p50, round6(127.0 / 255.0));
        assert_eq!(s.p95, round6(243.0 / 255.0));
        assert_eq!(s.mean.l, 0.5);
        // 梯度两端各有 5 个像素（x<5 / x>250）落入裁切区
        assert_eq!(s.shadow_clip_pct, 0.019531);
        assert_eq!(s.highlight_clip_pct, 0.019531);
    }

    #[test]
    fn 半黑半白_裁切占比锁定() {
        let img = DynamicImage::from(RgbaImage::from_fn(2, 1, |x, _| {
            if x == 0 {
                image::Rgba([0, 0, 0, 255])
            } else {
                image::Rgba([255, 255, 255, 255])
            }
        }));
        let s = stats_of(&img);
        assert_eq!(s.shadow_clip_pct, 0.5);
        assert_eq!(s.highlight_clip_pct, 0.5);
        assert_eq!(s.p05, 0.0);
        assert_eq!(s.p95, 1.0);
    }

    #[test]
    fn 大图缩到长边256_常数灰统计不变() {
        let img = DynamicImage::from(RgbaImage::from_fn(512, 512, |_, _| {
            image::Rgba([128, 128, 128, 255])
        }));
        let s = stats_of(&img);
        assert_eq!((s.width, s.height), (256, 256));
        assert_eq!(s.histogram.l[32], 256 * 256);
        assert_eq!(s.mean.l, 0.501961);
        assert_eq!(s.p50, 0.501961);
    }
}

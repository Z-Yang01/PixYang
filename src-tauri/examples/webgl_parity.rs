// WebGL shader 输出 vs Rust 执行器 实机像素对拍（取证工具，非 CI 门禁；examples 不被 cargo test 运行）。
// 流程与运行方式见 tests/webgl-parity/run.cjs（一键驱动），本文件负责 Rust 侧三步：
//   CARGO_BUILD_JOBS=1 cargo run --example webgl_parity -- gen      生成确定性底图 %TEMP%/pixyang_parity/fixture.png
//   CARGO_BUILD_JOBS=1 cargo run --example webgl_parity -- render   对 specs/*.json 逐例跑 render_spec_to_file 出 rust/<case>.png
//   CARGO_BUILD_JOBS=1 cargo run --example webgl_parity -- diff     rust PNG vs web/<case>.rgba 逐通道 maxΔ/meanΔ/坏点审计
// spec 由 run.cjs 经前端同一套模块（src/lib/editParams.js + shared/renderSpec.cjs）计算，
// 保证「浏览器 shader 消费的 spec」与「Rust 执行器消费的 spec」逐字节同源。
use image::GenericImageView;
use std::path::PathBuf;

fn parity_dir() -> PathBuf {
    std::env::temp_dir().join("pixyang_parity")
}

fn fixture_path() -> PathBuf {
    parity_dir().join("fixture.png")
}

// 确定性底图：800x1000，横向斜坡 + 纵向斜坡 + 对角锯齿 + 正弦调制 + 哈希噪声，
// 全通道覆盖 0..255，避免恒值区掩盖非线性阶段（曲线/HSL/分级）的差异。
fn gen() {
    let (w, h) = (800u32, 1000u32);
    let mut img = image::RgbImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let fx = x as f32 / w as f32;
            let fy = y as f32 / h as f32;
            let noise =
                ((x as u32).wrapping_mul(73856093) ^ (y as u32).wrapping_mul(19349663)) % 15;
            let saw = ((x + y) % 128) as f32 / 127.0;
            let wave = (fx * std::f32::consts::PI * 6.0).sin();
            let r = fx * 235.0 + 10.0 + wave * 8.0 + noise as f32;
            let g = fy * 235.0 + 10.0 + saw * 6.0 + noise as f32;
            let b = saw * 244.0 + 6.0 + wave * 6.0 + noise as f32;
            let px = [
                r.clamp(0.0, 255.0) as u8,
                g.clamp(0.0, 255.0) as u8,
                b.clamp(0.0, 255.0) as u8,
            ];
            img.put_pixel(x, y, image::Rgb(px));
        }
    }
    std::fs::create_dir_all(parity_dir()).unwrap();
    img.save_with_format(fixture_path(), image::ImageFormat::Png)
        .unwrap();
    println!("fixture: {}", fixture_path().display());
}

fn render() {
    let specs = parity_dir().join("specs");
    let out = parity_dir().join("rust");
    std::fs::create_dir_all(&out).unwrap();
    let mut names: Vec<String> = std::fs::read_dir(&specs)
        .unwrap_or_else(|e| panic!("specs 目录缺失（先由 run.cjs 生成）: {e}"))
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".json"))
        .collect();
    names.sort();
    for name in &names {
        let spec = std::fs::read_to_string(specs.join(name)).unwrap();
        let spec: serde_json::Value = serde_json::from_str(&spec).unwrap();
        let case = name.trim_end_matches(".json");
        let actual = out.join(format!("{case}.png"));
        pixyang::executor::render_spec_to_file(&spec, &fixture_path().as_path(), &actual)
            .unwrap_or_else(|e| panic!("case {case} 渲染失败: {e}"));
        let (w, h) = image::ImageReader::open(&actual)
            .unwrap()
            .with_guessed_format()
            .unwrap()
            .into_dimensions()
            .unwrap();
        println!("rust render: {case} {w}x{h}");
    }
}

fn decode_rgba(path: &PathBuf) -> (Vec<u8>, u32, u32) {
    let img = image::ImageReader::open(path)
        .unwrap_or_else(|e| panic!("打开 {} 失败: {e}", path.display()))
        .with_guessed_format()
        .unwrap()
        .decode()
        .unwrap();
    let (w, h) = img.dimensions();
    (img.to_rgba8().into_raw(), w, h)
}

fn diff() {
    let web_dir = parity_dir().join("web");
    let rust_dir = parity_dir().join("rust");
    let mut names: Vec<String> = std::fs::read_dir(&web_dir)
        .unwrap_or_else(|e| panic!("web 目录缺失（先由 run.cjs 出帧）: {e}"))
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".rgba"))
        .collect();
    names.sort();
    println!("\n=== WebGL shader vs Rust 执行器 逐通道 Δ 审计 ===");
    println!(
        "{:<24} {:>6} {:>7} {:>7} {:>7} {:>9} {:>8} {:>8} {:>8}",
        "case", "dims", "maxΔR", "maxΔG", "maxΔB", "meanΔ", "nΔ>0", "nΔ>1", "nΔ>2"
    );
    let mut report = serde_json::Map::new();
    for name in &names {
        let case = name.trim_end_matches(".rgba");
        let web = std::fs::read(web_dir.join(name)).unwrap();
        let (rust, rw, rh) = decode_rgba(&rust_dir.join(format!("{case}.png")));
        assert_eq!(
            web.len(),
            rust.len(),
            "case {case}: web 帧字节数与 rust PNG 不一致"
        );
        let (ww, wh) = (rw, rh);
        let dims_ok = true;
        let len = web.len();
        let mut max = [0i64; 3];
        let mut sum = 0i64;
        let mut cnt = [0i64; 3];
        for i in (0..len).step_by(4) {
            for ch in 0..3 {
                let d = (web[i + ch] as i64 - rust[i + ch] as i64).abs();
                if d > max[ch] {
                    max[ch] = d;
                }
                sum += d;
                if d >= 1 {
                    cnt[0] += 1;
                }
                if d >= 2 {
                    cnt[1] += 1;
                }
                if d >= 3 {
                    cnt[2] += 1;
                }
            }
        }
        let px_total = (ww as i64) * (wh as i64);
        let mean = sum as f64 / (px_total * 3).max(1) as f64;
        println!(
            "{:<24} {:>6} {:>7} {:>7} {:>7} {:>9.4} {:>8} {:>8} {:>8}",
            case,
            format!("{ww}x{wh}/{}", if dims_ok { "ok" } else { "BAD" }),
            max[0],
            max[1],
            max[2],
            mean,
            format!("{}/{}", cnt[0], px_total * 3),
            cnt[1],
            cnt[2]
        );
        report.insert(
            case.to_string(),
            serde_json::json!({
                "width": ww, "height": wh, "dimsOk": dims_ok,
                "maxDelta": [max[0], max[1], max[2]],
                "meanDelta": (mean * 10000.0).round() / 10000.0,
                "countGte1": cnt[0], "countGte2": cnt[1], "countGte3": cnt[2],
                "channelSamples": px_total * 3,
            }),
        );
    }
    let path = parity_dir().join("rust-diff.json");
    std::fs::write(&path, serde_json::to_string_pretty(&report).unwrap()).unwrap();
    println!("\nreport: {}", path.display());
}

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("gen") => gen(),
        Some("render") => render(),
        Some("diff") => diff(),
        other => {
            eprintln!(
                "用法: cargo run --example webgl_parity -- gen|render|diff（收到: {other:?}）"
            );
            std::process::exit(2);
        }
    }
}

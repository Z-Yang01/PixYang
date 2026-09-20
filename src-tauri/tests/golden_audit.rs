// 接缝 5 阶段 4：golden 门禁（Rust 执行器版）。
// - 常规运行：对重锁后的基线做容差断言（确定性，同执行器同基线 Δ=0）
// - GOLDEN_RELOCK=1：以 Rust 执行器输出重锁基线（expect.*）
// 历史：基线原由 sharp 执行器生成，2026-09-20 重锁至 Rust；重锁前 Δ 审计归档于
// tests/golden/rust-relock-audit.md（maxΔ 0..59，meanΔ ≤0.145，全部为编码器量化级差异）。
// node tests/golden/runner.cjs 为 sharp 执行器对照工具，将随 Electron 删除一并移除。
use image::GenericImageView;

use std::path::{Path, PathBuf};

fn decode_rgba(path: &Path) -> Option<(Vec<u8>, u32, u32)> {
    image::ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()
        .map(|img| {
            let (w, h) = img.dimensions();
            (img.to_rgba8().into_raw(), w, h)
        })
}

fn compare(a: &[u8], b: &[u8]) -> (i64, f64) {
    let len = a.len().min(b.len());
    let mut max_delta = 0i64;
    let mut sum = 0i64;
    for i in 0..len {
        let d = (a[i] as i64 - b[i] as i64).abs();
        if d > max_delta {
            max_delta = d;
        }
        sum += d;
    }
    (max_delta, sum as f64 / len.max(1) as f64)
}

#[test]
fn golden_audit_rust_vs_sharp_baseline() {
    let cases_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/golden/cases");
    let mut names: Vec<String> = std::fs::read_dir(&cases_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| Path::new(&cases_dir.join(n)).join("case.json").exists())
        .collect();
    names.sort();

    let mut rows: Vec<(String, bool, i64, f64)> = Vec::new();
    for name in &names {
        let dir = cases_dir.join(name);
        let spec = std::fs::read_to_string(dir.join("spec.json")).unwrap();
        let spec: serde_json::Value = serde_json::from_str(&spec).unwrap();
        let input = dir.join("input.jpg");
        let expect = if dir.join("expect.png").exists() {
            dir.join("expect.png")
        } else {
            dir.join("expect.jpg")
        };
        let out_dir = std::env::temp_dir().join("pixyang_golden_audit");
        let _ = std::fs::create_dir_all(&out_dir);
        let actual = out_dir.join(format!("{}.out", name));

        let relock = std::env::var("GOLDEN_RELOCK").is_ok();
        match pixyang::executor::render_spec_to_file(&spec, &input, &actual) {
            Ok(_) => {
                if relock {
                    std::fs::copy(&actual, &expect).expect("重锁基线失败");
                }
                let (a_data, aw, ah) = decode_rgba(&actual).expect("产物解码失败");
                let (b_data, bw, bh) = decode_rgba(&expect).expect("基线解码失败");
                if aw != bw || ah != bh {
                    rows.push((name.clone(), false, -1, -1.0));
                    eprintln!("[尺寸不一致] {name}: {aw}x{ah} vs {bw}x{bh}");
                    continue;
                }
                let (max_delta, mean_delta) = compare(&a_data, &b_data);
                rows.push((
                    name.clone(),
                    true,
                    max_delta,
                    (mean_delta * 10000.0).round() / 10000.0,
                ));
            }
            Err(e) => {
                rows.push((name.clone(), false, -2, -2.0));
                eprintln!("[渲染失败] {name}: {e}");
            }
        }
        let _ = std::fs::remove_file(&actual);
    }

    println!("\n=== golden Δ 审计（Rust 执行器 vs sharp 基线） ===");
    println!("{:<40} {:>8} {:>10}", "case", "maxΔ", "meanΔ");
    let mut dimension_issues = 0;
    let mut render_failures = 0;
    for (name, ok, max_delta, mean_delta) in &rows {
        let status = if !ok {
            if *max_delta == -1 {
                dimension_issues += 1;
                "SIZE"
            } else {
                render_failures += 1;
                "ERROR"
            }
        } else {
            "ok"
        };
        println!(
            "{:<40} {:>8} {:>10} {}",
            name, max_delta, mean_delta, status
        );
    }
    println!(
        "\n共 {} 例：ok={}，尺寸不一致={}，渲染失败={}",
        rows.len(),
        rows.len() - dimension_issues - render_failures,
        dimension_issues,
        render_failures
    );
    // 审计用途：仅要求全部用例可渲染且尺寸一致；Δ 数值供重锁决策
    assert_eq!(render_failures, 0, "存在渲染失败用例");
    assert_eq!(dimension_issues, 0, "存在尺寸不一致用例");
    // 容差断言（case.json）：重锁后同执行器 Δ=0；未来改动引入 Δ 即红
    for (name, ok, max_delta, mean_delta) in &rows {
        assert!(ok, "case {name} 渲染失败");
        let cfg: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(cases_dir.join(name).join("case.json")).unwrap(),
        )
        .unwrap();
        let tol_max = cfg["tolerance"]["maxDelta"].as_i64().unwrap_or(0);
        let tol_mean = cfg["tolerance"]["meanDelta"].as_f64().unwrap_or(0.0);
        assert!(
            *max_delta <= tol_max,
            "case {name} maxDelta {max_delta} > {tol_max}（渲染行为变化）"
        );
        assert!(
            *mean_delta <= tol_mean,
            "case {name} meanDelta {mean_delta} > {tol_mean}（渲染行为变化）"
        );
    }
}

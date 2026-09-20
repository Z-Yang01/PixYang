# Golden 基线重锁 Δ 审计（sharp → Rust 执行器）

重锁时间：2026-09-20。基线自 sharp（libjpeg-turbo）执行器重锁至 Rust（image-rs）执行器。
Δ 分布结论：全部为编码器量化级差异——数学层逐像素一致性由
src-tauri/src/render.rs 的 JS 对拍向量（8/8 零偏差）与执行器 gamma 对 libvips
实测表逐值一致（tests/executor.rs 阴影提升用例）分别证明。

| case | maxΔ | meanΔ |
|---|---|---|
| 001-identity | 4 | 0.0127 |
| 002-crop-rotate90 | 4 | 0.007 |
| 003-exposure-1ev | 1 | 0.0023 |
| 004-contrast-30 | 1 | 0.0023 |
| 005-saturation-mono | 2 | 0.0141 |
| 006-wb-warm-50 | 13 | 0.095 |
| 007-flip-hv | 0 | 0 |
| 008-crop-1-1 | 4 | 0.0185 |
| 009-unsupported-curves-hsl | 4 | 0.0131 |
| 010-schema-garbage | 4 | 0.0127 |
| 011-wb-cool-50 | 15 | 0.0817 |
| 012-shadows-lift | 1 | 0.0047 |
| 013-shadows-crush | 1 | 0.0035 |
| 014-highlights-recover | 28 | 0.139 |
| 015-full-basic-combo | 59 | 0.145 |
| 016-curves-scurve | 6 | 0.0137 |
| 017-color-grading | 4 | 0.0128 |
| 018-vignette | 4 | 0.0078 |
| 019-full-combo-new-stages | 10 | 0.0163 |
| 020-hsl-shift | 7 | 0.0131 |
| 021-radial-mask | 4 | 0.0101 |
| 022-range-mask | 4 | 0.0125 |
| 023-rot90-fliph-crop | 4 | 0.007 |

maxΔ 峰值集中在 014/015（gamma 截断表 ±1 差异经后续阶段与有损编码放大），
均值全部 ≤0.145/255。golden 门禁自起重锁后由
`cargo test --test golden_audit`（容差断言）承担；node runner.cjs 留作 sharp 对照。

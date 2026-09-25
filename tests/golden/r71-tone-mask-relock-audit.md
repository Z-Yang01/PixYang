# Golden 基线重锁 Δ 审计（P2-3 高光/阴影亮度掩蔽）

重锁时间：2026-09-25 R71。基线自「全局近似 tone（高光线性全图乘 / 阴影全图 gamma，
负阴影 negate 复合）」重锁至「亮度掩蔽 tone（out = mix(c, f(c), w(L))，L=Rec.709，
阴影带 [0,0.5] / 高光带 [0.5,1] smoothstep，高光方向 LR 惯例 +提亮/−压暗）」。

变化性质：**渲染语义修复**（用户拍板方案 B，硬切无新旧开关），非回归。f 力度公式不变、
只加定位；18/23 用例 Δ=0 逐字节一致（无 tone 参数的用例全部不动，含 004-contrast-30
纯仿射路径），恰 5 例含非零 tone 参数的用例变化，与实施范围精确对应：

| case | maxΔ | meanΔ | 变化来源 |
|---|---|---|---|
| 012-shadows-lift (shadows 80) | 38 | 13.3957 | 亮区不再被提亮（掩蔽分区） |
| 013-shadows-crush (shadows −80) | 29 | 10.9477 | 负阴影改掩蔽 + negate 三次量化→单次量化 |
| 014-highlights-recover (highlights −60) | 76 | 17.2857 | 方向翻转（旧：全图提亮；新：压暗高光区） |
| 015-full-basic-combo (h −30/s 40) | 61 | 16.8517 | 同上两类叠加 |
| 019-full-combo-new-stages (h −20/s 25) | 35 | 8.5184 | 同上 |

其余 18 例（001–011、016–018、020–023）maxΔ=0 / meanΔ=0。

语义正确性证明链：执行器手算表与分区/方向锁（src-tauri/src/executor.rs
阴影提升_亮度掩蔽_手算表一致 / 影调亮度掩蔽_分区锁与高光方向_lr惯例，f64 手算逐字节）、
JS 契约模型同表（tests/unit/lib/previewUniforms.test.jsx 掩蔽代表点/分区方向锁，
Python 双精度独立复算写死）、实机 shader↔执行器对拍（tests/webgl-parity，R71 全矩阵
见 NIGHTLY_LOG R71）。四组变异验证（w≡1、方向公式还原、掩蔽 uniform 漏传、Rust 侧
w≡1）均红后复绿。

重锁前旧基线 Δ 审计（sharp→Rust，2026-09-20）见 rust-relock-audit.md；本轮重锁后
门禁由 `cargo test --test golden_audit`（容差断言，重锁后同执行器 Δ=0）承担。

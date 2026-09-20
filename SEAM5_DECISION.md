# 接缝 5 技术决策：sharp（libvips）替代方案

状态：待拍板。本文件量化三条路线，给出推荐与分阶段实施计划。
数据基线：electron/render/renderSpecToSharp.cjs（520 行）+ electron/thumbWorker.js（182 行）
+ electron/imageWorker.js（88 行），golden 像素锁定 23 例。

## 关键量化事实（决定天平的三个发现）

1. **渲染语义大部分已是非 sharp 的纯像素循环**：曲线/HSL/分级/饱和度/暗角/蒙版全部是
   `applyXxxInPlace` 形式的 JS 逐像素数学，且与 WebGL 预览**同源**（shared/*.cjs 唯一事实源）。
   sharp 仅承担：解码/编码（jpeg/png/webp）、几何（composite/resize/rotate）、EXIF 元数据回接、
   蒙版路径的 PNG 无损中间层。→ Rust 平移的主体是"直译已知公式"，不是重造图像库。
2. **golden 比较是解码后像素 Δ（maxΔ=0 锁定）**：换编码器（libjpeg-turbo → image-rs）后
   有损格式的解码像素必有微小差异 → golden 基线需一次性 `--update` 重锁，
   并审计 Δ 分布确认差异仅来自编码量化（数学层要求逐像素一致，可另行断言）。
3. **NEF 预览路径是隐性风险**：thumbWorker 依赖 sharp "碰巧能读部分 NEF"（非标准能力）。
   Rust 无 RAW 解码；等价做法是字节级提取 NEF 内嵌 JPEG 预览段（SOI/EOI 扫描）+ 转正。
   可行但需单独验证一批实机 NEF。

## 三条路线

| | A：image-rs 纯 Rust（推荐） | B：libvips bindings | C：Node sidecar 过渡 |
|---|---|---|---|
| 工作量 | 4-6 轮（见分阶段） | 3-5 轮 + DLL 打包工程 | 1-2 轮 |
| 安装包 | ~10MB（零原生依赖） | +20MB libvips DLL 全家桶 | +40-60MB Node 运行时 |
| golden | 一次性重锁 + Δ 审计 | 重锁（libvips 与 sharp 同源，Δ 极小） | 零风险 |
| 长期形态 | 彻底删 Node，无原生 DLL 地狱 | 性能最强（流式），但 DLL 分发地狱（第二个 ABI 问题） | 保留 Node = 删一半，ABI 地狱照旧 |
| NEF/EXIF | kamadak-exif + 预览段扫描 | libvips 自带（最省心） | 现状不动 |
| 主要风险 | webp 编码器差异、NEF 预览提取、EXIF 回接（JPEG APP1 段手工注入/PNG eXIf chunk） | 原生库分发与版本矩阵 | 双运行时永久化 |

## 推荐：方案 A，分四阶段（每阶段独立可验证、可回退）

- **阶段 1（1 轮，无 golden 影响）**：缩略图 worker 平移——image-rs 解码 + EXIF orientation
  转正（kamadak-exif）+ resize + jpeg 编码；NEF 预览段提取单测。
- **阶段 2（1 轮）**：EXIF 回接基建——JPEG APP1 段拷贝 / PNG eXIf chunk 注入，工具函数 + 测试。
- **阶段 3（2-3 轮）**：渲染执行器平移——shared 公式逐函数直译成 Rust（仿射累积/检查点模式
  原样保留），每函数带 JS 对拍测试向量；解码/编码换 image-rs。
- **阶段 4（1 轮）**：golden 重锁 + Δ 审计报告（数学层另设逐像素一致断言，编码量化差异归档），
  importImages/renameImage/updateImage 接缝随之落地。

## 降级路径

阶段 3 若蒙版 PNG 中间层或某编码器出现不可接受差异：该阶段局部回退方案 C（sidecar 只跑该环节），
其余保持 Rust——但按当前量化，预期不需要。

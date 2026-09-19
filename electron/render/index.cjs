// 渲染入口（主进程侧封装）：EditParams/RenderSpec → worker 线程执行。
// 全尺寸解码/渲染都在 worker，不阻塞主进程（进而绝不阻塞 UI）。
const crypto = require('crypto');
const fs = require('fs');
const { editParamsToRenderSpec } = require('../../shared/renderSpec.cjs');
const { callWorker, sendToWorker, closeWorker: closeImageWorker } = require('../imageWorker');


// 输入图内容哈希：底图更换后 spec 失效防护（sourceHash）
function computeSourceHash(inputPath) {
  try {
    const buf = fs.readFileSync(inputPath);
    return crypto.createHash('md5').update(buf).digest('hex');
  } catch {
    return `missing-${Date.now()}`;
  }
}

// EditParams（edits.params_json 结构）→ RenderSpec → 渲染输出文件
async function renderFromEditParams(editParams, { inputPath, outputPath, sourceHash } = {}) {
  if (!inputPath) throw new Error('[render] inputPath 必填');
  const spec = editParamsToRenderSpec(editParams, {
    sourceHash: sourceHash ?? computeSourceHash(inputPath),
  });
  return renderFromSpec(spec, inputPath, outputPath);
}

// 在途渲染输出登记：worker 侧会在 outputPath 旁写 {out}.part / {out}.icc 中间文件，
// 成功/失败分支各自清理；退出时 terminate worker 会让两条清理路径都不执行，
// 用户导出目录里留下半截垃圾（审查批 8 P-3）
const activeRenderOutputs = new Set();

async function renderFromSpec(spec, inputPath, outputPath) {
  if (!inputPath || !outputPath) throw new Error('[render] inputPath/outputPath 必填');
  // 消息字段名与 thumbWorker 的解构约定一致（srcPath/outPath）
  activeRenderOutputs.add(outputPath);
  try {
    const result = await callWorker({ type: 'render-spec', spec, srcPath: inputPath, outPath: outputPath });
    return { ok: true, path: outputPath, ...result };
  } finally {
    activeRenderOutputs.delete(outputPath);
  }
}

// before-quit 调用：清掉所有在途渲染的中间文件
function cleanupInterruptedRenders() {
  let removed = 0;
  for (const out of activeRenderOutputs) {
    for (const tmp of [`${out}.part`, `${out}.icc`]) {
      try {
        if (fs.existsSync(tmp)) {
          fs.unlinkSync(tmp);
          removed++;
        }
      } catch (e) {
        console.error('[render] 退出清理残留失败:', tmp, e.message);
      }
    }
  }
  activeRenderOutputs.clear();
  if (removed) console.log(`[render] 已清理 ${removed} 个在途渲染残留`);
  return removed;
}

// 生命周期与 imageWorker 共用同一 worker（closeRenderWorker 为别名，兼容既有调用）
function closeRenderWorker() {
  return closeImageWorker();
}

module.exports = { renderFromEditParams, renderFromSpec, computeSourceHash, callWorker, sendToWorker, closeRenderWorker, cleanupInterruptedRenders };

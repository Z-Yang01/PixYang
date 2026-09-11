// 渲染入口（主进程侧封装）：EditParams/RenderSpec → worker 线程执行。
// 全尺寸解码/渲染都在 worker，不阻塞主进程（进而绝不阻塞 UI）。
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { editParamsToRenderSpec } = require('../../shared/renderSpec.cjs');

let worker = null;
let seq = 0;
const pending = new Map();

function ensureWorker() {
  if (worker) return worker;
  const { Worker } = require('worker_threads');
  worker = new Worker(path.join(__dirname, '..', 'thumbWorker.js'));
  worker.on('message', ({ id, result, error }) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error) entry.reject(new Error(error));
    else entry.resolve(result);
  });
  worker.on('error', (err) => {
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
    worker = null;
  });
  return worker;
}

function callWorker(message) {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, ...message });
  });
}

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

async function renderFromSpec(spec, inputPath, outputPath) {
  if (!inputPath || !outputPath) throw new Error('[render] inputPath/outputPath 必填');
  // 消息字段名与 thumbWorker 的解构约定一致（srcPath/outPath）
  const result = await callWorker({ type: 'render-spec', spec, srcPath: inputPath, outPath: outputPath });
  return { ok: true, path: outputPath, ...result };
}

function closeRenderWorker() {
  if (worker) {
    const w = worker;
    worker = null;
    return w.terminate();
  }
  return Promise.resolve();
}

module.exports = { renderFromEditParams, renderFromSpec, computeSourceHash, closeRenderWorker };

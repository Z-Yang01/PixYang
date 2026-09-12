const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');

let worker = null;
let seq = 0;
const pending = new Map();

// 缩略图/编辑底图/渲染全部在 worker 线程完成，主进程只做调度，不再被图片解码阻塞 IPC
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(path.join(__dirname, 'thumbWorker.js'));
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

// 生成失败/文件不存在均返回 null，调用方按"无法生成"处理
async function generateThumbnailTiers(filepath) {
  if (!filepath || !fs.existsSync(filepath)) return null;
  try {
    return await callWorker({ type: 'tiers', filepath });
  } catch (e) {
    console.error('[缩略图] 生成失败:', e.message);
    return null;
  }
}

// 提取 NEF 全尺寸预览；失败返回 null
async function extractNefPreview(nefPath, outPath) {
  try {
    return await callWorker({ type: 'nef-preview', nefPath, outPath });
  } catch (e) {
    console.error('[编辑] NEF 预览提取失败:', e.message);
    return null;
  }
}

// 规范化编辑底图（auto-orient 转正），返回 { width, height }
async function normalizeEditBase(srcPath, outPath) {
  return callWorker({ type: 'normalize', srcPath, outPath });
}

// 读取图片元数据（尺寸等，轻量）
async function getImageMeta(filepath) {
  return callWorker({ type: 'meta', filepath });
}

async function closeWorker() {
  if (worker) {
    const w = worker;
    worker = null;
    await w.terminate();
  }
}

module.exports = { generateThumbnailTiers, extractNefPreview, normalizeEditBase, getImageMeta, callWorker, closeWorker };

const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');

let worker = null;
let seq = 0;
const pending = new Map();

// 缩略图解码/缩放全部在 worker 线程完成，主进程只做调度，不再被图片解码阻塞 IPC
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

// 生成失败/文件不存在均返回 null，调用方按"无法生成"处理
async function generateThumbnailTiers(filepath) {
  if (!filepath || !fs.existsSync(filepath)) return null;
  try {
    const w = ensureWorker();
    const id = ++seq;
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, type: 'tiers', filepath });
    });
  } catch (e) {
    console.error('[缩略图] 生成失败:', e.message);
    return null;
  }
}

async function closeWorker() {
  if (worker) {
    const w = worker;
    worker = null;
    await w.terminate();
  }
}

module.exports = { generateThumbnailTiers, closeWorker };

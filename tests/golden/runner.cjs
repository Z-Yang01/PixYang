// Golden 测试 runner：
//   node tests/golden/runner.cjs --update   生成/刷新 baseline（spec.json + expect.*）并拷贝 input.jpg
//   node tests/golden/runner.cjs            比对模式（CI）：spec 深比较 + 输出像素 diff（maxDelta/meanDelta ≤ tolerance）
// baseline 首次生成后入仓；CI 只比对不更新。
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { editParamsToRenderSpec, listUnsupported } = require('../../shared/renderSpec.cjs');
const { renderSpecToSharp } = require('../../electron/render/renderSpecToSharp.cjs');

const CASES_DIR = path.join(__dirname, 'cases');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const UPDATE = process.argv.includes('--update');

// spec 快照比对排除时间戳字段
function stableSpec(spec) {
  const { meta, ...rest } = spec;
  return { ...rest, meta: { ...meta, generatedAt: '<ts>' } };
}

function listCases() {
  return fs.readdirSync(CASES_DIR).filter((d) =>
    fs.existsSync(path.join(CASES_DIR, d, 'case.json'))
  ).sort();
}

async function comparePixels(fileA, fileB) {
  const [a, b] = await Promise.all([
    sharp(fileA).raw().toBuffer({ resolveWithObject: true }),
    sharp(fileB).raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height || a.info.channels !== b.info.channels) {
    return { dimensionMismatch: true, sizeA: `${a.info.width}x${a.info.height}`, sizeB: `${b.info.width}x${b.info.height}` };
  }
  let maxDelta = 0;
  let sum = 0;
  const len = Math.min(a.data.length, b.data.length);
  for (let i = 0; i < len; i++) {
    const d = Math.abs(a.data[i] - b.data[i]);
    if (d > maxDelta) maxDelta = d;
    sum += d;
  }
  return { maxDelta, meanDelta: Number((sum / len).toFixed(4)) };
}

async function runCase(name) {
  const dir = path.join(CASES_DIR, name);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8'));
  const params = JSON.parse(fs.readFileSync(path.join(dir, 'params.json'), 'utf8'));

  // input.jpg：从 fixture 拷贝（首次）
  const input = path.join(dir, 'input.jpg');
  if (!fs.existsSync(input)) {
    fs.copyFileSync(path.join(FIXTURES_DIR, cfg.fixture), input);
  }

  const spec = editParamsToRenderSpec(params, { sourceHash: 'golden' });
  const specFile = path.join(dir, 'spec.json');
  const ext = params.output?.format === 'png' ? 'png' : 'jpg';
  const expectFile = path.join(dir, `expect.${ext}`);

  if (UPDATE) {
    fs.writeFileSync(specFile, JSON.stringify({ ...stableSpec(spec), meta: spec.meta }, null, 2));
    await renderSpecToSharp(spec, input, expectFile);
    const meta = await sharp(expectFile).metadata();
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
      width: meta.width, height: meta.height, format: meta.format,
      unsupported: listUnsupported(spec),
    }, null, 2));
    return { name, updated: true, unsupported: listUnsupported(spec) };
  }

  // 比对模式
  const problems = [];
  if (!fs.existsSync(specFile) || !fs.existsSync(expectFile)) {
    throw new Error(`baseline 缺失，先运行 runner --update（cases/${name}）`);
  }
  const specSnapshot = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  if (JSON.stringify(stableSpec(spec)) !== JSON.stringify(stableSpec(specSnapshot))) {
    problems.push('spec 与 baseline 不一致（参数语义或管线结构变化）');
  }
  const actualTmp = path.join(dir, `__actual__.${ext}`);
  await renderSpecToSharp(spec, input, actualTmp);
  const diff = await comparePixels(actualTmp, expectFile);
  fs.unlinkSync(actualTmp);
  if (diff.dimensionMismatch) {
    problems.push(`输出尺寸变化: ${diff.sizeA} vs ${diff.sizeB}`);
  } else {
    if (diff.maxDelta > cfg.tolerance.maxDelta) problems.push(`maxDelta ${diff.maxDelta} > ${cfg.tolerance.maxDelta}`);
    if (diff.meanDelta > cfg.tolerance.meanDelta) problems.push(`meanDelta ${diff.meanDelta} > ${cfg.tolerance.meanDelta}`);
  }
  return {
    name, ok: problems.length === 0, problems,
    maxDelta: diff.maxDelta, meanDelta: diff.meanDelta,
    unsupported: listUnsupported(spec),
  };
}

(async () => {
  const names = listCases();
  if (!names.length) {
    console.error('未找到 golden cases');
    process.exit(1);
  }
  let failed = 0;
  const unsupportedAll = new Set();
  for (const name of names) {
    const r = await runCase(name);
    if (r.unsupported) r.unsupported.forEach(k => unsupportedAll.add(k));
    if (UPDATE) {
      console.log(`[update] ${r.name}${r.unsupported?.length ? `（unsupported: ${r.unsupported.join(',')}）` : ''}`);
    } else if (!r.ok) {
      failed++;
      console.error(`[FAIL] ${r.name}: ${r.problems.join('; ')}`);
    } else {
      console.log(`[ok] ${r.name} (maxΔ=${r.maxDelta}, meanΔ=${r.meanDelta})`);
    }
  }
  if (!UPDATE && unsupportedAll.size) {
    console.log(`[info] 未实现阶段清单（M4~M8 盘点）: ${[...unsupportedAll].sort().join(', ')}`);
  }
  console.log(UPDATE ? `baseline 更新完成（${names.length} cases）` : (failed ? `${failed}/${names.length} 失败` : `${names.length}/${names.length} 全部通过`));
  process.exit(UPDATE || failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

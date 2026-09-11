// Golden 测试 CI 集成：遍历 cases 比对 spec 快照与像素（不更新 baseline）。
// baseline 更新：node tests/golden/runner.cjs --update（人工确认后入仓）。
import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { editParamsToRenderSpec, listUnsupported } from '../../../shared/renderSpec.cjs';
import { renderSpecToSharp } from '../../../electron/render/renderSpecToSharp.cjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(HERE, '..', '..', 'golden', 'cases');

// spec 快照比对排除时间戳
function stableSpec(spec) {
  const { meta, ...rest } = spec;
  return { ...rest, meta: { ...meta, generatedAt: '<ts>' } };
}

async function pixelDiff(aFile, bFile) {
  const [a, b] = await Promise.all([
    import('sharp').then((m) => m.default(aFile).raw().toBuffer({ resolveWithObject: true })),
    import('sharp').then((m) => m.default(bFile).raw().toBuffer({ resolveWithObject: true })),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return { dimensionMismatch: true };
  let maxDelta = 0;
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i] - b.data[i]);
    maxDelta = Math.max(maxDelta, d);
    sum += d;
  }
  return { maxDelta, meanDelta: sum / a.data.length };
}

const caseDirs = fs.existsSync(CASES_DIR)
  ? fs.readdirSync(CASES_DIR).filter((d) => fs.existsSync(path.join(CASES_DIR, d, 'case.json'))).sort()
  : [];

describe.skipIf(caseDirs.length === 0)('golden 像素锁定', () => {
  it.each(caseDirs)('%s：spec 快照与像素基线一致', async (name) => {
    const dir = path.join(CASES_DIR, name);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8'));
    const params = JSON.parse(fs.readFileSync(path.join(dir, 'params.json'), 'utf8'));
    const spec = editParamsToRenderSpec(params, { sourceHash: 'golden' });

    // spec 快照比对
    const snapshot = JSON.parse(fs.readFileSync(path.join(dir, 'spec.json'), 'utf8'));
    expect(stableSpec(spec)).toEqual(stableSpec(snapshot));

    // 像素比对
    const ext = params.output?.format === 'png' ? 'png' : 'jpg';
    const expectFile = path.join(dir, `expect.${ext}`);
    expect(fs.existsSync(expectFile)).toBe(true);
    const tmp = path.join(dir, `__vitest_actual__.${ext}`);
    await renderSpecToSharp(spec, path.join(dir, 'input.jpg'), tmp);
    const d = await pixelDiff(tmp, expectFile);
    fs.unlinkSync(tmp);

    expect(d.dimensionMismatch).not.toBe(true);
    expect(d.maxDelta).toBeLessThanOrEqual(cfg.tolerance.maxDelta);
    expect(d.meanDelta).toBeLessThanOrEqual(cfg.tolerance.meanDelta);
  });

  it('002 锁定 rotate→crop 顺序语义（400×600 输出）', () => {
    const params = JSON.parse(fs.readFileSync(path.join(CASES_DIR, '002-crop-rotate90', 'params.json'), 'utf8'));
    const spec = editParamsToRenderSpec(params, { sourceHash: 'golden' });
    const kinds = spec.stages.map((s) => s.kind);
    expect(kinds.indexOf('geometry')).toBeLessThan(kinds.indexOf('crop'));
  });

  it('009 未实现阶段显式 unsupported（curves/hsl）', () => {
    const params = JSON.parse(fs.readFileSync(path.join(CASES_DIR, '009-unsupported-curves-hsl', 'params.json'), 'utf8'));
    const spec = editParamsToRenderSpec(params, { sourceHash: 'golden' });
    const unsupported = listUnsupported(spec);
    expect(unsupported).toContain('curves');
    expect(unsupported).toContain('hsl');
  });
});

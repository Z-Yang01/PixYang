// Golden 测试（CI 集成）：spec 快照与管线结构断言。
// 像素锁定门禁在 Rust 执行器侧：cargo test --test golden_audit
//（基线 2026-09-20 起由 Rust 执行器产物锁定，Δ 审计见 tests/golden/rust-relock-audit.md）。
import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { editParamsToRenderSpec, listUnsupported } from '../../../shared/renderSpec.cjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(HERE, '..', '..', 'golden', 'cases');

// spec 快照比对排除时间戳
function stableSpec(spec) {
  const { meta, ...rest } = spec;
  return { ...rest, meta: { ...meta, generatedAt: '<ts>' } };
}

const caseDirs = fs.existsSync(CASES_DIR)
  ? fs.readdirSync(CASES_DIR).filter((d) => fs.existsSync(path.join(CASES_DIR, d, 'case.json'))).sort()
  : [];

describe.skipIf(caseDirs.length === 0)('golden spec 快照与结构锁定', () => {
  it.each(caseDirs)('%s：spec 快照与参数语义一致', (name) => {
    const dir = path.join(CASES_DIR, name);
    const params = JSON.parse(fs.readFileSync(path.join(dir, 'params.json'), 'utf8'));
    const spec = editParamsToRenderSpec(params, { sourceHash: 'golden' });

    // spec 快照比对
    const snapshot = JSON.parse(fs.readFileSync(path.join(dir, 'spec.json'), 'utf8'));
    expect(stableSpec(spec)).toEqual(stableSpec(snapshot));

    // 基线产物存在（像素比对在 cargo 门禁 golden_audit）
    const ext = params.output?.format === 'png' ? 'png' : 'jpg';
    expect(fs.existsSync(path.join(dir, `expect.${ext}`))).toBe(true);
  }, 30_000);

  it('002 锁定 rotate→crop 顺序语义（400×600 输出）', () => {
    const params = JSON.parse(fs.readFileSync(path.join(CASES_DIR, '002-crop-rotate90', 'params.json'), 'utf8'));
    const spec = editParamsToRenderSpec(params, { sourceHash: 'golden' });
    const kinds = spec.stages.map((s) => s.kind);
    expect(kinds.indexOf('geometry')).toBeLessThan(kinds.indexOf('crop'));
  });

  it('009 全部 14 阶段已支持（不再有 unsupported 清单）', () => {
    const params = JSON.parse(fs.readFileSync(path.join(CASES_DIR, '009-unsupported-curves-hsl', 'params.json'), 'utf8'));
    const spec = editParamsToRenderSpec(params, { sourceHash: 'golden' });
    expect(listUnsupported(spec)).toEqual([]);
  });
});

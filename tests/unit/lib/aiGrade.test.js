import { describe, it, expect, vi } from 'vitest';
import {
  buildMessages,
  parseSuggestion,
  pickExifSummary,
  suggestByVision,
  AI_DEFAULT_BASE_URL,
} from '@/lib/aiGrade';

const VALID = {
  exposure: 0.35,
  contrast: 12,
  highlights: -30,
  shadows: 15,
  whites: 0,
  blacks: -10,
  saturation: 5,
  temperature: 20,
  tint: -8,
};

describe('parseSuggestion 模型回复解析', () => {
  it('裸 JSON：九字段全收', () => {
    const { name, basic } = parseSuggestion(JSON.stringify({ basic: VALID }));
    expect(name).toBe('AI 调色');
    expect(basic).toEqual(VALID);
  });

  it('代码围栏与前后废话：剥围栏截取 JSON', () => {
    const text = `好的，以下是建议：\n\`\`\`json\n${JSON.stringify({ basic: VALID })}\n\`\`\`\n希望有帮助`;
    expect(parseSuggestion(text).basic.exposure).toBe(0.35);
  });

  it('白名单裁剪：模型越界输出的 crop/masks/output 被丢弃', () => {
    const text = JSON.stringify({
      basic: VALID,
      crop: { x: 0, y: 0, w: 100 },
      masks: [{ type: 'radial' }],
      orientation: { rotate: 90 },
    });
    const { basic } = parseSuggestion(text);
    expect(basic).toEqual(VALID);
  });

  it('缺字段回 0、非数值回 0、值域越界钳到边界', () => {
    const text = JSON.stringify({
      basic: { exposure: 99, contrast: 'abc', saturation: -250 },
    });
    const { basic } = parseSuggestion(text);
    expect(basic.exposure).toBe(2);
    expect(basic.contrast).toBe(0);
    expect(basic.saturation).toBe(-100);
    expect(basic.highlights).toBe(0);
    expect(basic.temperature).toBe(0);
  });

  it('空回复 / 无 JSON / 坏 JSON：抛带语义的错', () => {
    expect(() => parseSuggestion('')).toThrow('回复为空');
    expect(() => parseSuggestion('抱歉我无法处理')).toThrow('未找到 JSON');
    expect(() => parseSuggestion('{basic: 1,,}')).toThrow('无法解析');
  });
});

describe('buildMessages 提示构建', () => {
  it('有图：system + user（text+image_url 双部件），统计数字进 prompt', () => {
    const messages = buildMessages({
      imageDataUrl: 'data:image/jpeg;base64,QUJD',
      analysis: {
        mean: { r: 0.3, g: 0.35, b: 0.6, l: 0.416667 },
        p05: 0.75,
        p50: 0.8,
        p95: 0.98,
        shadowClipPct: 0,
        highlightClipPct: 0.15,
      },
      exif: { camera: ' Nikon Z6' },
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('-2..2');
    expect(messages[0].content).toContain('正值变暖');
    const parts = messages[1].content;
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('p50=0.8');
    expect(parts[0].text).toContain('高光裁切占比=0.15');
    expect(parts[1].image_url.url).toBe('data:image/jpeg;base64,QUJD');
  });

  it('无图/无统计：单 text 部件且不缺占位说明', () => {
    const messages = buildMessages({ imageDataUrl: null, analysis: null, exif: null });
    const parts = messages[1].content;
    expect(parts).toHaveLength(1);
    expect(parts[0].text).toContain('无量化统计');
  });

  it('pickExifSummary：只留白名单字段，全空返回 null', () => {
    expect(pickExifSummary({ camera: 'X', gps: 'y', iso: 400 })).toEqual({ camera: 'X', iso: 400 });
    expect(pickExifSummary({ gps: 'y' })).toBeNull();
    expect(pickExifSummary(null)).toBeNull();
  });
});

describe('suggestByVision 请求与响应', () => {
  const config = { baseUrl: `${AI_DEFAULT_BASE_URL}/`, apiKey: 'sk-test', model: 'gpt-4o-mini' };
  const input = { imageDataUrl: 'data:image/jpeg;base64,QUJD', analysis: { p50: 0.5 }, exif: null };

  function okFetch() {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ choices: [{ message: { content: JSON.stringify({ basic: VALID }) } }] }),
    });
  }

  it('POST 到 base+ /chat/completions：URL 去尾斜杠、Bearer 头、消息体形状', async () => {
    const fetchImpl = okFetch();
    const result = await suggestByVision(config, input, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${AI_DEFAULT_BASE_URL}/chat/completions`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toHaveLength(2);
    expect(result.basic.exposure).toBe(0.35);
  });

  it('缺密钥/模型名：不发请求直接抛', async () => {
    const fetchImpl = okFetch();
    await expect(suggestByVision({ ...config, apiKey: '' }, input, fetchImpl)).rejects.toThrow(
      '缺少 API 密钥'
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('非 200：抛带状态码与响应片段', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('{"error":"bad key"}'),
    });
    await expect(suggestByVision(config, input, fetchImpl)).rejects.toThrow('401');
  });

  it('超时覆盖读体阶段：fetch 与 response.json() 挂起都会以中文超时错误中断', async () => {
    // fetch 阶段挂起：signal abort 时才 reject
    const hangFetch = vi.fn(
      (url, init) =>
        new Promise((_, rej) => {
          init.signal.addEventListener('abort', () =>
            rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );
    await expect(suggestByVision(config, input, hangFetch, { timeoutMs: 20 })).rejects.toThrow(
      'AI 请求超时（0 秒无响应）'
    );
    // 读体阶段挂起：响应头已到但 json() 永不 resolve（真实 json() 会响应 abort，mock 同法模拟）
    const hangJson = vi.fn((url, init) => ({
      ok: true,
      json: () =>
        new Promise((_, rej) => {
          init.signal.addEventListener('abort', () =>
            rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        }),
    }));
    await expect(suggestByVision(config, input, hangJson, { timeoutMs: 20 })).rejects.toThrow(
      'AI 请求超时'
    );
  }, 5000);

  it('响应缺 choices：抛结构错', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    await expect(suggestByVision(config, input, fetchImpl)).rejects.toThrow('choices');
  });
});

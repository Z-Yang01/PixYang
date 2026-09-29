// AI 调色建议器（Phase 2）：400px 代理底图 + analyze_image 统计 + EXIF 摘要发给
// OpenAI 兼容视觉模型，模型只回 basic 影调域 JSON。经字段白名单裁剪 + editSchema
// normalizeEdits 兜底（zod catch 防越界）后，走与本地自动调色完全相同的 applyPreset
// 通路。传输面仅 ≤400px JPEG（base64）与文字摘要，原图不出库；密钥存本机 settings 表。
// 端点须支持浏览器直连（CORS）：OpenAI 官方/多数代理/本地 Ollama（需 OLLAMA_ORIGINS）均可。

import editSchemaModule from '../../shared/editSchema.cjs';

const { normalizeEdits } = editSchemaModule;

export const AI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

// 与 shared/editSchema.cjs BasicSchema 同域：九个影调字段
const BASIC_KEYS = [
  'exposure',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'saturation',
  'temperature',
  'tint',
];

// EXIF 只挑对调色有上下文价值的字段，控制 payload
export function pickExifSummary(exif) {
  if (!exif || typeof exif !== 'object') return null;
  const out = {};
  for (const key of ['camera', 'lens', 'iso', 'exposure', 'focalLength']) {
    if (exif[key]) out[key] = exif[key];
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function buildMessages({ imageDataUrl, analysis, exif } = {}) {
  const system = [
    '你是专业照片调色师。根据给出的画面统计与缩略图，输出照片影调参数建议。',
    '参数域与语义（严格遵守符号约定）：',
    '- exposure：曝光（EV，-2..2，步进 0.05）',
    '- contrast：对比度（-50..50）',
    '- highlights：高光（-100..100，负值压回过曝亮部）',
    '- shadows：阴影（-100..100，正值提亮暗部）',
    '- whites：白色色阶（-100..100，正值提亮白场）',
    '- blacks：黑色色阶（-100..100，负值加深黑场）',
    '- saturation：饱和度（-100..100）',
    '- temperature：色温（-100..100，正值变暖=画面偏蓝时用正）',
    '- tint：色调（-100..100，正值压绿偏品红=画面偏绿时用正）',
    '只输出一个 JSON 对象，不要任何解释或代码围栏：',
    '{"basic":{"exposure":0,"contrast":0,"highlights":0,"shadows":0,"whites":0,"blacks":0,"saturation":0,"temperature":0,"tint":0}}',
    '九个键必须齐全，没有必要的项取 0。不要建议裁剪、旋转、蒙版等其他域。',
  ].join('\n');

  const stats = analysis
    ? [
        `画面统计：`,
        `亮度均值 l=${analysis.mean?.l ?? '未知'}（R=${analysis.mean?.r ?? '?'} G=${analysis.mean?.g ?? '?'} B=${analysis.mean?.b ?? '?'}）`,
        `亮度分位 p05=${analysis.p05 ?? '?'} p50=${analysis.p50 ?? '?'} p95=${analysis.p95 ?? '?'}（0..1）`,
        `阴影裁切占比=${analysis.shadowClipPct ?? 0}，高光裁切占比=${analysis.highlightClipPct ?? 0}`,
      ].join('\n')
    : '（无量化统计）';
  const exifText = exif ? `\n拍摄信息：${JSON.stringify(exif)}` : '';

  const textPart = `${stats}${exifText}\n请给出这张照片的影调建议。`;
  const parts = [{ type: 'text', text: textPart }];
  if (imageDataUrl) {
    parts.push({ type: 'image_url', image_url: { url: imageDataUrl } });
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: parts },
  ];
}

// 各字段值域（与 shared/editSchema.cjs BasicSchema 同域）：先钳到边界再交给
// normalizeEdits，轻微越界（如 exposure 2.5）保留为边界值而非被 .catch 归零
const BASIC_RANGES = {
  exposure: [-2, 2],
  contrast: [-50, 50],
  highlights: [-100, 100],
  shadows: [-100, 100],
  whites: [-100, 100],
  blacks: [-100, 100],
  saturation: [-100, 100],
  temperature: [-100, 100],
  tint: [-100, 100],
};

// 从模型回复提取建议：剥代码围栏 → 截取首个 {...} → JSON.parse →
// 只保留 basic 九字段白名单并钳制值域 → normalizeEdits 结构兜底（永不抛错）
export function parseSuggestion(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('模型回复为空');
  }
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('模型回复中未找到 JSON');
  }
  let parsed;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error('模型回复的 JSON 无法解析');
  }
  const rawBasic = parsed?.basic && typeof parsed.basic === 'object' ? parsed.basic : parsed;
  const basic = {};
  for (const key of BASIC_KEYS) {
    const v = Number(rawBasic?.[key]);
    if (!Number.isFinite(v)) {
      basic[key] = 0;
      continue;
    }
    const [min, max] = BASIC_RANGES[key];
    basic[key] = Math.min(max, Math.max(min, v));
  }
  const normalized = normalizeEdits({ schemaVersion: 1, basic });
  return { name: 'AI 调色', basic: normalized.basic };
}

/**
 * @param {{baseUrl: string, apiKey: string, model: string}} config 设置页配置
 * @param {{imageDataUrl?: string|null, analysis?: object, exif?: object|null}} input
 * @param {typeof fetch} fetchImpl 注入点（单测替换）
 * @param {{timeoutMs?: number}} opts 超时可注入（单测用）
 * @returns {Promise<{name: string, basic: object}>}
 */
export async function suggestByVision(config, input, fetchImpl = globalThis.fetch, opts = {}) {
  if (!config?.apiKey || !config?.model) {
    throw new Error('缺少 API 密钥或模型名');
  }
  const base = (config.baseUrl || AI_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = Number(opts.timeoutMs) || 60_000;
  const controller = new AbortController();
  // 超时必须同时覆盖响应头与读体阶段：只护 fetch 的话，服务端挂着不发 body
  // 会让 await 永不 resolve，AI 按钮的 busy 态永久卡死
  let timedOut = false;
  const arm = () =>
    setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  let timer = arm();
  const asUserError = (e) => {
    if (timedOut || e?.name === 'AbortError') {
      return new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)} 秒无响应）`);
    }
    return e;
  };
  let response;
  try {
    response = await (fetchImpl || globalThis.fetch)(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: buildMessages(input),
        temperature: 0.2,
        max_tokens: 300,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw asUserError(e);
  }
  if (!response.ok) {
    clearTimeout(timer);
    const body = await response.text().catch(() => '');
    throw new Error(`接口返回 ${response.status}${body ? `：${body.slice(0, 200)}` : ''}`);
  }
  clearTimeout(timer);
  timer = arm();
  let data;
  try {
    data = await response.json();
  } catch (e) {
    throw asUserError(e);
  } finally {
    clearTimeout(timer);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('接口响应缺少 choices[0].message.content');
  }
  return parseSuggestion(content);
}

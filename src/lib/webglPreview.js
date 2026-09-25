// M7 WebGL2 预览渲染器：shader 直接消费 RenderSpec uniforms（specToShaderUniforms 产出），
// 与 Rust 执行器共享 shared/ 数学（曲线 LUT/HSL/分级/暗角逐像素同公式）。
// 无 WebGL2 环境由调用方回退 CSS/SVG 滤镜链。几何/裁剪不在此渲染（CSS transform 承担）。

const VERTEX_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uImage;
uniform sampler2D uCurveLut;
uniform float uCurveLutOn;
uniform vec3 uAffineSlope;
uniform float uAffineOffset;
uniform vec2 uShadows;          // x=exponent(0=off), y=invert
uniform float uHighlightsSlope;
uniform float uHslOn;
uniform float uHslHue[8];
uniform float uHslSat[8];
uniform float uHslLum[8];
uniform float uHslCenters[8];
uniform float uBandRadius;
uniform float uHueMaxDeg;
uniform float uLumMax;
uniform float uGradingOn;
uniform vec3 uGradingScale;
uniform vec3 uGradingDelta0;
uniform vec3 uGradingDelta1;
uniform vec3 uGradingDelta2;
uniform float uSaturation;
uniform float uMono;
uniform float uVignette;
uniform float uMaskOn;
uniform vec2 uImageSize;        // 底图全尺寸（蒙版几何为 pre-crop 像素坐标）
uniform float uMaskType[8];     // 0 none, 1 radial, 2 linear, 3 range（与 previewUniforms 打包一致）
uniform vec4 uMaskGeo[8];       // radial: cx,cy,rx,ry / linear: x0,y0,x1,y1 / range: center,range,0,0
uniform float uMaskRotation[8];
uniform float uMaskFeather[8];
uniform float uMaskInvert[8];
uniform float uMaskAdjExposure[8];
uniform float uMaskAdjContrast[8];
uniform float uMaskAdjSat[8];
uniform float uMaskAdjTemp[8];
uniform float uMaskAdjTint[8];

float maskWeight(int i, vec2 px, vec3 c) {
  vec4 g = uMaskGeo[i];
  float w;
  if (uMaskType[i] < 1.5) {
    vec2 d = px - g.xy;
    float a = radians(uMaskRotation[i]);
    vec2 u = vec2(d.x * cos(a) + d.y * sin(a), -d.x * sin(a) + d.y * cos(a));
    float dist = length(u / g.zw);
    w = uMaskFeather[i] > 0.0 ? clamp((1.0 - dist) / uMaskFeather[i], 0.0, 1.0) : (dist < 1.0 ? 1.0 : 0.0);
  } else if (uMaskType[i] < 2.5) {
    vec2 dir = g.zw - g.xy;
    float len2 = dot(dir, dir);
    if (len2 <= 0.0) return uMaskInvert[i] > 0.5 ? 1.0 : 0.0;
    w = clamp(dot(px - g.xy, dir) / len2, 0.0, 1.0);
  } else {
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float dd = abs(L - g.x);
    w = uMaskFeather[i] > 0.0 ? clamp((g.y + uMaskFeather[i] - dd) / uMaskFeather[i], 0.0, 1.0) : (dd <= g.y ? 1.0 : 0.0);
  }
  if (uMaskInvert[i] > 0.5) w = 1.0 - w;
  return w;
}

void applyMaskedAdjust(int i, float w, inout vec3 c) {
  if (uMaskAdjExposure[i] != 0.0) c *= pow(2.0, uMaskAdjExposure[i] * w);
  float tk = uMaskAdjTemp[i] / 100.0 * w;
  float gk = uMaskAdjTint[i] / 100.0 * w;
  if (tk != 0.0 || gk != 0.0) c = vec3(c.r * (1.0 + tk * 0.1), c.g * (1.0 - gk * 0.06), c.b * (1.0 - tk * 0.1));
  if (uMaskAdjContrast[i] != 0.0) c = (c - 0.5) * (1.0 + (uMaskAdjContrast[i] / 50.0) * w) + 0.5;
  if (uMaskAdjSat[i] != 0.0) {
    float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = y + (c - y) * (1.0 + (uMaskAdjSat[i] / 100.0) * w);
  }
  // 与 shared/masks.cjs applyMaskedAdjustment 一致：每个蒙版独立钳制，避免越界值串入下一蒙版
  c = clamp(c, 0.0, 1.0);
}

vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) / 2.0;
  if (mx == mn) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = (l > 0.0 && l < 1.0) ? d / (1.0 - abs(2.0 * l - 1.0)) : 0.0;
  float h;
  if (mx == c.r) h = 60.0 * mod((c.g - c.b) / d, 6.0);
  else if (mx == c.g) h = 60.0 * ((c.b - c.r) / d + 2.0);
  else h = 60.0 * ((c.r - c.g) / d + 4.0);
  return vec3(mod(h, 360.0), s, l);
}

float hue2rgb(float p, float q, float t) {
  t = mod(t, 1.0);
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y == 0.0) return vec3(hsl.z);
  float h = hsl.x / 360.0;
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0));
}

float bandWeight(float center, float h) {
  float d = abs(mod(h - center + 180.0, 360.0) - 180.0);
  return max(0.0, 1.0 - d / uBandRadius);
}

float weighted(float adj[8], float h) {
  float sum = 0.0;
  float wsum = 0.0;
  for (int i = 0; i < 8; i++) {
    float w = bandWeight(uHslCenters[i], h);
    if (w <= 0.0) continue;
    wsum += w;
    sum += adj[i] * w;
  }
  return wsum > 0.0 ? sum / wsum : 0.0;
}

void main() {
  vec3 c = texture(uImage, vUv).rgb;
  c = clamp(c * uAffineSlope + uAffineOffset, 0.0, 1.0);
  if (uShadows.x > 0.0) {
    c = uShadows.y > 0.5 ? 1.0 - pow(1.0 - c, vec3(uShadows.x)) : pow(c, vec3(uShadows.x));
  }
  if (uHighlightsSlope != 1.0) c = clamp(c * uHighlightsSlope, 0.0, 1.0);
  if (uCurveLutOn > 0.5) {
    // texelFetch 显式最近邻取整（round 语义），与执行器 applyCurveLutsInPlace 的
    // data[byte] 同式；NEAREST+floor(u*256) 在上半值区间存在差一输入档的采样分叉
    c = vec3(
      texelFetch(uCurveLut, ivec2(int(c.r * 255.0 + 0.5), 0), 0).r,
      texelFetch(uCurveLut, ivec2(int(c.g * 255.0 + 0.5), 0), 0).g,
      texelFetch(uCurveLut, ivec2(int(c.b * 255.0 + 0.5), 0), 0).b
    );
  }
  if (uHslOn > 0.5) {
    vec3 hsl = rgb2hsl(c);
    float hueAdj = weighted(uHslHue, hsl.x) / 100.0 * uHueMaxDeg;
    float satAdj = weighted(uHslSat, hsl.x) / 100.0;
    float lumAdj = weighted(uHslLum, hsl.x) / 100.0 * uLumMax;
    c = hsl2rgb(vec3(mod(hsl.x + hueAdj, 360.0), clamp(hsl.y * (1.0 + satAdj), 0.0, 1.0), clamp(hsl.z + lumAdj, 0.0, 1.0)));
  }
  if (uGradingOn > 0.5) {
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    for (int i = 0; i < 3; i++) {
      float scale = i == 0 ? uGradingScale.x : (i == 1 ? uGradingScale.y : uGradingScale.z);
      if (scale <= 0.0) continue;
      float w = i == 0 ? clamp(1.0 - L / 0.5, 0.0, 1.0)
        : i == 1 ? clamp(1.0 - abs(L - 0.5) / 0.35, 0.0, 1.0)
          : clamp((L - 0.5) / 0.5, 0.0, 1.0);
      w *= w;
      vec3 delta = i == 0 ? uGradingDelta0 : (i == 1 ? uGradingDelta1 : uGradingDelta2);
      c += (w * scale / 255.0) * delta;
    }
    c = clamp(c, 0.0, 1.0);
  }
  float luma = dot(c, vec3(0.213, 0.715, 0.072));
  if (uMono > 0.5) c = vec3(luma);
  else if (uSaturation != 1.0) c = mix(vec3(luma), c, uSaturation);
  if (uMaskOn > 0.5) {
    vec2 px = vUv * uImageSize;
    for (int i = 0; i < 8; i++) {
      if (uMaskType[i] < 0.5) continue;
      float w = maskWeight(i, px, c);
      if (w > 0.0) applyMaskedAdjust(i, w, c);
    }
    c = clamp(c, 0.0, 1.0);
  }
  if (uVignette != 0.0) {
    float d = length((vUv - 0.5) * 2.0);
    float f = clamp((d - 0.5) / 0.5, 0.0, 1.0);
    if (uVignette < 0.0) c *= 1.0 + (uVignette / 100.0) * f;
    else c += (uVignette / 100.0) * f * (1.0 - c);
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

let cachedAvailability = null;

export function isWebGL2Available() {
  if (cachedAvailability !== null) return cachedAvailability;
  try {
    const probe = document.createElement('canvas');
    cachedAvailability = !!probe.getContext('webgl2');
  } catch {
    cachedAvailability = false;
  }
  return cachedAvailability;
}

// 全分辨率出帧的画布长边上限；draft（滑杆拖动中）再降一档，像素量 1/4
const FULL_EDGE = 2048;
const DRAFT_EDGE = 896;

export function previewDrawSize(naturalWidth, naturalHeight, maxEdge) {
  const longEdge = Math.max(naturalWidth, naturalHeight);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  return {
    w: Math.max(1, Math.round(naturalWidth * scale)),
    h: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

// 每画布状态（gl 上下文/程序/纹理缓存）
const stateByCanvas = new WeakMap();

function getUniformLocations(gl, program) {
  const names = [
    'uImage',
    'uCurveLut',
    'uCurveLutOn',
    'uAffineSlope',
    'uAffineOffset',
    'uShadows',
    'uHighlightsSlope',
    'uHslOn',
    'uHslHue',
    'uHslSat',
    'uHslLum',
    'uHslCenters',
    'uBandRadius',
    'uHueMaxDeg',
    'uLumMax',
    'uGradingOn',
    'uGradingScale',
    'uGradingDelta0',
    'uGradingDelta1',
    'uGradingDelta2',
    'uSaturation',
    'uMono',
    'uVignette',
    'uMaskOn',
    'uImageSize',
    'uMaskType',
    'uMaskGeo',
    'uMaskRotation',
    'uMaskFeather',
    'uMaskInvert',
    'uMaskAdjExposure',
    'uMaskAdjContrast',
    'uMaskAdjSat',
    'uMaskAdjTemp',
    'uMaskAdjTint',
  ];
  const locs = {};
  for (const n of names) locs[n] = gl.getUniformLocation(program, n);
  return locs;
}

function initCanvas(canvas) {
  const gl = canvas.getContext('webgl2', {
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(`[webgl] shader 编译失败: ${gl.getShaderInfoLog(sh)}`);
    }
    return sh;
  };
  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SRC));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`[webgl] 程序链接失败: ${gl.getProgramInfoLog(program)}`);
    }
  } catch (e) {
    console.error(e.message);
    return null;
  }
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  const lutTexture = gl.createTexture();
  return {
    gl,
    program,
    locs: getUniformLocations(gl, program),
    texture,
    lutTexture,
    lastSrc: null,
    lastTexEdge: 0,
  };
}

// 主入口：canvas 上绘制 uniforms 驱动的预览。image 须已加载（complete && naturalWidth>0）。
// 失败返回 false，调用方回退 CSS/SVG。异步（纹理上传走 createImageBitmap 跳过浏览器
// 色彩转换——导出在原生编码值上编辑，预览纹理也必须取原生值，宽色域 tagged 图才一致）。
// opts.draft：滑杆拖动中的草稿帧，画布按 1024 长边出帧，settled 后由调用方补全分辨率帧。
export async function renderWebGLPreview(canvas, image, uniforms, opts = {}) {
  const draft = !!opts.draft;
  let st = stateByCanvas.get(canvas);
  if (st && st.gl && st.gl.isContextLost()) stateByCanvas.delete(canvas);
  if (!st || !st.gl || st.gl.isContextLost()) {
    st = initCanvas(canvas);
    if (!st) return false;
    // 丢失的上下文上 getContext 返回同一具尸体且不抛错：init 后必须再验一次，
    // 否则照常走完静默绘制并谎报成功（true），画布永久空白且 CSS 回退永不触发（审查批 8 P-1）
    if (st.gl.isContextLost()) return false;
    stateByCanvas.set(canvas, st);
  }
  const { gl, locs } = st;
  const seq = (st.drawSeq = (st.drawSeq || 0) + 1); // 异步上传的过期绘制丢弃
  try {
    const { w, h } = previewDrawSize(
      image.naturalWidth,
      image.naturalHeight,
      draft ? DRAFT_EDGE : FULL_EDGE
    );
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(st.program);

    // 底图纹理（按 src + 纹理边长缓存，滑杆调节不重复上传）。
    // 上传即在 bitmap 阶段降采样到画布上限：画布输出从不超过 FULL_EDGE，全尺寸原图
    // 纹理（24MP ≈ 96MB 传输/显存）纯属浪费；draft 首帧会先传低清版，settled 补传全清。
    // createImageBitmap colorSpaceConversion:'none'——浏览器默认会把 tagged 图转到 sRGB，
    // 而导出在原生编码值上编辑，预览纹理必须同为原生值（宽色域 P3 等才与导出一致）。
    if (st.lastSrc !== image.src || (st.lastTexEdge || 0) < w) {
      gl.bindTexture(gl.TEXTURE_2D, st.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      let source = image;
      if (typeof createImageBitmap === 'function') {
        try {
          const scaled = w !== image.naturalWidth || h !== image.naturalHeight;
          const bitmap = await createImageBitmap(image, {
            ...(scaled ? { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' } : {}),
            colorSpaceConversion: 'none',
            premultiplyAlpha: 'none',
          });
          if (seq !== st.drawSeq) {
            bitmap.close();
            // 过期绘制 ≠ 渲染失败：返回 false 会让调用方把 webglFailed 误闩锁
            return true;
          }
          source = bitmap;
        } catch {
          /* 构造失败回退直接上传（可能经浏览器色彩转换） */
        }
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      if (source !== image) source.close();
      st.lastSrc = image.src;
      st.lastTexEdge = w;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, st.texture);
    gl.uniform1i(locs.uImage, 0);

    // 曲线 LUT 纹理（4KB，每次重传无压力）
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, st.lutTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (uniforms.curveLut) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        256,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        uniforms.curveLut
      );
    }
    gl.uniform1i(locs.uCurveLut, 1);
    gl.uniform1f(locs.uCurveLutOn, uniforms.curveLut ? 1 : 0);

    gl.uniform3fv(locs.uAffineSlope, uniforms.affineSlope);
    gl.uniform1f(locs.uAffineOffset, uniforms.affineOffset255 / 255);
    gl.uniform2f(
      locs.uShadows,
      uniforms.shadows ? uniforms.shadows.exponent : 0,
      uniforms.shadows ? uniforms.shadows.invert : 0
    );
    gl.uniform1f(locs.uHighlightsSlope, uniforms.highlightsSlope);
    gl.uniform1f(locs.uHslOn, uniforms.hslOn);
    gl.uniform1fv(locs.uHslHue, uniforms.hslHue);
    gl.uniform1fv(locs.uHslSat, uniforms.hslSat);
    gl.uniform1fv(locs.uHslLum, uniforms.hslLum);
    gl.uniform1fv(locs.uHslCenters, uniforms.hslBands);
    gl.uniform1f(locs.uBandRadius, 60);
    gl.uniform1f(locs.uHueMaxDeg, 30);
    gl.uniform1f(locs.uLumMax, 0.3);
    gl.uniform1f(locs.uGradingOn, uniforms.gradingOn);
    gl.uniform3fv(locs.uGradingScale, uniforms.gradingScale);
    gl.uniform3fv(locs.uGradingDelta0, uniforms.gradingDelta[0]);
    gl.uniform3fv(locs.uGradingDelta1, uniforms.gradingDelta[1]);
    gl.uniform3fv(locs.uGradingDelta2, uniforms.gradingDelta[2]);
    gl.uniform1f(locs.uSaturation, uniforms.saturation);
    gl.uniform1f(locs.uMono, uniforms.mono);
    gl.uniform1f(locs.uVignette, uniforms.vignette);
    gl.uniform1f(locs.uMaskOn, uniforms.maskOn || 0);
    gl.uniform2fv(locs.uImageSize, uniforms.imageSize || [0, 0]);
    gl.uniform1fv(locs.uMaskType, uniforms.maskType);
    gl.uniform4fv(locs.uMaskGeo, uniforms.maskGeo.flat());
    gl.uniform1fv(locs.uMaskRotation, uniforms.maskRotation);
    gl.uniform1fv(locs.uMaskFeather, uniforms.maskFeather);
    gl.uniform1fv(locs.uMaskInvert, uniforms.maskInvert);
    gl.uniform1fv(locs.uMaskAdjExposure, uniforms.maskAdjExposure);
    gl.uniform1fv(locs.uMaskAdjContrast, uniforms.maskAdjContrast);
    gl.uniform1fv(locs.uMaskAdjSat, uniforms.maskAdjSat);
    gl.uniform1fv(locs.uMaskAdjTemp, uniforms.maskAdjTemp);
    gl.uniform1fv(locs.uMaskAdjTint, uniforms.maskAdjTint);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  } catch (e) {
    console.error('[webgl] 预览渲染失败:', e.message);
    return false;
  }
}

// 主动释放画布的 GL 资源与上下文：canvas 卸载（切换 showBefore/对比模式、退出编辑、
// 卸载查看器）不会自动回收 WebGL 上下文，浏览器对每页活动上下文数有上限（约 16），
// 反复进出编辑重挂画布会耗尽配额导致 initCanvas 拿不到上下文（审查批 8 P-1）
export function releaseWebGLPreview(canvas) {
  const st = stateByCanvas.get(canvas);
  if (!st) return;
  stateByCanvas.delete(canvas);
  const { gl, program, texture, lutTexture } = st;
  if (!gl) return;
  try {
    if (!gl.isContextLost()) {
      if (texture) gl.deleteTexture(texture);
      if (lutTexture) gl.deleteTexture(lutTexture);
      if (program) gl.deleteProgram(program);
    }
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch (e) {
    console.error('[webgl] 资源释放失败:', e.message);
  }
}

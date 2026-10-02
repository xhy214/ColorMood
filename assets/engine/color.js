// 颜色数学：HSL/RGB/Hex/OKLab 互转、插值、亮度与对比度
window.ColorMood = window.ColorMood || {};
window.ColorMood.color = (function () {
  function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    s = clamp(s, 0, 1); l = clamp(l, 0, 1);
    if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    function hue2rgb(t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return { r: Math.round(hue2rgb(h + 1 / 3) * 255), g: Math.round(hue2rgb(h) * 255), b: Math.round(hue2rgb(h - 1 / 3) * 255) };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s: s, l: l };
  }

  function hexToRgb(hex) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex(r, g, b) {
    function c(v) { const s = clamp(Math.round(v), 0, 255).toString(16); return s.length === 1 ? "0" + s : s; }
    return "#" + c(r) + c(g) + c(b);
  }

  function hslToHex(h, s, l) { const c = hslToRgb(h, s, l); return rgbToHex(c.r, c.g, c.b); }
  function hexToHsl(hex) { const c = hexToRgb(hex); return rgbToHsl(c.r, c.g, c.b); }

  // sRGB -> OKLab
  function oklabFromRgb(r, g, b) {
    function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    const lr = lin(r), lg = lin(g), lb = lin(b);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return {
      L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    };
  }

  // OKLab -> sRGB
  function rgbFromOklab(L, a, b) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    let bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    function gam(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
    return { r: clamp(gam(r) * 255, 0, 255), g: clamp(gam(g) * 255, 0, 255), b: clamp(gam(bl) * 255, 0, 255) };
  }

  function oklabFromHex(hex) { const c = hexToRgb(hex); return oklabFromRgb(c.r, c.g, c.b); }
  function oklabFromHsl(h, s, l) { const c = hslToRgb(h, s, l); return oklabFromRgb(c.r, c.g, c.b); }
  function hexFromOklab(L, a, b) { const c = rgbFromOklab(L, a, b); return rgbToHex(c.r, c.g, c.b); }

  // OKLab 感知均匀插值
  function mixHex(hex1, hex2, t) {
    const A = oklabFromHex(hex1), B = oklabFromHex(hex2);
    t = clamp(t, 0, 1);
    return hexFromOklab(A.L + (B.L - A.L) * t, A.a + (B.a - A.a) * t, A.b + (B.b - A.b) * t);
  }

  // 多个 hex 按权重在 OKLab 混合
  function mixWeighted(pairs) {
    let L = 0, a = 0, b = 0, total = 0;
    for (let i = 0; i < pairs.length; i++) {
      const lab = oklabFromHex(pairs[i].hex);
      const w = pairs[i].weight || 1;
      L += lab.L * w; a += lab.a * w; b += lab.b * w; total += w;
    }
    if (total === 0) return "#9E9E9E";
    return hexFromOklab(L / total, a / total, b / total);
  }

  // WCAG 相对亮度
  function luminance(hex) {
    const c = hexToRgb(hex);
    function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  function contrast(hex1, hex2) {
    const l1 = luminance(hex1), l2 = luminance(hex2);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  // 根据背景选可读前景色
  function readableForeground(bgHex) {
    const dark = "#1A1A2E", light = "#FFFFFF";
    return contrast(bgHex, light) >= contrast(bgHex, dark) ? light : dark;
  }

  // 字符串确定性哈希（作为颜色种子）
  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  function lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }

  return {
    clamp: clamp, lerp: lerp,
    hslToRgb: hslToRgb, rgbToHsl: rgbToHsl,
    hexToRgb: hexToRgb, rgbToHex: rgbToHex,
    hslToHex: hslToHex, hexToHsl: hexToHsl,
    oklabFromHex: oklabFromHex, hexFromOklab: hexFromOklab, oklabFromHsl: oklabFromHsl,
    mixHex: mixHex, mixWeighted: mixWeighted,
    luminance: luminance, contrast: contrast, readableForeground: readableForeground,
    hashSeed: hashSeed
  };
})();

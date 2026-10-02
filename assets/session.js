// 本次页面打开期间的 buffer：只在内存中保存，不写入任何浏览器存储。
window.ColorMood = window.ColorMood || {};
window.ColorMood.session = (function () {
  let buffer = new Map();
  let epoch = 0;
  let active = true;
  function normalize(text) { return String(text || "").replace(/\r\n?/g, "\n").trim(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function start() { buffer.clear(); buffer = new Map(); epoch++; active = true; }
  function end() { buffer.clear(); epoch++; active = false; }
  function get(text) { return active && buffer.has(normalize(text)) ? clone(buffer.get(normalize(text))) : null; }
  function put(text, result, expectedEpoch) {
    if (!active || (expectedEpoch !== undefined && expectedEpoch !== epoch)) return false;
    buffer.set(normalize(text), clone(result));
    return true;
  }
  return {
    start: start, end: end, get: get, put: put, normalize: normalize,
    has: function (text) { return active && buffer.has(normalize(text)); },
    version: function () { return epoch; },
    size: function () { return buffer.size; }
  };
})();

// 全局状态 + 持久成就/色卡；原始输入和 API buffer 不写入本地存储。
window.ColorMood = window.ColorMood || {};
window.ColorMood.store = (function () {
  const LS_ACHIEVEMENTS = "colormood.achievements";
  const LS_ACH_VIEWED = "colormood.achViewedAt";
  const LS_PREFS = "colormood.prefs";
  const LS_COLLECTION = "colormood.collection.v1";
  let collection = null;

  const state = {
    text: "",
    theme: "light", // light | dark
    colorState: null,
    prefs: { colorblind: false, posterStyle: "radar" }
  };

  const listeners = {};
  function on(event, cb) {
    (listeners[event] = listeners[event] || []).push(cb);
  }
  function emit(event, payload) {
    (listeners[event] || []).forEach(function (cb) { cb(payload); });
  }

  function set(key, value) {
    state[key] = value;
    emit(key, value);
    emit("change", state);
  }

  // —— 偏好 ——
  function loadPrefs() {
    try {
      const raw = localStorage.getItem(LS_PREFS);
      if (raw) {
        const data = JSON.parse(raw);
        state.prefs = Object.assign(state.prefs, data.prefs || data);
        if (data.theme) state.theme = data.theme;
      }
    } catch (e) { /* 存储不可用时静默 */ }
    return state.prefs;
  }
  function savePrefs() {
    try { localStorage.setItem(LS_PREFS, JSON.stringify({ prefs: state.prefs, theme: state.theme })); } catch (e) {}
  }

  // —— 成就 ——
  function loadAchievements() {
    try {
      const raw = localStorage.getItem(LS_ACHIEVEMENTS);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  // 成就栏最后查看时间：NEW 徽标一次性显示，打开即视为已读
  function loadViewedAt() {
    try {
      const v = parseInt(localStorage.getItem(LS_ACH_VIEWED), 10);
      return isFinite(v) ? v : 0;
    } catch (e) { return 0; }
  }
  function saveViewedAt(ts) {
    try { localStorage.setItem(LS_ACH_VIEWED, String(ts)); } catch (e) {}
  }
  function unlockAchievement(label) {
    const key = (label || "").trim();
    if (!key) return null;
    const ach = loadAchievements();
    if (!ach[key]) {
      ach[key] = Date.now();
      try { localStorage.setItem(LS_ACHIEVEMENTS, JSON.stringify(ach)); } catch (e) {}
    }
    return ach[key];
  }

  function personalityNames() {
    const P = window.ColorMood.strategies.PERSONALITY;
    return Object.values(P.A1).concat(Object.values(P.A2), Object.values(P.B), [P.C]).map(function (v) { return v.trim(); });
  }

  function loadCollection() {
    if (collection) return collection;
    let data = {};
    try { data = JSON.parse(localStorage.getItem(LS_COLLECTION) || "{}"); } catch (e) {}
    if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
    collection = {
      total: Number.isFinite(data.total) ? Math.max(0, data.total) : 0,
      cards: Array.isArray(data.cards) ? data.cards : [],
      seen: data.seen && typeof data.seen === "object" ? data.seen : {},
      dominant: data.dominant && typeof data.dominant === "object" ? data.dominant : {},
      mixes: data.mixes && typeof data.mixes === "object" ? data.mixes : {},
      milestones: data.milestones && typeof data.milestones === "object" ? data.milestones : {}
    };
    return collection;
  }

  function saveCollection() {
    try { localStorage.setItem(LS_COLLECTION, JSON.stringify(loadCollection())); } catch (e) {}
  }

  function collectionProgress() {
    const unlocked = loadAchievements();
    const names = personalityNames();
    const count = names.filter(function (name) { return !!unlocked[name]; }).length;
    return { count: count, total: names.length, cards: loadCollection().total };
  }

  function explorationDefinitions() {
    const data = loadCollection();
    const colors = window.ColorMood.strategies.EMOTION_COLORS;
    const mixedNames = Object.values(window.ColorMood.strategies.PERSONALITY.B);
    return [
      { id: "first_card", name: "第一抹心情", hint: "生成你的第一张色卡", target: 1, progress: data.total },
      { id: "six_emotions", name: "六色旅途", hint: "收集六种不同的主情绪", target: 6, progress: Object.keys(colors).filter(function (key) { return !!data.dominant[key]; }).length },
      { id: "five_mixes", name: "心情调色师", hint: "发现五种不同的混合人格", target: 5, progress: mixedNames.filter(function (name) { return !!data.mixes[name]; }).length },
      { id: "ten_personalities", name: "十面心情", hint: "解锁十种不同的人格", target: 10, progress: collectionProgress().count },
      { id: "full_gallery", name: "情绪收藏家", hint: "集齐全部 28 个人格", target: 28, progress: collectionProgress().count }
    ];
  }

  function getExplorations() {
    const data = loadCollection();
    let changed = false;
    const list = explorationDefinitions().map(function (item) {
      if (item.progress >= item.target && !data.milestones[item.id]) {
        data.milestones[item.id] = Date.now(); changed = true;
      }
      return Object.assign({}, item, { progress: Math.min(item.progress, item.target), unlockedAt: data.milestones[item.id] || 0 });
    });
    if (changed) saveCollection();
    return list;
  }

  // 双 32 位指纹只用于成就去重，无法作为 API 分析结果的缓存命中来源。
  function fingerprint(text) {
    let a = 2166136261, b = 2246822519;
    for (let i = 0; i < text.length; i++) {
      a = Math.imul(a ^ text.charCodeAt(i), 16777619);
      b = Math.imul(b ^ text.charCodeAt(i), 3266489917);
    }
    return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
  }

  function recordColorCard(text, colorState) {
    if (!text.trim() || !colorState || colorState.label === "等待输入") return [];
    const data = loadCollection();
    const id = fingerprint(text);
    if (data.seen[id]) return [];
    const label = colorState.label.trim();
    const newUnlocks = [];
    const previous = loadAchievements();
    if (personalityNames().indexOf(label) >= 0 && !previous[label]) {
      unlockAchievement(label);
      newUnlocks.push({ name: label, kind: "personality" });
    }
    data.seen[id] = true;
    data.total++;
    const card = {
      id: id, createdAt: Date.now(), label: label,
      main: colorState.main, secondary: colorState.secondary,
      confidence: colorState.confidence, inputHash: colorState.inputHash,
      legend: (colorState.legend || []).map(function (item) {
        return { label: item.label, color: item.color, ratio: item.ratio };
      })
    };
    const counts = {};
    data.cards = [card].concat(data.cards).filter(function (item) {
      counts[item.label] = (counts[item.label] || 0) + 1;
      return counts[item.label] <= 12;
    });
    const colors = window.ColorMood.strategies.EMOTION_COLORS;
    const active = card.legend.filter(function (item) { return item.ratio > 0; }).sort(function (a, b) { return b.ratio - a.ratio; });
    if (active.length) {
      Object.keys(colors).forEach(function (key) {
        if (colors[key].label === active[0].label) data.dominant[key] = true;
      });
    }
    if (Object.values(window.ColorMood.strategies.PERSONALITY.B).indexOf(label) >= 0) data.mixes[label] = true;
    explorationDefinitions().forEach(function (item) {
      if (item.progress >= item.target && !data.milestones[item.id]) {
        data.milestones[item.id] = Date.now();
        newUnlocks.push({ name: item.name, kind: "exploration" });
      }
    });
    saveCollection();
    emit("collectionChanged");
    return newUnlocks;
  }

  function getColorCards(label) {
    return JSON.parse(JSON.stringify(loadCollection().cards.filter(function (item) { return item.label === label.trim(); })));
  }

  return {
    state: state, on: on, emit: emit, set: set,
    loadPrefs: loadPrefs, savePrefs: savePrefs,
    loadAchievements: loadAchievements, unlockAchievement: unlockAchievement,
    loadViewedAt: loadViewedAt, saveViewedAt: saveViewedAt,
    collectionProgress: collectionProgress, getExplorations: getExplorations,
    recordColorCard: recordColorCard, getColorCards: getColorCards
  };
})();

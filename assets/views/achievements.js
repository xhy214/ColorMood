// 情绪图鉴：28 人格、探索进度、解锁庆祝与历史色卡；回看不调用 API。
window.ColorMood = window.ColorMood || {};
window.ColorMood.views = window.ColorMood.views || {};
window.ColorMood.views.achievements = (function () {
  const CM = window.ColorMood;
  const store = CM.store;
  const $ = function (id) { return document.getElementById(id); };
  let activeTab = "personality";
  let selected = null;
  let celebrationTimer = 0;
  let queue = [];

  // 每个人格使用独立矢量图标；仅作图鉴展示，不参与分析或配色。
  function badge(item) { return "./assets/icons/personality/" + item.icon; }

  function tint(element, item) {
    element.style.setProperty('--collection-tint', CM.color.mixHex(item.main, '#ffffff', .9));
    element.style.setProperty('--collection-tint-end', CM.color.mixHex(item.secondary, '#ffffff', .95));
    element.style.setProperty('--collection-accent', CM.color.mixHex(item.main, '#596ab4', .48));
    element.style.setProperty('--collection-dark-tint', CM.color.mixHex(item.main, '#242433', .91));
    element.style.setProperty('--collection-dark-end', CM.color.mixHex(item.secondary, '#252633', .94));
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  function buildList() {
    const P = CM.strategies.PERSONALITY;
    const order = CM.strategies.PERSONALITY_ORDER;
    const emotions = CM.strategies.EMOTION_COLORS;
    const list = [];
    order.forEach(function (key) {
      list.push({ name: P.A1[key].trim(), keys: [key], category: "纯粹心情", clue: "等一场浓烈的" + emotions[key].label, hint: "当" + emotions[key].label + "特别突出时，或许就能遇见它。" });
    });
    order.forEach(function (key) {
      list.push({ name: P.A2[key].trim(), keys: [key], category: "细腻心情", clue: "藏着一点" + emotions[key].label, hint: "带着一些" + emotions[key].label + "，同时还容得下其他心情。" });
    });
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        list.push({ name: P.B[order[i] + "_" + order[j]], keys: [order[i], order[j]], category: "混合心情", clue: emotions[order[i]].label + " × " + emotions[order[j]].label, hint: emotions[order[i]].label + "与" + emotions[order[j]].label + "同时出现时，留意这张色卡。" });
      }
    }
    list.push({ name: P.C, keys: [], category: "平衡心情", clue: "等心情找到平衡", hint: "当多种情绪比较均衡，没有一种独占舞台时。" });
    return list.map(function (item, i) {
      item.icon = "personality-" + String(i + 1).padStart(2, "0") + ".svg";
      item.number = String(i + 1).padStart(2, "0");
      item.main = item.keys.length ? emotions[item.keys[0]].hex : '#8f9eb8';
      item.secondary = item.keys.length > 1 ? emotions[item.keys[1]].hex : '#a8b5df';
      return item;
    });
  }

  function showDetail(item) {
    selected = item;
    $("achievement-grid").classList.add("hidden");
    $("exploration-list").classList.add("hidden");
    $("collection-tabs").classList.add("hidden");
    $("collection-section-intro").classList.add("hidden");
    $("collection-detail").classList.remove("hidden");
    $("collection-detail-title").textContent = item.name;
    const cards = store.getColorCards(item.name);
    const unlocked = store.loadAchievements()[item.name];
    const hero = $("collection-detail-hero");
    tint(hero, item);
    hero.classList.toggle("is-locked", !unlocked);
    $("collection-detail-icon").src = badge(item);
    $("collection-detail-category").textContent = item.category + " · " + item.number;
    $("collection-detail-date").textContent = unlocked ? "初次遇见 · " + fmtDate(unlocked) : "尚未遇见，留一点好奇";
    $("collection-history-heading").classList.toggle("hidden", cards.length === 0);
    $("collection-history-count").textContent = cards.length + " 张";
    $("collection-detail-hint").textContent = unlocked ? (cards.length ? "这些心情，曾经在这里留下颜色。点击色卡回看海报。" : "你此前已解锁这个人格；再次遇见时，会留下第一张历史色卡。") : "解锁线索：" + item.hint;
    $("collection-card-preview").classList.add("hidden");
    $("collection-card-preview").src = "";
    const box = $("collection-cards"); box.innerHTML = "";
    cards.forEach(function (card) {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "collection-card";
      btn.setAttribute("aria-label", fmtDate(card.createdAt) + "，回看" + card.label + "海报");
      const swatch = document.createElement("span"); swatch.className = "collection-card-swatch";
      swatch.style.background = "linear-gradient(135deg," + card.main + "," + card.secondary + ")";
      const title = document.createElement("strong"); title.textContent = card.label;
      const date = document.createElement("span"); date.className = "collection-card-date"; date.textContent = fmtDate(card.createdAt);
      const ratio = document.createElement("span"); ratio.className = "collection-card-ratio";
      ratio.textContent = card.legend.filter(function (l) { return l.ratio > 0; }).sort(function (a, b) { return b.ratio - a.ratio; }).slice(0, 2).map(function (l) { return l.label + " " + (l.ratio * 100).toFixed(0) + "%"; }).join(" · ");
      btn.appendChild(swatch); btn.appendChild(title); btn.appendChild(date); btn.appendChild(ratio);
      btn.addEventListener("click", function () {
        const img = $("collection-card-preview");
        img.src = CM.renderer.exportPoster(card, "文色 · " + card.label, store.state.prefs.posterStyle || "radar");
        img.classList.remove("hidden");
        if (img.scrollIntoView) img.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      box.appendChild(btn);
    });
  }

  function renderPersonalities() {
    const unlocked = store.loadAchievements();
    const viewedAt = store.loadViewedAt();
    const box = $("achievement-grid"); box.innerHTML = "";
    buildList().forEach(function (item, i) {
      const cell = document.createElement("button"); cell.type = "button";
      cell.className = "ach-cell"; cell.style.setProperty("--i", Math.min(i, 18));
      tint(cell, item);
      cell.setAttribute("aria-label", item.name + (unlocked[item.name] ? "，查看历史色卡" : "，查看解锁线索"));
      cell.classList.add(unlocked[item.name] ? "unlocked" : "locked");
      if (unlocked[item.name] && unlocked[item.name] > viewedAt) cell.classList.add("ach-new");
      const inner = document.createElement("div"); inner.className = "ach-inner";
      const icon = document.createElement("img"); icon.className = "ach-icon";
      icon.src = badge(item); icon.alt = "";
      const name = document.createElement("div"); name.className = "ach-name"; name.textContent = item.name;
      inner.appendChild(icon); inner.appendChild(name); cell.appendChild(inner);
      cell.addEventListener("click", function () { showDetail(item); });
      box.appendChild(cell);
    });
  }

  function renderExploration() {
    const box = $("exploration-list"); box.innerHTML = "";
    store.getExplorations().forEach(function (item, i) {
      const row = document.createElement("div"); row.className = "exploration-item" + (item.unlockedAt ? " complete" : "");
      const mark = document.createElement("span"); mark.className = "exploration-mark";
      mark.setAttribute("aria-hidden", "true");
      const icon = document.createElement("img"); icon.alt = "";
      icon.src = "./assets/icons/exploration/exploration-" + (i + 1) + ".svg";
      mark.appendChild(icon);
      const info = document.createElement("div"); info.className = "exploration-info";
      const name = document.createElement("strong"); name.textContent = item.name;
      const hint = document.createElement("p"); hint.textContent = item.hint;
      const rail = document.createElement("div"); rail.className = "exploration-progress";
      const fill = document.createElement("span"); fill.style.width = (item.progress / item.target * 100) + "%"; rail.appendChild(fill);
      rail.setAttribute("role", "progressbar"); rail.setAttribute("aria-label", item.name);
      rail.setAttribute("aria-valuemin", "0"); rail.setAttribute("aria-valuemax", String(item.target)); rail.setAttribute("aria-valuenow", String(item.progress));
      info.appendChild(name); info.appendChild(hint); info.appendChild(rail);
      const count = document.createElement("span"); count.className = "exploration-count";
      count.textContent = item.unlockedAt ? "已达成" : item.progress + " / " + item.target;
      row.appendChild(mark); row.appendChild(info); row.appendChild(count); box.appendChild(row);
    });
  }

  function render() {
    const progress = store.collectionProgress();
    $("collection-count").textContent = progress.count + " / " + progress.total;
    $("collection-progress-fill").style.width = (progress.count / progress.total * 100) + "%";
    $("collection-progress").setAttribute("aria-valuenow", String(progress.count));
    $("collection-summary-note").textContent = progress.count === progress.total ? "28 种人格已经集齐，继续记录新的心情吧。" : "还差 " + (progress.total - progress.count) + " 种人格 · 已留下 " + progress.cards + " 张不同的色卡";
    renderPersonalities(); renderExploration();
    if (selected) { showDetail(selected); return; }
    $("collection-tabs").classList.remove("hidden");
    $("collection-section-intro").classList.remove("hidden");
    $("collection-section-title").textContent = activeTab === "personality" ? "你的人格色谱" : "把心情探索得更远一点";
    $("collection-section-note").textContent = activeTab === "personality" ? "点击卡片，回看心情" : "每一小步，都有回响";
    $("collection-detail").classList.add("hidden");
    $("achievement-grid").classList.toggle("hidden", activeTab !== "personality");
    $("exploration-list").classList.toggle("hidden", activeTab !== "exploration");
    $("tab-personalities").classList.toggle("active", activeTab === "personality");
    $("tab-exploration").classList.toggle("active", activeTab === "exploration");
    $("tab-personalities").setAttribute("aria-selected", String(activeTab === "personality"));
    $("tab-exploration").setAttribute("aria-selected", String(activeTab === "exploration"));
  }

  function stopCelebration() {
    clearTimeout(celebrationTimer); celebrationTimer = 0; queue = [];
    $("collection-unlock").classList.add("hidden");
  }

  function nextCelebration() {
    const item = queue.shift();
    if (!item) { $("collection-unlock").classList.add("hidden"); celebrationTimer = 0; return; }
    $("collection-unlock-name").textContent = item.name;
    $("collection-unlock-note").textContent = item.kind === "personality" ? "已加入你的人格图鉴" : "新的探索里程碑";
    const box = $("collection-unlock"); box.classList.add("hidden");
    // 重置 CSS 入场动画；不影响 API、配色或输入。
    void box.offsetWidth; box.classList.remove("hidden");
    celebrationTimer = setTimeout(nextCelebration, 2300);
  }

  function celebrate(items) {
    queue = queue.concat(items);
    if (!celebrationTimer) nextCelebration();
  }

  function init() {
    if (!store.loadViewedAt()) store.saveViewedAt(Date.now());
    $("btn-achievements").addEventListener("click", function () {
      selected = null; render(); store.saveViewedAt(Date.now());
      $("view-achievements").classList.remove("hidden");
    });
    $("tab-personalities").addEventListener("click", function () { selected = null; activeTab = "personality"; render(); });
    $("tab-exploration").addEventListener("click", function () { selected = null; activeTab = "exploration"; render(); });
    $("btn-collection-back").addEventListener("click", function () { selected = null; render(); });
    store.on("collectionChanged", function () { if (!$("view-achievements").classList.contains("hidden")) render(); });
  }

  return { init: init, render: render, celebrate: celebrate, stopCelebration: stopCelebration };
})();

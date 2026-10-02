// 入口：绑定事件、初始化引擎、导出分享
(function () {
  const CM = window.ColorMood;
  const store = CM.store;
  const strategies = CM.strategies;
  const renderer = CM.renderer;
  const bridge = CM.bridge;

  const $ = function (id) { return document.getElementById(id); };

  let debounceTimer = 0;
  let analysisVersion = 0;
  let activeController = null;
  let activePromise = null;
  let renderedText = null;
  let analysisError = null;

  // —— Toast ——
  let toastTimer = 0;
  function toast(msg, duration) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add("hidden"); }, duration || 4000);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    $("toast").classList.add("hidden");
  }

  function cancelAnalysis() {
    analysisVersion++;
    if (activeController) activeController.abort();
    activeController = null;
    activePromise = null;
    CM.storyboard.reset();
    renderer.stopAnalysis();
    $("analysis-wait").classList.add("hidden");
    $("stage-wrap").setAttribute("aria-busy", "false");
  }

  function hideFallback() { $("analysis-fallback").classList.add("hidden"); }

  function showFallback(retryable) {
    renderer.showUnavailable();
    renderLegend({ legend: [] });
    const box = $("ai-story");
    if (box) box.textContent = "";
    $("view-poster").classList.add("hidden");
    $("fallback-title").textContent = retryable ? "信号迷路了" : "调色盘正在挠头";
    $("fallback-message").textContent = retryable ? "心情还在，连接先溜号了。再试一次？" : "这段心情把调色盘难住了，换个说法再试试？";
    $("btn-analysis-retry").classList.toggle("hidden", !retryable);
    $("analysis-fallback").classList.remove("hidden");
    hideToast();
  }

  // —— 重算与渲染 ——
  function makeColorState(text, result) {
    const state = strategies.analyze(text, {
      colorblind: store.state.prefs.colorblind,
      emotionOverride: result && result.emotion_distribution,
      sentimentScore: result && result.sentiment_score
    });
    // 整体与每一幕都复用原有配色和显示增强。
    const hsl = CM.color.hexToHsl(state.main);
    state.main = CM.color.hslToHex(hsl.h, Math.min(1, hsl.s * 1.15), hsl.l * 0.85);
    return state;
  }

  async function recompute() {
    const text = store.state.text;
    const version = ++analysisVersion;
    if (activeController) activeController.abort();
    activeController = null;
    analysisError = null;
    CM.storyboard.reset();
    hideFallback();
    store.state.colorState = null;

    try {
      let aiResult = null;
      if (text.trim()) {
        const cached = CM.session.get(text);
        if (cached) {
          aiResult = cached;
        } else {
          if (!CM.ai || typeof CM.ai.analyze !== "function") {
            throw new Error("AI 模块未加载，请强制刷新页面");
          }
          activeController = new AbortController();
          hideToast();
          renderLegend({ legend: [] });
          renderer.startAnalysis();
          $("analysis-wait").classList.remove("hidden");
          $("stage-wrap").setAttribute("aria-busy", "true");
          aiResult = await CM.ai.analyze(text, { signal: activeController.signal });
          if (version !== analysisVersion || text !== store.state.text) return false;
        }
      }

      if (version !== analysisVersion || text !== store.state.text) return false;
      if (aiResult && aiResult.status === "unavailable") {
        analysisError = "这段心情暂时无法调色，换个说法再试试？";
        showFallback(false);
        return false;
      }
      const colorState = makeColorState(text, aiResult);
      if (aiResult) {
        colorState.ai = aiResult;
        colorState.aiNarrative = aiResult.narrative;
        colorState.aiWorldTitle = aiResult.mood_title;
      }
      renderer.stopAnalysis();
      renderer.render(colorState);
      renderLegend(colorState);
      renderAIStory(colorState);
      store.state.colorState = colorState;
      renderedText = text;
      CM.storyboard.load(aiResult, text, colorState, makeColorState);
      renderer.resize();
      const unlocked = text.trim() ? store.recordColorCard(text, colorState) : [];
      if (unlocked.length) CM.views.achievements.celebrate(unlocked);
      hideToast();
      return true;
    } catch (error) {
      if (version !== analysisVersion || (error && error.name === "AbortError")) return false;
      analysisError = error && error.message ? error.message : "情绪分析失败，请重试";
      store.state.colorState = null;
      renderLegend({ legend: [] });
      const box = $("ai-story");
      if (box) box.textContent = analysisError;
      if (error && error.retryable) showFallback(true);
      else toast(analysisError, 8000);
      console.error("情绪分析失败：", analysisError);
      return false;
    } finally {
      if (version === analysisVersion) {
        activeController = null;
        renderer.stopAnalysis();
        $("analysis-wait").classList.add("hidden");
        $("stage-wrap").setAttribute("aria-busy", "false");
      }
    }
  }

  function runRecompute() {
    const promise = recompute();
    activePromise = promise;
    promise.then(function () {
      if (activePromise === promise) activePromise = null;
    });
    return promise;
  }

  function renderAIStory(colorState) {
    let box = document.getElementById("ai-story");
    if (!box) return;
    box.textContent = colorState.aiNarrative || "AI情绪旅人等待你的故事...";
  }

  function renderLegend(colorState) {
    const box = $("legend");
    box.innerHTML = "";
    (colorState.legend || []).filter(function (l) { return l.ratio > 0; }).forEach(function (l) {
      const item = document.createElement("span");
      item.className = "legend-item";
      const dot = document.createElement("span");
      dot.className = "legend-dot";
      dot.style.background = l.color;
      const label = document.createElement("span");
      label.textContent = l.label + " " + (l.ratio * 100).toFixed(1) + "%";
      item.appendChild(dot);
      item.appendChild(label);
      box.appendChild(item);
    });
  }

  // —— 输入 ——
  function onInput(text, immediate) {
    const normalized = CM.session.normalize(text.slice(0, 500));
    $("btn-clear-input").classList.toggle("hidden", text.length === 0);
    // 首尾空白不改变分析内容；保留正在执行的请求或已完成结果。
    if (normalized === store.state.text && (activePromise || store.state.colorState)) return;
    store.state.text = normalized;
    hideFallback();
    cancelAnalysis();
    store.state.colorState = null;
    analysisError = null;
    $("btn-clear-input").classList.toggle("hidden", store.state.text.length === 0);
    clearTimeout(debounceTimer);
    hideToast();
    if (immediate || !store.state.text.trim() || CM.session.has(store.state.text)) { runRecompute(); return; }
    debounceTimer = setTimeout(runRecompute, 600);
  }

  // —— 海报预览（模板切换 + 导出） ——
  function updatePosterPreview() {
    const s = store.state.colorState;
    const style = store.state.prefs.posterStyle || "radar";
    $("poster-preview-img").src = renderer.exportPoster(s, "文色 · " + s.label, style);
    document.querySelectorAll("#view-poster .seg-btn[data-style]").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.style === style);
    });
  }

  function openPosterPreview(action) {
    const s = store.state.colorState;
    if (!s || renderedText !== store.state.text || !store.state.text.trim()) {
      if ($("analysis-fallback").classList.contains("hidden")) toast(analysisError || "先输入文字并等待 AI 分析完成");
      return false;
    }
    CM.storyboard.restore();
    $("btn-preview-save").classList.toggle("hidden", action !== "save");
    $("btn-preview-share").classList.toggle("hidden", action !== "share");
    updatePosterPreview();
    $("view-poster").classList.remove("hidden");
    return true;
  }

  // —— 保存 / 分享 ——
  function currentPoster() {
    const s = store.state.colorState;
    if (!s || renderedText !== store.state.text || !store.state.text.trim()) {
      if ($("analysis-fallback").classList.contains("hidden")) toast(analysisError || "先输入文字并等待 AI 分析完成");
      return null;
    }
    return renderer.exportPoster(s, "文色 · " + s.label, store.state.prefs.posterStyle);
  }

  async function ensureCurrentColor() {
    clearTimeout(debounceTimer);
    if (!store.state.text.trim()) {
      toast("先输入一些文字吧");
      return false;
    }
    if (store.state.colorState && renderedText === store.state.text) return true;
    await (activePromise || runRecompute());
    return !!store.state.colorState && renderedText === store.state.text;
  }

  async function onSave() { if (await ensureCurrentColor()) openPosterPreview("save"); }
  async function onShare() { if (await ensureCurrentColor()) openPosterPreview("share"); }

  // 预览面板内操作：模板切换 + 保存/发笔记（容器内走 bridge，桌面降级为下载）
  function bindPosterActions() {
    document.querySelectorAll("#view-poster .seg-btn[data-style]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        store.state.prefs.posterStyle = btn.dataset.style;
        store.savePrefs();
        updatePosterPreview();
      });
    });
    $("btn-preview-save").addEventListener("click", function () {
      const uri = currentPoster();
      if (!uri) return;
      if (!bridge.available()) {
        toast("保存相册需在小红书 App 内使用");
        return;
      }
      bridge.saveImage(uri).then(function () {
        toast("已保存到相册");
      }).catch(function (e) {
        toast("保存失败：" + (e && e.errMsg ? e.errMsg : "请重试"));
      });
    });
    $("btn-preview-share").addEventListener("click", function () {
      const uri = currentPoster();
      if (!uri) return;
      if (!bridge.available()) {
        toast("发笔记需在小红书 App 内使用");
        return;
      }
      bridge.postNote({
        title: "我的文色",
        content: "用文字生成的专属色彩海报，来试试你的心情是什么颜色～",
        imageDataUri: uri
      }).then(function () {
        toast("发布成功");
      }).catch(function (e) {
        toast("分享取消或失败：" + (e && e.errMsg ? e.errMsg : ""));
      });
    });
  }

  // —— 覆盖层 ——
  function bindOverlays() {
    const closers = document.querySelectorAll(".close-overlay");
    closers.forEach(function (btn) {
      btn.addEventListener("click", function () {
        $(btn.dataset.target).classList.add("hidden");
      });
    });
    const overlays = document.querySelectorAll(".overlay");
    overlays.forEach(function (ov) {
      ov.addEventListener("pointerdown", function (e) {
        if (e.target === ov) ov.classList.add("hidden");
      });
    });
  }

  // —— 软键盘适配（真机） ——
  function bindViewport() {
    if (!window.visualViewport) return;
    window.visualViewport.addEventListener("resize", function () {
      $("app").style.height = window.visualViewport.height + "px";
      renderer.resize();
    });
  }

  // —— 初始化 ——
  function init() {
    CM.session.start();
    store.loadPrefs();
    renderer.init($("stage"), $("stage-particles"));
    CM.storyboard.init(function (state, scene) {
      renderer.render(state, scene ? { duration: 900 } : undefined);
      renderLegend(state);
      if (!scene) renderAIStory(state);
    });
    CM.views.achievements.init();
    CM.views.settings.init();
    CM.views.settings.apply();
    $("set-dark").addEventListener("change", renderer.resize);
    bindOverlays();
    bindPosterActions();
    bindViewport();

    $("text-input").addEventListener("input", function (e) { onInput(e.target.value); });
    $("btn-analysis-edit").addEventListener("click", function () { $("text-input").focus(); });
    $("btn-analysis-retry").addEventListener("click", function () {
      clearTimeout(debounceTimer);
      if (!activePromise) runRecompute();
    });

    // 一键清空输入（长文本在手机上逐个删除太麻烦）
    $("btn-clear-input").addEventListener("click", function () {
      $("text-input").value = "";
      onInput("");
      $("text-input").focus(); // 保持焦点与软键盘，方便直接输入新内容
    });

    const examples = document.querySelectorAll(".example-chip");
    examples.forEach(function (chip) {
      chip.addEventListener("click", function () {
        $("text-input").value = chip.dataset.text;
        onInput(chip.dataset.text, true); // 一次性动作，跳过打字防抖立即出效果
      });
    });

    $("btn-save").addEventListener("click", onSave);
    $("btn-share").addEventListener("click", onShare);

    store.on("prefsChanged", function () {
      clearTimeout(debounceTimer);
      if (activePromise) return; // 请求完成后会读取最新偏好，无需重复调用接口。
      runRecompute();
    });

    window.addEventListener("pagehide", function () {
      clearTimeout(debounceTimer);
      cancelAnalysis();
      CM.session.end();
      CM.views.achievements.stopCelebration();
      hideToast();
    });
    window.addEventListener("pageshow", function (event) {
      if (!event.persisted) return;
      CM.session.start(); // 从浏览器返回缓存恢复时，也创建新的空 buffer。
      store.state.colorState = null;
      runRecompute();
    });

    window.addEventListener("resize", renderer.resize);
    window.addEventListener("orientationchange", function () {
      setTimeout(renderer.resize, 120);
    });

    runRecompute();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

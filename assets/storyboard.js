// 情绪分镜：使用已取得的分析结果播放，不发请求，不写入成就或持久存储。
window.ColorMood = window.ColorMood || {};
window.ColorMood.storyboard = (function () {
  const $ = function (id) { return document.getElementById(id); };
  const DURATION = 4200;
  let scenes = [], states = [], overall = null, show = null;
  let active = -1, elapsed = 0, playing = false, ended = false;
  let raf = 0, lastTime = 0, buttons = [], fills = [];

  function controls() {
    $("storyboard-play-label").textContent = playing ? "暂停" : ended ? "重播" : active >= 0 ? "继续" : "播放";
    $("storyboard-icon-play").classList.toggle("hidden", playing || ended);
    $("storyboard-icon-pause").classList.toggle("hidden", !playing);
    $("storyboard-icon-replay").classList.toggle("hidden", !ended);
    $("btn-storyboard-play").setAttribute("aria-label", playing ? "暂停情绪分镜" : ended ? "重播情绪分镜" : active >= 0 ? "继续情绪分镜" : "播放情绪分镜");
    $("btn-storyboard-play").setAttribute("aria-pressed", String(playing));
    $("btn-storyboard-overview").classList.toggle("hidden", active < 0);
    $("storyboard-status").textContent = active < 0 ? "共 " + scenes.length + " 幕" : ended ? "播放结束" : "第 " + (active + 1) + " 幕 / 共 " + scenes.length + " 幕：" + scenes[active].title + (playing ? "" : "，已暂停");
    buttons.forEach(function (button, i) {
      button.classList.toggle("selected", i === active);
      button.setAttribute("aria-pressed", String(i === active));
      fills[i].style.width = active < 0 || i > active ? "0%" : i < active ? "100%" : Math.min(100, elapsed / DURATION * 100) + "%";
    });
  }

  function displayScene() {
    if (active < 0 || !scenes[active]) return;
    show(states[active], scenes[active]);
    const caption = $("storyboard-caption");
    const entering = caption.classList.contains("hidden") || $("scene-title").textContent !== scenes[active].title;
    $("scene-title").textContent = scenes[active].title;
    $("scene-caption").textContent = scenes[active].caption;
    caption.classList.remove("hidden");
    if (entering && typeof caption.animate === "function" && !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      caption.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: "ease-out" });
    }
    $("stage-wrap").classList.add("storyboard-active");
    controls();
  }

  function tick(now) {
    if (!playing) return;
    if (document.hidden) { pause(); return; }
    elapsed += Math.max(0, now - lastTime);
    lastTime = now;
    if (elapsed >= DURATION) {
      if (active + 1 < scenes.length) {
        active++; elapsed = 0;
        displayScene();
      } else {
        elapsed = DURATION; playing = false; ended = true;
        controls(); return;
      }
    }
    // 只更新进度宽度；ARIA 和文案仅在切幕/暂停时更新。
    if (fills[active]) fills[active].style.width = Math.min(100, elapsed / DURATION * 100) + "%";
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    if (!playing) return;
    elapsed = Math.min(DURATION, elapsed + Math.max(0, performance.now() - lastTime));
    playing = false;
    cancelAnimationFrame(raf); raf = 0;
    controls();
  }

  function play() {
    if (!overall || !scenes.length) return;
    if (playing) { pause(); return; }
    if (active < 0 || ended) { active = 0; elapsed = 0; ended = false; }
    playing = true;
    displayScene();
    lastTime = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function select(index) {
    pause();
    active = index; elapsed = 0; ended = false;
    displayScene();
  }

  function restore() {
    if (!overall) return;
    pause();
    active = -1; elapsed = 0; ended = false;
    $("storyboard-caption").classList.add("hidden");
    $("stage-wrap").classList.remove("storyboard-active");
    show(overall, null);
    controls();
  }

  function reset() {
    playing = false; cancelAnimationFrame(raf); raf = 0;
    active = -1; elapsed = 0; ended = false;
    scenes = []; states = []; overall = null; buttons = []; fills = [];
    $("storyboard-controls").classList.add("hidden");
    $("storyboard-caption").classList.add("hidden");
    $("stage-wrap").classList.remove("storyboard-active");
    $("storyboard-scenes").innerHTML = "";
  }

  function load(result, text, colorState, makeColor) {
    reset();
    // 单幕直接保留整体色卡；同一种情绪的重复分段也不制造播放流程。
    if (!result || !Array.isArray(result.scenes) || result.scenes.length < 2) return;
    const first = result.scenes[0].emotion_distribution;
    const changesEmotion = result.scenes.some(function (scene) {
      return Object.keys(first).some(function (key) {
        return Math.abs((scene.emotion_distribution[key] || 0) - (first[key] || 0)) > 0.01 + 1e-9;
      });
    });
    if (!changesEmotion) return;
    overall = colorState;
    scenes = result.scenes;
    states = scenes.map(function (scene) {
      const state = makeColor(scene.source || text, scene);
      state.sceneTitle = scene.title;
      return state;
    });
    const box = $("storyboard-scenes");
    scenes.forEach(function (scene, i) {
      const button = document.createElement("button"); button.type = "button"; button.className = "storyboard-scene";
      button.setAttribute("aria-label", "查看第 " + (i + 1) + " 幕：" + scene.title);
      button.setAttribute("title", scene.title);
      const rgb = window.ColorMood.color.hexToRgb(states[i].main);
      const secondary = window.ColorMood.color.hexToRgb(states[i].secondary);
      button.style.background = "linear-gradient(115deg,rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",.17),rgba(" + secondary.r + "," + secondary.g + "," + secondary.b + ",.12))";
      const swatch = document.createElement("span"); swatch.className = "scene-swatch"; swatch.style.background = states[i].main; swatch.setAttribute("aria-hidden", "true");
      const number = document.createElement("span"); number.className = "scene-number"; number.textContent = String(i + 1).padStart(2, "0");
      const rail = document.createElement("span"); rail.className = "scene-rail"; rail.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span"); fill.className = "scene-fill"; fill.style.background = "linear-gradient(90deg," + states[i].main + "," + states[i].secondary + ")";
      rail.appendChild(fill); button.appendChild(swatch); button.appendChild(number); button.appendChild(rail);
      button.addEventListener("click", function () { select(i); });
      buttons.push(button); fills.push(fill); box.appendChild(button);
    });
    $("storyboard-controls").classList.remove("hidden");
    controls();
  }

  function init(display) {
    show = display;
    $("btn-storyboard-play").addEventListener("click", play);
    $("btn-storyboard-overview").addEventListener("click", restore);
    document.addEventListener("visibilitychange", function () { if (document.hidden) pause(); });
    ["btn-settings", "btn-achievements"].forEach(function (id) { $(id).addEventListener("click", pause); });
  }

  return { init: init, load: load, reset: reset, restore: restore, pause: pause };
})();

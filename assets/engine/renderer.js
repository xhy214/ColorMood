// Canvas 渲染器：情绪渐变背景 + 过渡动画 + 粒子光点 + 海报导出
window.ColorMood = window.ColorMood || {};
window.ColorMood.renderer = (function () {
  const C = window.ColorMood.color;

  let canvas = null, ctx = null;
  let current = null;      // 当前颜色状态
  let displayed = null;    // 过渡中显示状态
  let rafId = 0;
  let pCanvas = null, pCtx = null;
  let particles = [];
  let lastKey = "";
  let ripples = [];      // 点按涟漪
  let follow = null;     // 粒子跟随目标（归一化坐标）
  let interacting = false;
  let guideActive = false; // 空状态引导动画
  let guideRafId = 0;
  let analysisActive = false;
  let analysisStart = 0;
  let analysisPaintAt = -Infinity, analysisPaintDark = null;
  let particlePaletteKey = "", particlePalette = [];
  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function softTone(hex) {
    const hsl = C.hexToHsl(hex);
    const saturation = Math.min(0.48, hsl.s * 0.52);
    return {
      pearl: C.hexToRgb(C.hslToHex(hsl.h, saturation * 0.6, 0.94)),
      bloom: C.hexToRgb(C.hslToHex(hsl.h, saturation, 0.72)),
      rim: C.hexToRgb(C.hslToHex(hsl.h, saturation, 0.54))
    };
  }

  function rgba(color, alpha) {
    return "rgba(" + color.r + "," + color.g + "," + color.b + "," + alpha.toFixed(3) + ")";
  }

  // 渐变外光晕 + 偏心高光，避免实心圆和硬边缘。
  function drawSoftParticle(x, y, radius, tone, strength) {
    const halo = pCtx.createRadialGradient(x, y, 0, x, y, radius * 3.4);
    halo.addColorStop(0, rgba(tone.pearl, strength * 0.16));
    halo.addColorStop(0.32, rgba(tone.bloom, strength * 0.16));
    halo.addColorStop(1, rgba(tone.bloom, 0));
    pCtx.fillStyle = halo;
    pCtx.beginPath(); pCtx.arc(x, y, radius * 3.4, 0, Math.PI * 2); pCtx.fill();

    const core = pCtx.createRadialGradient(
      x - radius * 0.24, y - radius * 0.28, 0,
      x, y, radius
    );
    core.addColorStop(0, rgba(tone.pearl, strength * 0.82));
    core.addColorStop(0.48, rgba(tone.pearl, strength * 0.54));
    core.addColorStop(1, rgba(tone.rim, strength * 0.2));
    pCtx.fillStyle = core;
    pCtx.beginPath(); pCtx.arc(x, y, radius, 0, Math.PI * 2); pCtx.fill();
  }

  function resultParticlePalette(main, secondary) {
    const key = main + secondary;
    if (key !== particlePaletteKey) {
      particlePaletteKey = key;
      particlePalette = [
        softTone(main),
        softTone(secondary),
        softTone(C.mixHex(main, secondary, 0.5))
      ];
    }
    return particlePalette;
  }

  const waitingTones = Object.keys(window.ColorMood.strategies.EMOTION_COLORS).map(function (key) {
    return softTone(window.ColorMood.strategies.EMOTION_COLORS[key].hex);
  });

  // 等待时的色彩仅作装饰，不表示尚未返回的情绪分析结果。
  const waitingBackgrounds = {
    light: ["#e4dcf8", "#f3dbe7", "#f9dfd0", "#f5ebcc", "#d7eade", "#d6e6f5"],
    dark: ["#2c2946", "#3c2b40", "#403039", "#3b3732", "#283d3b", "#29384a"]
  };

  function drawAnalysisBackdrop(now, force) {
    if (!analysisActive || !ctx || !canvas) return;

    const dark = document.body.classList.contains("dark");

    // 复用粒子 RAF；背景最多约 30 帧/秒，不再单独创建动画循环。
    if (!force && dark === analysisPaintDark &&
        (reduceMotion || now - analysisPaintAt < 33)) return;

    analysisPaintAt = now;
    analysisPaintDark = dark;

    const age = reduceMotion ? 0 : Math.max(0, now - analysisStart);
    const phase = age / 4800;
    const index = Math.floor(phase);
    const progress = phase - index;
    const blend = 0.5 - 0.5 * Math.cos(progress * Math.PI);
    const palette = dark ? waitingBackgrounds.dark : waitingBackgrounds.light;

    function tone(offset) {
      return C.mixHex(
        palette[(index + offset) % palette.length],
        palette[(index + offset + 1) % palette.length],
        blend
      );
    }

    const main = tone(0), secondary = tone(3);
    drawBackdrop(main, secondary);

    const w = canvas.width, h = canvas.height;
    const drift = age * 0.00016;
    const blooms = [
      [
        0.22 + Math.sin(drift) * 0.12,
        0.24 + Math.cos(drift * 0.8) * 0.09,
        tone(1)
      ],
      [
        0.78 + Math.cos(drift * 0.7) * 0.09,
        0.48 + Math.sin(drift * 0.9) * 0.13,
        tone(4)
      ],
      [
        0.48 + Math.sin(drift * 0.6) * 0.14,
        0.87,
        tone(2)
      ]
    ];

    blooms.forEach(function (bloom) {
      const color = C.hexToRgb(bloom[2]);
      const x = bloom[0] * w, y = bloom[1] * h;
      const glow = ctx.createRadialGradient(
        x, y, 0,
        x, y, Math.max(w, h) * 0.68
      );
      glow.addColorStop(0, rgba(color, dark ? 0.52 : 0.62));
      glow.addColorStop(0.45, rgba(color, dark ? 0.24 : 0.28));
      glow.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    });
  }

  function startAnalysis() {
    if (analysisActive) return;
    analysisActive = true;
    analysisStart = performance.now();
    stopGuideAnim();
    cancelAnimationFrame(rafId);
    drawAnalysisBackdrop(analysisStart, true);
  }

  function stopAnalysis() {
    if (!analysisActive) return;
    analysisActive = false;
    if (current && current.label === "等待输入") startGuideAnim();
    else if (current) draw(displayed || current);
  }

  function showUnavailable() {
    stopAnalysis();
    stopGuideAnim();
    cancelAnimationFrame(rafId);
    const dark = document.body.classList.contains("dark");
    current = displayed = {
      unavailable: true,
      label: "",
      legend: [],
      main: dark ? "#202337" : "#f3f1fb",
      secondary: dark ? "#303d51" : "#e8eff9"
    };
    lastKey = "";
    draw(current);
  }

  // 六色只表示等待时的光点，真实情绪比例到达后仍由原配色算法定色。
  function drawAnalysisParticles(now, w, h) {
    const palette = window.ColorMood.strategies.EMOTION_COLORS;
    const keys = Object.keys(palette);
    const age = Math.max(0, now - analysisStart);
    const gather = reduceMotion ? 1 : Math.min(1, age / 2400);
    const radius = Math.min(w, h) * (0.32 - gather * 0.13);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const group = i % keys.length;
      const a = group * Math.PI / 3 - Math.PI / 2 +
        (reduceMotion ? 0 : age * 0.00013);
      const wave = reduceMotion ? 0 : Math.sin(age * 0.0014 + i) * 0.014;
      let tx = 0.5 + Math.cos(a) * radius / w + wave;
      let ty = 0.38 + Math.sin(a) * radius / h + wave;

      if (follow) {
        tx = tx * 0.72 + follow.x * 0.28;
        ty = ty * 0.72 + follow.y * 0.28;
      }

      if (reduceMotion) {
        p.x = tx;
        p.y = ty;
      } else {
        p.x += (tx - p.x) * 0.035;
        p.y += (ty - p.y) * 0.035;
      }

      const x = p.x * w, y = p.y * h;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = (p.r + 1 +
        (reduceMotion ? 0 : Math.sin(age * 0.0018 + i) * 0.4)) * dpr;

      drawSoftParticle(x, y, r, waitingTones[group], 0.82);
    }

    drawRipples(now, w, h, "#576184", "#e8eff9");
  }

  function init(canvasEl, particleEl) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");

    if (particleEl) {
      pCanvas = particleEl;
      pCtx = pCanvas.getContext("2d");

      while (particles.length < 26) {
        particles.push({
          x: Math.random(),
          y: Math.random(),
          vx: (Math.random() - 0.5) * 0.0016,
          vy: (Math.random() - 0.5) * 0.0016,
          baseVx: (Math.random() - 0.5) * 0.0016,
          baseVy: (Math.random() - 0.5) * 0.0016,
          r: 2 + Math.random() * 5
        });
      }

      requestAnimationFrame(particleLoop);
    }

    bindInteraction(canvasEl);
    resize();
  }

  // 点按/拖动互动：涟漪扩散 + 粒子跟随（仅反馈，不改变颜色结果）
  // 按住期间跟随，松开恢复；无 PointerEvent 时回退到 mouse/touch
  function bindInteraction(el) {
    if (!el) return;

    function local(e) {
      const rect = el.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height
      };
    }

    function onDown(e) {
      const p = local(e);
      ripples.push({
        x: p.x,
        y: p.y,
        start: performance.now(),
        dur: 700,
        big: true
      });
      if (ripples.length > 6) ripples.shift();
      follow = p;
      interacting = true;
    }

    function onMove(e) {
      if (!interacting) return;
      follow = local(e);
    }

    function onUp() {
      follow = null;
      interacting = false;
    }

    if (window.PointerEvent) {
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
      el.addEventListener("pointerleave", onUp);
    } else {
      el.addEventListener("mousedown", onDown);
      el.addEventListener("mousemove", onMove);
      el.addEventListener("mouseup", onUp);
      el.addEventListener("mouseleave", onUp);
      el.addEventListener("touchstart", function (e) {
        if (e.touches[0]) onDown(e.touches[0]);
      });
      el.addEventListener("touchmove", function (e) {
        if (e.touches[0]) onMove(e.touches[0]);
      });
      el.addEventListener("touchend", onUp);
      el.addEventListener("touchcancel", onUp);
    }

    // 兜底：任何位置松开 / 窗口失焦都结束跟随。
    window.addEventListener("blur", onUp);
    if (window.PointerEvent) {
      window.addEventListener("pointerup", onUp);
    } else {
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchend", onUp);
    }
  }

  // 按渐变两端的对比度选择粒子/涟漪颜色。
  function particleTint(main, secondary) {
    const hsl = C.hexToHsl(main);
    const dark = C.hslToHex(hsl.h, Math.min(1, hsl.s + 0.05), 0.22);
    const light = C.hslToHex(hsl.h, Math.min(1, hsl.s * 0.8), 0.86);
    const dWorst = Math.min(C.contrast(main, dark), C.contrast(secondary, dark));
    const lWorst = Math.min(C.contrast(main, light), C.contrast(secondary, light));
    return dWorst >= lWorst ? dark : light;
  }

  // 粒子光点持续游离（独立图层，不干扰颜色过渡与文字）
  function particleLoop(now) {
    try {
      now = now || performance.now();
      const w = pCanvas.width, h = pCanvas.height;
      const visual = guideActive ? current : (displayed || current);
      const main = (visual && visual.main) || "#546E7A";
      const secondary = (visual && visual.secondary) || "#78909C";
      const tones = resultParticlePalette(main, secondary);

      pCtx.clearRect(0, 0, w, h);

      if (analysisActive) {
        drawAnalysisBackdrop(now);
        drawAnalysisParticles(now, w, h);
      } else {
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];

          if (follow) {
            const dx = follow.x - p.x, dy = follow.y - p.y;
            if (dx * dx + dy * dy < 0.09) {
              p.vx += dx * 0.0009;
              p.vy += dy * 0.0009;
            }
            const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            if (sp > 0.004) {
              p.vx = p.vx / sp * 0.004;
              p.vy = p.vy / sp * 0.004;
            }
          } else {
            // 松开后柔和回归基础漂移。
            p.vx += (p.baseVx - p.vx) * 0.08;
            p.vy += (p.baseVy - p.vy) * 0.08;
          }

          p.x += p.vx;
          p.y += p.vy;

          // 越界时同步反转基础速度并钳回边界。
          if (p.x < 0 || p.x > 1) {
            p.vx *= -1;
            p.baseVx = p.vx;
            p.x = p.x < 0 ? 0 : 1;
          }
          if (p.y < 0 || p.y > 1) {
            p.vy *= -1;
            p.baseVy = p.vy;
            p.y = p.y < 0 ? 0 : 1;
          }

          const shimmer = reduceMotion ? 0.82 :
            0.76 + Math.sin(now * 0.0008 + i * 1.9) * 0.1;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);

          drawSoftParticle(
            p.x * w,
            p.y * h,
            p.r * dpr,
            tones[i % tones.length],
            shimmer
          );
        }

        drawRipples(now, w, h, main, secondary);
      }
    } catch (err) {
      console.error("particleLoop error:", err);
    }

    requestAnimationFrame(particleLoop);
  }

  // 点按涟漪：主色对比色描边环 + 淡填充，随进度扩散渐隐
  function drawRipples(now, w, h, main, secondary) {
    if (!ripples.length) return;
    const ringColor = C.hexToRgb(particleTint(main, secondary));
    pCtx.save();
    pCtx.lineWidth = 3;

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      const t = Math.min(1, (now - r.start) / r.dur);

      if (t >= 1) {
        ripples.splice(i, 1);
        continue;
      }

      const e = 1 - Math.pow(1 - t, 3);
      const R = Math.max(w, h) * (r.big ? 0.5 : 0.24) * e;
      const alpha = (1 - t) * 0.55;

      pCtx.beginPath();
      pCtx.arc(r.x * w, r.y * h, R, 0, Math.PI * 2);
      pCtx.strokeStyle = "rgba(" +
        ringColor.r + "," + ringColor.g + "," + ringColor.b + "," +
        alpha.toFixed(3) + ")";
      pCtx.stroke();

      pCtx.beginPath();
      pCtx.arc(r.x * w, r.y * h, R * 0.85, 0, Math.PI * 2);
      pCtx.fillStyle = "rgba(" +
        ringColor.r + "," + ringColor.g + "," + ringColor.b + "," +
        (alpha * 0.12).toFixed(3) + ")";
      pCtx.fill();
    }

    pCtx.restore();
  }

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    if (pCanvas) {
      pCanvas.width = canvas.width;
      pCanvas.height = canvas.height;
    }

    if (analysisActive) {
      drawAnalysisBackdrop(performance.now(), true);
      return;
    }

    if (guideActive) return;
    if (current) draw(displayed || current);
  }

  // 默认 300ms；分镜切幕使用较舒缓的颜色过渡。
  function render(state, options) {
    current = state;

    if (state.label === "等待输入") {
      cancelAnimationFrame(rafId);
      if (!displayed) displayed = state;
      startGuideAnim();
      return;
    }

    stopGuideAnim();

    const key = JSON.stringify([
      state.main,
      state.secondary,
      state.label,
      state.inputHash,
      state.sceneTitle
    ]);

    if (key === lastKey) {
      // 引导/等待动画可能覆盖画布，重复结果也需要恢复色卡。
      cancelAnimationFrame(rafId);
      displayed = state;
      draw(state);
      return;
    }

    lastKey = key;

    if (!displayed) {
      displayed = state;
      draw(displayed);
      return;
    }

    const from = displayed;
    const to = state;
    const start = performance.now();
    const dur = reduceMotion ? 1 : (options && options.duration) || 300;

    cancelAnimationFrame(rafId);

    function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      const frame = {
        main: C.mixHex(from.main, to.main, e),
        secondary: C.mixHex(from.secondary, to.secondary, e),
        label: to.sceneTitle || t >= 1 ? to.label : from.label,
        sceneTitle: to.sceneTitle,
        confidence: t >= 1 ? to.confidence : from.confidence,
        legend: to.legend
      };

      draw(frame);
      displayed = frame;

      if (t < 1) rafId = requestAnimationFrame(step);
      else displayed = to;
    }

    rafId = requestAnimationFrame(step);
  }

  // 渐变背景 + 径向光晕
  function drawBackdrop(main, secondary) {
    const w = canvas.width, h = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, main);
    grad.addColorStop(1, secondary);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const rg = ctx.createRadialGradient(
      w * 0.3, h * 0.25, 0,
      w * 0.3, h * 0.25, Math.max(w, h) * 0.8
    );
    rg.addColorStop(0, "rgba(255,255,255,0.18)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
  }

  // 空状态引导：文字呼吸 + 箭头浮动
  function startGuideAnim() {
    if (guideActive) return;
    guideActive = true;
    const start = performance.now();

    function step(now) {
      if (!guideActive || !ctx) return;

      const st = current || {
        main: "#546E7A",
        secondary: "#78909C"
      };

      drawBackdrop(st.main, st.secondary);

      const w = canvas.width, h = canvas.height;
      const t = ((now - start) / 1800) % 1;
      const pulse = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);

      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = C.readableForeground(st.main);
      ctx.globalAlpha = 0.4 + 0.4 * pulse;
      ctx.font = "600 " + Math.round(w * 0.048) + "px sans-serif";
      ctx.fillText("在下方写下此刻的心情", w / 2, h * 0.40);

      ctx.font = "600 " + Math.round(w * 0.05) + "px sans-serif";
      ctx.fillText(
        "↓",
        w / 2,
        h * 0.40 + w * 0.085 + pulse * w * 0.012
      );

      ctx.globalAlpha *= 0.62;
      ctx.font = "400 " + Math.round(w * 0.033) + "px sans-serif";
      ctx.fillText(
        "或点下面的示例，立刻看效果",
        w / 2,
        h * 0.40 + w * 0.16
      );
      ctx.restore();

      guideRafId = requestAnimationFrame(step);
    }

    guideRafId = requestAnimationFrame(step);
  }

  function stopGuideAnim() {
    if (!guideActive) return;
    guideActive = false;
    cancelAnimationFrame(guideRafId);
  }

  function draw(state) {
    if (!ctx) return;
    drawBackdrop(state.main, state.secondary);
    if (state.unavailable) return;

    if (state.sceneTitle) {
      // 根据文字区域的实际背景选择前景色。
      const caption = document.getElementById("storyboard-caption");

      if (caption) {
        const w = canvas.width, h = canvas.height;
        const t = (w * w * 0.5 + h * h * 0.42) / (w * w + h * h);
        const a = C.hexToRgb(state.main);
        const b = C.hexToRgb(state.secondary);
        const radius = Math.max(w, h) * 0.8;
        const distance = Math.sqrt(w * w * 0.04 + h * h * 0.0289);
        const glow = 0.18 * Math.max(0, 1 - distance / radius);

        const sampled = C.rgbToHex(
          C.lerp(C.lerp(a.r, b.r, t), 255, glow),
          C.lerp(C.lerp(a.g, b.g, t), 255, glow),
          C.lerp(C.lerp(a.b, b.b, t), 255, glow)
        );

        const foreground = C.readableForeground(sampled);

        caption.style.setProperty("--scene-foreground", foreground);
        caption.style.setProperty(
          "--scene-text-shadow",
          foreground === "#FFFFFF" ? "rgba(0,0,0,.15)" : "transparent"
        );
      }
    }

    drawCenterText(state, canvas.width, canvas.height);
  }

  function sortedActiveLegend(state) {
    return (state.legend || [])
      .filter(function (l) {
        return l.ratio > 0;
      })
      .sort(function (a, b) {
        return b.ratio - a.ratio;
      });
  }

  // 海报占比行
  function proportionText(state) {
    const items = sortedActiveLegend(state);

    if (items.length === 0) {
      return "置信度 " + Math.round((state.confidence || 0) * 100) + "%";
    }

    return items.map(function (l) {
      return l.label + " " + (l.ratio * 100).toFixed(1) + "%";
    }).join(" · ");
  }

  const SUBTITLES = {
    "人间小太阳": "不仅自己亮，路过的人都被你晒暖了～",
    "世界观刷新中": "认知系统紧急更新补丁，请勿强制关机",
    "情绪海绵": "正一点点把悲伤挤出来，需要一点时间",
    "脑补灾难片": "消息三分钟没回，已经演完八十集分手大戏",
    "生理性抗拒": "不是不想忍，是身体先替你做决定了",
    "你惹到我了": "本宫今日心情易燃易爆，闲杂人等自觉退到安全距离外",

    "奶茶半糖": "快乐不齁甜，七分满足三分清醒",
    "微微一愣": "惊讶来得快去得也快，表情管理勉强还在线",
    "阴天住户": "还能看见外面，只是什么都朦朦胧胧的",
    "疑神疑鬼": "自己吓自己，真相永远是你想多了",
    "已读乱回": "表面在互动，实际大脑根本没加载你的内容",
    "炸毛边缘": "现在顺毛还来得及，再摸就是另一个故事",

    "尊嘟假嘟": "这泼天的富贵居然轮到我了？",
    "糖里藏刀": "本来甜甜蜜蜜的，突然就被回忆杀捅了一刀",
    "又菜又爱玩": "明明怕得要死但就是停不下来，我是什么受虐体质啊救命",
    "真香警告": "好看是好看但能不能别这么离谱啊！！！",
    "释怀了": "气我是真的，但逗笑我也是真的",
    "求求是假的吧": "要是能重来，我宁愿没听到这个消息",
    "已吓鼠": "0个人在意我的死活，我先鼠一步",
    "我请问呢": "是觉得人类的承受能力太强了吗？？",
    "活人微怒": "表面还在呼吸，实际已经气走了一会儿了",
    "渡劫ing": "惶恐滩头说惶恐，零丁洋里叹零丁",
    "老坛酸菜": "自己都嫌弃自己，但偏偏这是我自己腌的",
    "悲愤交加": "出师未捷身先死，长使英雄泪满襟",
    "阴暗爬行": "腥臊并御，芳不得薄兮",
    "气抖冷": "怕到想打110，气到想打120",
    "蓝的盆": "夏虫不可语冰，井蛙不可语海",
    "低饱和灵魂": "但热闹是它们的，我什么也没有"
  };

  function subtitle(state) {
    const label = (state.label || "").trim();
    if (label === "中性") return "";
    return SUBTITLES[label] || "*****";
  }

  // 按最大宽度收缩字号后绘制
  function fillFitText(g, text, x, y, size, minSize, maxW) {
    g.font = size + "px sans-serif";

    while (g.measureText(text).width > maxW && size > minSize) {
      size--;
      g.font = size + "px sans-serif";
    }

    g.fillText(text, x, y);
  }

  function drawCenterText(state, w, h) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const fg = C.readableForeground(state.main);
    ctx.fillStyle = fg;
    ctx.globalAlpha = 0.92;

    if (state.sceneTitle) {
      // 分镜标题与旁白由 DOM 呈现，避免重复文案。
      ctx.restore();
      return;
    }

    ctx.font = "600 " + Math.round(w * 0.055) + "px sans-serif";
    ctx.fillText(state.label || "", w / 2, h * 0.42);

    ctx.globalAlpha = 0.6;
    const sub = subtitle(state);

    if (state.label && sub) {
      fillFitText(
        ctx,
        sub,
        w / 2,
        h * 0.42 + w * 0.075,
        Math.round(w * 0.035),
        12,
        w * 0.9
      );
    }

    ctx.restore();
  }

  // 六边形情绪维度图
  function drawRadar(g, cx, cy, maxR, legend, fgColor, mainColor) {
    const N = 6;

    for (let ring = 4; ring >= 1; ring--) {
      const r = maxR * ring / 4;
      g.beginPath();

      for (let i = 0; i < N; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 3;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }

      g.closePath();
      g.strokeStyle = fgColor;
      g.globalAlpha = ring === 4 ? 0.35 : 0.14;
      g.lineWidth = ring === 4 ? 3 : 1.5;
      g.stroke();
    }

    g.globalAlpha = 0.18;
    g.lineWidth = 1.5;

    for (let i = 0; i < N; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 3;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(
        cx + Math.cos(a) * maxR,
        cy + Math.sin(a) * maxR
      );
      g.stroke();
    }

    const pts = [];

    for (let i = 0; i < N; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 3;
      const v = Math.min(1, legend[i].ratio);
      pts.push({
        x: cx + Math.cos(a) * maxR * v,
        y: cy + Math.sin(a) * maxR * v
      });
    }

    g.beginPath();
    pts.forEach(function (p, i) {
      if (i === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    });
    g.closePath();

    const rgb = C.hexToRgb(mainColor);
    g.fillStyle = "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",0.42)";
    g.fill();
    g.strokeStyle = mainColor;
    g.globalAlpha = 1;
    g.lineWidth = 5;
    g.lineJoin = "round";
    g.stroke();

    for (let i = 0; i < N; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 3;
      const v = Math.min(1, legend[i].ratio);
      const px = cx + Math.cos(a) * maxR * v;
      const py = cy + Math.sin(a) * maxR * v;
      const lr = maxR + 42;
      const lx = cx + Math.cos(a) * lr;
      const ly = cy + Math.sin(a) * lr;

      if (Math.abs(Math.cos(a)) < 0.3) {
        g.textAlign = "center";
        g.textBaseline = Math.sin(a) < 0 ? "bottom" : "top";
      } else {
        g.textAlign = Math.cos(a) > 0 ? "left" : "right";
        g.textBaseline = "middle";
      }

      g.fillStyle = fgColor;
      g.font = "600 30px sans-serif";
      g.fillText(
        legend[i].label + " " + (legend[i].ratio * 100).toFixed(1) + "%",
        lx,
        ly
      );
    }

    g.textAlign = "center";
    g.textBaseline = "middle";
    g.globalAlpha = 1;
  }

  // 花瓣数分配：最大余数法
  function allocatePetals(ratios, total) {
    const n = ratios.length;
    const counts = new Array(n).fill(0);
    const remainders = [];
    let used = 0;

    for (let i = 0; i < n; i++) {
      const exact = ratios[i] * total;
      counts[i] = Math.floor(exact);
      used += counts[i];

      if (exact - counts[i] > 0.0001) {
        remainders.push({
          i: i,
          r: exact - counts[i]
        });
      }
    }

    remainders.sort(function (a, b) {
      return b.r - a.r;
    });

    for (let k = 0; used < total && k < remainders.length; k++) {
      counts[remainders[k].i]++;
      used++;
    }

    return counts;
  }

  function drawPetalLayer(g, cx, cy, r0, r1, counts, legend, fgColor) {
    const total = counts.reduce(function (s, c) {
      return s + c;
    }, 0);

    if (total <= 0) return;

    const step = Math.PI * 2 / total;
    let a = -Math.PI / 2;

    for (let i = 0; i < counts.length; i++) {
      if (counts[i] === 0) continue;

      const span = counts[i] * step;
      const rgb = C.hexToRgb(legend[i].color);

      g.beginPath();
      g.arc(cx, cy, r0, a, a + span);
      g.arc(cx, cy, r1, a + span, a, true);
      g.closePath();
      g.fillStyle = "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",0.45)";
      g.fill();
      g.strokeStyle = fgColor;
      g.globalAlpha = 0.12;
      g.lineWidth = 1;
      g.stroke();
      g.globalAlpha = 1;
      a += span;
    }
  }

  // 曼陀罗式情绪图
  function drawMandala(g, cx, cy, maxR, legend, fgColor, mainColor, label) {
    const ratios = legend.map(function (l) {
      return l.ratio;
    });
    const inner = allocatePetals(ratios, 12);
    const outer = allocatePetals(ratios, 24);

    [0.36, 0.58, 0.9].forEach(function (k) {
      g.beginPath();
      g.arc(cx, cy, maxR * k, 0, Math.PI * 2);
      g.strokeStyle = fgColor;
      g.globalAlpha = k === 0.9 ? 0.28 : 0.14;
      g.lineWidth = k === 0.9 ? 3 : 1.5;
      g.stroke();
    });

    drawPetalLayer(
      g, cx, cy,
      maxR * 0.62, maxR * 0.88,
      outer, legend, fgColor
    );
    drawPetalLayer(
      g, cx, cy,
      maxR * 0.38, maxR * 0.56,
      inner, legend, fgColor
    );

    g.fillStyle = fgColor;
    g.globalAlpha = 0.3;

    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI * 2 / 24;
      g.beginPath();
      g.arc(
        cx + Math.cos(a) * maxR * 0.95,
        cy + Math.sin(a) * maxR * 0.95,
        3,
        0,
        Math.PI * 2
      );
      g.fill();
    }

    g.globalAlpha = 1;

    const cr = maxR * 0.32;
    g.beginPath();
    g.arc(cx, cy, cr, 0, Math.PI * 2);
    g.fillStyle = mainColor;
    g.fill();
    g.strokeStyle = fgColor;
    g.globalAlpha = 0.55;
    g.lineWidth = 3;
    g.stroke();
    g.globalAlpha = 1;

    if (label) {
      g.fillStyle = fgColor;
      g.font = "600 34px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      fillFitText(g, label, cx, cy, 34, 16, cr * 2 * 0.86);
    }

    g.textAlign = "center";
    g.textBaseline = "middle";
    g.globalAlpha = 1;
  }

  // 海报导出：离屏 1080×1440 重绘
  function exportPoster(state, metaText, template) {
    const W = 1080, H = 1440;
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const octx = off.getContext("2d");

    const grad = octx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, state.main);
    grad.addColorStop(1, state.secondary);
    octx.fillStyle = grad;
    octx.fillRect(0, 0, W, H);

    const rg = octx.createRadialGradient(
      W * 0.3, H * 0.25, 0,
      W * 0.3, H * 0.25, H * 0.9
    );
    rg.addColorStop(0, "rgba(255,255,255,0.18)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    octx.fillStyle = rg;
    octx.fillRect(0, 0, W, H);

    const fg = C.readableForeground(state.main);
    octx.textAlign = "center";
    octx.textBaseline = "middle";
    const hasHex = state.legend && state.legend.length === 6;

    octx.fillStyle = fg;
    octx.globalAlpha = 0.94;
    octx.font = "600 96px sans-serif";
    octx.fillText(state.label || "", W / 2, H * 0.14);

    octx.globalAlpha = 0.72;
    fillFitText(
      octx,
      proportionText(state),
      W / 2,
      H * 0.14 + 150,
      40,
      24,
      W * 0.9
    );
    octx.globalAlpha = 0.8;

    if (hasHex) {
      if (template === "mandala") {
        drawMandala(
          octx,
          W / 2,
          H * 0.57,
          300,
          state.legend,
          fg,
          state.main,
          state.label
        );
      } else {
        drawRadar(
          octx,
          W / 2,
          H * 0.57,
          300,
          state.legend,
          fg,
          state.main
        );
      }
    }

    const activeItems = sortedActiveLegend(state);

    if (!hasHex && activeItems.length) {
      octx.font = "40px sans-serif";
      octx.globalAlpha = 0.8;

      activeItems.forEach(function (l, i) {
        const y = H * 0.58 + i * 64;
        octx.fillStyle = l.color;
        octx.beginPath();
        octx.arc(W / 2 - 120, y, 14, 0, Math.PI * 2);
        octx.fill();
        octx.fillStyle = fg;
        octx.textAlign = "left";
        octx.fillText(
          l.label + " " + (l.ratio * 100).toFixed(1) + "%",
          W / 2 - 90,
          y
        );
        octx.textAlign = "center";
      });
    }

    octx.fillStyle = fg;
    octx.globalAlpha = 0.75;
    octx.font = "36px sans-serif";
    octx.textBaseline = "alphabetic";
    octx.fillText(
      metaText || "文色 · Text Color Card",
      W / 2,
      H - 120
    );
    octx.globalAlpha = 1;

    return off.toDataURL("image/png");
  }

  return {
    init: init,
    resize: resize,
    render: render,
    exportPoster: exportPoster,
    startAnalysis: startAnalysis,
    stopAnalysis: stopAnalysis,
    showUnavailable: showUnavailable
  };
})();
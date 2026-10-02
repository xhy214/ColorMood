// AI 数据适配：校验整体情绪和分镜来源，不使用本地词库或生成颜色。
window.ColorMood = window.ColorMood || {};
window.ColorMood.analyzer = (function () {
  const EMOTIONS = ["joy", "anger", "sadness", "surprise", "fear", "disgust"];

  function numeric(value, field) {
    if (typeof value !== "number" && typeof value !== "string") {
      throw new Error("AI 返回的 " + field + " 不是有效数字");
    }
    if (typeof value === "string" && !value.trim()) {
      throw new Error("AI 返回的 " + field + " 为空");
    }
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error("AI 返回的 " + field + " 不是有效数字");
    return number;
  }

  function normalizeAnalysis(result) {
    const raw = result && result.emotion_distribution;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("AI 未返回 emotion_distribution 情绪占比");
    }
    if (!EMOTIONS.some(function (key) { return Object.prototype.hasOwnProperty.call(raw, key); })) {
      throw new Error("AI 返回的数据不包含六种基础情绪");
    }
    const dist = {};
    let total = 0;
    EMOTIONS.forEach(function (key) {
      const value = Object.prototype.hasOwnProperty.call(raw, key) ? numeric(raw[key], key) : 0;
      if (value < 0) throw new Error("AI 返回的情绪占比不能为负数");
      dist[key] = value;
      total += value;
    });
    if (!Number.isFinite(total)) throw new Error("AI 返回的情绪占比超出有效范围");
    // 兼容小数舍入和百分数形式；全零表示中性，不制造虚假的六等分情绪。
    if (total > 0) EMOTIONS.forEach(function (key) { dist[key] /= total; });

    let sentiment = 0;
    if (result.sentiment_score !== undefined && result.sentiment_score !== null) {
      sentiment = numeric(result.sentiment_score, "sentiment_score");
      if (sentiment < -1 || sentiment > 1) {
        throw new Error("AI 返回的情感极性必须在 -1 到 1 之间");
      }
    }
    return {
      emotion_distribution: dist,
      sentiment_score: sentiment,
      hasEmotion: total > 0,
      mood_title: typeof result.mood_title === "string" ? result.mood_title.trim().slice(0, 40) : "",
      narrative: typeof result.narrative === "string" ? result.narrative.trim().slice(0, 300) : ""
    };
  }

  function fromAI(result, sourceText) {
    const overall = normalizeAnalysis(result);
    const text = typeof sourceText === "string" ? sourceText : "";
    const fallback = [{
      title: "此刻的心情", caption: (overall.narrative || "把这一刻，留给它自己的颜色。").slice(0, 60),
      source: text.slice(0, 160),
      emotion_distribution: overall.emotion_distribution, sentiment_score: overall.sentiment_score
    }];
    let scenes = fallback;
    // 分镜是增强项：无效时保留整体分析，单幕兜底，不额外调用 API。
    if (Array.isArray(result.scenes) && result.scenes.length >= 1 && result.scenes.length <= 3 && text) {
      try {
        let end = 0;
        scenes = result.scenes.map(function (scene) {
          if (!scene || typeof scene.title !== "string" || !scene.title.trim() ||
              typeof scene.caption !== "string" || !scene.caption.trim() ||
              typeof scene.source !== "string" || !scene.source.trim()) throw new Error("分镜字段不完整");
          const source = scene.source.trim();
          const start = text.indexOf(source, end);
          if (start < 0) throw new Error("分镜来源不在原文中或顺序不正确");
          end = start + source.length;
          const adapted = normalizeAnalysis(scene);
          return {
            title: scene.title.trim().slice(0, 12), caption: scene.caption.trim().slice(0, 60),
            source: source.slice(0, 160),
            emotion_distribution: adapted.emotion_distribution, sentiment_score: adapted.sentiment_score
          };
        });
      } catch (error) { scenes = fallback; }
    }
    overall.scenes = scenes;
    return overall;
  }

  return { fromAI: fromAI, EMOTIONS: EMOTIONS };
})();

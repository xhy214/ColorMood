// 情绪颜色映射：多维情绪定色相，情感极性调强度
window.ColorMood = window.ColorMood || {};
window.ColorMood.strategies = (function () {
  const C = window.ColorMood.color;

  const EMOTION_COLORS = {
    joy:      { hex: "#FFB300", label: "喜悦" },
    anger:    { hex: "#E53935", label: "愤怒" },
    sadness:  { hex: "#1E88E5", label: "悲伤" },
    surprise: { hex: "#FF6F00", label: "惊讶" },
    fear:     { hex: "#5E35B1", label: "恐惧" },
    disgust:  { hex: "#7CB342", label: "厌恶" }
  };

  const NEUTRAL = "#90A4AE";

  // 小红书风格人格：按情绪占比分布映射大字标签
  const PERSONALITY_ORDER = ["joy", "surprise", "sadness", "fear", "disgust", "anger"];
  const PERSONALITY = {
    A1: { joy: "人间小太阳", surprise: "世界观刷新中", sadness: "情绪海绵", fear: "脑补灾难片", disgust: "生理性抗拒", anger: "你惹到我了" },
    A2: { joy: " 奶茶半糖", surprise: "微微一愣", sadness: "阴天住户", fear: "疑神疑鬼", disgust: "已读乱回", anger: "炸毛边缘" },
    B: {
      joy_surprise: "尊嘟假嘟", joy_sadness: "糖里藏刀", joy_fear: "又菜又爱玩", joy_disgust: "真香警告", joy_anger: "释怀了",
      surprise_sadness: "求求是假的吧", surprise_fear: "已吓鼠", surprise_disgust: "我请问呢", surprise_anger: "活人微怒",
      sadness_fear: "渡劫ing", sadness_disgust: "老坛酸菜", sadness_anger: "悲愤交加",
      fear_disgust: "阴暗爬行", fear_anger: "气抖冷",
      disgust_anger: "蓝的盆"
    },
    C: "低饱和灵魂"
  };

  function personalityLabel(dist) {
    const keys = Object.keys(PERSONALITY.A1);
    keys.sort(function (a, b) { return dist[b] - dist[a]; });
    const top = keys[0], second = keys[1];
    if (dist[top] > 0.70) return PERSONALITY.A1[top];
    if (dist[second] > 0.30) {
      const pair = [top, second].sort(function (a, b) {
        return PERSONALITY_ORDER.indexOf(a) - PERSONALITY_ORDER.indexOf(b);
      });
      return PERSONALITY.B[pair.join("_")];
    }
    if (dist[top] > 0.30) return PERSONALITY.A2[top];
    return PERSONALITY.C;
  }

  // 情感极性 → 暖橙/冷蓝色带（AI 未识别出基础情绪时的原有中性色带）
  function sentimentColor(S) {
    const t = (S + 1) / 2;
    const hue = C.lerp(215, 35, t);
    const sat = 0.25 + 0.65 * Math.abs(S);
    const light = 0.42 + 0.12 * Math.abs(S);
    return C.hslToHex(hue, sat, light);
  }

  // 主入口：文本 + AI 情绪占比 → 原有统一颜色状态
  function analyze(text, opts) {
    opts = opts || {};
    text = text || "";
    if (!text.trim()) {
      return {
        main: "#546E7A", secondary: "#78909C",
        confidence: 0, label: "等待输入", legend: [],
        inputHash: 0
      };
    }

    const an = window.ColorMood.analyzer.fromAI({
      emotion_distribution: opts.emotionOverride,
      sentiment_score: opts.sentimentScore
    });
    const S = an.sentiment_score;
    const dist = an.emotion_distribution;
    let main, label, confidence, legend = [];

    if (an.hasEmotion) {
      // 沿用原公式：p² 加权混合定色相，情感强度 |S| 提饱和
      const pairs = [];
      let maxP = 0;
      for (const k in EMOTION_COLORS) {
        if (dist[k] > maxP) maxP = dist[k];
        if (dist[k] > 0.05) pairs.push({ hex: EMOTION_COLORS[k].hex, weight: dist[k] * dist[k] });
      }
      const mixed = C.mixWeighted(pairs);
      const hsl = C.hexToHsl(mixed);
      main = C.hslToHex(hsl.h, C.clamp(hsl.s + Math.abs(S) * 0.15, 0, 1), hsl.l);
      label = personalityLabel(dist);
      confidence = Math.min(1, maxP * 1.4 + 0.15);
      legend = Object.keys(EMOTION_COLORS).map(function (k) {
        return { color: EMOTION_COLORS[k].hex, label: EMOTION_COLORS[k].label, ratio: dist[k] };
      });
    } else {
      // 无基础情绪：退到原有情感极性色带，大字统一中性兜底
      main = sentimentColor(S);
      label = "中性";
      confidence = Math.min(1, Math.abs(S) * 1.5 + 0.2);
    }

    // 低置信度向中性灰回退
    if (confidence < 0.35) main = C.mixHex(main, NEUTRAL, (0.35 - confidence) / 0.35 * 0.7);

    const hsl = C.hexToHsl(main);
    const secondary = C.hslToHex((hsl.h + 26) % 360, hsl.s * 0.75, Math.min(0.92, hsl.l + 0.2));

    const result = {
      main: main, secondary: secondary,
      confidence: confidence, label: label, legend: legend,
      inputHash: C.hashSeed(text)
    };

    // 色盲模式：红绿替换为蓝橙
    if (opts.colorblind) {
      result.main = daltonize(result.main);
      result.secondary = daltonize(result.secondary);
      result.legend.forEach(function (l) { l.color = daltonize(l.color); });
    }
    return result;
  }

  // 红/绿色系 → 蓝/橙（色盲友好）
  function daltonize(hex) {
    const hsl = C.hexToHsl(hex);
    let h = hsl.h;
    if (h >= 340 || h <= 20) h = 25;          // 红 → 橙
    else if (h >= 80 && h <= 170) h = 210;    // 绿 → 蓝
    return C.hslToHex(h, hsl.s, hsl.l);
  }

  return {
    analyze: analyze,
    EMOTION_COLORS: EMOTION_COLORS,
    PERSONALITY: PERSONALITY,
    PERSONALITY_ORDER: PERSONALITY_ORDER,
    daltonize: daltonize
  };
})();

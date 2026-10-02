// 文色 · 常见模型的速度预配置与接口兼容层（核对日期：2026-10-02）。
// 不发探测请求，不写入 localStorage，不修改全局 fetch。
window.ColorMood = window.ColorMood || {};
window.ColorMood.modelPresets = (function () {
  const rawFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : fetch;
  const modes = new Map();
  const MAX_ATTEMPTS = 6;

  // 规则按版本区分；未知版本保留服务默认值，不把所有模型都当成可关闭思考。
  const rules = [
    { family: "deepseek", match: /^deepseek-(?:chat|reasoner|flash|v[34](?:\.\d+)?)(?:$|-)/,
      id: "deepseek-hybrid", thinking: "off" },
    { family: "glm", match: /^glm-5\.3(?:$|-)/,
      id: "glm-5.3-low", effort: "low", mandatory: true },
    { family: "glm", match: /^glm-(?:4\.[567]|5(?:\.[12])?)(?:$|-)/,
      id: "glm-hybrid", thinking: "off" },
    { family: "gpt", match: /^gpt-6(?:\.1)?-astra(?:$|-)|^gpt-6\.1-sol(?:$|-)/,
      id: "gpt-6-low", effort: "low", mandatory: true },
    { family: "gpt", match: /^gpt-6-(?:sol|luna)(?:$|-)/,
      id: "gpt-6-none", effort: "none" },
    { family: "gpt", match: /^gpt-5(?:-(?:mini|nano))?(?:$|-\d{4}-)/,
      id: "gpt-5-minimal", effort: "minimal" },
    { family: "gpt", match: /^gpt-5\.[12456](?:$|-(?:mini|nano|sol|terra|luna)(?:$|-)|-\d{4}-)/,
      id: "gpt-5.x-none", effort: "none" },
    { family: "gpt", match: /^(?:o1|o3|o4-mini)(?:$|-(?:mini|\d{4})(?:$|-))/,
      id: "openai-o-low", effort: "low", mandatory: true },
    { family: "claude", match: /^claude-sonnet-5[.-]5(?:$|-)/,
      id: "claude-sonnet-5.5", thinking: "between_tools", effort: "low" },
    { family: "claude", match: /^claude-(?:opus-5[.-]5|fable-5(?:[.-]1)?|mythos-(?:5(?:[.-]1)?|preview))(?:$|-)/,
      id: "claude-mandatory-low", effort: "low", mandatory: true },
    { family: "claude", match: /^claude-(?:opus|sonnet)-5(?:$|-\d{8}$)/,
      id: "claude-5-off", thinking: "off", effort: "low" },
    { family: "claude", match: /^claude-(?:opus-4[.-][5678]|sonnet-4[.-]6)(?:$|-)/,
      id: "claude-4-off-low", thinking: "off", effort: "low" },
    { family: "claude", match: /^claude-(?:(?:opus|sonnet|haiku)-4(?:[.-][15])?|3[.-]7-sonnet)(?:$|-)/,
      id: "claude-hybrid-off", thinking: "off" },
    { family: "gemini", match: /^gemini-2\.5-flash(?:$|-)/,
      id: "gemini-2.5-flash-off", budget: 0 },
    { family: "gemini", match: /^gemini-2\.5-pro(?:$|-)/,
      id: "gemini-2.5-pro-128", budget: 128, mandatory: true },
    { family: "gemini", match: /^gemini-3\.[78]-flash(?:$|-(?!lite))/,
      id: "gemini-3.7-3.8-flash-low", effort: "low", mandatory: true },
    { family: "gemini", match: /^gemini-3(?:\.[156])?-flash(?:$|-)/,
      id: "gemini-3-flash-minimal", effort: "minimal", mandatory: true },
    { family: "gemini", match: /^gemini-3(?:\.1)?-pro(?:$|-)/,
      id: "gemini-3-pro-low", effort: "low", mandatory: true },
    { family: "qwen", match: /^(?:qwen3.*-thinking(?:$|-)|qwq(?:$|-))/,
      id: "qwen-thinking-budget", budget: 128, mandatory: true, streaming: true },
    { family: "qwen", match: /^qwen3\.8-(?:max|2\.4t)(?:$|-)/,
      id: "qwen3.8-mandatory", budget: 128, mandatory: true },
    { family: "qwen", match: /^qwen(?:3(?:\.[5678])?(?:$|-)|-(?:plus|flash|turbo|3-max)(?:$|-))/,
      id: "qwen-hybrid-off", thinking: "off" }
  ];

  function endpointInfo(endpoint) {
    const base = window.location && window.location.href || "http://localhost/";
    const url = new URL(endpoint, base);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "");
    const alibaba = /^(?:dashscope(?:-intl|-us)?\.)aliyuncs\.com$/.test(host) || /\.maas\.aliyuncs\.com$/.test(host);
    const router = host === "openrouter.ai";
    let official = "";
    if (host === "api.deepseek.com") official = "deepseek";
    else if (host === "open.bigmodel.cn" || host === "api.z.ai") official = "glm";
    else if (host === "api.openai.com") official = "gpt";
    else if (host === "api.anthropic.com") official = "claude";
    else if (host === "generativelanguage.googleapis.com") official = "gemini";
    let protocol = "chat";
    if (/\/messages$/.test(path)) protocol = "anthropic";
    else if (/\/models\/[^/]+:generateContent$/.test(path)) protocol = "gemini";
    else if (/\/responses$/.test(path)) protocol = "responses";
    return { url: url, host: host, alibaba: alibaba, router: router, official: official, protocol: protocol };
  }

  function familyOf(model) {
    if (/^deepseek(?:$|-)/.test(model)) return "deepseek";
    if (/^glm(?:$|-)/.test(model)) return "glm";
    if (/^(?:gpt(?:$|-)|o[134](?:$|-))/.test(model)) return "gpt";
    if (/^claude(?:$|-)/.test(model)) return "claude";
    if (/^gemini(?:$|-)/.test(model)) return "gemini";
    if (/^(?:qwen|qwq)(?:\d|$|-)/.test(model)) return "qwen";
    return "";
  }

  function match(endpoint, model) {
    const info = endpointInfo(endpoint);
    const bare = String(model || "").trim().toLowerCase().split("/").pop();
    const family = familyOf(bare);
    // 官方单一服务与模型家族不符时，不添加猜测参数。
    const mismatch = info.official && info.official !== family;
    let rule = mismatch ? null : rules.find(function (r) { return r.family === family && r.match.test(bare); });
    // 这些模型已经不思考，或属于另一种专用接口，保留默认设置。
    if (/(?:instruct|coder|chat-latest|(?:^|-)pro(?:$|-))/.test(bare) && family === "gpt") rule = null;
    if (/(?:instruct|coder)/.test(bare) && family === "qwen") rule = null;
    const speed = [];
    function add(path, value) { speed.push({ path: path, value: value }); }
    if (rule) {
      if (info.router && info.protocol === "chat") {
        add("reasoning", { effort: rule.mandatory ? (rule.effort || "low") :
          (rule.effort || (rule.budget === 0 || rule.thinking === "off" ? "none" : "low")) });
      } else if (info.alibaba && info.protocol === "chat") {
        if (rule.mandatory) add("thinking_budget", 128);
        else if (rule.thinking === "off" || rule.budget === 0) add("enable_thinking", false);
      } else if (info.protocol === "anthropic") {
        if (rule.thinking) add("thinking", { type: rule.thinking === "off" ? "disabled" : rule.thinking });
        if (rule.effort) add("output_config.effort", rule.effort === "none" ? "low" : rule.effort);
      } else if (info.protocol === "gemini" && family === "gemini") {
        add("generationConfig.thinkingConfig", rule.budget !== undefined ?
          { thinkingBudget: rule.budget } : { thinkingLevel: rule.effort });
      } else if (info.protocol === "responses") {
        add("reasoning", { effort: rule.effort || (rule.thinking === "off" ? "none" : "low") });
      } else if (family === "gemini") {
        if (rule.budget === 128) add("extra_body", { google: { thinking_config: { thinking_budget: 128 } } });
        else add("reasoning_effort", rule.budget === 0 ? "none" : rule.effort);
      } else if (family === "qwen") {
        if (rule.budget !== undefined) add("thinking_budget", rule.budget);
        else add("enable_thinking", false);
      } else if (family === "claude") {
        if (rule.thinking) add("thinking", { type: rule.thinking === "off" ? "disabled" : rule.thinking });
        if (rule.effort) add("output_config.effort", rule.effort);
      } else if (rule.thinking === "off") add("thinking", { type: "disabled" });
      else if (rule.effort) add("reasoning_effort", rule.effort);
    }
    return { info: info, family: family, bare: bare, rule: rule, speed: speed,
      streaming: !!(rule && rule.streaming && info.protocol === "chat" && !info.router),
      key: JSON.stringify([info.url.href, String(model || "").trim()]) };
  }

  function stateFor(profile) {
    if (!modes.has(profile.key)) modes.set(profile.key, { disabled: new Set(), jsonDisabled: false,
      tokenName: null, tokenTried: new Set(), accepted: false });
    return modes.get(profile.key);
  }

  function put(body, path, value) {
    const keys = path.split(".");
    let target = body;
    for (let i = 0; i < keys.length - 1; i++) target = target[keys[i]] || (target[keys[i]] = {});
    target[keys[keys.length - 1]] = JSON.parse(JSON.stringify(value));
  }

  function headerObject(source) {
    const headers = {};
    if (source && typeof source.forEach === "function") source.forEach(function (v, k) { headers[k] = v; });
    else Object.assign(headers, source || {});
    return headers;
  }

  function build(profile, state, base, options) {
    const body = JSON.parse(JSON.stringify(base));
    const headers = headerObject(options.headers);
    const key = String(headers.Authorization || headers.authorization || "").replace(/^Bearer\s+/i, "");
    let endpoint = profile.info.url.href;
    let request = body;
    if (profile.info.protocol === "anthropic") {
      request = { model: base.model, stream: false, max_tokens: base.max_tokens || base.max_completion_tokens || 4096,
        system: (base.messages || []).filter(function (m) { return m.role === "system"; }).map(function (m) { return m.content; }).join("\n"),
        messages: (base.messages || []).filter(function (m) { return m.role !== "system"; }) };
      delete headers.Authorization; delete headers.authorization;
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
      if (profile.info.host === "api.anthropic.com") headers["anthropic-dangerous-direct-browser-access"] = "true";
    } else if (profile.info.protocol === "gemini") {
      request = { systemInstruction: { parts: (base.messages || []).filter(function (m) { return m.role === "system"; }).map(function (m) { return { text: m.content }; }) },
        contents: (base.messages || []).filter(function (m) { return m.role !== "system"; }).map(function (m) {
          return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
        }), generationConfig: { maxOutputTokens: base.max_tokens || base.max_completion_tokens || 4096 } };
      if (!state.jsonDisabled) request.generationConfig.responseMimeType = "application/json";
      delete headers.Authorization; delete headers.authorization;
      headers["x-goog-api-key"] = key;
      const url = new URL(endpoint);
      url.pathname = url.pathname.replace(/\/models\/[^/]+:generateContent$/, "/models/" + encodeURIComponent(profile.bare) + ":generateContent");
      url.searchParams.delete("key");
      endpoint = url.href;
    } else if (profile.info.protocol === "responses") {
      request = { model: base.model, stream: false, input: base.messages,
        max_output_tokens: base.max_tokens || base.max_completion_tokens || 4096 };
      if (!state.jsonDisabled) request.text = { format: { type: "json_object" } };
    } else {
      if (state.jsonDisabled) delete request.response_format;
      const reasoningGPT = profile.family === "gpt" && /^(?:gpt-[56]|o[134](?:$|-))/.test(profile.bare);
      const tokenName = state.tokenName || (reasoningGPT && !profile.info.router ? "max_completion_tokens" : "max_tokens");
      const limit = base.max_tokens || base.max_completion_tokens;
      delete request.max_tokens; delete request.max_completion_tokens;
      if (limit) request[tokenName] = limit;
      if (profile.streaming) request.stream = true;
    }
    profile.speed.forEach(function (entry) {
      if (!state.disabled.has(entry.path)) put(request, entry.path, entry.value);
    });
    return { endpoint: endpoint, options: Object.assign({}, options, { headers: headers, body: JSON.stringify(request) }), body: request };
  }

  function aborted(signal) {
    if (signal && signal.aborted) {
      const error = new Error("请求已取消"); error.name = "AbortError"; throw error;
    }
  }

  function flat(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

  function rejection(status, data, profile, state, body) {
    if (status !== 400 && status !== 422) return false;
    const error = data && (data.error || data) || {};
    if (String(error.code) === "1301" || /auth|api.?key|quota|rate.?limit|content.?filter|safety|moderation|refusal/i.test(String(error.code || error.type || ""))) return false;
    let detail = String(error.message || error.msg || "");
    if (error.metadata && error.metadata.raw) detail += " " + String(error.metadata.raw);
    if (error.details) detail += " " + JSON.stringify(error.details);
    const unsupported = /unsupported|unrecognized|unrecognised|not[ _-]*(?:supported|allowed|permitted)|does not support|cannot.{0,20}(?:disable|turned? off)|mandatory|unknown (?:field|parameter|argument|name)|unexpected (?:field|parameter|argument)|extra[ _]?(?:inputs?|fields?)|invalid[ _](?:value|parameter|argument)|only supports?|input should be|不支持|不能关闭|必须开启|未知参数|未识别|无效参数|参数.{0,8}(?:非法|无效)/i;
    if (!unsupported.test(detail + " " + String(error.code || ""))) return false;
    // 有明确 param 时只检查该字段，避免因错误中引用了用户内容而误降级。
    const target = flat(error.param || detail);
    function namesMatch(names) { return names.some(function (name) { return target.indexOf(flat(name)) >= 0; }); }
    const jsonPath = profile.info.protocol === "gemini" ? "responseMimeType" : profile.info.protocol === "responses" ? "text.format" : "response_format";
    if (!state.jsonDisabled && profile.info.protocol !== "anthropic" && namesMatch([jsonPath, "response_format"])) {
      state.jsonDisabled = true; return true;
    }
    for (const entry of profile.speed) {
      if (state.disabled.has(entry.path)) continue;
      const aliases = [entry.path, entry.path.split(".")[0]];
      if (entry.path === "extra_body") aliases.push("thinking_config", "thinking_budget", "extra_body.google");
      if (entry.path === "generationConfig.thinkingConfig") aliases.push("thinkingConfig", "thinkingBudget", "thinkingLevel");
      if (entry.path === "reasoning") aliases.push("reasoning_effort");
      if (namesMatch(aliases)) { state.disabled.add(entry.path); return true; }
    }
    if (profile.info.protocol === "chat" && namesMatch(["max_tokens", "max_completion_tokens"]) &&
        !/range|between|greater|less than|minimum|maximum|范围|上限|过大|过小/i.test(detail)) {
      const oldName = Object.prototype.hasOwnProperty.call(body, "max_completion_tokens") ? "max_completion_tokens" : "max_tokens";
      const next = oldName === "max_tokens" ? "max_completion_tokens" : "max_tokens";
      state.tokenTried.add(oldName);
      if (!state.tokenTried.has(next)) { state.tokenName = next; return true; }
    }
    if (!error.param && /(?:extra|additional)\s+(?:parameters?|fields?|inputs?).*(?:not\s+(?:allowed|permitted|supported)|unsupported)|(?:unknown|unsupported|unexpected)\s+(?:extra\s+|additional\s+)?(?:parameters?|fields?)|(?:no|不支持|不允许).{0,12}(?:extra|additional|额外).{0,12}(?:parameters?|fields?|参数)/i.test(detail)) {
      const active = profile.speed.filter(function (entry) { return !state.disabled.has(entry.path); });
      active.forEach(function (entry) { state.disabled.add(entry.path); });
      if (active.length) return true;
      if (!state.jsonDisabled && profile.info.protocol !== "anthropic") { state.jsonDisabled = true; return true; }
    }
    return false;
  }

  function chatChoice(content, finish, refusal) {
    const message = { content: content };
    if (refusal) message.refusal = true;
    return { choices: [{ finish_reason: finish || "stop", message: message }] };
  }

  function normalize(data, protocol) {
    if (!data || data.error || protocol === "chat") return data;
    if (protocol === "anthropic") {
      if (!Array.isArray(data.content)) return data;
      return chatChoice(data.content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text || ""; }).join(""),
        data.stop_reason === "max_tokens" ? "length" : "stop", data.stop_reason === "refusal");
    }
    if (protocol === "gemini") {
      const blocked = data.promptFeedback && data.promptFeedback.blockReason;
      if (blocked && blocked !== "BLOCK_REASON_UNSPECIFIED") return chatChoice("", "content_filter", true);
      const candidate = data.candidates && data.candidates[0];
      if (!candidate) return data;
      const parts = candidate.content && candidate.content.parts || [];
      const unsafe = /SAFETY|RECITATION|BLOCKLIST|PROHIBITED_CONTENT|SPII/.test(candidate.finishReason || "");
      return chatChoice(parts.filter(function (p) { return !p.thought && typeof p.text === "string"; }).map(function (p) { return p.text; }).join(""),
        candidate.finishReason === "MAX_TOKENS" ? "length" : unsafe ? "content_filter" : "stop", unsafe);
    }
    if (!Array.isArray(data.output)) return data;
    const parts = data.output.filter(function (item) { return item.type === "message"; }).reduce(function (all, item) { return all.concat(item.content || []); }, []);
    const refused = parts.some(function (p) { return p.type === "refusal"; });
    const reason = data.incomplete_details && data.incomplete_details.reason;
    return chatChoice(parts.filter(function (p) { return p.type === "output_text"; }).map(function (p) { return p.text || ""; }).join(""),
      reason === "max_output_tokens" ? "length" : reason === "content_filter" ? "content_filter" : data.status === "failed" ? "network_error" : "stop", refused);
  }

  function parseStream(text) {
    let content = "", finish = null, refusal = false;
    for (const block of text.replace(/\r\n/g, "\n").split("\n\n")) {
      const value = block.split("\n").filter(function (line) { return line.startsWith("data:"); }).map(function (line) { return line.slice(5).trim(); }).join("\n");
      if (!value || value === "[DONE]") continue;
      const chunk = JSON.parse(value);
      if (chunk.error) return chunk;
      const choice = chunk.choices && chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta || choice.message || {};
      if (typeof delta.content === "string") content += delta.content;
      if (delta.refusal) refusal = true;
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    return chatChoice(content, finish || "network_error", refusal);
  }

  function wrapped(response, data, parseError) {
    return { ok: response.ok, status: response.status, statusText: response.statusText, headers: response.headers,
      json: async function () { if (parseError) throw parseError; return data; } };
  }

  async function presetFetch(endpoint, options) {
    options = options || {};
    let base;
    try { base = JSON.parse(options.body); } catch (ignored) { return rawFetch(endpoint, options); }
    if (!base || !base.model || !Array.isArray(base.messages)) return rawFetch(endpoint, options);
    const profile = match(endpoint, base.model);
    const state = stateFor(profile);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      aborted(options.signal);
      const wire = build(profile, state, base, options);
      const response = await rawFetch(wire.endpoint, wire.options);
      let data;
      try {
        const type = response.headers && response.headers.get && response.headers.get("content-type") || "";
        data = response.ok && /text\/event-stream/i.test(type) ? parseStream(await response.text()) : await response.json();
      } catch (error) { aborted(options.signal); return wrapped(response, null, error); }
      aborted(options.signal);
      // 部分兼容网关在 HTTP 200 中携带明确的 400/422 错误码。
      const reported = data && data.error && Number(data.error.status || data.error.code);
      const status = response.ok && (reported === 400 || reported === 422) ? reported : response.status;
      if (attempt < MAX_ATTEMPTS - 1 && rejection(status, data, profile, state, wire.body)) continue;
      if (response.ok && data && !data.error) state.accepted = true;
      return wrapped(response, normalize(data, profile.info.protocol));
    }
  }

  function describe(endpoint, model) {
    const profile = match(endpoint, model);
    const state = stateFor(profile);
    const parameters = {};
    profile.speed.forEach(function (entry) { if (!state.disabled.has(entry.path)) put(parameters, entry.path, entry.value); });
    return { family: profile.family || "unknown", protocol: profile.info.protocol,
      preset: profile.rule ? profile.rule.id : "service-default", parameters: parameters,
      mode: Object.keys(parameters).length ? "optimized" : "plain", accepted: state.accepted,
      // HTTP 接受参数不等于证明第三方网关实际执行了参数。
      jsonMode: profile.info.protocol !== "anthropic" && !state.jsonDisabled };
  }

  function reset() { modes.clear(); }
  window.addEventListener("pagehide", reset);
  return { fetch: presetFetch, describe: describe, reset: reset };
})();

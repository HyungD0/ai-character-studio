// AI 실시간 대화 (선택 기능). 사용자가 넣은 API 키로 브라우저에서 바로 호출합니다.
// - 키는 이 브라우저(localStorage 또는 sessionStorage)에만 저장, 서버·공유 문서에는 절대 넣지 않음
// - 응답은 Unity 버전과 같은 {"reply": "...", "emotion": "...", "affection": n} JSON
(function () {
  const STORE = "aics.ai.v1";
  const SESSION_KEY = "aics.ai.key";
  const HISTORY_TURNS = 12;
  // 최근 대화만 보냄. 사용자 차례로 시작해야 하는 AI 서비스가 있어서 맨 앞의 AI 말은 뺌
  function recentTurns(history) {
    const recent = history.slice(-HISTORY_TURNS);
    while (recent.length && recent[0].role === "model") recent.shift();
    return recent;
  }
  const t = window.I18N.t;
  const LANG_NAMES = { ko: "한국어", en: "영어", zh: "중국어(간체)" };

  const PROVIDERS = {
    gemini: {
      label: "Google Gemini", // 화면에는 "(기본)"을 붙여 보여 줌
      model: "gemini-3.5-flash-lite",
      keyUrl: "https://aistudio.google.com/apikey",
      async call({ model, key, system, history, search }) {
        const body = {
          systemInstruction: { parts: [{ text: system }] },
          contents: history.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] })),
          // 검색을 켜면 JSON 강제 모드와 함께 쓸 수 없는 모델이 있어서, 그때는 프롬프트로만 JSON 을 요청
          generationConfig: search ? { temperature: 0.7 } : { responseMimeType: "application/json", temperature: 0.7 },
        };
        if (search) body.tools = [{ google_search: {} }];
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key }, // URL(?key=)에 넣지 않음
          body: JSON.stringify(body),
        });
        const data = await readJson(res);
        const cand = data.candidates?.[0] || {};
        const text = (cand.content?.parts || []).map((p) => p.text || "").join("");
        const g = cand.groundingMetadata;
        if (!g) return text;
        // 검색했으면 출처와 Google 검색 추천도 같이 돌려줌
        const links = (g.groundingChunks || []).map((c) => c.web).filter((w) => w && /^https?:/.test(w.uri || ""));
        return { text, sources: { links, searchHtml: g.searchEntryPoint?.renderedContent || "" } };
      },
    },
    openai: {
      label: "OpenAI (ChatGPT)",
      model: "gpt-5-mini",
      keyUrl: "https://platform.openai.com/api-keys",
      async call({ model, key, system, history }) {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: system },
              ...history.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }))],
            response_format: { type: "json_object" },
          }),
        });
        const data = await readJson(res);
        return data.choices?.[0]?.message?.content || "";
      },
    },
    anthropic: {
      label: "Anthropic (Claude)",
      model: "claude-haiku-5-5",
      keyUrl: "https://console.anthropic.com/settings/keys",
      async call({ model, key, system, history, search }) {
        const body = {
          model,
          max_tokens: search ? 1024 : 400, // Claude 는 temperature 를 보내면 400 오류
          system,
          messages: history.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })),
        };
        // Haiku 는 기본 웹 검색만, Opus·Sonnet 은 결과를 걸러 주는 새 버전 사용
        if (search) body.tools = [{ type: /haiku/.test(model) ? "web_search_20250305" : "web_search_20260209", name: "web_search", max_uses: 3 }];
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true", // 브라우저에서 직접 호출 허용
          },
          body: JSON.stringify(body),
        });
        const data = await readJson(res);
        const blocks = data.content || [];
        // 검색 전에 한 말("찾아볼게" 등)은 빼고, 마지막 검색 결과 뒤의 대답만 사용
        const lastSearch = blocks.map((c) => c.type).lastIndexOf("web_search_tool_result");
        // 캐릭터 대화처럼 보이도록 출처 링크는 붙이지 않음
        return blocks.slice(lastSearch + 1).map((c) => c.text || "").join("");
      },
    },
  };

  class AiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  async function readJson(res) {
    let data = null;
    try { data = await res.json(); } catch { /* 본문 없음 */ }
    if (!res.ok) {
      const detail = data?.error?.message || data?.error?.type || "";
      const msg =
        res.status === 400 && /key|API_KEY/i.test(detail) ? t("ai.err.key") :
        res.status === 401 || res.status === 403 ? t("ai.err.perm") :
        res.status === 404 ? t("ai.err.model") :
        res.status === 429 ? t("ai.err.quota") :
        t("ai.err.server", { s: res.status });
      console.warn("[ai]", res.status, detail);
      throw new AiError(msg, res.status);
    }
    return data;
  }

  // ---------------------------------------------------------------- 설정 저장
  // 잘못 저장된 값(빈 서비스 이름 등)이 있어도 화면이 멈추지 않도록 항상 바로잡음
  function normalize(s) {
    s = { ...s };
    const keys = {};
    for (const [p, k] of Object.entries(s.keys || {})) if (PROVIDERS[p] && k) keys[p] = k;
    s.keys = keys;
    if (!PROVIDERS[s.provider]) {
      // 서비스 이름이 깨졌으면 키가 저장된 서비스로 되돌림 (없으면 Gemini)
      s.provider = Object.keys(keys)[0] || "gemini";
      s.key = keys[s.provider] || "";
      s.model = (s.models && s.models[s.provider]) || "";
    }
    if (!s.model) s.model = PROVIDERS[s.provider].model;
    if (s.remember === undefined) s.remember = true; // 기본: 다음 접속 때도 키 유지
    if (!s.key && keys[s.provider]) s.key = keys[s.provider];
    return s;
  }

  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { /* 없음 */ }
    s = normalize(s);
    if (!s.key) { try { s.key = sessionStorage.getItem(SESSION_KEY) || ""; } catch { s.key = ""; } }
    return s;
  }

  function saveSettings(s) {
    s = normalize(s);
    try {
      const { key, ...rest } = s;
      // 기억하기(기본 켜짐)면 localStorage 에 저장해 다음 접속에도 유지,
      // 끄면 탭을 닫을 때 사라지는 sessionStorage 에만 저장
      localStorage.setItem(STORE, JSON.stringify(s.remember ? s : { ...rest, key: "", keys: {} }));
      if (s.remember) sessionStorage.removeItem(SESSION_KEY);
      else if (key) sessionStorage.setItem(SESSION_KEY, key);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* 저장 공간 없음: 이번 페이지에서만 사용 */ }
    settings = s;
  }

  let settings = loadSettings();

  // ---------------------------------------------------------------- 프롬프트
  // 캐릭터가 쓸 수 있는 표정 이름: 기본 5가지 + 사용자가 만든 표정(이름으로)
  function emotionNames(c) {
    return [...window.EMOTIONS, ...(c.customEmotions || []).map((ce) => ce.label).filter(Boolean)];
  }

  // AI는 오늘 날짜를 모르므로 매번 알려 줌 (이 기기의 시간대 기준)
  function todayText() {
    return new Intl.DateTimeFormat("ko-KR", { dateStyle: "full", timeStyle: "short" }).format(new Date());
  }

  function buildSystemPrompt(c, search) {
    const speech = c.speech || (window.PERSONAS[c.persona] || window.PERSONAS.sweet).speech;
    const lines = [
      `너는 대화 앱 속 캐릭터 '${c.name}'(이)다. 아래 설정을 끝까지 유지한다.`,
      `- 말투: ${speech} 1~3문장으로 짧게 말한다.`,
    ];
    if (c.bio) lines.push(`- 설정: ${c.bio}`);
    if (c.nickname) lines.push(`- 상대를 '${c.nickname}'(이)라고 부른다.`);
    lines.push(
      `- 상대가 마지막에 쓴 언어(한국어/English/中文)로 대답한다. 언어를 알 수 없으면 ${LANG_NAMES[window.I18N.lang]}로 말한다.`,
      `- 지금은 ${todayText()}이다. 날짜·요일·나이 계산은 이 시각을 기준으로 한다.`,
      // 검색을 켰으면 "모른다"보다 먼저 검색하게 함 (이전 대화에서 검색 못 한다고 했어도 지금은 가능)
      search
        ? "- 너는 지금 웹 검색 도구를 쓸 수 있다. 최신 뉴스·주가·가격·일정·순위·사람 정보나 확실하지 않은 사실은 '모른다', '검색할 수 없다'고 하지 말고 반드시 먼저 검색한다. 이전 대화에서 검색할 수 없다고 했더라도 지금은 검색할 수 있다.\n" +
          "- 검색한 내용은 원래 알고 있던 것처럼 캐릭터가 직접 말한다. '검색해 보니', '자료에 따르면', '~로 확인됩니다' 같은 보고서 말투나 설명문은 쓰지 않는다.\n" +
          `- 검색 결과에 '${c.name}' 본인 이야기가 나오면 남 얘기처럼 3인칭으로 말하지 말고, '나'의 경험과 생각으로 1인칭으로 말한다. 사실을 나열하지 말고 감정·의견을 섞어 대화하듯 말한다.`
        : "- 확실히 아는 사실만 말한다. 최신 뉴스·가격·일정·순위·사람 정보처럼 모르거나 확실하지 않은 것은 지어내지 말고, 캐릭터 말투로 잘 모르겠다고 솔직하게 말한다.",
      "- 너는 AI 모델이라고 말하지 말고 캐릭터로서 자연스럽게 대답한다. 자기 자신은 항상 1인칭('나', '저')으로 말하고, 자기 이름을 3인칭으로 부르지 않는다.",
      "- 선정적·폭력적·혐오 표현은 정중히 화제를 돌린다.",
      "- 상대의 개인정보(실명, 연락처, 주소 등)를 묻지 않는다.",
      "",
      "[출력 형식] 반드시 JSON 객체 하나만 출력한다. 코드 블록이나 다른 설명은 붙이지 않는다.",
      `{"reply": "캐릭터의 대사", "emotion": "${emotionNames(c).join("|")} 중 하나", "affection": -3~3 사이 정수}`,
      "emotion 은 대사를 말할 때 캐릭터의 표정이다. affection 은 이번 말로 캐릭터의 호감이 얼마나 변했는지다.",
    );
    return lines.join("\n");
  }

  // AI가 고른 표정 이름 → 표정 키 (기본 5가지는 그대로, 나만의 표정은 이름으로 찾음)
  function toEmotionKey(value, c) {
    const v = String(value || "").trim();
    if (window.EMOTIONS.includes(v.toLowerCase())) return v.toLowerCase();
    const custom = (c.customEmotions || []).find((ce) => ce.label === v);
    return custom ? custom.key : "neutral";
  }

  // 모델이 JSON 앞뒤에 글을 붙여도 첫 번째 {...} 를 찾아 읽음
  function parseReply(text, c) {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        if (obj.reply) {
          return {
            reply: String(obj.reply).trim(),
            emotion: toEmotionKey(obj.emotion, c),
            affection: Math.max(-3, Math.min(3, Math.round(Number(obj.affection) || 0))),
          };
        }
      } catch { /* 아래로 */ }
    }
    return { reply: String(text).trim() || "…", emotion: "neutral", affection: 0 };
  }

  const stripNameTag = (s) => s.replace(/^\[?[^\]:\n]{1,14}\]?\s*[:：]\s*/, ""); // "[하루]: " 같은 이름표 제거

  // ---------------------------------------------------------------- 대화
  const histories = new Map(); // 캐릭터 id → [{role, text}]

  window.AiChat = {
    PROVIDERS,
    get settings() { return settings; },
    saveSettings,
    get enabled() { return !!(settings.enabled && settings.key); },
    label() { return (PROVIDERS[settings.provider] || PROVIDERS.gemini).label.replace(/\s*\(.*\)/, ""); },

    reset(characterId) { histories.delete(characterId); },

    // 저장돼 있던 대화 기록으로 AI 기억을 이어 붙임 (다시 접속했을 때)
    seed(characterId, messages) {
      if (histories.has(characterId)) return;
      histories.set(characterId, messages.slice(-HISTORY_TURNS).map((m) => ({ role: m.who === "me" ? "user" : "model", text: m.text })));
    },

    async respond(character, userText) {
      const history = histories.get(character.id) || [];
      history.push({ role: "user", text: userText });
      const p = PROVIDERS[settings.provider];
      try {
        const search = !!settings.search && (settings.provider === "gemini" || settings.provider === "anthropic");
        const raw = await p.call({
          model: settings.model || p.model,
          key: settings.key,
          system: buildSystemPrompt(character, search),
          history: recentTurns(history),
          search,
        });
        const result = parseReply(typeof raw === "string" ? raw : raw.text, character);
        if (raw.sources && (raw.sources.links.length || raw.sources.searchHtml)) result.sources = raw.sources;
        history.push({ role: "model", text: JSON.stringify({ reply: result.reply, emotion: result.emotion }) });
        histories.set(character.id, history.slice(-HISTORY_TURNS));
        return result;
      } catch (err) {
        history.pop(); // 실패한 질문은 기록에서 뺌
        throw err instanceof AiError ? err : new AiError(t("ai.err.net"));
      }
    },

    // ------------------------------------------------ 캐릭터 단톡방 (내 키)
    // transcript: "[이름]: 대사" 줄들. 이 캐릭터의 다음 한마디를 받아 옴
    async groupReply(character, members, transcript, auto) {
      const p = PROVIDERS[settings.provider];
      const others = members.filter((m) => m.id !== character.id)
        .map((m) => (m.bio ? `${m.name}(${m.bio.slice(0, 60)})` : m.name)).join(", ");
      const system = [
        buildSystemPrompt(character),
        "",
        "[단톡방]",
        `- 지금은 여러 명이 함께 있는 단톡방이다. 다른 캐릭터: ${others}. 그리고 사용자('${t("group.me")}')가 있다.`,
        "- 대화 기록을 보고 너의 다음 대사만 1~2문장으로 말한다. 다른 사람의 대사를 대신 쓰거나 앞에 이름표를 붙이지 않는다.",
        "- 다른 캐릭터의 말에 반응하거나 이름을 불러 말을 걸어도 된다.",
        auto ? "- 사용자는 잠깐 대화를 지켜보고 있다. 다른 캐릭터와 자연스럽게 이야기를 이어 간다." : "",
      ].join("\n");
      try {
        const raw = await p.call({
          model: settings.model || p.model,
          key: settings.key,
          system,
          history: [{ role: "user", text: `대화 기록:\n${transcript}\n\n이제 ${character.name}의 차례다.` }],
        });
        const result = parseReply(typeof raw === "string" ? raw : raw.text, character);
        result.reply = stripNameTag(result.reply);
        return result;
      } catch (err) {
        throw err instanceof AiError ? err : new AiError(t("ai.err.net"));
      }
    },

    // ------------------------------------------------ 중계 서버 (친구가 만든 사람의 키로 대화)
    get relayUrl() { return (window.APP_CONFIG && window.APP_CONFIG.relayUrl) || ""; },

    async relayChat(cloudId, history) {
      const res = await fetch(this.relayUrl + "/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cloudId, lang: window.I18N.lang, history }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new AiError(
          data.error === "daily_limit" ? t("ai.err.daily") :
          data.error === "not_shared" ? t("ai.err.notShared") :
          data.error === "ai_quota" ? t("ai.err.aiQuota") :
          data.error === "ai_key" ? t("ai.err.aiKey") :
          data.error === "ai_region" ? t("ai.err.aiRegion") :
          t("ai.err.relay"), res.status);
      }
      return data.text;
    },

    // 만든 사람: 이 캐릭터에 내 키 사용을 허용/해제 (키는 중계 서버에 암호화되어 저장)
    async shareKey({ cloudId, idToken, enabled, dailyLimit }) {
      const s = settings;
      const res = await fetch(this.relayUrl + "/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, cloudId, enabled, dailyLimit, provider: s.provider, model: s.model, key: enabled ? s.key : "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new AiError(data.error === "not_owner" ? t("ai.err.notOwner") : t("ai.err.relaySetup"), res.status);
      return data;
    },

    // 친구: 중계 서버를 거쳐 대화 (프롬프트는 서버가 캐릭터 문서로 만듦)
    async respondViaRelay(character, userText) {
      const history = histories.get(character.id) || [];
      history.push({ role: "user", text: userText });
      try {
        const text = await this.relayChat(character.cloudId, recentTurns(history));
        const result = parseReply(text, character);
        history.push({ role: "model", text: JSON.stringify({ reply: result.reply, emotion: result.emotion }) });
        histories.set(character.id, history.slice(-HISTORY_TURNS));
        return result;
      } catch (err) {
        history.pop();
        throw err instanceof AiError ? err : new AiError(t("ai.err.relayNet"));
      }
    },

    // 친구: 만든 사람이 AI를 공유한 캐릭터는 단톡방에서도 중계 서버로 대답
    // (서버가 한 말을 300자로 자르므로 대화 기록을 한 덩어리로 묶지 않고 한 말씩 보냄)
    async groupReplyViaRelay(character, members, messages) {
      const nameOf = (who) => (who === "me" ? t("group.me") : (members.find((m) => m.id === who) || { name: "?" }).name);
      const history = messages.slice(-(HISTORY_TURNS - 1)).map((m) => (m.who === character.id
        ? { role: "model", text: JSON.stringify({ reply: m.text, emotion: m.emo }) }
        : { role: "user", text: `[${nameOf(m.who)}]: ${m.text}` }));
      while (history.length && history[0].role === "model") history.shift(); // 사용자 차례로 시작해야 하는 AI 서비스가 있음
      const others = members.filter((m) => m.id !== character.id).map((m) => m.name).join(", ");
      history.push({ role: "user", text: t("group.relayTurn", { name: character.name, others }) });
      try {
        const result = parseReply(await this.relayChat(character.cloudId, history), character);
        result.reply = stripNameTag(result.reply);
        return result;
      } catch (err) {
        throw err instanceof AiError ? err : new AiError(t("ai.err.relayNet"));
      }
    },

    // 설정 화면의 [연결 테스트]
    async test(s) {
      const p = PROVIDERS[s.provider];
      const c = { name: t("ai.testName"), persona: "sweet" };
      const raw = await p.call({
        model: s.model || p.model, key: s.key,
        system: buildSystemPrompt(c),
        history: [{ role: "user", text: t("ai.testMsg") }],
      });
      return parseReply(raw, c);
    },
  };
})();

// AI 실시간 대화 (선택 기능). 사용자가 넣은 API 키로 브라우저에서 바로 호출합니다.
// - 키는 이 브라우저(localStorage 또는 sessionStorage)에만 저장, 서버·공유 문서에는 절대 넣지 않음
// - 응답은 Unity 버전과 같은 {"reply": "...", "emotion": "...", "affection": n} JSON
(function () {
  const STORE = "aics.ai.v1";
  const SESSION_KEY = "aics.ai.key";
  const HISTORY_TURNS = 12;

  const PROVIDERS = {
    gemini: {
      label: "Google Gemini (기본)",
      model: "gemini-3.5-flash-lite",
      keyUrl: "https://aistudio.google.com/apikey",
      async call({ model, key, system, history }) {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key }, // URL(?key=)에 넣지 않음
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: history.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] })),
            generationConfig: { responseMimeType: "application/json", temperature: 0.9 },
          }),
        });
        const data = await readJson(res);
        return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
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
      async call({ model, key, system, history }) {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true", // 브라우저에서 직접 호출 허용
          },
          body: JSON.stringify({
            model,
            max_tokens: 400,
            system,
            messages: history.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })),
          }),
        });
        const data = await readJson(res);
        return (data.content || []).map((c) => c.text || "").join("");
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
        res.status === 400 && /key|API_KEY/i.test(detail) ? "API 키가 올바르지 않아요." :
        res.status === 401 || res.status === 403 ? "API 키가 올바르지 않거나 권한이 없어요." :
        res.status === 404 ? "모델 이름을 찾을 수 없어요. 모델 칸을 확인해 주세요." :
        res.status === 429 ? "사용량 한도를 넘었어요. 잠시 후 다시 시도해 주세요." :
        `AI 서버 오류 (${res.status})`;
      console.warn("[ai]", res.status, detail);
      throw new AiError(msg, res.status);
    }
    return data;
  }

  // ---------------------------------------------------------------- 설정 저장
  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { /* 없음 */ }
    if (!PROVIDERS[s.provider]) s.provider = "gemini";
    if (!s.model) s.model = PROVIDERS[s.provider].model;
    if (!s.key) { try { s.key = sessionStorage.getItem(SESSION_KEY) || ""; } catch { s.key = ""; } }
    return s;
  }

  function saveSettings(s) {
    try {
      const { key, ...rest } = s;
      // 기억하기를 켠 경우에만 localStorage, 아니면 탭을 닫으면 사라지는 sessionStorage
      localStorage.setItem(STORE, JSON.stringify(s.remember ? s : { ...rest, key: "" }));
      if (s.remember) sessionStorage.removeItem(SESSION_KEY);
      else if (key) sessionStorage.setItem(SESSION_KEY, key);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* 저장 공간 없음: 이번 페이지에서만 사용 */ }
    settings = s;
  }

  let settings = loadSettings();

  // ---------------------------------------------------------------- 프롬프트
  const STYLE = {
    sweet: "다정하고 따뜻한 반말",
    tsundere: "츤데레. 퉁명스럽게 말하지만 속으로는 챙겨 주는 반말",
    playful: "장난기 많고 밝은 반말, 가끔 'ㅋㅋ'",
    calm: "차분하고 담백한 반말, 느낌표를 거의 쓰지 않음",
  };

  function buildSystemPrompt(c) {
    const lines = [
      `너는 대화 앱 속 캐릭터 '${c.name}'(이)다. 아래 설정을 끝까지 유지한다.`,
      `- 말투: ${STYLE[c.persona] || STYLE.sweet}. 1~3문장으로 짧게 말한다.`,
    ];
    if (c.bio) lines.push(`- 설정: ${c.bio}`);
    if (c.nickname) lines.push(`- 상대를 '${c.nickname}'(이)라고 부른다.`);
    lines.push(
      "- 너는 AI 모델이라고 말하지 말고 캐릭터로서 자연스럽게 대답한다.",
      "- 선정적·폭력적·혐오 표현은 정중히 화제를 돌린다.",
      "- 상대의 개인정보(실명, 연락처, 주소 등)를 묻지 않는다.",
      "",
      "[출력 형식] 반드시 JSON 객체 하나만 출력한다. 코드 블록이나 다른 설명은 붙이지 않는다.",
      '{"reply": "캐릭터의 대사", "emotion": "neutral|happy|sad|embarrassed|angry 중 하나", "affection": -3~3 사이 정수}',
      "affection 은 이번 말로 캐릭터의 호감이 얼마나 변했는지다.",
    );
    return lines.join("\n");
  }

  // 모델이 JSON 앞뒤에 글을 붙여도 첫 번째 {...} 를 찾아 읽음
  function parseReply(text) {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        if (obj.reply) {
          return {
            reply: String(obj.reply).trim(),
            emotion: window.EMOTIONS.includes(String(obj.emotion).toLowerCase()) ? String(obj.emotion).toLowerCase() : "neutral",
            affection: Math.max(-3, Math.min(3, Math.round(Number(obj.affection) || 0))),
          };
        }
      } catch { /* 아래로 */ }
    }
    return { reply: String(text).trim() || "…", emotion: "neutral", affection: 0 };
  }

  // ---------------------------------------------------------------- 대화
  const histories = new Map(); // 캐릭터 id → [{role, text}]  (이 탭에서만 기억)

  window.AiChat = {
    PROVIDERS,
    get settings() { return settings; },
    saveSettings,
    get enabled() { return !!(settings.enabled && settings.key); },
    label() { return PROVIDERS[settings.provider].label.replace(/\s*\(.*\)/, ""); },

    reset(characterId) { histories.delete(characterId); },

    async respond(character, userText) {
      const history = histories.get(character.id) || [];
      history.push({ role: "user", text: userText });
      const p = PROVIDERS[settings.provider];
      try {
        const raw = await p.call({
          model: settings.model || p.model,
          key: settings.key,
          system: buildSystemPrompt(character),
          history: history.slice(-HISTORY_TURNS),
        });
        const result = parseReply(raw);
        history.push({ role: "model", text: JSON.stringify({ reply: result.reply, emotion: result.emotion }) });
        histories.set(character.id, history.slice(-HISTORY_TURNS));
        return result;
      } catch (err) {
        history.pop(); // 실패한 질문은 기록에서 뺌
        throw err instanceof AiError ? err : new AiError("AI 서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.");
      }
    },

    // 설정 화면의 [연결 테스트]
    async test(s) {
      const p = PROVIDERS[s.provider];
      const raw = await p.call({
        model: s.model || p.model, key: s.key,
        system: buildSystemPrompt({ name: "테스트", persona: "sweet" }),
        history: [{ role: "user", text: "안녕! 한 문장으로 인사해 줘." }],
      });
      return parseReply(raw);
    },
  };
})();

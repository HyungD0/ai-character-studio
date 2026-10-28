// API 없이 동작하는 심심이식 대화 엔진.
// 1) 키워드 DB(chat-db.js + 구글 시트)에서 가장 잘 맞는 답을 찾고
// 2) 모르는 말이면 사용자에게 대답을 "가르쳐 달라"고 요청해 학습합니다.
(function () {
  const EMOTIONS = ["neutral", "happy", "sad", "embarrassed", "angry"];
  const TAUGHT_KEY = "aics.taught.v1";

  // 띄어쓰기·문장부호·대소문자를 무시하고 비교
  function normalize(text) {
    return String(text || "").toLowerCase().replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ+]/g, "");
  }

  function hasBannedWord(text) {
    const n = normalize(text);
    return window.BANNED_WORDS.some((w) => n.includes(normalize(w)));
  }

  function safeEmotion(value) {
    const key = String(value || "").trim().toLowerCase();
    return EMOTIONS.includes(key) ? key : "neutral";
  }

  function pick(list, avoid) {
    if (list.length > 1) list = list.filter((x) => x !== avoid);
    return list[Math.floor(Math.random() * list.length)];
  }

  // 성격별 말투 입히기 (DB 대사는 하나로 쓰고 말투만 바꿈)
  const PERSONAS = {
    sweet: { label: "다정함", style: (t) => t },
    tsundere: {
      label: "츤데레",
      style: (t, emo) =>
        emo === "happy" || emo === "embarrassed"
          ? pick(["흐, 흥! ", "딱히 좋아서 그런 건 아니고… ", ""]) + t
          : t,
    },
    playful: { label: "장난꾸러기", style: (t, emo) => t + (emo === "sad" ? "" : pick([" ㅋㅋ", " 히히", " 😜", ""])) },
    calm: { label: "차분함", style: (t) => t.replace(/[!！]+/g, ".").replace(/헤헤,?\s?/g, "") },
  };

  function loadTaught() {
    try { return JSON.parse(localStorage.getItem(TAUGHT_KEY)) || []; } catch { return []; }
  }
  function saveTaught(list) {
    try { localStorage.setItem(TAUGHT_KEY, JSON.stringify(list.slice(-300))); } catch { /* 저장 공간 없음 */ }
  }

  class ChatEngine {
    constructor() {
      this.rules = window.CHAT_DB.map((r) => ({ ...r, keys: r.keywords.map(normalize) }));
      this.taught = loadTaught();
      this.lastReply = "";
    }

    // 구글 시트(승인된 행)를 불러와 DB에 더함. 실패해도 내장 DB로 계속 동작.
    async loadSheet(url) {
      if (!url) return 0;
      try {
        const res = await fetch(url + "?action=list");
        const data = await res.json();
        const rows = (data.rows || []).filter((r) => r.question && r.answer && !hasBannedWord(r.answer));
        for (const r of rows) this.addTaughtRule(r.question, r.answer, r.emotion, Number(r.affection) || 0, false);
        return rows.length;
      } catch (e) {
        console.warn("[sheet] 불러오기 실패, 내장 DB만 사용", e);
        return 0;
      }
    }

    addTaughtRule(question, answer, emotion, affection, remember) {
      const key = normalize(question);
      if (!key) return;
      const existing = this.rules.find((r) => r.taught && r.keys[0] === key);
      if (existing) {
        if (!existing.replies.includes(answer)) existing.replies.push(answer);
      } else {
        // 사용자가 가르친 문장은 "거의 같은 문장"일 때 우선 매칭되도록 가중치를 높게
        this.rules.push({ taught: true, keys: [key], replies: [answer], emotion: safeEmotion(emotion), affection });
      }
      if (remember) {
        this.taught.push({ question, answer, emotion: safeEmotion(emotion) });
        saveTaught(this.taught);
      }
    }

    restoreTaught() {
      for (const t of this.taught) this.addTaughtRule(t.question, t.answer, t.emotion, 0, false);
    }

    findRule(text) {
      const n = normalize(text);
      if (!n) return null;
      let best = null, bestScore = 0;
      for (const rule of this.rules) {
        let score = 0;
        for (const k of rule.keys) {
          if (!k) continue;
          if (rule.taught) {
            // 가르친 문장: 완전히 같으면 높은 점수, 서로 포함 관계면 중간 점수
            if (n === k) score = Math.max(score, 100);
            else if (k.length >= 2 && (n.includes(k) || k.includes(n))) score = Math.max(score, k.length + 3);
          } else if (n.includes(k)) {
            score += k.length;
          }
        }
        if (score > bestScore) { bestScore = score; best = rule; }
      }
      return best;
    }

    // 사용자가 가르친 대답의 감정을 대사 내용으로 추측
    guessEmotion(answer) {
      const rule = this.findRule(answer);
      if (rule && !rule.taught) return rule.emotion;
      if (/[😊😆😄🥰❤💕ㅎㅋ]|헤헤|좋아/.test(answer)) return "happy";
      if (/[😢😭]|ㅠ|ㅜ/.test(answer)) return "sad";
      if (/[😡💢]|흥|화나/.test(answer)) return "angry";
      return "neutral";
    }

    /**
     * 대답 만들기. 반환: { reply, emotion, affection, unknown }
     * unknown=true 이면 "가르쳐 줄래?" 흐름을 시작하라는 뜻.
     */
    respond(text, character) {
      const user = character.nickname || "너";
      const fill = (t) => t.replaceAll("{user}", user).replaceAll("{name}", character.name);
      const persona = PERSONAS[character.persona] || PERSONAS.sweet;

      if (hasBannedWord(text)) {
        return { reply: fill("음… 그런 말은 조금 무서워. 다른 얘기 하자!"), emotion: "sad", affection: -1, unknown: false };
      }

      const rule = this.findRule(text);
      if (!rule) {
        return { reply: pick(window.CHAT_FALLBACK, this.lastReply), emotion: "neutral", affection: 0, unknown: true };
      }
      const raw = fill(pick(rule.replies, this.lastReply));
      this.lastReply = raw;
      return { reply: persona.style(raw, rule.emotion), emotion: rule.emotion, affection: rule.affection || 0, unknown: false };
    }

    // 가르치기: 이 기기에는 바로 반영, 시트에는 "검수 대기"로 전송
    async teach(question, answer, sheetUrl) {
      if (hasBannedWord(question) || hasBannedWord(answer)) return { ok: false, reason: "banned" };
      const emotion = this.guessEmotion(answer);
      this.addTaughtRule(question, answer, emotion, 1, true);
      if (sheetUrl) {
        try {
          // text/plain 으로 보내야 Apps Script 에서 CORS 사전 요청 없이 받을 수 있음
          await fetch(sheetUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "teach", question, answer, emotion }),
          });
        } catch (e) {
          console.warn("[sheet] 전송 실패 (이 기기에는 저장됨)", e);
        }
      }
      return { ok: true, emotion };
    }
  }

  window.ChatEngine = ChatEngine;
  window.PERSONAS = PERSONAS;
  window.EMOTIONS = EMOTIONS;
  window.hasBannedWord = hasBannedWord;
})();

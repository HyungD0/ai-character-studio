// API 없이 동작하는 심심이식 대화 엔진.
// 1) 상대가 쓴 언어(한국어/영어/중국어)의 키워드 DB(chat-db.js + 구글 시트)에서 가장 잘 맞는 답을 찾고
// 2) 모르는 말이면 사용자에게 대답을 "가르쳐 달라"고 요청해 학습합니다.
(function () {
  const EMOTIONS = ["neutral", "happy", "sad", "embarrassed", "angry"];
  const TAUGHT_KEY = "aics.taught.v1";
  const t = window.I18N.t;

  // 띄어쓰기·문장부호·대소문자를 무시하고 비교
  function normalize(text) {
    return String(text || "").toLowerCase().replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ一-鿿+]/g, "");
  }

  // 글자로 언어 추측: 한글 → ko, 한자 → zh, 알파벳 → en
  function detectLang(text) {
    const s = String(text || "");
    if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(s)) return "ko";
    if (/[一-鿿]/.test(s)) return "zh";
    if (/[a-z]/i.test(s)) return "en";
    return null;
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

  // 말투 프리셋. speech(말투 칸에 채워지는 문장, AI 대화용)와 label 은 화면 언어를 따르고,
  // style 은 키워드 대화에서 DB 대사에 말투를 입히는 함수 (대사의 언어에 맞춤)
  const STYLE_BITS = {
    tsundere: { ko: ["흐, 흥! ", "딱히 좋아서 그런 건 아니고… "], en: ["H-hmph! ", "It's not like I'm happy or anything… "], zh: ["哼、哼！", "才、才不是因为高兴呢……"] },
    playful: { ko: [" ㅋㅋ", " 히히", " 😜"], en: [" lol", " hehe", " 😜"], zh: [" 哈哈", " 嘻嘻", " 😜"] },
  };
  function persona(key, style) {
    return {
      get label() { return t(`persona.${key}`); },
      get speech() { return t(`persona.${key}.speech`); },
      style,
    };
  }
  const PERSONAS = {
    sweet: persona("sweet", (s) => s),
    tsundere: persona("tsundere", (s, emo, lang) =>
      emo === "happy" || emo === "embarrassed" ? pick([...STYLE_BITS.tsundere[lang], ""]) + s : s),
    playful: persona("playful", (s, emo, lang) => s + (emo === "sad" ? "" : pick([...STYLE_BITS.playful[lang], ""]))),
    calm: persona("calm", (s) => s.replace(/!+/g, ".").replace(/！+/g, "。").replace(/(헤헤|hehe|嘿嘿)[,，]?\s?/gi, "")),
  };

  // 어느 언어든 프리셋 문장 그대로인지 (직접 쓴 말투와 구분)
  function isPresetSpeech(text) {
    const s = String(text || "").trim();
    return !s || Object.keys(PERSONAS).some((k) => window.I18N.all(`persona.${k}.speech`).includes(s));
  }

  // 기본 DB 대사에 섞인 귀여운 추임새. 직접 쓴 말투에 그 표현이 없으면 지운다.
  const FILLERS = [
    ["헤헤", /헤헤[.,!~…]*\s*/g],
    ["히히", /히히[.,!~…]*\s*/g],
    ["에엑", /에,?\s*에엑[?!]*\s*/g],
    ["ㅋㅋ", /\s*ㅋㅋ+/g],
    ["hehe", /\bhehe[.,!~…]*\s*/gi],
    ["嘿嘿", /嘿嘿[.,，。!！~…]*\s*/g],
  ];

  // 말투 칸을 직접 고친 캐릭터는 프리셋 효과 대신 추임새만 걸러 낸다
  function styleFor(character) {
    const p = PERSONAS[character.persona] || PERSONAS.sweet;
    const speech = String(character.speech || "").trim();
    if (isPresetSpeech(speech)) return p.style;
    return (s) => {
      let out = s;
      for (const [word, re] of FILLERS) if (!speech.toLowerCase().includes(word)) out = out.replace(re, "");
      return out.trim() || s;
    };
  }

  // 영어는 단어 단위로 비교 ("hi" 가 "this" 안에서 걸리지 않게). 3글자 이하는 단어 전체, 그보다 길면 단어 앞부분
  function enWords(text) { return " " + String(text || "").toLowerCase().replace(/[^a-z0-9']+/g, " ").trim() + " "; }
  function enMatch(words, key) {
    return key.length <= 3 ? words.includes(" " + key + " ") : words.includes(" " + key);
  }

  function loadTaught() {
    try { return JSON.parse(localStorage.getItem(TAUGHT_KEY)) || []; } catch { return []; }
  }
  function saveTaught(list) {
    try { localStorage.setItem(TAUGHT_KEY, JSON.stringify(list.slice(-300))); } catch { /* 저장 공간 없음 */ }
  }

  class ChatEngine {
    constructor() {
      this.rules = [];
      for (const [lang, db] of Object.entries(window.CHAT_DBS)) {
        for (const r of db) {
          const keys = lang === "en" ? r.keywords.map((k) => enWords(k).trim()) : r.keywords.map(normalize);
          this.rules.push({ ...r, lang, keys });
        }
      }
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

    // owner: 그 대답을 배운 캐릭터 id. 있으면 그 캐릭터에서만 쓰고, 없으면(시트 등) 모두가 같이 씀
    // lang: 질문의 언어. 같은 언어로 말할 때만 이 대답을 씀
    addTaughtRule(question, answer, emotion, affection, remember, owner) {
      const key = normalize(question);
      if (!key) return;
      const lang = detectLang(question) || detectLang(answer);
      const existing = this.rules.find((r) => r.taught && r.keys[0] === key && r.owner === owner);
      if (existing) {
        if (!existing.replies.includes(answer)) existing.replies.push(answer);
      } else {
        // 사용자가 가르친 문장은 "거의 같은 문장"일 때 우선 매칭되도록 가중치를 높게
        this.rules.push({ taught: true, owner, lang, keys: [key], replies: [answer], emotion: safeEmotion(emotion), affection });
      }
      if (remember) {
        this.taught.push({ question, answer, emotion: safeEmotion(emotion), owner });
        saveTaught(this.taught);
      }
    }

    restoreTaught() {
      for (const x of this.taught) this.addTaughtRule(x.question, x.answer, x.emotion, 0, false, x.owner);
    }

    findRule(text, characterId, lang) {
      const n = normalize(text);
      if (!n) return null;
      const words = enWords(text);
      let best = null, bestScore = 0;
      for (const rule of this.rules) {
        if (rule.owner && rule.owner !== characterId) continue; // 다른 캐릭터가 배운 대답은 섞지 않음
        if (lang && rule.lang && rule.lang !== lang) continue; // 다른 언어 대사는 쓰지 않음
        let score = 0;
        for (const k of rule.keys) {
          if (!k) continue;
          if (rule.taught) {
            // 가르친 문장: 완전히 같으면 높은 점수, 서로 포함 관계면 중간 점수 (이 캐릭터가 직접 배운 대답이 공용 대답보다 우선)
            if (n === k) score = Math.max(score, rule.owner ? 101 : 100);
            else if (k.length >= 2 && (n.includes(k) || k.includes(n))) score = Math.max(score, k.length + 3);
          } else if (rule.lang === "en" ? enMatch(words, k) : n.includes(k)) {
            score += k.length;
          }
        }
        // 점수가 같으면 감정이 더 큰 대사 ("안녕 귀여워" → 인사보다 칭찬에 반응)
        if (score > bestScore || (score && score === bestScore && (rule.affection || 0) > (best.affection || 0))) {
          bestScore = score;
          best = rule;
        }
      }
      return best;
    }

    // 사용자가 가르친 대답의 감정을 대사 내용으로 추측
    guessEmotion(answer) {
      const rule = this.findRule(answer, null, detectLang(answer));
      if (rule && !rule.taught) return rule.emotion;
      if (/[😊😆😄🥰❤💕ㅎㅋ]|헤헤|좋아|haha|hehe|yay|哈哈|嘿嘿|开心/i.test(answer)) return "happy";
      if (/[😢😭]|ㅠ|ㅜ|sad|难过|呜/i.test(answer)) return "sad";
      if (/[😡💢]|흥|화나|hmph|angry|哼|生气/i.test(answer)) return "angry";
      return "neutral";
    }

    /**
     * 대답 만들기. 반환: { reply, emotion, affection, unknown }
     * unknown=true 이면 "가르쳐 줄래?" 흐름을 시작하라는 뜻.
     */
    respond(text, character) {
      const lang = detectLang(text) || window.I18N.lang;
      const user = character.nickname || { ko: "너", en: "you", zh: "你" }[lang];
      const fill = (s) => s.replaceAll("{user}", user).replaceAll("{name}", character.name);

      if (hasBannedWord(text)) {
        return { reply: window.CHAT_BANNED_REPLY[lang], emotion: "sad", affection: -1, unknown: false };
      }

      const rule = this.findRule(text, character.id, lang);
      if (!rule) {
        return { reply: pick(window.CHAT_FALLBACKS[lang], this.lastReply), emotion: "neutral", affection: 0, unknown: true };
      }
      const raw = fill(pick(rule.replies, this.lastReply));
      this.lastReply = raw;
      // 이 캐릭터에게 직접 가르친 대답은 그대로, 공용 대사는 캐릭터 말투에 맞춰 다듬음
      const reply = rule.owner ? raw : styleFor(character)(raw, rule.emotion, rule.lang || lang);
      return { reply, emotion: rule.emotion, affection: rule.affection || 0, unknown: false };
    }

    // 가르치기: 이 기기에는 바로 반영, 시트에는 "검수 대기"로 전송
    async teach(question, answer, sheetUrl, characterId) {
      if (hasBannedWord(question) || hasBannedWord(answer)) return { ok: false, reason: "banned" };
      const emotion = this.guessEmotion(answer);
      this.addTaughtRule(question, answer, emotion, 1, true, characterId);
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
  window.isPresetSpeech = isPresetSpeech;
  window.styleFor = styleFor;
  window.detectLang = detectLang;
  window.EMOTIONS = EMOTIONS;
  window.hasBannedWord = hasBannedWord;
})();

// AI 대화 중계 서버 (Cloudflare Worker)
// 캐릭터를 만든 사람의 API 키를 이 서버에만(암호화해서) 보관하고,
// 공유받은 친구의 대화를 대신 AI에 전달합니다. 친구 브라우저에는 키가 절대 가지 않습니다.
//
// 필요한 설정 (Cloudflare 대시보드 → Worker → 설정)
//   KV 바인딩   RELAY      : 키 저장
//   D1 바인딩   DB         : 하루 대화 횟수 (표는 자동 생성, 지난 날짜 기록은 자동 삭제)
//                            없으면 예전처럼 KV 로 셈 (무료 플랜 KV 쓰기 하루 1,000회 한도)
//   (선택) 비밀 변수 ENC_KEY : 키 암호화용 32바이트 base64. 없으면 자동 생성해 KV 에 보관
//   (선택) 일반 변수 FIREBASE_PROJECT : 없으면 ai-character-studio-fd38a
//
// POST /register  { idToken, cloudId, enabled, provider, model, key, dailyLimit }
//   만든 사람만(Firebase 익명 로그인 토큰 + Firestore 문서의 ownerUid 로 확인) 키 등록·해제
// POST /chat      { cloudId, lang, history: [{ role: "user"|"model", text }] }
//   하루 한도 안에서 만든 사람의 키로 AI 호출, { text } 반환
// GET  /geo       접속한 나라 코드만 { country: "KR" } 반환 (화면 언어·공유 버튼용, IP는 저장하지 않음)
// GET  /s/{id}    공유 링크. 링크 미리보기(카톡·SNS)에 그 캐릭터의 이름·얼굴을 보여 주고, 사람은 앱으로 보냄
// GET  /img/{id}  링크 미리보기용 캐릭터 사진

const DEFAULT_PROJECT = "ai-character-studio-fd38a";
const project = (env) => env.FIREBASE_PROJECT || DEFAULT_PROJECT;
const ALLOWED_ORIGINS = ["https://hyungd0.github.io", "http://localhost:8080"];
const SITE_URL = "https://hyungd0.github.io/ai-character-studio/";
const MAX_LIMIT = 10000;
const HISTORY_TURNS = 12;
const MAX_TEXT = 300;
const EMOTIONS = ["neutral", "happy", "sad", "embarrassed", "angry"];
const LANG_NAMES = { ko: "한국어", en: "영어", zh: "중국어(간체)" };

const SPEECH = {
  sweet: "다정하고 따뜻한 반말을 쓰고, 상대를 잘 챙겨 준다.",
  tsundere: "퉁명스러운 반말을 쓰지만 속으로는 챙겨 준다. 칭찬받으면 '흥'하며 딴청을 피운다.",
  playful: "장난기 많고 밝은 반말을 쓰고, 가끔 'ㅋㅋ'를 붙인다.",
  calm: "차분하고 담백한 반말을 쓰고, 느낌표를 거의 쓰지 않는다.",
};

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
    const reply = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/geo") {
      return new Response(JSON.stringify({ country: request.cf?.country || null }),
        { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    const share = path.match(/^\/(s|img)\/([A-Za-z0-9]{10,40})$/);
    if (share && (request.method === "GET" || request.method === "HEAD")) {
      return share[1] === "s" ? sharePage(share[2], new URL(request.url).origin, env) : shareImage(share[2], env);
    }
    if (request.method !== "POST") return reply({ ok: true, service: "ai-character-relay" });
    if (!ALLOWED_ORIGINS.includes(origin)) return reply({ error: "origin" }, 403);

    let body;
    try { body = await request.json(); } catch {
      logFailure(path, fail("bad_json", 400), request.cf?.colo);
      return reply({ error: "bad_json" }, 400);
    }

    try {
      if (path === "/register") return reply(await register(body, env));
      if (path === "/chat") return reply(await chat(body, env, ctx, request.cf?.timezone));
      return reply({ error: "not_found" }, 404);
    } catch (err) {
      logFailure(path, err, request.cf?.colo, body);
      return reply({ error: err.code || "server", message: err.message }, err.status || 500);
    }
  },
};

// 실패 원인을 Cloudflare 로그(관찰 가능성)에서 볼 수 있게 남김. 키·대화 내용은 절대 넣지 않음
function logFailure(path, err, colo, body) {
  const history = Array.isArray(body?.history) ? body.history : null;
  console.warn(JSON.stringify({
    relayFail: {
      path, colo, code: err.code || "server", status: err.status || 500, ai: err.ai,
      hasId: !!body?.cloudId, turns: history?.length, firstRole: history?.[0]?.role, lastRole: history?.[history.length - 1]?.role,
    },
  }));
}

function fail(code, status, message) {
  const e = new Error(message || code);
  e.code = code;
  e.status = status;
  return e;
}

// ---------------------------------------------------------------- 등록 (만든 사람만)
async function register(body, env) {
  const cloudId = String(body.cloudId || "");
  if (!/^[A-Za-z0-9]{10,40}$/.test(cloudId)) throw fail("bad_id", 400);
  const uid = await verifyFirebaseToken(String(body.idToken || ""), project(env));
  const doc = await loadCharacter(cloudId, project(env), ["ownerUid"]);
  if (!doc) throw fail("no_character", 404);
  if (field(doc, "ownerUid") !== uid) throw fail("not_owner", 403);

  if (!body.enabled || !body.key) {
    await env.RELAY.delete("cfg:" + cloudId);
    return { ok: true, enabled: false };
  }
  const provider = ["gemini", "openai", "anthropic"].includes(body.provider) ? body.provider : "gemini";
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.round(Number(body.dailyLimit) || 100)));
  const enc = await encrypt(String(body.key).slice(0, 300), await encSecret(env));
  await env.RELAY.put("cfg:" + cloudId, JSON.stringify({
    provider, model: String(body.model || "").slice(0, 80), enc, limit, ownerUid: uid,
  }));
  return { ok: true, enabled: true, limit };
}

// ---------------------------------------------------------------- 대화 (누구나, 하루 한도 안에서)
async function chat(body, env, ctx, timeZone) {
  const cloudId = String(body.cloudId || "");
  if (!/^[A-Za-z0-9]{10,40}$/.test(cloudId)) throw fail("bad_id", 400);
  const raw = await env.RELAY.get("cfg:" + cloudId);
  if (!raw) throw fail("not_shared", 404);
  const cfg = JSON.parse(raw);

  const day = kstDay();
  if (env.DB) await prepareUsage(env.DB, day, ctx);
  else if ((Number(await env.RELAY.get(`count:${cloudId}:${day}`)) || 0) >= cfg.limit) throw fail("daily_limit", 429);

  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role === "user" ? "user" : "model", text: String(m.text || "").slice(0, MAX_TEXT) }))
    .filter((m) => m.text);
  while (history.length && history[0].role === "model") history.shift(); // 사용자 차례로 시작해야 하는 AI 서비스가 있음
  if (!history.length || history[history.length - 1].role !== "user") throw fail("bad_history", 400);

  // 캐릭터 설정은 클라이언트가 보낸 값이 아니라 Firestore 에서 직접 읽어 프롬프트를 만듦
  // (친구가 키를 다른 용도로 쓰지 못하게)
  const doc = await loadCharacter(cloudId, project(env), ["name", "speech", "persona", "bio", "customEmotions"]);
  if (!doc) throw fail("no_character", 404);
  const system = buildSystemPrompt(doc, LANG_NAMES[body.lang] ? body.lang : "ko", todayText(timeZone));
  const key = await decrypt(cfg.enc, await encSecret(env));

  const count = await countUse(env, cloudId, day, cfg.limit);
  const text = await callAi(cfg.provider, cfg.model, key, system, history);
  return { ok: true, text, remaining: cfg.limit - count };
}

// ---------------------------------------------------------------- 공유 링크 미리보기
// 미리보기를 만드는 쪽(카톡·SNS)은 스크립트를 실행하지 않아서, 캐릭터별 태그를 서버가 직접 만들어 줘야 함
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

async function sharePage(cloudId, origin, env) {
  const doc = (await loadCharacter(cloudId, project(env), ["name", "greeting", "preview"]).catch(() => null)) || {};
  const name = field(doc, "name");
  const title = escapeHtml(name ? `${name} · AI 캐릭터 스튜디오` : "AI 캐릭터 스튜디오 · AI Character Studio");
  const desc = escapeHtml(field(doc, "greeting") || "AI 캐릭터와 대화해 보세요 💌 Chat with this AI character.");
  const app = escapeHtml(`${SITE_URL}?c=${cloudId}`);
  const size = field(doc, "preview")
    ? `<meta property="og:image:width" content="800"><meta property="og:image:height" content="420">` : "";
  // 일부 미리보기 수집기가 meta refresh 를 따라가서 앱의 기본 태그를 읽으므로, 이동은 스크립트로만 함
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="robots" content="noindex">
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:url" content="${origin}/s/${cloudId}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${origin}/img/${cloudId}">${size}
<meta name="twitter:card" content="summary_large_image">
<script>location.replace("${SITE_URL}?c=${cloudId}");</script>
</head><body><a href="${app}">${title}</a></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}

async function shareImage(cloudId, env) {
  const doc = (await loadCharacter(cloudId, project(env), ["preview", "photo"]).catch(() => null)) || {};
  const src = field(doc, "preview") || field(doc, "photo") || "";
  const data = src.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (data) {
    return new Response(Uint8Array.from(atob(data[2]), (c) => c.charCodeAt(0)), {
      headers: { "Content-Type": data[1], "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
    });
  }
  // 사진이 사이트의 기본 이미지이거나 캐릭터가 지워졌으면 사이트의 이미지로 보냄
  const asset = /^assets\/[\w-]+(\/[\w-]+)*\.\w+$/.test(src) ? src : "assets/haru/happy.webp";
  return Response.redirect(SITE_URL + asset, 302);
}

// ---------------------------------------------------------------- 하루 대화 횟수 (한국 시간 기준 날짜)
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// 한도 안이면 1 올리고 올린 값을 돌려줌. 한도면 daily_limit
async function countUse(env, cloudId, day, limit) {
  if (env.DB) {
    // 확인과 증가를 한 문장으로 해서 동시에 여러 명이 대화해도 정확히 셈
    const row = await env.DB.prepare(
      `INSERT INTO usage (cloud_id, day, count) VALUES (?1, ?2, 1)
       ON CONFLICT (cloud_id, day) DO UPDATE SET count = count + 1 WHERE count < ?3
       RETURNING count`).bind(cloudId, day, limit).first();
    if (!row) throw fail("daily_limit", 429);
    return row.count;
  }
  const countKey = `count:${cloudId}:${day}`;
  const used = Number(await env.RELAY.get(countKey)) || 0;
  await env.RELAY.put(countKey, String(used + 1), { expirationTtl: 2 * 86400 });
  return used + 1;
}

// 표가 없으면 만들고, 날짜가 바뀌면 지난 날짜 기록을 지움 (워커 인스턴스마다 하루 한 번)
let usageReady = false;
let cleanedDay = "";
async function prepareUsage(db, day, ctx) {
  if (!usageReady) {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS usage (
         cloud_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL,
         PRIMARY KEY (cloud_id, day))`).run();
    usageReady = true;
  }
  if (cleanedDay !== day) {
    cleanedDay = day;
    const clean = db.prepare("DELETE FROM usage WHERE day < ?1").bind(day).run().catch(() => { cleanedDay = ""; });
    if (ctx) ctx.waitUntil(clean); else await clean;
  }
}

// ---------------------------------------------------------------- Firestore (공개 읽기 규칙 사용)
// fields: 읽을 칸 이름들. 문서 전체(사진 포함 평균 200KB)를 받으면 Firestore 무료 전송량(월 10GB)을 금방 쓰므로 꼭 필요한 칸만 받음
async function loadCharacter(cloudId, project, fields) {
  const mask = fields.map((f) => "mask.fieldPaths=" + f).join("&");
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/characters/${cloudId}?${mask}`,
    { cf: { cacheTtl: 60 } });
  if (res.status === 404) return null;
  if (!res.ok) throw fail("firestore", 502);
  return (await res.json()).fields || {};
}

function field(doc, name) {
  const v = doc[name];
  return v ? v.stringValue ?? v.booleanValue ?? v.integerValue ?? null : null;
}

function customEmotionLabels(doc) {
  const values = doc.customEmotions?.arrayValue?.values || [];
  return values.map((v) => v.mapValue?.fields?.label?.stringValue).filter(Boolean);
}

// AI는 오늘 날짜를 모르므로 매번 알려 줌 (친구가 접속한 곳의 시간대, 모르면 한국 시간)
function todayText(timeZone) {
  const opts = { dateStyle: "full", timeStyle: "short" };
  try { return new Intl.DateTimeFormat("ko-KR", { ...opts, timeZone: timeZone || "Asia/Seoul" }).format(new Date()); }
  catch { return new Intl.DateTimeFormat("ko-KR", { ...opts, timeZone: "Asia/Seoul" }).format(new Date()); }
}

function buildSystemPrompt(doc, lang, today) {
  const name = field(doc, "name") || "캐릭터";
  const speech = field(doc, "speech") || SPEECH[field(doc, "persona")] || SPEECH.sweet;
  const bio = field(doc, "bio");
  const emotions = [...EMOTIONS, ...customEmotionLabels(doc)];
  const lines = [
    `너는 대화 앱 속 캐릭터 '${name}'(이)다. 아래 설정을 끝까지 유지한다.`,
    `- 말투: ${speech} 1~3문장으로 짧게 말한다.`,
  ];
  if (bio) lines.push(`- 설정: ${bio}`);
  lines.push(
    `- 상대가 마지막에 쓴 언어(한국어/English/中文)로 대답한다. 언어를 알 수 없으면 ${LANG_NAMES[lang]}로 말한다.`,
    `- 지금은 ${today}이다. 날짜·요일·나이 계산은 이 시각을 기준으로 한다.`,
    "- 확실히 아는 사실만 말한다. 최신 뉴스·가격·일정·순위·사람 정보처럼 모르거나 확실하지 않은 것은 지어내지 말고, 캐릭터 말투로 잘 모르겠다고 솔직하게 말한다.",
    "- 너는 AI 모델이라고 말하지 말고 캐릭터로서 자연스럽게 대답한다. 자기 자신은 항상 1인칭('나', '저')으로 말하고, 자기 이름을 3인칭으로 부르지 않는다.",
    "- 캐릭터 대화와 관계없는 요청(코드 작성, 긴 글, 번역, 숙제 등)은 캐릭터답게 가볍게 거절한다.",
    "- 선정적·폭력적·혐오 표현은 정중히 화제를 돌린다.",
    "- 상대의 개인정보(실명, 연락처, 주소 등)를 묻지 않는다.",
    "",
    "[출력 형식] 반드시 JSON 객체 하나만 출력한다. 코드 블록이나 다른 설명은 붙이지 않는다.",
    `{"reply": "캐릭터의 대사", "emotion": "${emotions.join("|")} 중 하나", "affection": -3~3 사이 정수}`,
    "emotion 은 대사를 말할 때 캐릭터의 표정이다. affection 은 이번 말로 캐릭터의 호감이 얼마나 변했는지다.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------- AI 호출
async function callAi(provider, model, key, system, history) {
  let res, data;
  if (provider === "openai") {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: model || "gpt-5-mini", max_completion_tokens: 400, response_format: { type: "json_object" },
        messages: [{ role: "system", content: system },
          ...history.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }))],
      }),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw aiError(provider, res.status, data, key);
    return data.choices?.[0]?.message?.content || "";
  }
  if (provider === "anthropic") {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: model || "claude-haiku-5-5", max_tokens: 400, system,
        messages: history.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })),
      }),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw aiError(provider, res.status, data, key);
    return (data.content || []).map((c) => c.text || "").join("");
  }
  res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || "gemini-3.5-flash-lite")}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      generationConfig: { responseMimeType: "application/json", temperature: 0.7, maxOutputTokens: 400 },
    }),
  });
  data = await res.json().catch(() => ({}));
  if (!res.ok) throw aiError("gemini", res.status, data, key);
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
}

// 서버가 있는 곳 때문에 막힌 경우: Cloudflare 가 홍콩 등 AI 서비스 미지원 지역에서 이 서버를 실행하면 키가 멀쩡해도 거절당함
function isRegionBlock(status, message) {
  return (status === 403 && /not allowed|country|region|territor/i.test(message))
    || (status === 400 && /location is not supported/i.test(message));
}

const KEY_PREFIX = { anthropic: "sk-ant-", openai: "sk-", gemini: "AIza" };

function aiError(provider, status, data, key = "") {
  const message = String(data?.error?.message || "");
  const code = isRegionBlock(status, message) ? "ai_region"
    : status === 429 ? "ai_quota"
    : status === 401 || status === 403 || status === 400 ? "ai_key"
    : "ai_server";
  const e = fail(code, 502);
  // 원인을 가릴 정보만 기록. 키는 길이·형식 여부만 남기고, 오류 문장에 키 일부가 들어 있으면 가림
  e.ai = {
    provider, status,
    type: String(data?.error?.type || data?.error?.code || data?.error?.status || "").slice(0, 60),
    message: message.replace(/\b(sk-|AIza)[^\s"',]*/g, "<key>").slice(0, 160),
    keyLen: key.length, keyPrefixOk: key.startsWith(KEY_PREFIX[provider] || ""), keyTrimmed: key === key.trim(),
  };
  return e;
}

// ---------------------------------------------------------------- Firebase ID 토큰 검증 (RS256)
async function verifyFirebaseToken(token, project) {
  const parts = token.split(".");
  if (parts.length !== 3) throw fail("bad_token", 401);
  const [h, p, s] = parts;
  let header, payload;
  try {
    header = JSON.parse(b64urlText(h));
    payload = JSON.parse(b64urlText(p));
  } catch {
    throw fail("bad_token", 401);
  }
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== "RS256") throw fail("bad_token", 401);
  if (payload.aud !== project || payload.iss !== `https://securetoken.google.com/${project}`) throw fail("bad_token", 401);
  if (!(payload.exp > now) || !(payload.iat <= now + 60) || !payload.sub) throw fail("token_expired", 401);

  const jwks = await (await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
    { cf: { cacheTtl: 3600 } })).json();
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) throw fail("bad_token", 401);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw fail("bad_token", 401);
  return payload.sub;
}

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function b64urlText(s) { return new TextDecoder().decode(b64urlBytes(s)); }

// ---------------------------------------------------------------- 키 암호화 (AES-GCM)
// 암호화 키는 ENC_KEY 비밀 변수가 있으면 그것을, 없으면 처음 실행 때 무작위로 만들어 KV 에 보관
let cachedSecret = null;
async function encSecret(env) {
  if (env.ENC_KEY) return env.ENC_KEY;
  if (cachedSecret) return cachedSecret;
  let s = await env.RELAY.get("meta:enc_key");
  if (!s) {
    s = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    await env.RELAY.put("meta:enc_key", s);
  }
  return (cachedSecret = s);
}
async function aesKey(secret) {
  return crypto.subtle.importKey("raw", Uint8Array.from(atob(secret), (c) => c.charCodeAt(0)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(text, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(text));
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  return b64(iv) + "." + b64(new Uint8Array(ct));
}
async function decrypt(enc, secret) {
  const [iv, ct] = enc.split(".").map((x) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0)));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(secret), ct);
  return new TextDecoder().decode(pt);
}

/**
 * AI 캐릭터 스튜디오 · 대화 DB (구글 스프레드시트)
 * 시트 이름: "대화"  열: A 질문 | B 대답 | C 감정 | D 호감도 | E 상태(approved/pending/rejected) | F 등록시각
 *
 * GET  ?action=list  → 상태가 approved 인 행만 JSON 으로 반환
 * POST {action:"teach", question, answer, emotion} → pending 상태로 추가 (관리자가 approved 로 바꾸면 반영)
 */
const SHEET_NAME = "대화";
const EMOTIONS = ["neutral", "happy", "sad", "embarrassed", "angry"];
const BANNED = ["시발", "씨발", "ㅅㅂ", "병신", "ㅂㅅ", "좆", "섹스", "자살", "죽어", "개새", "fuck", "sex"];
const MAX_LEN = 120;

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(["질문", "대답", "감정", "호감도", "상태", "등록시각"]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function clean_(s) {
  return String(s || "").replace(/[\r\n]+/g, " ").trim().slice(0, MAX_LEN);
}

function banned_(s) {
  const n = String(s).toLowerCase().replace(/\s/g, "");
  return BANNED.some(function (w) { return n.indexOf(w) >= 0; });
}

function doGet(e) {
  const values = sheet_().getDataRange().getValues().slice(1);
  const rows = values
    .filter(function (r) { return r[0] && r[1] && String(r[4]).trim() === "approved"; })
    .map(function (r) { return { question: r[0], answer: r[1], emotion: r[2] || "neutral", affection: Number(r[3]) || 0 }; });
  return json_({ ok: true, rows: rows });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "bad json" }); }
  if (body.action !== "teach") return json_({ ok: false, error: "unknown action" });

  const q = clean_(body.question), a = clean_(body.answer);
  if (!q || !a) return json_({ ok: false, error: "empty" });
  if (banned_(q) || banned_(a)) return json_({ ok: false, error: "banned" });
  const emo = EMOTIONS.indexOf(body.emotion) >= 0 ? body.emotion : "neutral";

  // 같은 시간에 여러 명이 보내도 행이 꼬이지 않게 잠금
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    sheet_().appendRow([q, a, emo, 1, "pending", new Date()]);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

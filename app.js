// 화면 전환, 캐릭터 저장(이 기기 localStorage), 사진 업로드, 대화 UI
(function () {
  const STORE_KEY = "aics.characters.v1";
  const EMOTION_LABEL = { neutral: "중립", happy: "기쁨", sad: "슬픔", embarrassed: "당황", angry: "화남" };
  const EMOTION_BADGE = { neutral: "", happy: "✨", sad: "💧", embarrassed: "💦", angry: "💢" };
  const sheetUrl = (window.APP_CONFIG && window.APP_CONFIG.sheetUrl) || "";

  // 기본 캐릭터: 수업 프로젝트의 하루 (표정별 이미지가 모두 있음)
  const HARU = {
    id: "haru", builtIn: true, name: "하루", nickname: "", persona: "sweet",
    greeting: "안녕! 오늘 프로젝트는 잘 돼 가? 무슨 얘기든 해 줘.",
    photo: "assets/haru/neutral.webp",
    slots: Object.fromEntries(window.EMOTIONS.map((e) => [e, `assets/haru/${e}.webp`])),
    sprite: true, affection: 20,
  };

  const $ = (id) => document.getElementById(id);
  const engine = new window.ChatEngine();
  engine.restoreTaught();
  engine.loadSheet(sheetUrl).then((n) => n && console.info(`[sheet] ${n}개 대화 불러옴`));

  // ---------------------------------------------------------------- 저장소
  function loadCharacters() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { /* 비공개 창 등 */ }
    const haruState = list.find((c) => c.id === "haru") || {};
    return [{ ...HARU, affection: haruState.affection ?? HARU.affection, cloudId: haruState.cloudId }, ...list.filter((c) => c.id !== "haru")];
  }
  function saveCharacters(list) {
    // 하루는 호감도와 공유 링크만 저장
    const data = list.map((c) => (c.builtIn ? { id: c.id, affection: c.affection, cloudId: c.cloudId } : c));
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      alert("저장 공간이 부족해요. 안 쓰는 캐릭터를 지우거나 표정별 사진 수를 줄여 주세요.");
      return false;
    }
  }
  let characters = loadCharacters();
  const findChar = (id) => characters.find((c) => c.id === id);

  // ---------------------------------------------------------------- 사진 줄이기
  // 휴대폰 사진(수 MB)을 그대로 저장하면 금방 꽉 차므로 가로·세로 최대 maxSide 의 JPEG 로 줄임
  function resizeImage(file, maxSide) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 읽을 수 없어요")); };
      img.src = url;
    });
  }

  // ---------------------------------------------------------------- 화면 전환 (#/, #/new, #/edit/id, #/chat/id, #/c/공유id)
  function show(screen) {
    for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== "screen-" + screen;
    window.scrollTo(0, 0);
  }
  function route() {
    const [, page, id] = location.hash.split("/");
    closeShareSheet();
    if (!$("card-sheet").hidden) closeCardSheet();
    if (page === "c" && id) openShared(id);
    else if (page === "new") openEdit(null);
    else if (page === "edit" && findChar(id)) openEdit(findChar(id));
    else if (page === "chat" && findChar(id)) openChat(findChar(id));
    else renderHome();
  }
  window.addEventListener("hashchange", route);
  document.querySelectorAll("[data-go=home]").forEach((b) => b.addEventListener("click", () => (location.hash = "#/")));

  // ---------------------------------------------------------------- ① 홈
  function renderHome() {
    const list = $("character-list");
    list.innerHTML = "";
    for (const c of characters) {
      const card = document.createElement("button");
      card.className = "card";
      card.innerHTML = `<img alt=""><b></b><small></small>`;
      card.querySelector("img").src = c.photo;
      card.querySelector("b").textContent = c.name;
      if (c.readonly) card.querySelector("b").insertAdjacentHTML("beforeend", `<span class="tag">받은 캐릭터</span>`);
      card.querySelector("small").textContent = `${window.PERSONAS[c.persona]?.label || ""} · 💗 ${c.affection}`;
      card.addEventListener("click", () => (location.hash = "#/chat/" + c.id));
      list.appendChild(card);
    }
    show("home");
  }
  $("btn-new").addEventListener("click", () => (location.hash = "#/new"));

  // ---------------------------------------------------------------- ② 만들기 / 수정
  let draft = null;

  function openEdit(c) {
    draft = c ? { ...c, slots: { ...c.slots } } : { id: null, name: "", nickname: "", persona: "sweet", greeting: "", photo: "", slots: {}, affection: 10 };
    $("edit-title").textContent = c ? `${c.name} 수정` : "새 캐릭터";
    $("edit-name").value = draft.name;
    $("edit-nick").value = draft.nickname;
    $("edit-persona").value = draft.persona;
    $("edit-greeting").value = draft.greeting;
    $("edit-consent").checked = !!c;
    $("btn-delete").hidden = !c || c.builtIn;
    // 기본 캐릭터는 사진을 바꿀 수 없음 (이름·성격만)
    $("edit-photo").disabled = !!draft.builtIn;
    renderPhoto();
    renderSlots();
    show("edit");
  }

  function renderPhoto() {
    $("edit-photo-preview").src = draft.photo || "";
    $("edit-photo-empty").hidden = !!draft.photo;
  }

  function renderSlots() {
    const box = $("slot-list");
    box.innerHTML = "";
    for (const emo of window.EMOTIONS) {
      const label = document.createElement("label");
      label.className = "slot";
      label.innerHTML = `<img alt=""><span></span><input type="file" accept="image/*">`;
      label.querySelector("img").src = draft.slots[emo] || "";
      label.querySelector("span").textContent = EMOTION_LABEL[emo];
      const input = label.querySelector("input");
      input.disabled = !!draft.builtIn;
      input.addEventListener("change", async () => {
        if (!input.files[0]) return;
        draft.slots[emo] = await resizeImage(input.files[0], 480);
        if (emo === "neutral" && !draft.photo) { draft.photo = draft.slots[emo]; renderPhoto(); }
        renderSlots();
      });
      // 길게 누르거나 우클릭하면 해당 표정 사진 지우기
      label.addEventListener("contextmenu", (e) => {
        if (draft.builtIn || !draft.slots[emo]) return;
        e.preventDefault();
        delete draft.slots[emo];
        renderSlots();
      });
      box.appendChild(label);
    }
  }

  $("edit-photo").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { draft.photo = await resizeImage(file, 640); renderPhoto(); } catch (err) { alert(err.message); }
  });

  $("edit-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!draft.photo) { alert("사진을 선택해 주세요."); return; }
    const name = $("edit-name").value.trim();
    const greeting = $("edit-greeting").value.trim();
    if (window.hasBannedWord(name) || window.hasBannedWord(greeting)) { alert("사용할 수 없는 단어가 있어요."); return; }
    Object.assign(draft, {
      name,
      nickname: $("edit-nick").value.trim(),
      persona: $("edit-persona").value,
      greeting: greeting || "안녕! 나랑 얘기하자.",
    });
    if (!draft.id) {
      draft.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      characters.push(draft);
    } else {
      characters = characters.map((c) => (c.id === draft.id ? draft : c));
    }
    if (!saveCharacters(characters)) return;
    // 이미 공유한 캐릭터를 고치면 공유 링크 내용도 같이 갱신
    if (draft.cloudId && window.Cloud.enabled) {
      const saved = draft;
      window.Cloud.share(saved).catch((err) => console.warn("[cloud] 공유 내용 갱신 실패", err));
    }
    location.hash = "#/chat/" + draft.id;
  });

  $("btn-delete").addEventListener("click", () => {
    if (!confirm(`${draft.name}을(를) 삭제할까요?${draft.cloudId ? "\n공유한 링크도 더 이상 열리지 않아요." : ""}`)) return;
    if (draft.cloudId && window.Cloud.enabled) window.Cloud.remove(draft.cloudId).catch((err) => console.warn("[cloud] 링크 삭제 실패", err));
    removeCharacter(draft.id);
  });

  function removeCharacter(id) {
    characters = characters.filter((c) => c.id !== id);
    saveCharacters(characters);
    location.hash = "#/";
  }

  // ---------------------------------------------------------------- 공유 링크로 들어옴
  async function openShared(cloudId) {
    const local = characters.find((c) => c.readonly && c.cloudId === cloudId) ||
                  characters.find((c) => !c.readonly && c.cloudId === cloudId); // 내가 만든 걸 내가 연 경우
    if (local) { openChat(local); return; }

    $("loading-text").textContent = "캐릭터를 불러오는 중…";
    $("loading-home").hidden = true;
    show("loading");
    let doc = null;
    try {
      doc = window.Cloud.enabled ? await window.Cloud.load(cloudId) : null;
    } catch (err) {
      console.warn("[cloud] 불러오기 실패", err);
    }
    if (!doc) {
      $("loading-text").textContent = "캐릭터를 찾을 수 없어요. 삭제됐거나 링크가 잘못됐어요.";
      $("loading-home").hidden = false;
      return;
    }
    const received = {
      id: "s_" + cloudId, cloudId, readonly: true, nickname: "", affection: 10,
      name: doc.name, persona: doc.persona, greeting: doc.greeting, photo: doc.photo, slots: doc.slots || {}, sprite: !!doc.sprite,
    };
    characters.push(received);
    saveCharacters(characters);
    // 이 기기에서 처음 받은 경우에만 조회수 +1
    window.Cloud.addView(cloudId).catch((err) => console.warn("[cloud] 조회수 기록 실패", err));
    openChat(received);
  }

  $("btn-make-own").addEventListener("click", () => (location.hash = "#/new"));

  // ---------------------------------------------------------------- 공유 시트
  function shareLink(cloudId) {
    return location.origin + location.pathname + "#/c/" + cloudId;
  }

  function closeShareSheet() { $("share-sheet").hidden = true; $("share-views").hidden = true; }

  // 내가 만든 캐릭터: 링크로 몇 명이 들어왔는지
  async function showViews(cloudId) {
    try {
      const doc = await window.Cloud.load(cloudId);
      const views = (doc && doc.views) || 0;
      $("share-views").textContent = views ? `👀 지금까지 ${views}명이 대화하러 왔어요!` : "아직 아무도 안 왔어요. 첫 친구를 초대해 보세요!";
      $("share-views").hidden = false;
    } catch (err) {
      console.warn("[cloud] 조회수 불러오기 실패", err);
    }
  }

  async function openShareSheet() {
    const c = current;
    $("share-sheet").hidden = false;
    $("share-body").hidden = true;
    $("btn-report").hidden = !c.readonly;
    $("btn-unshare").hidden = true;
    $("share-title").textContent = `${c.name} 공유하기`;

    if (!window.Cloud.enabled) {
      $("share-status").textContent = "공유 서버가 아직 설정되지 않았어요. (config.js 의 firebase)";
      return;
    }
    if (!c.readonly) {
      $("share-status").textContent = "공유 링크를 만드는 중…";
      try {
        c.cloudId = await window.Cloud.share(c);
        saveCharacters(characters);
      } catch (err) {
        $("share-status").textContent = err.message || "공유 링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.";
        return;
      }
    }
    $("share-status").textContent = window.Cloud.isDev ? "⚠️ 개발용 모드: 이 브라우저에서만 열리는 링크예요." : "";
    $("share-link").value = shareLink(c.cloudId);
    $("btn-kakao").hidden = !window.KakaoShare.enabled;
    window.KakaoShare.prepare(c);
    if (!c.readonly) showViews(c.cloudId);
    $("share-body").hidden = false;
    $("btn-unshare").hidden = c.readonly;
  }

  $("btn-share").addEventListener("click", () => current && openShareSheet());
  $("btn-sheet-close").addEventListener("click", closeShareSheet);
  $("share-sheet").addEventListener("click", (e) => { if (e.target.id === "share-sheet") closeShareSheet(); });

  async function copyLink() {
    const link = $("share-link").value;
    try { await navigator.clipboard.writeText(link); } catch { $("share-link").select(); document.execCommand("copy"); }
    $("btn-copy").textContent = "복사됨!";
    setTimeout(() => ($("btn-copy").textContent = "링크 복사"), 1500);
  }
  $("btn-copy").addEventListener("click", copyLink);

  $("btn-kakao").addEventListener("click", () => {
    try {
      window.KakaoShare.share(current, $("share-link").value);
    } catch (err) {
      console.warn("[kakao] 공유 실패", err);
      alert("카카오톡 공유에 실패했어요. 링크 복사로 공유해 주세요.");
    }
  });
  window.KakaoShare.preload();

  // ---------------------------------------------------------------- 대화 카드 (5단계)
  let card = null; // { blob, url(로컬 미리보기), kakaoUrl, link }

  function recentMessages() {
    return [...document.querySelectorAll("#chat-log .msg.me, #chat-log .msg.her:not(.typing)")]
      .map((el) => ({ who: el.classList.contains("me") ? "me" : "her", text: el.firstChild ? el.firstChild.textContent : "" }))
      .filter((m) => m.text);
  }

  function closeCardSheet() {
    $("card-sheet").hidden = true;
    if (card && card.url) URL.revokeObjectURL(card.url);
    card = null;
  }

  async function openCardSheet() {
    const c = current;
    const mine = (card = { blob: null, url: null, kakaoUrl: null, link: null });
    $("card-sheet").hidden = false;
    $("card-preview").hidden = true;
    $("btn-card-kakao").hidden = true;
    $("btn-card-share").hidden = true;
    $("card-status").textContent = "카드를 만드는 중…";

    const blob = await window.Viral.makeCard(c, $("avatar-img").src, recentMessages());
    if (card !== mine) return; // 그 사이 닫힘
    mine.blob = blob;
    mine.url = URL.createObjectURL(blob);
    $("card-preview").src = mine.url;
    $("card-preview").hidden = false;
    $("card-status").textContent = "";
    $("btn-card-share").hidden = !(navigator.canShare && navigator.canShare({ files: [new File([blob], "card.png", { type: "image/png" })] }));

    // 카톡으로 보내려면 공유 링크와 카카오 서버에 올린 카드 이미지가 필요 → 미리 준비
    if (!window.KakaoShare.enabled || !window.Cloud.enabled) return;
    try {
      if (!c.cloudId && !c.readonly) { c.cloudId = await window.Cloud.share(c); saveCharacters(characters); }
      mine.link = shareLink(c.cloudId);
      mine.kakaoUrl = await window.KakaoShare.prepareCard(blob);
      if (card === mine) $("btn-card-kakao").hidden = false;
    } catch (err) {
      console.warn("[card] 카톡 보내기 준비 실패", err);
    }
  }

  $("btn-card").addEventListener("click", () => current && openCardSheet());
  $("btn-card-close").addEventListener("click", closeCardSheet);
  $("card-sheet").addEventListener("click", (e) => { if (e.target.id === "card-sheet") closeCardSheet(); });

  $("btn-card-save").addEventListener("click", () => {
    if (!card || !card.url) return;
    const a = document.createElement("a");
    a.href = card.url;
    a.download = `${current.name}_대화카드.png`;
    a.click();
  });

  $("btn-card-share").addEventListener("click", async () => {
    if (!card || !card.blob) return;
    const file = new File([card.blob], `${current.name}_card.png`, { type: "image/png" });
    try { await navigator.share({ files: [file], title: `${current.name}와(과)의 대화` }); } catch { /* 취소 */ }
  });

  $("btn-card-kakao").addEventListener("click", () => {
    if (!card || !card.kakaoUrl) return;
    try {
      window.KakaoShare.share(current, card.link, { imageUrl: card.kakaoUrl, affection: Math.round(current.affection) });
    } catch (err) {
      console.warn("[kakao] 카드 공유 실패", err);
    }
  });

  $("btn-native-share").addEventListener("click", async () => {
    const data = { title: `${current.name}랑 대화해 볼래?`, text: `${current.name}(이)가 너랑 대화하고 싶대 💌`, url: $("share-link").value };
    if (navigator.share) {
      try { await navigator.share(data); } catch { /* 사용자가 취소 */ }
    } else {
      copyLink();
    }
  });

  $("btn-report").addEventListener("click", async () => {
    const reason = prompt("신고 사유를 적어 주세요. (예: 다른 사람 사진, 불쾌한 내용)");
    if (!reason) return;
    try {
      await window.Cloud.report(current.cloudId, reason);
      alert("신고가 접수됐어요. 확인 후 조치할게요.");
    } catch {
      alert("신고를 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  });

  $("btn-unshare").addEventListener("click", async () => {
    if (!confirm("공유 링크를 삭제할까요? 이미 받은 사람도 더 이상 새로 열 수 없어요.")) return;
    try {
      await window.Cloud.remove(current.cloudId);
      current.cloudId = undefined;
      saveCharacters(characters);
      closeShareSheet();
    } catch {
      alert("링크를 삭제하지 못했어요.");
    }
  });

  // ---------------------------------------------------------------- ③ 대화
  let current = null;
  let teachQuestion = null; // "가르치기" 모드일 때 배울 질문
  let badgeTimer = 0;

  function openChat(c) {
    current = c;
    teachQuestion = null;
    $("chat-name").textContent = c.name;
    $("guest-banner").hidden = !c.readonly;
    $("btn-edit").textContent = c.readonly ? "🗑" : "✎";
    $("btn-edit").title = c.readonly ? "목록에서 지우기" : "수정";
    $("avatar").classList.toggle("png-sprite", !!c.sprite);
    $("chat-log").innerHTML = "";
    setAffection(0);
    setEmotion("neutral", false);
    show("chat");
    addMessage("her", c.greeting);
    setTeachMode(null);
  }
  $("btn-edit").addEventListener("click", () => {
    if (!current) return;
    if (!current.readonly) { location.hash = "#/edit/" + current.id; return; }
    if (confirm(`받은 캐릭터 ${current.name}을(를) 내 목록에서 지울까요?`)) removeCharacter(current.id);
  });

  // 표정 바꾸기: 감정별 사진이 있으면 교체, 없으면 기본 사진 + CSS 효과(색감·움직임·볼터치·이모지)
  function setEmotion(emo, animate = true) {
    const avatar = $("avatar");
    const slot = current.slots && current.slots[emo];
    $("avatar-img").src = slot || current.photo;
    avatar.className = avatar.className.replace(/\bemo-\S+/g, "").trim();
    avatar.classList.toggle("has-slot", !!slot && emo !== "neutral");
    if (animate) void avatar.offsetWidth; // 같은 감정이 연속돼도 애니메이션 다시 재생
    avatar.classList.add("emo-" + emo);

    $("avatar-badge").textContent = EMOTION_BADGE[emo];
    avatar.classList.toggle("show-badge", animate && !!EMOTION_BADGE[emo]);
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => avatar.classList.remove("show-badge"), 1800);
  }

  function setAffection(delta) {
    current.affection = Math.max(0, Math.min(100, (current.affection || 0) + delta));
    $("affection-fill").style.width = current.affection + "%";
    if (delta) saveCharacters(characters);
  }

  function addMessage(who, text, extra) {
    const div = document.createElement("div");
    div.className = "msg " + who;
    div.textContent = text;
    if (extra) div.appendChild(extra);
    $("chat-log").appendChild(div);
    div.scrollIntoView({ block: "end", behavior: "smooth" });
    return div;
  }

  function setTeachMode(question) {
    teachQuestion = question;
    $("chat-text").placeholder = question ? `"${question}"에 뭐라고 대답할까?` : "메시지를 입력하세요";
    if (question) $("chat-text").focus();
  }

  function teachButton(question) {
    const wrap = document.createElement("div");
    wrap.style.marginTop = "6px";
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.type = "button";
    btn.textContent = "✏️ 대답 가르쳐 주기";
    btn.addEventListener("click", () => {
      btn.disabled = true;
      addMessage("system", `"${question}"에 ${current.name}(이)가 할 대답을 입력해 주세요.`);
      setTeachMode(question);
    });
    wrap.appendChild(btn);
    return wrap;
  }

  $("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("chat-text");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";

    if (teachQuestion) {
      const question = teachQuestion;
      setTeachMode(null);
      addMessage("me", text);
      const result = await engine.teach(question, text, sheetUrl);
      if (!result.ok) { addMessage("system", "그 대답에는 사용할 수 없는 단어가 있어서 배우지 않았어요."); return; }
      setEmotion("happy");
      setAffection(1);
      addMessage("her", `알겠어! 앞으로 "${question}" 하면 그렇게 말할게. 헤헤.`);
      return;
    }

    addMessage("me", text);
    const typing = addMessage("her typing", "···");
    await new Promise((r) => setTimeout(r, 450 + Math.random() * 450));
    typing.remove();

    const res = engine.respond(text, current);
    setEmotion(res.emotion);
    if (res.affection) setAffection(res.affection);
    addMessage("her", res.reply, res.unknown ? teachButton(text) : null);
  });

  route();
})();

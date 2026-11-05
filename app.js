// 화면 전환, 캐릭터 저장(이 기기 localStorage), 사진 업로드, 대화 UI
(function () {
  const STORE_KEY = "aics.characters.v1";
  const t = window.I18N.t;
  const emotionLabel = (emo) => t(`emo.${emo}`);
  const EMOTION_BADGE = { neutral: "", happy: "✨", sad: "💧", embarrassed: "💦", angry: "💢" };
  const sheetUrl = (window.APP_CONFIG && window.APP_CONFIG.sheetUrl) || "";

  // 기본 캐릭터: 수업 프로젝트의 하루 (표정별 이미지가 모두 있음). 이름·인사·설정은 화면 언어를 따름
  const HARU = {
    id: "haru", builtIn: true, nickname: "", persona: "sweet",
    background: "",
    photo: "assets/haru/neutral.webp",
    slots: Object.fromEntries(window.EMOTIONS.map((e) => [e, `assets/haru/${e}.webp`])),
    sprite: true, affection: 20,
  };

  const $ = (id) => document.getElementById(id);
  const engine = new window.ChatEngine();
  engine.restoreTaught();
  engine.loadSheet(sheetUrl).then((n) => n && console.info(`[sheet] ${n}개 대화 불러옴`));

  // ---------------------------------------------------------------- 저장소
  // 하루의 글자 항목이 어느 언어로든 기본값 그대로면 "안 고친 것"으로 보고 화면 언어로 보여 줌
  const HARU_TEXT = ["name", "greeting", "bio"];
  function isHaruDefault(k, v) {
    if (k === "speech") return window.isPresetSpeech(v);
    return HARU_TEXT.includes(k) && window.I18N.all("haru." + k).includes(v);
  }
  function loadCharacters() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { /* 비공개 창 등 */ }
    const haruState = list.find((c) => c.id === "haru") || {};
    // 하루는 기본값 위에 사용자가 고친 값만 덮어씀 (원래대로 되돌리기 쉽게)
    const haru = { ...HARU, name: t("haru.name"), greeting: t("haru.greeting"), bio: t("haru.bio") };
    for (const k of HARU_EDITABLE) if (haruState[k] !== undefined && !isHaruDefault(k, haruState[k])) haru[k] = haruState[k];
    return [haru, ...list.filter((c) => c.id !== "haru")];
  }
  const HARU_EDITABLE = ["affection", "cloudId", "name", "nickname", "persona", "speech", "greeting", "bio", "background",
    "photo", "sprite", "slots", "customEmotions", "lastVisit", "streak", "milestone", "published", "aiShare",
    "metAt", "annivShown", "birthday", "bdayShown", "mission", "dailyAsked"];
  function saveCharacters(list) {
    const data = list.map((c) => (c.builtIn
      ? Object.fromEntries([["id", c.id], ...HARU_EDITABLE.filter((k) => !isHaruDefault(k, c[k])).map((k) => [k, c[k]])])
      : c));
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      alert(t("common.storageFull"));
      return false;
    }
  }
  let characters = loadCharacters();
  const findChar = (id) => characters.find((c) => c.id === id);

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
    else if (page === "gallery") openGallery();
    else if (page === "admin") openAdmin();
    else if (page === "privacy") show("privacy");
    else if (page === "groups") openGroups();
    else if (page === "group" && groups.find((g) => g.id === id)) openGroup(groups.find((g) => g.id === id));
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
      if (c.readonly) card.querySelector("b").insertAdjacentHTML("beforeend", `<span class="tag">${t("home.received")}</span>`);
      card.querySelector("small").textContent = `${speechLabel(c)} · 💗 ${c.affection}`;
      card.addEventListener("click", () => (location.hash = "#/chat/" + c.id));
      list.appendChild(card);
    }
    show("home");
    maybeShowTutorial();
    // 관리자 기기에서만 "관리" 링크
    if (window.Cloud.enabled) window.Cloud.uid().then(() => ($("admin-link").hidden = !window.Cloud.isAdmin)).catch(() => {});
  }
  $("btn-gallery").addEventListener("click", () => (location.hash = "#/gallery"));

  // ---------------------------------------------------------------- 앱으로 설치 (PWA)
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    $("btn-install").hidden = false;
  });
  $("btn-install").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") { $("btn-install").hidden = true; window.track("install_app"); }
    installPrompt = null;
  });
  // 아이폰 Safari 는 설치 버튼 대신 "홈 화면에 추가" 안내
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  $("ios-install-hint").hidden = standalone || !/iphone|ipad|ipod/i.test(navigator.userAgent);
  $("btn-new").addEventListener("click", () => (location.hash = "#/new"));

  // ---------------------------------------------------------------- ② 만들기 / 수정
  let draft = null;
  let photoFile = null; // [사진 다시 맞추기]용 원본 파일 (저장하지 않음)

  // 결과 이미지 크기: 캐릭터 3:4, 배경은 대화 화면 무대에 맞춘 4:3
  const PHOTO_SIZE = { width: 600, height: 800, get title() { return t("edit.photoTitle"); } };
  const SLOT_SIZE = { width: 480, height: 640 };
  const BG_SIZE = { width: 960, height: 720, get title() { return t("edit.bgTitle"); } };

  async function editImage(file, size) {
    try {
      return await window.ImageEditor.open(file, size);
    } catch (err) {
      alert(err.message);
      return null;
    }
  }

  const MAX_CUSTOM_EMOTIONS = 5;

  // 말투 칸에 직접 쓴 글이 프리셋 문장과 같으면 그 프리셋 이름, 아니면 "직접 설정"
  function speechLabel(c) {
    const preset = window.PERSONAS[c.persona] || window.PERSONAS.sweet;
    return window.isPresetSpeech(c.speech) ? preset.label : t("speech.custom");
  }

  // ---------------------------------------------------------------- 작성 중 자동 저장
  // 만들기/수정 화면의 내용을 입력할 때마다 저장해 두고, 다시 들어오면 이어서 보여 줌
  const DRAFT_KEY = "aics.editdraft.v1";
  let editTarget = null; // 수정 중인 캐릭터 id, 새로 만들기면 "new"

  function readEditForm() {
    Object.assign(draft, {
      name: $("edit-name").value,
      nickname: $("edit-nick").value,
      speech: $("edit-speech").value,
      greeting: $("edit-greeting").value,
      bio: $("edit-bio").value,
      birthday: $("edit-birthday").value ? $("edit-birthday").value.slice(5) : "",
    });
  }
  let editLoading = false; // 화면을 처음 채우는 동안은 저장하지 않음 (아무것도 안 고쳤는데 "불러왔어요"가 뜨지 않게)
  function saveEditDraft() {
    if (!draft || !editTarget || editLoading) return;
    readEditForm();
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ target: editTarget, draft })); }
    catch { /* 사진이 커서 공간이 부족하면 글자만이라도 */
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ target: editTarget, draft: { ...draft, slots: {}, photo: "", background: "" } })); } catch { /* 포기 */ }
    }
  }
  function loadEditDraft(target) {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
      return d && d.target === target ? d.draft : null;
    } catch { return null; }
  }
  function clearEditDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* 무시 */ }
  }
  $("edit-form").addEventListener("input", saveEditDraft);
  $("edit-form").addEventListener("change", saveEditDraft);
  $("btn-discard-draft").addEventListener("click", () => {
    clearEditDraft();
    openEdit(editTarget === "new" ? null : findChar(editTarget), true);
  });

  function openEdit(c, ignoreDraft = false) {
    editLoading = true;
    editTarget = c ? c.id : "new";
    const restored = ignoreDraft ? null : loadEditDraft(editTarget);
    draft = restored ? { ...restored, slots: { ...(restored.slots || {}) }, customEmotions: [...(restored.customEmotions || [])] }
      : c ? { ...c, slots: { ...c.slots }, customEmotions: [...(c.customEmotions || [])] }
      : { id: null, name: "", nickname: "", persona: "sweet", speech: window.PERSONAS.sweet.speech, greeting: "", bio: "",
          background: "", photo: "", slots: {}, customEmotions: [], affection: 10 };
    if (restored && c) Object.assign(draft, { id: c.id, builtIn: c.builtIn, cloudId: c.cloudId, affection: c.affection });
    $("edit-restored").hidden = !restored;
    // 프리셋 말투는 지금 화면 언어의 문장으로 보여 줌
    if (window.isPresetSpeech(draft.speech)) draft.speech = (window.PERSONAS[draft.persona] || window.PERSONAS.sweet).speech;
    photoFile = null;
    $("edit-title").textContent = c ? t("edit.editing", { name: c.name }) : t("edit.new");
    $("edit-name").value = draft.name;
    $("edit-nick").value = draft.nickname;
    $("edit-speech").value = draft.speech;
    renderSpeechChips();
    $("edit-greeting").value = draft.greeting;
    $("edit-bio").value = draft.bio || "";
    $("edit-birthday").value = /^\d\d-\d\d$/.test(draft.birthday || "") ? "2000-" + draft.birthday : "";
    $("edit-consent").checked = !!c;
    $("btn-delete").hidden = !c || c.builtIn;
    renderPhoto();
    renderSlots();
    renderBackground();
    editLoading = false;
    show("edit");
  }

  function renderPhoto() {
    $("edit-photo-preview").src = draft.photo || "";
    $("edit-photo-empty").hidden = !!draft.photo;
    $("btn-photo-readjust").hidden = !photoFile;
    saveEditDraft();
  }

  function renderBackground() {
    $("edit-bg-preview").src = draft.background || "";
    $("edit-bg-empty").hidden = !!draft.background;
    $("btn-bg-reset").hidden = !draft.background;
    saveEditDraft();
  }

  // 표정 칸 하나: 누르면 사진 고르기 → 편집기, ✕ 로 지우기
  function slotCell(key, title, onPick, onRemove, nameEl) {
    const cell = document.createElement("div");
    cell.className = "slot";
    cell.innerHTML = `<label class="pick"><img alt=""><span class="plus">＋</span><input type="file" accept="image/*"></label>`;
    const img = cell.querySelector("img");
    img.src = (key && draft.slots[key]) || "";
    cell.querySelector(".plus").hidden = !!img.getAttribute("src");
    const input = cell.querySelector("input");
    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.value = "";
      if (!file) return;
      const result = await editImage(file, { ...SLOT_SIZE, title });
      if (result) onPick(result);
    });
    if (onRemove) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "remove";
      x.textContent = "✕";
      x.title = t("edit.remove");
      x.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onRemove(); });
      cell.querySelector(".pick").appendChild(x);
    }
    cell.appendChild(nameEl);
    return cell;
  }

  function nameText(text) {
    const el = document.createElement("span");
    el.className = "name";
    el.textContent = text;
    return el;
  }

  function renderSlots() {
    const box = $("slot-list");
    box.innerHTML = "";

    // 기본 5가지 표정 (키워드 대화와 AI 대화 모두 사용)
    for (const emo of window.EMOTIONS) {
      box.appendChild(slotCell(emo, t("edit.emoTitle", { label: emotionLabel(emo) }),
        (r) => {
          draft.slots[emo] = r.dataUrl;
          if (emo === "neutral" && !draft.photo) { draft.photo = r.dataUrl; draft.sprite = r.transparent; renderPhoto(); }
          renderSlots();
        },
        draft.slots[emo] ? () => { delete draft.slots[emo]; renderSlots(); } : null,
        nameText(emotionLabel(emo))));
    }

    // 나만의 표정 (이름을 직접 정함, AI 대화에서 사용)
    for (const ce of draft.customEmotions) {
      const name = document.createElement("input");
      name.className = "name";
      name.maxLength = 8;
      name.value = ce.label;
      name.placeholder = t("edit.customName");
      name.addEventListener("input", () => { ce.label = name.value.trim(); });
      box.appendChild(slotCell(ce.key, t("edit.fitTitle", { label: ce.label || t("edit.newEmo") }),
        (r) => { draft.slots[ce.key] = r.dataUrl; renderSlots(); },
        () => {
          draft.customEmotions = draft.customEmotions.filter((x) => x !== ce);
          delete draft.slots[ce.key];
          renderSlots();
        },
        name));
    }

    // ＋ 표정 추가: 사진을 먼저 고르고 이름을 붙임
    if (draft.customEmotions.length < MAX_CUSTOM_EMOTIONS) {
      const add = slotCell(null, t("edit.fitTitle", { label: t("edit.newEmo") }), (r) => {
        const key = "c" + Math.random().toString(36).slice(2, 7);
        draft.customEmotions.push({ key, label: "" });
        draft.slots[key] = r.dataUrl;
        renderSlots();
        // 방금 추가한 표정의 이름 칸으로 이동
        const inputs = box.querySelectorAll("input.name");
        if (inputs.length) inputs[inputs.length - 1].focus();
      }, null, nameText(t("edit.addEmo")));
      add.classList.add("add");
      box.appendChild(add);
    }

    const filled = Object.keys(draft.slots).filter((k) => draft.slots[k]).length;
    $("slot-count").textContent = t("edit.slotCount", { n: filled, c: draft.customEmotions.length, max: MAX_CUSTOM_EMOTIONS });
    saveEditDraft();
  }

  // ---------------------------------------------------------------- 말투
  function renderSpeechChips() {
    const text = $("edit-speech").value.trim();
    for (const chip of document.querySelectorAll("#speech-presets .chip")) {
      chip.classList.toggle("on", window.PERSONAS[chip.dataset.persona].speech === text);
    }
  }
  document.querySelectorAll("#speech-presets .chip").forEach((chip) => chip.addEventListener("click", () => {
    draft.persona = chip.dataset.persona;
    $("edit-speech").value = window.PERSONAS[chip.dataset.persona].speech;
    renderSpeechChips();
    saveEditDraft();
  }));
  $("edit-speech").addEventListener("input", renderSpeechChips);

  async function applyPhoto(file) {
    const result = await editImage(file, PHOTO_SIZE);
    if (!result) return;
    photoFile = file;
    draft.photo = result.dataUrl;
    draft.sprite = result.transparent; // 투명 이미지면 테두리 없이 배경 위에 올림
    renderPhoto();
  }

  $("edit-photo").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // 같은 파일을 다시 골라도 change 가 오도록
    if (file) applyPhoto(file);
  });
  $("btn-photo-readjust").addEventListener("click", () => photoFile && applyPhoto(photoFile));

  $("edit-bg").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const result = await editImage(file, BG_SIZE);
    if (!result) return;
    draft.background = result.dataUrl;
    renderBackground();
  });
  $("btn-bg-reset").addEventListener("click", () => { draft.background = ""; renderBackground(); });

  $("edit-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!draft.photo) { alert(t("edit.needPhoto")); return; }
    const name = $("edit-name").value.trim();
    const greeting = $("edit-greeting").value.trim();
    const bio = $("edit-bio").value.trim();
    const speech = $("edit-speech").value.trim();
    // 이름 없는 나만의 표정에는 기본 이름을 붙임
    draft.customEmotions.forEach((ce, i) => { if (!ce.label) ce.label = t("edit.defaultEmo", { n: i + 1 }); });
    const labels = draft.customEmotions.map((ce) => ce.label);
    if ([name, greeting, bio, speech, ...labels].some(window.hasBannedWord)) { alert(t("edit.banned")); return; }
    if (new Set([...labels, ...window.EMOTIONS.map(emotionLabel)]).size !== labels.length + 5) {
      alert(t("edit.dupEmo"));
      return;
    }
    Object.assign(draft, {
      name,
      nickname: $("edit-nick").value.trim(),
      speech: speech || window.PERSONAS[draft.persona].speech,
      greeting: greeting || t("edit.defaultGreeting"),
      bio,
      birthday: $("edit-birthday").value ? $("edit-birthday").value.slice(5) : "",
    });
    window.AiChat.reset(draft.id); // 설정이 바뀌었으니 AI 대화 기록은 새로 시작
    if (!draft.id) {
      draft.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      characters.push(draft);
      window.track("create_character");
    } else {
      characters = characters.map((c) => (c.id === draft.id ? draft : c));
    }
    if (!saveCharacters(characters)) return;
    clearEditDraft();
    editTarget = null;
    // 이미 공유한 캐릭터를 고치면 공유 링크 내용도 같이 갱신
    if (draft.cloudId && window.Cloud.enabled) {
      const saved = draft;
      window.Cloud.share(saved).catch((err) => console.warn("[cloud] 공유 내용 갱신 실패", err));
    }
    location.hash = "#/chat/" + draft.id;
  });

  $("btn-delete").addEventListener("click", () => {
    if (!confirm(t("edit.confirmDelete", { name: draft.name }) + (draft.cloudId ? "\n" + t("edit.confirmDeleteShared") : ""))) return;
    if (draft.cloudId && window.Cloud.enabled) window.Cloud.remove(draft.cloudId).catch((err) => console.warn("[cloud] 링크 삭제 실패", err));
    clearEditDraft();
    editTarget = null;
    removeCharacter(draft.id);
  });

  function removeCharacter(id) {
    clearChat(id);
    characters = characters.filter((c) => c.id !== id);
    saveCharacters(characters);
    location.hash = "#/";
  }

  // ---------------------------------------------------------------- 공유 링크로 들어옴
  async function openShared(cloudId) {
    const local = characters.find((c) => c.readonly && c.cloudId === cloudId) ||
                  characters.find((c) => !c.readonly && c.cloudId === cloudId); // 내가 만든 걸 내가 연 경우
    if (local) { openChat(local); refreshReceived(local); return; }

    $("loading-text").textContent = t("loading.text");
    $("loading-home").hidden = true;
    show("loading");
    let doc = null;
    try {
      doc = window.Cloud.enabled ? await window.Cloud.load(cloudId) : null;
    } catch (err) {
      console.warn("[cloud] 불러오기 실패", err);
    }
    if (!doc) {
      $("loading-text").textContent = t("loading.notFound");
      $("loading-home").hidden = false;
      return;
    }
    const received = {
      id: "s_" + cloudId, cloudId, readonly: true, nickname: "", affection: 10,
      name: doc.name, persona: doc.persona, greeting: doc.greeting, photo: doc.photo, slots: doc.slots || {}, sprite: !!doc.sprite,
      bio: doc.bio || "", background: doc.background || "", speech: doc.speech || "", customEmotions: doc.customEmotions || [],
      birthday: doc.birthday || "",
      aiShared: !!doc.aiShared,
    };
    characters.push(received);
    saveCharacters(characters);
    // 이 기기에서 처음 받은 경우에만 조회수 +1
    window.Cloud.addView(cloudId).catch((err) => console.warn("[cloud] 조회수 기록 실패", err));
    window.Cloud.addGalleryView(cloudId).catch(() => {}); // 갤러리에 없는 캐릭터면 그냥 실패
    openChat(received);
  }

  // 받은 캐릭터: 만든 사람이 나중에 AI 공유를 켜거나 껐을 수 있으니 열 때마다 확인
  async function refreshReceived(c) {
    if (!c.readonly || !window.Cloud.enabled) return;
    try {
      const doc = await window.Cloud.peek(c.cloudId, ["aiShared"]);
      if (!doc) return;
      c.aiShared = !!doc.aiShared;
      saveCharacters(characters);
      if (current === c) renderModeChip();
      if (group && groupMembers(group).includes(c)) renderGroupMode(group);
    } catch { /* 다음에 다시 */ }
  }

  $("btn-make-own").addEventListener("click", () => (location.hash = "#/new"));
  // 받은 캐릭터의 말투·설정·표정 이름을 그대로 가져와서 내 사진으로 새로 만들기
  $("btn-remix").addEventListener("click", () => {
    const c = current;
    const remix = {
      id: null, name: "", nickname: "", persona: c.persona || "sweet", speech: c.speech || "", greeting: c.greeting || "",
      bio: c.bio || "", background: "", photo: "", slots: {}, affection: 10,
      customEmotions: (c.customEmotions || []).map((ce) => ({ key: ce.key, label: ce.label })),
    };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ target: "new", draft: remix })); } catch { /* 공간 부족 */ }
    window.track("remix");
    location.hash = "#/new";
  });

  // ---------------------------------------------------------------- 공유 시트
  // 카카오톡 인앱 브라우저 등에서 # 뒤가 잘리는 경우가 있어 ?c= 형태로 공유 (열리면 #/c/ 로 바꿔 줌)
  function appLink(cloudId) {
    return location.origin + location.pathname + "?c=" + encodeURIComponent(cloudId);
  }
  // 복사·SNS용 링크: 링크 미리보기에 캐릭터 얼굴이 뜨도록 중계 서버를 거쳐 앱으로 들어옴
  // (카카오톡 공유 버튼은 등록한 도메인만 쓸 수 있고 사진을 직접 보내므로 appLink 사용)
  function shareLink(cloudId) {
    const relay = window.AiChat.relayUrl;
    return relay ? relay + "/s/" + encodeURIComponent(cloudId) : appLink(cloudId);
  }

  function closeShareSheet() { $("share-sheet").hidden = true; $("share-views").hidden = true; }

  // 내가 만든 캐릭터: 링크로 몇 명이 들어왔는지
  async function showViews(cloudId) {
    try {
      const doc = await window.Cloud.peek(cloudId, ["views"]);
      const views = (doc && doc.views) || 0;
      $("share-views").textContent = views ? t("share.views", { n: views }) : t("share.noViews");
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
    $("share-title").textContent = t("share.title", { name: c.name });
    $("qr-box").hidden = true;

    if (!window.Cloud.enabled) {
      $("share-status").textContent = t("share.noServer");
      return;
    }
    if (!c.readonly) {
      $("share-status").textContent = t("share.making");
      try {
        c.cloudId = await window.Cloud.share(c);
        saveCharacters(characters);
      } catch (err) {
        $("share-status").textContent = err.message || t("share.failed");
        return;
      }
    }
    $("share-status").textContent = window.Cloud.isDev ? t("share.dev") : "";
    $("share-link").value = shareLink(c.cloudId);
    renderSocialButtons();
    window.KakaoShare.prepare(c);
    if (!c.readonly) showViews(c.cloudId);
    renderAiShareBox(c);
    renderGalleryBox(c);
    $("share-body").hidden = false;
    $("btn-unshare").hidden = c.readonly;
  }

  // ---------------------------------------------------------------- 친구도 내 AI 키로 대화 (중계 서버)
  function renderAiShareBox(c) {
    const can = !c.readonly && !!window.AiChat.relayUrl;
    $("ai-share-box").hidden = !can;
    if (!can) return;
    const on = !!(c.aiShare && c.aiShare.enabled);
    $("ai-share-on").checked = on;
    setLimitField((c.aiShare && c.aiShare.limit) || 100);
    $("ai-share-status").textContent = !window.AiChat.settings.key
      ? t("share.needKey")
      : on ? t("share.aiStatus", { p: window.AiChat.label(), n: c.aiShare.limit }) : "";
  }

  // 하루 한도: 30/100/300/1000 중 고르거나 "직접 입력"으로 1~10000
  const LIMIT_MAX = 10000;
  function setLimitField(n) {
    const preset = [...$("ai-share-limit").options].some((o) => o.value === String(n));
    $("ai-share-limit").value = preset ? String(n) : "custom";
    $("ai-share-limit-custom").hidden = preset;
    if (!preset) $("ai-share-limit-custom").value = String(n);
  }
  function readLimit() {
    const v = $("ai-share-limit").value === "custom" ? $("ai-share-limit-custom").value : $("ai-share-limit").value;
    const n = Math.round(Number(v));
    return n >= 1 && n <= LIMIT_MAX ? n : null;
  }

  async function applyAiShare() {
    const c = current;
    const enabled = $("ai-share-on").checked;
    const limit = readLimit();
    if (enabled && !limit) {
      $("ai-share-status").textContent = t("share.limitBad", { max: LIMIT_MAX });
      return;
    }
    if (enabled && !window.AiChat.settings.key) {
      $("ai-share-on").checked = false;
      $("ai-share-status").textContent = t("share.needKey");
      return;
    }
    $("ai-share-status").textContent = t("share.setting");
    try {
      await window.AiChat.shareKey({ cloudId: c.cloudId, idToken: await window.Cloud.idToken(), enabled, dailyLimit: limit });
      c.aiShare = { enabled, limit: limit || (c.aiShare && c.aiShare.limit) || 100 };
      saveCharacters(characters);
      await window.Cloud.share(c); // 공유 문서에 "AI 대화 가능" 표시 (키는 넣지 않음)
      renderAiShareBox(c);
    } catch (err) {
      $("ai-share-on").checked = !enabled;
      $("ai-share-status").textContent = `❌ ${err.message}`;
    }
  }
  $("ai-share-on").addEventListener("change", applyAiShare);

  // ---------------------------------------------------------------- 공개 갤러리에 올리기 (만든 사람만)
  async function renderGalleryBox(c) {
    const can = !c.readonly && window.Cloud.enabled && !window.Cloud.isDev;
    $("gallery-share-box").hidden = !can;
    if (!can) return;
    $("gallery-on").checked = !!c.published;
    $("gallery-share-status").textContent = c.published ? t("gallery.published") : "";
    try {
      const on = await window.Cloud.isPublished(c.cloudId);
      if (current === c && on !== !!c.published) { c.published = on; saveCharacters(characters); renderGalleryBox(c); }
    } catch { /* 다음에 */ }
  }
  $("gallery-on").addEventListener("change", async () => {
    const c = current;
    const on = $("gallery-on").checked;
    $("gallery-share-status").textContent = t("gallery.publishing");
    try {
      if (on) await window.Cloud.publish(c);
      else await window.Cloud.unpublish(c.cloudId);
      c.published = on;
      saveCharacters(characters);
      $("gallery-share-status").textContent = on ? t("gallery.published") : "";
      window.track(on ? "gallery_publish" : "gallery_unpublish");
    } catch (err) {
      $("gallery-on").checked = !on;
      $("gallery-share-status").textContent = `❌ ${err.message}`;
    }
  });

  // ---------------------------------------------------------------- ④ 둘러보기 (공개 갤러리)
  let gallerySort = "views";
  let commentCountObserver = null;
  async function openGallery() {
    show("gallery");
    if (commentCountObserver) commentCountObserver.disconnect();
    // 댓글 수는 화면에 보이는 카드만 셈 (카드 하나당 읽기 1회)
    commentCountObserver = new IntersectionObserver((entries, observer) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer.unobserve(e.target);
        window.Cloud.commentCount(e.target.dataset.id)
          .then((n) => { e.target.textContent = `💬 ${commentCountText(n)}`; })
          .catch(() => {});
      }
    });
    for (const b of document.querySelectorAll(".gallery-tabs .chip")) b.classList.toggle("on", b.dataset.sort === gallerySort);
    const list = $("gallery-list");
    list.innerHTML = "";
    $("gallery-status").textContent = t("gallery.loading");
    if (!window.Cloud.enabled) { $("gallery-status").textContent = t("gallery.empty"); return; }
    try {
      const items = await window.Cloud.gallery(gallerySort);
      $("gallery-status").textContent = items.length ? "" : t("gallery.empty");
      const ranked = gallerySort === "week" || gallerySort === "likes";
      const liked = likedSet();
      items.forEach((g, i) => {
        const card = document.createElement("a");
        card.className = "card";
        card.href = "#/c/" + encodeURIComponent(g.id);
        card.innerHTML = `<div class="thumb"><img alt=""><span class="rank"></span><button type="button" class="cmt">💬</button><button type="button" class="like"></button></div><b></b><small></small>`;
        card.querySelector("img").src = g.thumb || "";
        card.querySelector("b").textContent = g.name;
        const rank = card.querySelector(".rank");
        rank.hidden = !ranked;
        rank.textContent = ["🥇", "🥈", "🥉"][i] || String(i + 1);
        card.querySelector("small").textContent = gallerySort === "week"
          ? `${t("gallery.weekLikes", { n: g.weekLikes || 0 })} · ${t("gallery.views", { n: g.views || 0 })}`
          : `${t("gallery.views", { n: g.views || 0 })} · ${g.greeting || ""}`;
        const likeBtn = card.querySelector(".like");
        renderLike(likeBtn, liked.has(g.id), g.likes || 0);
        likeBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggleLike(g.id, likeBtn); });
        const cmtBtn = card.querySelector(".cmt");
        cmtBtn.dataset.id = g.id;
        cmtBtn.title = t("comments.title");
        cmtBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          commentsToOpen = g.id;
          window.track("comments_open", { from: "gallery" });
          location.hash = card.getAttribute("href");
        });
        commentCountObserver.observe(cmtBtn);
        card.addEventListener("click", () => window.track("gallery_open"));
        list.appendChild(card);
      });
    } catch (err) {
      console.warn("[gallery]", err);
      $("gallery-status").textContent = t("gallery.fail");
    }
  }
  for (const b of document.querySelectorAll(".gallery-tabs .chip")) {
    b.addEventListener("click", () => { gallerySort = b.dataset.sort; openGallery(); });
  }

  // ---------------------------------------------------------------- 공개 캐릭터 댓글
  const NICK_KEY = "aics.nick.v1";
  let commentsToOpen = null; // 갤러리 카드의 💬 를 눌렀을 때 대화 화면이 열리면 바로 띄울 캐릭터
  function commentCountText(n) { return n >= 50 ? "50+" : String(n); }
  // count 가 null 이면 아직 모르는 상태: 입구만 먼저 보여 줌
  function renderCommentStrip(count, latest) {
    $("comments-strip").hidden = false;
    $("comments-strip-count").textContent = t("comments.strip", { n: count === null ? "" : commentCountText(count) }).trim();
    $("comments-strip-preview").textContent = latest
      ? `${latest.nick || t("comments.anon")}: ${latest.text}`
      : count === 0 ? t("comments.first") : "";
  }
  async function openComments() {
    const c = current;
    $("comments-sheet").hidden = false;
    try { $("comment-nick").value = localStorage.getItem(NICK_KEY) || ""; } catch { /* 비공개 창 */ }
    const list = $("comments-list");
    list.innerHTML = "";
    $("comments-status").textContent = t("comments.loading");
    try {
      const [items, uid] = await Promise.all([window.Cloud.comments(c.cloudId), window.Cloud.uid()]);
      if (current !== c) return;
      $("comments-status").textContent = items.length ? "" : t("comments.empty");
      const syncCount = () => {
        renderCommentStrip(items.length, items[0]);
        window.Cloud.noteCommentCount(c.cloudId, items.length);
      };
      syncCount();
      const canModerate = !c.readonly || window.Cloud.isAdmin; // 캐릭터 주인·관리자는 모든 댓글 삭제 가능
      for (const m of items) {
        const row = document.createElement("div");
        row.className = "comment";
        row.innerHTML = `<b></b><span></span><small></small>`;
        row.querySelector("b").textContent = m.nick || t("comments.anon");
        row.querySelector("span").textContent = m.text;
        row.querySelector("small").textContent = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate().toLocaleDateString() : "";
        if (m.uid === uid || canModerate) {
          const del = document.createElement("button");
          del.type = "button";
          del.className = "btn ghost small";
          del.textContent = t("comments.delete");
          del.addEventListener("click", async () => {
            if (!confirm(t("comments.confirmDelete"))) return;
            try {
              await window.Cloud.deleteComment(c.cloudId, m.id);
              row.remove();
              items.splice(items.indexOf(m), 1);
              syncCount();
            } catch (err) { alert(err.message); }
          });
          row.appendChild(del);
        }
        list.appendChild(row);
      }
    } catch (err) {
      console.warn("[comments]", err);
      $("comments-status").textContent = t("comments.fail");
    }
  }
  $("comments-strip").addEventListener("click", () => {
    if (!current || !current.cloudId) return;
    window.track("comments_open", { from: "chat" });
    openComments();
  });
  $("btn-comments-close").addEventListener("click", () => ($("comments-sheet").hidden = true));
  $("comments-sheet").addEventListener("click", (e) => { if (e.target.id === "comments-sheet") $("comments-sheet").hidden = true; });
  $("comments-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nick = $("comment-nick").value.trim().slice(0, 12);
    const text = $("comment-text").value.trim().slice(0, 100);
    if (!text) return;
    if (window.hasBannedWord(text) || window.hasBannedWord(nick)) { $("comments-status").textContent = t("comments.banned"); return; }
    try { localStorage.setItem(NICK_KEY, nick); } catch { /* 비공개 창 */ }
    const btn = e.submitter || document.querySelector("#comments-form .btn");
    btn.disabled = true;
    try {
      await window.Cloud.addComment(current.cloudId, nick, text);
      $("comment-text").value = "";
      window.track("comment");
      await openComments();
    } catch (err) {
      console.warn("[comments]", err);
      $("comments-status").textContent = t("comments.sendFail");
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------------------------------------------------------- ⑤ 관리 (신고 처리)
  async function openAdmin() {
    show("admin");
    $("admin-sheet-link").href = "https://docs.google.com/spreadsheets/d/14kPoViNz6KeMLIkZ1I8grDwW8tMhn87GP2IMzH-EQHA/edit";
    const box = $("admin-reports");
    box.innerHTML = "";
    $("admin-status").textContent = t("admin.loading");
    try {
      const uid = await window.Cloud.uid();
      if (!window.Cloud.isAdmin) { $("admin-status").textContent = t("admin.notAdmin", { uid }); return; }
      const reports = await window.Cloud.reports();
      $("admin-status").textContent = reports.length ? "" : t("admin.noReports");
      for (const r of reports) box.appendChild(await reportRow(r));
    } catch (err) {
      $("admin-status").textContent = t("admin.failed", { msg: err.message });
    }
  }
  async function reportRow(r) {
    const row = document.createElement("div");
    row.className = "admin-row";
    row.innerHTML = `<img alt=""><div class="grow"><b></b><p class="reason"></p><small></small>
      <div class="row"><a class="btn small-btn open"></a><button class="btn small-btn danger del"></button><button class="btn small-btn dismiss"></button></div></div>`;
    let doc = null;
    try { doc = await window.Cloud.load(r.characterId); } catch { /* 지워졌거나 오류 */ }
    row.querySelector("img").src = (doc && doc.photo) || "";
    row.querySelector("b").textContent = doc ? doc.name : t("admin.gone");
    row.querySelector(".reason").textContent = r.reason;
    row.querySelector("small").textContent = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleString() : "";
    const open = row.querySelector(".open");
    open.textContent = t("admin.open");
    open.href = "?c=" + encodeURIComponent(r.characterId);
    open.target = "_blank";
    open.hidden = !doc;
    const del = row.querySelector(".del");
    del.textContent = t("admin.delete");
    del.hidden = !doc;
    del.addEventListener("click", async () => {
      if (!confirm(t("admin.confirmDelete", { name: doc.name }))) return;
      try {
        await window.Cloud.takeDown(r.characterId);
        await window.Cloud.dismissReport(r.id);
        row.remove();
      } catch (err) { alert(t("admin.failed", { msg: err.message })); }
    });
    const dismiss = row.querySelector(".dismiss");
    dismiss.textContent = t("admin.dismiss");
    dismiss.addEventListener("click", async () => {
      try { await window.Cloud.dismissReport(r.id); row.remove(); }
      catch (err) { alert(t("admin.failed", { msg: err.message })); }
    });
    return row;
  }
  $("ai-share-limit").addEventListener("change", () => {
    const custom = $("ai-share-limit").value === "custom";
    $("ai-share-limit-custom").hidden = !custom;
    if (custom) {
      if (!$("ai-share-limit-custom").value) $("ai-share-limit-custom").value = String((current && current.aiShare && current.aiShare.limit) || 100);
      $("ai-share-limit-custom").focus();
      $("ai-share-limit-custom").select();
      return;
    }
    if ($("ai-share-on").checked) applyAiShare();
  });
  $("ai-share-limit-custom").addEventListener("change", () => { if ($("ai-share-on").checked) applyAiShare(); });

  $("btn-share").addEventListener("click", () => current && openShareSheet());
  $("btn-sheet-close").addEventListener("click", closeShareSheet);
  $("share-sheet").addEventListener("click", (e) => { if (e.target.id === "share-sheet") closeShareSheet(); });

  async function copyLink() {
    const link = $("share-link").value;
    try { await navigator.clipboard.writeText(link); } catch { $("share-link").select(); document.execCommand("copy"); }
    $("btn-copy").textContent = t("share.copied");
    setTimeout(() => ($("btn-copy").textContent = t("share.copy")), 1500);
  }
  $("btn-copy").addEventListener("click", copyLink);

  $("btn-kakao").addEventListener("click", () => {
    try {
      window.KakaoShare.share(current, appLink(current.cloudId));
      window.track("share", { method: "kakao" });
    } catch (err) {
      console.warn("[kakao] 공유 실패", err);
      alert(t("share.kakaoFail"));
    }
  });
  window.KakaoShare.preload();

  // ---------------------------------------------------------------- 대화 카드 (5단계)
  let card = null; // { blob, url(로컬 미리보기), kakaoUrl, link, story(인스타 스토리용) }

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
    const mine = (card = { blob: null, url: null, kakaoUrl: null, link: null, story: null });
    $("card-sheet").hidden = false;
    $("card-preview").hidden = true;
    $("btn-card-kakao").hidden = true;
    $("btn-card-insta").hidden = true;
    $("insta-hint").hidden = true;
    $("btn-card-share").hidden = true;
    $("card-status").textContent = t("card.making");

    const blob = await window.Viral.makeCard(c, $("avatar-img").src, recentMessages());
    if (card !== mine) return; // 그 사이 닫힘
    mine.blob = blob;
    mine.url = URL.createObjectURL(blob);
    $("card-preview").src = mine.url;
    $("card-preview").hidden = false;
    $("card-status").textContent = "";
    $("btn-card-share").hidden = !(navigator.canShare && navigator.canShare({ files: [new File([blob], "card.png", { type: "image/png" })] }));

    // 인스타는 공유 창이 버튼을 누른 순간 열려야 해서 스토리 이미지를 미리 만들어 둠
    mine.story = await window.Viral.makeStory(blob);
    if (card === mine && window.I18N.region() !== "zh") $("btn-card-insta").hidden = false;

    // 카톡·인스타로 보내려면 공유 링크가, 카톡은 카카오 서버에 올린 카드 이미지도 필요 → 미리 준비
    if (!window.Cloud.enabled) return;
    try {
      if (!c.cloudId && !c.readonly) { c.cloudId = await window.Cloud.share(c); saveCharacters(characters); }
      mine.link = shareLink(c.cloudId);
      if (!window.KakaoShare.enabled || window.I18N.region() !== "KR") return; // 카톡 카드는 한국에서만
      mine.kakaoUrl = await window.KakaoShare.prepareCard(blob);
      if (card === mine) $("btn-card-kakao").hidden = false;
    } catch (err) {
      console.warn("[card] 카톡 보내기 준비 실패", err);
    }
  }

  $("btn-card").addEventListener("click", () => { if (!current) return; openCardSheet(); progressMission("card"); });
  $("btn-share-insta").addEventListener("click", () => { closeShareSheet(); if (current) openCardSheet(); });
  $("btn-card-close").addEventListener("click", closeCardSheet);
  $("card-sheet").addEventListener("click", (e) => { if (e.target.id === "card-sheet") closeCardSheet(); });

  $("btn-card-save").addEventListener("click", () => {
    if (!card || !card.url) return;
    const a = document.createElement("a");
    a.href = card.url;
    a.download = t("card.file", { name: current.name }) + ".png";
    a.click();
  });

  $("btn-card-share").addEventListener("click", async () => {
    if (!card || !card.blob) return;
    const file = new File([card.blob], `${current.name}_card.png`, { type: "image/png" });
    try { await navigator.share({ files: [file], title: t("card.shareTitle", { name: current.name }) }); } catch { /* 취소 */ }
  });

  // 인스타그램은 웹에서 바로 올리는 기능이 없어서: 링크를 복사해 두고 → 휴대폰 공유 창으로 이미지를 넘김
  $("btn-card-insta").addEventListener("click", async () => {
    if (!card || !card.story) return;
    window.track("share", { method: "instagram_story" });
    const file = new File([card.story], `${current.name}_story.png`, { type: "image/png" });
    const hint = $("insta-hint");
    if (card.link) navigator.clipboard.writeText(card.link).catch(() => {});
    const linkTip = card.link ? t("insta.tip") : "";
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      hint.textContent = t("insta.pick", { tip: linkTip });
      hint.hidden = false;
      try { await navigator.share({ files: [file] }); } catch { /* 취소 */ }
    } else {
      // PC 등 파일 공유가 안 되는 곳: 이미지를 저장해 휴대폰에서 올리도록 안내
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      hint.textContent = t("insta.saved", { tip: linkTip });
      hint.hidden = false;
    }
  });

  $("btn-card-kakao").addEventListener("click", () => {
    if (!card || !card.kakaoUrl) return;
    try {
      window.KakaoShare.share(current, appLink(current.cloudId), { imageUrl: card.kakaoUrl, affection: Math.round(current.affection) });
    } catch (err) {
      console.warn("[kakao] 카드 공유 실패", err);
    }
  });

  $("btn-native-share").addEventListener("click", async () => {
    const data = { title: t("share.nativeTitle", { name: current.name }), text: t("share.nativeText", { name: current.name }), url: $("share-link").value };
    if (navigator.share) {
      window.track("share", { method: "native" });
      try { await navigator.share(data); } catch { /* 사용자가 취소 */ }
    } else {
      copyLink();
    }
  });

  $("btn-report").addEventListener("click", async () => {
    const reason = prompt(t("share.reportAsk"));
    if (!reason) return;
    try {
      await window.Cloud.report(current.cloudId, reason);
      alert(t("share.reportOk"));
    } catch {
      alert(t("share.reportFail"));
    }
  });

  $("btn-unshare").addEventListener("click", async () => {
    if (!confirm(t("share.unshareConfirm"))) return;
    try {
      await window.Cloud.remove(current.cloudId);
      current.cloudId = undefined;
      current.published = false;
      saveCharacters(characters);
      closeShareSheet();
    } catch {
      alert(t("share.unshareFail"));
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
    $("btn-edit").title = t(c.readonly ? "chat.removeReceived" : "chat.edit");
    $("avatar").classList.toggle("png-sprite", !!c.sprite);
    document.querySelector("#screen-chat .stage").style.backgroundImage = c.background ? `url("${c.background}")` : "";
    renderModeChip();
    $("chat-log").innerHTML = "";
    setAffection(0);
    setEmotion("neutral", false);
    show("chat");
    if (c.readonly) refreshReceived(c);
    // 저장돼 있던 대화가 있으면 이어서 보여 주고, AI 기억에도 이어 붙임
    const saved = loadChat(c.id);
    if (saved.length) {
      for (const m of saved) addMessage(m.who, m.text, null, false);
      window.AiChat.seed(c.id, saved);
    } else {
      addMessage("her", c.greeting);
    }
    dailyCheckIn(c);
    setTeachMode(null);
    // 갤러리에 공개된 캐릭터면 댓글 줄
    $("comments-strip").hidden = true;
    $("btn-like").hidden = true;
    if (c.cloudId && window.Cloud.enabled) {
      window.Cloud.galleryDoc(c.cloudId).then((g) => {
        if (current !== c || !g) return;
        renderCommentStrip(null);
        $("btn-like").hidden = false;
        renderLike($("btn-like"), likedSet().has(c.cloudId), g.likes || 0);
        if (commentsToOpen === c.cloudId) {
          commentsToOpen = null;
          openComments();
        } else {
          window.Cloud.commentSummary(c.cloudId)
            .then(({ count, latest }) => { if (current === c) renderCommentStrip(count, latest); })
            .catch((err) => console.warn("[comments]", err));
        }
      }).catch(() => {});
    }
    checkAnniversary(c);
    renderMissionChip();
  }

  // ---------------------------------------------------------------- 대화 기록 저장 (캐릭터별 최근 60개)
  const CHAT_KEY = "aics.chat.v1";
  const CHAT_LIMIT = 60;
  function loadAllChats() {
    try { return JSON.parse(localStorage.getItem(CHAT_KEY)) || {}; } catch { return {}; }
  }
  function loadChat(id) { return loadAllChats()[id] || []; }
  function saveChatMessage(id, who, text) {
    const all = loadAllChats();
    all[id] = [...(all[id] || []), { who, text }].slice(-CHAT_LIMIT);
    try { localStorage.setItem(CHAT_KEY, JSON.stringify(all)); } catch { /* 저장 공간 부족: 화면에만 표시 */ }
  }
  function clearChat(id) {
    const all = loadAllChats();
    delete all[id];
    try { localStorage.setItem(CHAT_KEY, JSON.stringify(all)); } catch { /* 무시 */ }
  }

  // ---------------------------------------------------------------- 대화 초기화
  function closeResetSheet() { $("reset-sheet").hidden = true; }

  function resetConversation(withAffection) {
    const c = current;
    clearChat(c.id);
    window.AiChat.reset(c.id); // AI 가 기억하던 이전 대화도 지움
    teachQuestion = null;
    if (withAffection) {
      // 하루는 처음 값(20), 나머지는 새 캐릭터 기본값(10)으로
      c.affection = c.builtIn ? HARU.affection : 10;
      saveCharacters(characters);
    }
    closeResetSheet();
    openChat(c); // 저장된 대화가 없으니 첫인사부터 다시 시작
    addMessage("system", t(withAffection ? "chat.resetAllDone" : "chat.resetDone"), null, false);
  }

  $("btn-reset-chat").addEventListener("click", () => current && ($("reset-sheet").hidden = false));
  $("btn-reset-chat-only").addEventListener("click", () => resetConversation(false));
  $("btn-reset-all").addEventListener("click", () => resetConversation(true));
  $("btn-reset-cancel").addEventListener("click", closeResetSheet);
  $("reset-sheet").addEventListener("click", (e) => { if (e.target.id === "reset-sheet") closeResetSheet(); });
  $("btn-edit").addEventListener("click", () => {
    if (!current) return;
    if (!current.readonly) { location.hash = "#/edit/" + current.id; return; }
    if (confirm(t("chat.confirmRemove", { name: current.name }))) removeCharacter(current.id);
  });

  // 표정 바꾸기: 감정별 사진이 있으면 교체, 없으면 기본 사진 + CSS 효과(색감·움직임·볼터치·이모지)
  function setEmotion(emo, animate = true) {
    const avatar = $("avatar");
    const slot = current.slots && current.slots[emo];
    $("avatar-img").src = slot || current.photo;
    avatar.className = avatar.className.replace(/\bemo-\S+/g, "").trim();
    avatar.classList.toggle("has-slot", !!slot && emo !== "neutral");
    if (animate) void avatar.offsetWidth; // 같은 감정이 연속돼도 애니메이션 다시 재생
    // 나만의 표정은 사진 교체 + 통통 튀기만 (색 효과는 기본 5가지에만)
    avatar.classList.add(EMOTION_BADGE[emo] !== undefined ? "emo-" + emo : "emo-custom");

    $("avatar-badge").textContent = EMOTION_BADGE[emo] || "";
    avatar.classList.toggle("show-badge", animate && !!EMOTION_BADGE[emo]);
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => avatar.classList.remove("show-badge"), 1800);
  }

  // reward: 미션·출석·기념일 보상처럼 "호감도 올리기" 미션에 세지 않을 변화
  function setAffection(delta, reward = false) {
    current.affection = Math.max(0, Math.min(100, (current.affection || 0) + delta));
    $("affection-fill").style.width = current.affection + "%";
    if (delta) saveCharacters(characters);
    if (delta > 0 && !reward) progressMission("aff3", delta);
  }

  // ---------------------------------------------------------------- 출석 체크 · 오늘의 질문
  // 하루에 한 번 대화방에 들어오면 호감도 +1 (3일 연속 +2, 7일 연속 +3) 그리고 캐릭터가 먼저 질문
  function dateKey(d) { return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function dailyCheckIn(c) {
    const now = new Date();
    const today = dateKey(now);
    if (c.lastVisit === today) return;
    const yesterday = dateKey(new Date(now.getTime() - 86400000));
    const first = !c.lastVisit;
    c.streak = c.lastVisit === yesterday ? (c.streak || 1) + 1 : 1;
    c.lastVisit = today;
    saveCharacters(characters);
    if (first) return; // 처음 만난 날은 첫인사만
    const bonus = c.streak >= 7 ? 3 : c.streak >= 3 ? 2 : 1;
    addMessage("system", t("checkin", { n: c.streak, b: bonus }), null, false);
    setAffection(bonus, true);
    const day = Math.floor(now.getTime() / 86400000);
    addMessage("her", t(`daily.${day % 7}`));
    c.dailyAsked = today; // "오늘의 질문에 대답하기" 미션용
    saveCharacters(characters);
  }

  function addMessage(who, text, extra, save = true) {
    const div = document.createElement("div");
    div.className = "msg " + who;
    div.textContent = text;
    if (extra) div.appendChild(extra);
    $("chat-log").appendChild(div);
    div.scrollIntoView({ block: "end", behavior: "smooth" });
    if (save && current && (who === "me" || who === "her")) saveChatMessage(current.id, who, text);
    return div;
  }

  // "···" 글자 대신 움직이는 점 3개 (읽기 프로그램에는 "···"로 읽힘)
  function showDots(el) {
    el.innerHTML = `<span class="dots" role="img" aria-label="···"><i></i><i></i><i></i></span>`;
  }

  function setTeachMode(question) {
    teachQuestion = question;
    $("chat-text").placeholder = question ? t("chat.teachPh", { q: question }) : t("chat.placeholder");
    if (question) $("chat-text").focus();
  }

  // 검색해서 대답했을 때 출처와 Google 검색 추천(이용 조건상 함께 보여 줘야 함)
  function sourcesBox(src) {
    const box = document.createElement("div");
    box.className = "sources";
    if (src.links.length) {
      const p = document.createElement("p");
      p.textContent = t("chat.sources") + ": ";
      src.links.slice(0, 3).forEach((l, i) => {
        const a = document.createElement("a");
        a.href = l.uri;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = l.title || new URL(l.uri).hostname;
        if (i) p.append(" · ");
        p.appendChild(a);
      });
      box.appendChild(p);
    }
    if (src.searchHtml) {
      // Google 이 준 HTML 을 그대로 보여 주되, 사이트 스타일과 섞이지 않게 분리
      const host = document.createElement("div");
      host.attachShadow({ mode: "open" }).innerHTML = src.searchHtml;
      box.appendChild(host);
    }
    return box;
  }

  function teachButton(question) {
    const wrap = document.createElement("div");
    wrap.style.marginTop = "6px";
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.type = "button";
    btn.textContent = t("chat.teachBtn");
    btn.addEventListener("click", () => {
      btn.disabled = true;
      addMessage("system", t("chat.teachAsk", { q: question, name: current.name }));
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
      const result = await engine.teach(question, text, sheetUrl, current.id);
      if (!result.ok) { addMessage("system", t("chat.teachBanned")); return; }
      setEmotion("happy");
      setAffection(1);
      progressMission("teach");
      // 가르친 말의 언어로 대답
      addMessage("her", window.I18N.tIn(window.detectLang(question) || window.I18N.lang, "chat.teachOk", { q: question }));
      return;
    }

    addMessage("me", text);
    if (current.dailyAsked === dateKey(new Date())) progressMission("daily");
    progressMission("send5");
    if (text.length >= 20) progressMission("long");
    const typing = addMessage("her typing", "···");
    showDots(typing);
    const sendBtn = document.querySelector("#chat-form button");
    sendBtn.disabled = true;
    const who = current; // 응답을 기다리는 사이 다른 캐릭터로 옮겨 가도 섞이지 않게

    let res = null;
    const mode = chatMode(who);
    if (mode !== "basic" && !window.hasBannedWord(text)) {
      try {
        // 내 키가 있으면 내 키로, 없고 받은 캐릭터에 AI 공유가 켜져 있으면 중계 서버(만든 사람의 키)로
        res = mode === "own" ? await window.AiChat.respond(who, text) : await window.AiChat.respondViaRelay(who, text);
        if (window.hasBannedWord(res.reply)) { // AI 대답도 한 번 더 거름
          res = null;
          addMessage("system", t("chat.aiFiltered"));
        }
      } catch (err) {
        addMessage("system", t("chat.aiFail", { msg: err.message }));
      }
    } else {
      await new Promise((r) => setTimeout(r, 450 + Math.random() * 450));
    }
    typing.remove();
    sendBtn.disabled = false;
    if (current !== who) return;

    if (!res) res = engine.respond(text, current);
    setEmotion(res.emotion);
    if (res.emotion === "happy") progressMission("happy");
    if (res.emotion === "embarrassed") progressMission("fluster");
    if (res.affection) setAffection(res.affection);
    addMessage("her", res.reply, res.unknown ? teachButton(text) : res.sources ? sourcesBox(res.sources) : null);
  });

  // ---------------------------------------------------------------- AI 실시간 대화 설정
  // own: 내 키로 AI / relay: 만든 사람이 공유한 AI (중계 서버) / basic: 키워드 대화
  function chatMode(c) {
    if (window.AiChat.enabled) return "own";
    if (c && c.readonly && c.aiShared && window.AiChat.relayUrl) return "relay";
    return "basic";
  }

  function renderModeChip() {
    const on = window.AiChat.enabled;
    const mode = chatMode(current);
    $("chat-mode").textContent = mode === "own" ? t("chat.modeAi", { p: window.AiChat.label() }) : mode === "relay" ? t("chat.modeRelay") : t("chat.basic");
    $("chat-mode").classList.toggle("on", mode !== "basic");
    $("ai-home-state").textContent = on ? t("home.on", { p: window.AiChat.label() }) : t("home.off");
  }

  // 서비스 목록은 페이지가 열리자마자 채워 둠 (비어 있는 동안 저장되면 서비스 이름이 빈 값이 되던 문제)
  function fillProviderOptions() {
    const sel = $("ai-provider");
    const value = sel.value || window.AiChat.settings.provider;
    sel.innerHTML = "";
    for (const [id, p] of Object.entries(window.AiChat.PROVIDERS)) sel.add(new Option(p.label + (id === "gemini" ? t("ai.default") : ""), id));
    sel.value = value;
  }
  fillProviderOptions();

  function fillAiForm(s) {
    const sel = $("ai-provider");
    sel.value = s.provider;
    $("ai-model").value = s.model;
    $("ai-key").value = s.key || "";
    $("ai-remember").checked = s.remember !== false;
    $("ai-search").checked = !!s.search;
    $("ai-key-link").href = window.AiChat.PROVIDERS[s.provider].keyUrl;
    $("ai-status").textContent = s.key ? t("ai.hasKey") : "";
  }

  // 서비스별 키·모델을 따로 기억 (Gemini ↔ OpenAI 를 바꿔도 각자 키가 남아 있음)
  function readAiForm() {
    const prev = window.AiChat.settings;
    const provider = $("ai-provider").value;
    const key = $("ai-key").value.trim();
    const model = $("ai-model").value.trim() || window.AiChat.PROVIDERS[provider].model;
    return {
      ...prev,
      provider, key, model,
      keys: { ...(prev.keys || {}), [provider]: key },
      models: { ...(prev.models || {}), [provider]: model },
      remember: $("ai-remember").checked,
      search: $("ai-search").checked,
    };
  }

  // 입력하는 즉시 자동 저장 (켜짐/꺼짐 상태는 그대로)
  let aiSaveTimer = 0;
  function autosaveAi(e) {
    // 설정 창을 사람이 직접 고칠 때만 저장 (브라우저 자동 완성 등 다른 때 들어온 값은 무시)
    if ($("ai-sheet").hidden || (e && e.isTrusted === false)) return;
    clearTimeout(aiSaveTimer);
    aiSaveTimer = setTimeout(() => {
      const s = readAiForm();
      window.AiChat.saveSettings({ ...s, enabled: !!(window.AiChat.settings.enabled && s.key) });
      renderModeChip();
      if (s.key) $("ai-status").textContent = t("ai.autosaved");
    }, 300);
  }
  for (const id of ["ai-key", "ai-model"]) $(id).addEventListener("input", autosaveAi);
  $("ai-remember").addEventListener("change", autosaveAi);
  $("ai-search").addEventListener("change", autosaveAi);

  function openAiSheet() {
    fillAiForm(window.AiChat.settings);
    $("ai-sheet").hidden = false;
  }
  function closeAiSheet() { $("ai-sheet").hidden = true; }

  $("btn-ai-home").addEventListener("click", openAiSheet);
  $("chat-mode").addEventListener("click", openAiSheet);
  $("ai-sheet").addEventListener("click", (e) => { if (e.target.id === "ai-sheet") closeAiSheet(); });
  $("ai-provider").addEventListener("change", () => {
    const id = $("ai-provider").value;
    const p = window.AiChat.PROVIDERS[id];
    const s = window.AiChat.settings;
    // 그 서비스에 예전에 넣어 둔 키·모델이 있으면 다시 채움
    $("ai-model").value = (s.models && s.models[id]) || p.model;
    $("ai-key").value = (s.keys && s.keys[id]) || "";
    $("ai-key-link").href = p.keyUrl;
    $("ai-status").textContent = $("ai-key").value ? t("ai.hasKey") : "";
    autosaveAi();
  });

  $("ai-test").addEventListener("click", async () => {
    const s = readAiForm();
    if (!s.key) { $("ai-status").textContent = t("ai.needKey"); return; }
    $("ai-status").textContent = t("ai.testing");
    try {
      const r = await window.AiChat.test(s);
      $("ai-status").textContent = t("ai.testOk", { r: r.reply });
    } catch (err) {
      $("ai-status").textContent = `❌ ${err.message || t("ai.testFail")}`;
    }
  });

  $("ai-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const s = readAiForm();
    if (!s.key) { $("ai-status").textContent = t("ai.needKeyOn"); return; }
    window.AiChat.saveSettings({ ...s, enabled: true });
    window.track("ai_chat_on", { provider: s.provider });
    closeAiSheet();
    renderModeChip();
    if (current && !$("screen-chat").hidden) addMessage("system", t("chat.aiOn", { p: window.AiChat.label() }));
  });

  $("ai-off").addEventListener("click", () => {
    // 끄기만 하고 키는 남겨 둠 (다시 켤 때 그대로 사용)
    clearTimeout(aiSaveTimer);
    window.AiChat.saveSettings({ ...readAiForm(), enabled: false });
    closeAiSheet();
    renderModeChip();
    if (current && !$("screen-chat").hidden) addMessage("system", t("chat.aiOff"));
  });

  $("ai-forget").addEventListener("click", () => {
    if (!confirm(t("ai.forgetConfirm"))) return;
    clearTimeout(aiSaveTimer);
    window.AiChat.saveSettings({ ...readAiForm(), key: "", keys: {}, enabled: false });
    $("ai-key").value = "";
    $("ai-status").textContent = t("ai.forgot");
    renderModeChip();
  });

  // ---------------------------------------------------------------- 좋아요 (공개 캐릭터, 기기마다 한 번)
  const LIKED_KEY = "aics.liked.v1";
  function likedSet() {
    try { return new Set(JSON.parse(localStorage.getItem(LIKED_KEY)) || []); } catch { return new Set(); }
  }
  function saveLiked(set) {
    try { localStorage.setItem(LIKED_KEY, JSON.stringify([...set].slice(-500))); } catch { /* 비공개 창 */ }
  }
  function renderLike(btn, on, n) {
    btn.textContent = `${on ? "❤️" : "🤍"} ${n}`;
    btn.classList.toggle("on", on);
  }
  async function toggleLike(id, btn) {
    const set = likedSet();
    const on = !set.has(id);
    btn.disabled = true;
    try {
      const n = await window.Cloud.setLike(id, on);
      if (on) set.add(id); else set.delete(id);
      saveLiked(set);
      renderLike(btn, on, n);
      if (on) window.track("like");
    } catch (err) {
      // 이 기기 기록과 서버가 어긋났으면(기록 삭제 등) 서버 쪽에 맞춰 두고 한 번 더 누르게 함
      console.warn("[like]", err);
      try {
        const real = await window.Cloud.liked(id);
        if (real) set.add(id); else set.delete(id);
        saveLiked(set);
        const g = await window.Cloud.galleryDoc(id);
        renderLike(btn, real, (g && g.likes) || 0);
      } catch { /* 다음에 */ }
    } finally {
      btn.disabled = false;
    }
  }
  $("btn-like").addEventListener("click", () => current && current.cloudId && toggleLike(current.cloudId, $("btn-like")));

  // ---------------------------------------------------------------- 오늘의 대화 미션
  // 캐릭터마다 하루 3개. 하나에 호감도 +2, 모두 끝내면 +3
  const MISSIONS = { send5: 5, happy: 1, fluster: 1, daily: 1, teach: 1, card: 1, aff3: 3, long: 1 };
  function todayMissions(c) {
    const today = dateKey(new Date());
    if (!c.mission || c.mission.date !== today) {
      let pool = Object.keys(MISSIONS);
      if (chatMode(c) !== "basic") pool = pool.filter((id) => id !== "teach"); // AI 대화에는 가르치기 버튼이 없음
      if (c.dailyAsked !== today) pool = pool.filter((id) => id !== "daily");
      // 날짜와 캐릭터로 정해지는 순서라 하루 동안은 같은 미션
      let seed = [...(today + c.id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
      const ids = [];
      while (ids.length < 3 && pool.length) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        ids.push(pool.splice(seed % pool.length, 1)[0]);
      }
      c.mission = { date: today, ids, progress: {}, done: [], bonus: false };
      saveCharacters(characters);
    }
    return c.mission;
  }
  function missionName(id) { return t(`mission.${id}`, { name: current ? current.name : "" }); }
  function renderMissionChip() {
    if (!current) return;
    const m = todayMissions(current);
    $("btn-missions").textContent = t("mission.chip", { done: m.done.length, n: m.ids.length });
    $("btn-missions").classList.toggle("on", m.done.length === m.ids.length);
  }
  function progressMission(id, amount = 1) {
    const c = current;
    if (!c) return;
    const m = todayMissions(c);
    if (!m.ids.includes(id) || m.done.includes(id)) return;
    m.progress[id] = Math.min(MISSIONS[id], (m.progress[id] || 0) + amount);
    if (m.progress[id] >= MISSIONS[id]) {
      m.done.push(id);
      addMessage("system", t("mission.done", { name: missionName(id) }), null, false);
      setAffection(2, true);
      window.track("mission_complete", { mission: id });
      if (m.done.length === m.ids.length && !m.bonus) {
        m.bonus = true;
        addMessage("system", t("mission.allDone"), null, false);
        setAffection(3, true);
      }
    }
    saveCharacters(characters);
    renderMissionChip();
    if (!$("mission-sheet").hidden) renderMissions();
  }
  function renderMissions() {
    const m = todayMissions(current);
    const box = $("mission-list");
    box.innerHTML = "";
    for (const id of m.ids) {
      const row = document.createElement("div");
      row.className = "mission" + (m.done.includes(id) ? " done" : "");
      row.innerHTML = `<span></span><b></b><small></small>`;
      row.querySelector("span").textContent = m.done.includes(id) ? "✅" : "⬜";
      row.querySelector("b").textContent = missionName(id);
      row.querySelector("small").textContent = MISSIONS[id] > 1 ? `${m.progress[id] || 0}/${MISSIONS[id]}` : "";
      box.appendChild(row);
    }
  }
  $("btn-missions").addEventListener("click", () => { if (!current) return; renderMissions(); $("mission-sheet").hidden = false; });
  $("btn-mission-close").addEventListener("click", () => ($("mission-sheet").hidden = true));
  $("mission-sheet").addEventListener("click", (e) => { if (e.target.id === "mission-sheet") $("mission-sheet").hidden = true; });

  // ---------------------------------------------------------------- 기념일 (만난 지 N일) · 캐릭터 생일
  const ANNIV_DAYS = [7, 30, 50, 100, 200, 300, 365, 500, 730, 1000];
  function metAt(c) {
    if (!c.metAt) {
      // 직접 만든 캐릭터는 id 앞부분이 만든 시각이라 그날부터 셈
      const ts = parseInt(String(c.id).slice(0, 8), 36);
      c.metAt = ts > 1.6e12 && ts <= Date.now() ? ts : Date.now();
      saveCharacters(characters);
    }
    return c.metAt;
  }
  function daysTogether(c) {
    const start = new Date(metAt(c));
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((today - start) / 86400000) + 1; // 만난 날이 1일째
  }
  function checkAnniversary(c) {
    const d = daysTogether(c);
    const now = new Date();
    const md = String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    const birthday = c.birthday === md;
    $("dday-chip").textContent = (birthday ? "🎂 " : "") + t("anniv.chip", { n: d });
    if (ANNIV_DAYS.includes(d) && c.annivShown !== d) {
      c.annivShown = d;
      saveCharacters(characters);
      addMessage("system", t("anniv.day", { n: d }), null, false);
      addMessage("her", t(d >= 365 ? "anniv.lineYear" : "anniv.line", { n: d }));
      setAffection(5, true);
      setEmotion("happy");
      window.track("anniversary", { days: d });
    }
    if (birthday && c.bdayShown !== now.getFullYear()) {
      c.bdayShown = now.getFullYear();
      saveCharacters(characters);
      addMessage("system", t("bday.system", { name: c.name }), null, false);
      addMessage("her", t("bday.line"));
      setAffection(5, true);
      setEmotion("happy");
      window.track("birthday");
    }
  }

  // ---------------------------------------------------------------- 캐릭터 단톡방
  // AI 키가 있으면 캐릭터들이 서로의 말을 보고 대답하고, 없으면 AI가 공유된 받은 캐릭터는 중계 서버로,
  // 나머지는 각자 기본(키워드) 대화로 대답 (1:1 대화와 같은 chatMode 기준)
  const GROUP_KEY = "aics.groups.v1";
  function loadGroups() {
    try { return JSON.parse(localStorage.getItem(GROUP_KEY)) || []; } catch { return []; }
  }
  function saveGroups() {
    try { localStorage.setItem(GROUP_KEY, JSON.stringify(groups)); } catch { /* 공간 부족: 화면에만 */ }
  }
  let groups = loadGroups();
  let group = null;
  let groupBusy = false;
  const groupMembers = (g) => g.members.map(findChar).filter(Boolean);
  const groupAiMembers = (g) => groupMembers(g).filter((m) => chatMode(m) !== "basic");

  function openGroups() {
    group = null;
    show("groups");
    const list = $("group-list");
    list.innerHTML = "";
    if (!groups.length) list.innerHTML = `<p class="hint">${t("group.none")}</p>`;
    for (const g of groups) {
      const members = groupMembers(g);
      const row = document.createElement("a");
      row.className = "group-row";
      row.href = "#/group/" + g.id;
      row.innerHTML = `<div class="faces"></div><div class="grow"><b></b><small></small></div>`;
      for (const m of members) {
        const img = document.createElement("img");
        img.src = m.photo;
        img.alt = "";
        row.querySelector(".faces").appendChild(img);
      }
      row.querySelector("b").textContent = g.name;
      const last = g.messages[g.messages.length - 1];
      row.querySelector("small").textContent = last ? last.text : members.map((m) => m.name).join(", ");
      list.appendChild(row);
    }
    const pick = $("group-pick");
    pick.innerHTML = "";
    for (const c of characters) {
      const label = document.createElement("label");
      label.className = "pick-card";
      label.innerHTML = `<input type="checkbox"><img alt=""><span></span>`;
      label.querySelector("input").value = c.id;
      label.querySelector("img").src = c.photo;
      label.querySelector("span").textContent = c.name;
      pick.appendChild(label);
    }
  }
  $("btn-groups").addEventListener("click", () => (location.hash = "#/groups"));
  $("group-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const ids = [...$("group-pick").querySelectorAll("input:checked")].map((i) => i.value);
    if (ids.length < 2 || ids.length > 4) { alert(t("group.pickCount")); return; }
    const name = ($("group-name").value.trim() || ids.map((id) => findChar(id).name).join(", ")).slice(0, 20);
    if (window.hasBannedWord(name)) { alert(t("edit.banned")); return; }
    const g = { id: "g" + Date.now().toString(36), name, members: ids, messages: [] };
    groups.push(g);
    saveGroups();
    $("group-name").value = "";
    window.track("group_create", { size: ids.length });
    location.hash = "#/group/" + g.id;
  });

  function openGroup(g) {
    group = g;
    show("group");
    $("group-title").textContent = g.name;
    const members = groupMembers(g);
    const box = $("group-members");
    box.innerHTML = "";
    for (const m of members) {
      const s = document.createElement("span");
      s.innerHTML = `<img alt=""><small></small>`;
      s.querySelector("img").src = m.photo;
      s.querySelector("small").textContent = m.name;
      box.appendChild(s);
    }
    renderGroupMode(g);
    for (const m of members) refreshReceived(m);
    $("group-log").innerHTML = "";
    if (!g.messages.length) addGroupMessage("system", t("group.welcome", { names: members.map((m) => m.name).join(", ") }), null, false);
    for (const m of g.messages) addGroupMessage(m.who, m.text, m.emo, false);
    $("group-log").scrollTop = $("group-log").scrollHeight; // 방을 열면 바로 최신 대화부터
    setGroupBusy(false);
  }

  function renderGroupMode(g) {
    const members = groupMembers(g);
    const relay = members.filter((m) => chatMode(m) === "relay");
    $("group-mode").textContent =
      window.AiChat.enabled ? t("group.modeAi", { p: window.AiChat.label() }) :
      relay.length ? t("group.modeRelay", { names: relay.map((m) => m.name).join(", ") }) + (relay.length < members.length ? t("group.modeRest") : "") :
      t("group.modeBasic");
  }

  function addGroupMessage(who, text, emo, save = true) {
    const row = document.createElement("div");
    if (who === "me" || who === "system") {
      row.className = "msg " + who;
      row.textContent = text;
    } else {
      const c = findChar(who);
      row.className = "gmsg";
      row.innerHTML = `<img alt=""><div class="gbody"><small></small><div class="msg her"></div></div>`;
      row.querySelector("img").src = (c && ((c.slots && c.slots[emo]) || c.photo)) || "";
      row.querySelector("small").textContent = c ? c.name : "?";
      row.querySelector(".msg").textContent = text;
    }
    $("group-log").appendChild(row);
    row.scrollIntoView({ block: "end", behavior: "smooth" });
    if (save && group) {
      group.messages = [...group.messages, { who, text, emo: emo || "neutral" }].slice(-100);
      saveGroups();
    }
    return row;
  }

  function transcriptOf(g) {
    return g.messages.slice(-20)
      .map((m) => `[${m.who === "me" ? t("group.me") : (findChar(m.who) || { name: "?" }).name}]: ${m.text}`).join("\n");
  }
  const lastUserText = (g) => ([...g.messages].reverse().find((m) => m.who === "me") || { text: "" }).text;

  // 대답할 캐릭터: 이름이 불린 캐릭터 먼저, 나머지는 섞어서 최대 3명
  function pickResponders(members, text) {
    const named = members.filter((m) => text.includes(m.name));
    const rest = members.filter((m) => !named.includes(m)).sort(() => Math.random() - 0.5);
    return [...named, ...rest].slice(0, Math.min(3, members.length));
  }

  async function speak(g, m, auto) {
    const typing = addGroupMessage(m.id, "···", "neutral", false);
    typing.classList.add("typing");
    showDots(typing.querySelector(".msg"));
    let res = null;
    const mode = chatMode(m);
    if (mode !== "basic") {
      try {
        res = mode === "own"
          ? await window.AiChat.groupReply(m, groupMembers(g), transcriptOf(g), auto)
          : await window.AiChat.groupReplyViaRelay(m, groupMembers(g), g.messages);
      } catch (err) {
        addGroupMessage("system", t("chat.aiFail", { msg: err.message }), null, false);
      }
    } else {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 500));
    }
    typing.remove();
    if (group !== g) return;
    if (!res && !auto) res = engine.respond(lastUserText(g), m);
    if (!res || window.hasBannedWord(res.reply)) return;
    addGroupMessage(m.id, res.reply, res.emotion);
  }

  function setGroupBusy(busy) {
    groupBusy = busy;
    document.querySelector("#group-form-send button").disabled = busy;
    $("btn-group-auto").disabled = busy;
  }

  $("group-form-send").addEventListener("submit", async (e) => {
    e.preventDefault();
    const g = group;
    const text = $("group-text").value.trim();
    if (!g || groupBusy || !text) return;
    $("group-text").value = "";
    addGroupMessage("me", text);
    if (window.hasBannedWord(text)) {
      addGroupMessage("system", window.CHAT_BANNED_REPLY[window.detectLang(text) || window.I18N.lang], null, false);
      return;
    }
    setGroupBusy(true);
    for (const m of pickResponders(groupMembers(g), text)) {
      if (group !== g) break;
      await speak(g, m, false);
    }
    setGroupBusy(false);
    window.track("group_message");
  });

  // 사용자가 지켜보는 동안 캐릭터끼리 세 마디 주고받기
  // AI로 대답하는 캐릭터가 둘 이상일 때만 (기본 대화 캐릭터는 먼저 말을 걸지 못함). 아니면 이유를 알려 줌
  $("btn-group-auto").addEventListener("click", async () => {
    const g = group;
    if (!g || groupBusy) return;
    const members = groupAiMembers(g);
    if (members.length < 2) { addGroupMessage("system", t("group.autoNeedAi"), null, false); return; }
    setGroupBusy(true);
    let last = (g.messages[g.messages.length - 1] || {}).who;
    for (let i = 0; i < 3 && group === g; i++) {
      const choices = members.filter((m) => m.id !== last);
      const m = choices[Math.floor(Math.random() * choices.length)];
      await speak(g, m, true);
      last = m.id;
    }
    setGroupBusy(false);
    window.track("group_auto");
  });
  $("btn-group-delete").addEventListener("click", () => {
    if (!group || !confirm(t("group.confirmDelete", { name: group.name }))) return;
    groups = groups.filter((g) => g !== group);
    saveGroups();
    location.hash = "#/groups";
  });
  $("group-back").addEventListener("click", () => (location.hash = "#/groups"));

  // ---------------------------------------------------------------- 나라별 공유 버튼 · QR 코드
  // 한국은 카카오톡, 일본·대만·태국은 LINE, 중화권은 WeChat(QR)·微博, 그 밖은 WhatsApp·X·Facebook
  const SOCIAL = {
    line: { label: "LINE", cls: "line", url: (u, text) => `https://social-plugins.line.me/lineit/share?url=${enc(u)}&text=${enc(text)}` },
    whatsapp: { label: "WhatsApp", cls: "whatsapp", url: (u, text) => `https://wa.me/?text=${enc(text + " " + u)}` },
    x: { label: "X", cls: "x", url: (u, text) => `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(u)}` },
    facebook: { label: "Facebook", cls: "facebook", url: (u) => `https://www.facebook.com/sharer/sharer.php?u=${enc(u)}` },
    weibo: { label: "微博 Weibo", cls: "weibo", url: (u, text) => `https://service.weibo.com/share/share.php?url=${enc(u)}&title=${enc(text)}` },
    wechat: { cls: "wechat", qr: true },
  };
  const SOCIAL_BY_REGION = { KR: [], line: ["line", "x"], zh: ["wechat", "weibo"], default: ["whatsapp", "x", "facebook"] };
  const enc = encodeURIComponent;

  function renderSocialButtons() {
    const region = window.I18N.region();
    $("btn-kakao").hidden = !(window.KakaoShare.enabled && region === "KR");
    $("btn-share-insta").hidden = region === "zh"; // 중국 본토에서는 인스타가 막혀 있음
    const box = $("share-social");
    box.innerHTML = "";
    for (const id of SOCIAL_BY_REGION[region]) {
      const s = SOCIAL[id];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `btn social ${s.cls}`;
      btn.textContent = s.qr ? t("share.wechat") : s.label;
      btn.addEventListener("click", () => {
        const link = $("share-link").value;
        window.track("share", { method: id });
        if (s.qr) { showQr(link, t("share.wechatHint")); return; }
        window.open(s.url(link, t("share.nativeText", { name: current.name })), "_blank", "noopener");
      });
      box.appendChild(btn);
    }
    box.hidden = !box.children.length;
  }

  let qrLib = null;
  function loadQrLib() {
    qrLib = qrLib || new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
      s.onload = () => resolve(window.QRCode);
      s.onerror = () => { qrLib = null; reject(new Error("qr")); };
      document.head.appendChild(s);
    });
    return qrLib;
  }
  async function showQr(link, hint) {
    $("qr-box").hidden = false;
    $("qr-hint").textContent = hint;
    const el = $("qr-code");
    el.innerHTML = "";
    try {
      const QRCode = await loadQrLib();
      new QRCode(el, { text: link, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
    } catch {
      el.textContent = link;
    }
  }
  $("btn-qr").addEventListener("click", () => {
    if (!$("qr-box").hidden) { $("qr-box").hidden = true; return; }
    showQr($("share-link").value, t("share.qrHint"));
  });
  window.addEventListener("aics:country", () => { if (!$("share-sheet").hidden && current) renderSocialButtons(); });

  // ---------------------------------------------------------------- 처음 온 사람용 사용법
  const TUTORIAL_KEY = "aics.tutorial.v1";
  const TUT_IMAGES = ["happy", "neutral", "embarrassed", "happy", "happy"];
  let tutStep = 0;

  function renderTutorial() {
    const n = tutStep + 1;
    const region = window.I18N.region();
    $("tut-img").src = `assets/haru/${TUT_IMAGES[tutStep]}.webp`;
    $("tut-title").textContent = t(`tut.${n}.title`);
    $("tut-body").innerHTML = t(`tut.${n}.body`, { apps: t(`tut.apps.${region}`) });
    $("tut-langs").hidden = tutStep !== 0;
    for (const b of $("tut-langs").children) b.classList.toggle("on", b.dataset.lang === window.I18N.lang);
    $("tut-dots").innerHTML = TUT_IMAGES.map((_, i) => `<i class="${i === tutStep ? "on" : ""}"></i>`).join("");
    $("tut-prev").hidden = tutStep === 0;
    $("tut-next").textContent = t(n === TUT_IMAGES.length ? "tut.start" : "tut.next");
  }
  function openTutorial() { tutStep = 0; renderTutorial(); $("tutorial").hidden = false; }
  function closeTutorial() {
    $("tutorial").hidden = true;
    try { localStorage.setItem(TUTORIAL_KEY, "1"); } catch { /* 비공개 창 */ }
  }
  function maybeShowTutorial() {
    let seen = false;
    try { seen = !!localStorage.getItem(TUTORIAL_KEY); } catch { /* 비공개 창 */ }
    if (!seen && $("tutorial").hidden) openTutorial();
  }
  for (const [code, name] of Object.entries(window.I18N.LANGS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.dataset.lang = code;
    b.textContent = name;
    b.addEventListener("click", () => window.I18N.setLang(code));
    $("tut-langs").appendChild(b);
  }
  $("tut-next").addEventListener("click", () => {
    if (tutStep === TUT_IMAGES.length - 1) { closeTutorial(); return; }
    tutStep++;
    renderTutorial();
  });
  $("tut-prev").addEventListener("click", () => { tutStep = Math.max(0, tutStep - 1); renderTutorial(); });
  $("tut-skip").addEventListener("click", closeTutorial);
  $("btn-help").addEventListener("click", openTutorial);

  // ---------------------------------------------------------------- 언어 바꾸기
  for (const [code, name] of Object.entries(window.I18N.LANGS)) $("lang-select").add(new Option(name, code));
  $("lang-select").value = window.I18N.lang;
  $("lang-select").addEventListener("change", () => window.I18N.setLang($("lang-select").value));

  // ---------------------------------------------------------------- 테마 바꾸기
  const THEME_KEY = "aics.theme.v1";
  const THEMES = { pink: ["🌸", "#ff6fa5"], light: ["🤍", "#f6f7f9"], dark: ["🌙", "#15141a"], halloween: ["🎃", "#1a1225"], christmas: ["🎄", "#0f2a1f"] };
  function fillThemeOptions() {
    const sel = $("theme-select"), cur = document.documentElement.dataset.theme || "pink";
    sel.innerHTML = "";
    for (const [code, [icon]] of Object.entries(THEMES)) sel.add(new Option(`${icon} ${t("theme." + code)}`, code));
    sel.value = cur;
  }
  function setTheme(code) {
    if (!THEMES[code]) code = "pink";
    if (code === "pink") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = code;
    document.querySelector('meta[name="theme-color"]').content = THEMES[code][1];
    try { localStorage.setItem(THEME_KEY, code); } catch { /* 비공개 창 */ }
  }
  fillThemeOptions();
  setTheme($("theme-select").value);
  $("theme-select").addEventListener("change", () => setTheme($("theme-select").value));

  function applyDynamicText() {
    fillThemeOptions();
    for (const o of $("ai-share-limit").options) {
      o.textContent = o.value === "custom" ? t("share.custom") : t("share.times", { n: o.value });
    }
    fillProviderOptions();
    renderModeChip();
    setTeachMode(teachQuestion);
  }
  window.addEventListener("aics:lang", () => {
    $("lang-select").value = window.I18N.lang;
    characters = loadCharacters(); // 하루의 이름·인사가 새 언어를 따르도록
    if (current) current = findChar(current.id) || current;
    applyDynamicText();
    if (!$("tutorial").hidden) renderTutorial();
    if ($("screen-chat").hidden) route(); // 대화 중이면 대화는 그대로 두고 글자만 바꿈
    else $("chat-name").textContent = current.name;
  });
  applyDynamicText();

  // 공유 링크(?c=ID)·"나도 만들기" 링크(?new=1)로 들어오면 앱 안의 주소(#/...)로 바꿔서 시작
  const params = new URLSearchParams(location.search);
  if (params.has("c") || params.has("new")) {
    const hash = params.has("c") ? "#/c/" + params.get("c") : "#/new";
    history.replaceState(null, "", location.pathname + hash);
  }
  route();
})();

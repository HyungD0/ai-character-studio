// 캐릭터 공유용 저장소.
// - Firebase(Firestore + 익명 로그인): 실제 배포용. 사진은 Firestore 문서 안에 압축 JPEG 로 저장
//   (Firebase Storage 는 유료 요금제가 필요해서 쓰지 않음, 문서 하나는 1MB 이하여야 함)
// - DevBackend: Firebase 설정이 없을 때 localhost 에서만 쓰는 가짜 서버(이 브라우저 저장소)
(function () {
  const SDK = "https://www.gstatic.com/firebasejs/11.0.2/";
  const MAX_DOC_BYTES = 900 * 1024;
  const MAX_NEW_PER_DAY = 20; // 기기 하나가 하루에 새로 공유할 수 있는 캐릭터 수. firestore.rules 의 maxNewPerDay() 와 같게
  const GALLERY_CACHE_MS = 5 * 60 * 1000; // 갤러리 목록을 다시 받지 않는 시간 (목록 한 번이 사진 포함 최대 약 500KB)

  // 공유용으로 사진을 한 번 더 줄임 (dataURL 이 아니면 그대로: 기본 캐릭터의 assets 경로 등)
  function recompress(src, maxSide, quality) {
    if (!src || !src.startsWith("data:")) return Promise.resolve(src);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        // 투명 이미지(PNG/WebP)는 투명도를 살려서 다시 저장
        const transparent = /^data:image\/(png|webp)/.test(src);
        resolve(window.ImageEditor.exportCanvas(canvas, transparent, quality));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });
  }

  // 링크 미리보기용 가로 사진: 서비스마다 가로로 잘라 보여 주므로 얼굴이 잘리지 않게 사진 전체를 가운데에 넣음
  // (투명 배경이 까맣게 보이거나 WebP 를 못 읽는 곳이 있어서 배경을 채운 JPEG 로 저장)
  function linkPreview(src) {
    if (!src) return Promise.resolve("");
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 420;
        const g = canvas.getContext("2d");
        g.fillStyle = "#fff5f8";
        g.fillRect(0, 0, canvas.width, canvas.height);
        const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
        const w = img.width * scale, h = img.height * scale;
        g.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => resolve("");
      img.src = src;
    });
  }

  // 이번 주 번호 (월요일 0시 한국 시간에 바뀜). firestore.rules 의 thisWeek() 와 같은 계산
  function weekKey() { return Math.floor((Date.now() + 291600000) / 604800000); }

  // 로컬 캐릭터 → 공유 문서. 호칭(만든 사람의 이름)·호감도는 공유하지 않음
  async function toSharedDoc(c) {
    const preview = await linkPreview(c.photo);
    for (const [side, q] of [[512, 0.8], [400, 0.7], [320, 0.6]]) {
      const slots = {};
      for (const [emo, src] of Object.entries(c.slots || {})) slots[emo] = await recompress(src, Math.round(side * 0.75), q);
      const doc = {
        name: c.name, persona: c.persona, greeting: c.greeting, sprite: !!c.sprite, bio: c.bio || "",
        aiShared: !!(c.aiShare && c.aiShare.enabled), // 친구도 만든 사람의 키로 AI 대화 가능 (키 자체는 중계 서버에만)
        speech: c.speech || "", birthday: c.birthday || "", customEmotions: (c.customEmotions || []).map(({ key, label }) => ({ key, label })),
        photo: await recompress(c.photo, side, q), slots, preview,
        background: c.background ? await recompress(c.background, Math.round(side * 1.6), q) : "",
      };
      if (new Blob([JSON.stringify(doc)]).size < MAX_DOC_BYTES) return doc; // 한글은 글자당 3바이트라 글자 수가 아닌 바이트로 셈
    }
    throw new Error(window.I18N.t("cloud.tooBig"));
  }

  class FirebaseBackend {
    constructor(config) { this.config = config; this.ready = null; }

    init() {
      if (!this.ready) {
        this.ready = (async () => {
          const [{ initializeApp }, auth, fs] = await Promise.all([
            import(SDK + "firebase-app.js"),
            import(SDK + "firebase-auth.js"),
            import(SDK + "firebase-firestore.js"),
          ]);
          const app = initializeApp(this.config);
          const a = auth.getAuth(app);
          if (!a.currentUser) await auth.signInAnonymously(a);
          this.auth = a;
          this.uid = a.currentUser.uid;
          this.db = fs.getFirestore(app);
          this.fs = fs;
        })();
      }
      return this.ready;
    }

    async save(doc, existingId) {
      await this.init();
      const { fs, db } = this;
      const data = { ...doc, ownerUid: this.uid, updatedAt: fs.serverTimestamp() };
      if (existingId) {
        try {
          // updateDoc: 조회수(views)·createdAt 은 그대로 두고 내용만 바꿈
          await fs.updateDoc(fs.doc(db, "characters", existingId), data);
          return existingId;
        } catch (e) {
          // 다른 기기에서 만든 캐릭터 등 수정 권한이 없으면 새로 등록
          console.warn("[cloud] 기존 문서 수정 실패, 새로 등록", e);
        }
      }
      const fresh = { ...data, views: 0, createdAt: fs.serverTimestamp() };
      const limitRef = fs.doc(db, "userLimits", this.uid);
      let limit;
      try {
        limit = await fs.getDoc(limitRef);
      } catch (e) {
        // 새 보안 규칙을 게시하기 전에는 userLimits 를 읽을 수 없음: 예전 방식으로 등록
        if (e.code !== "permission-denied") throw e;
        return (await fs.addDoc(fs.collection(db, "characters"), fresh)).id;
      }
      // 새 문서와 오늘 등록 횟수를 한 번에 씀 (보안 규칙이 짝이 맞는지 검사)
      const day = Math.floor(Date.now() / 86400000);
      const used = limit.exists() && limit.data().day === day ? limit.data().count : 0;
      if (used >= MAX_NEW_PER_DAY) throw new Error(window.I18N.t("cloud.dailyLimit", { n: MAX_NEW_PER_DAY }));
      const ref = fs.doc(fs.collection(db, "characters"));
      const batch = fs.writeBatch(db);
      batch.set(ref, fresh);
      batch.set(limitRef, { day, count: used + 1 });
      await batch.commit();
      return ref.id;
    }

    // 문서에서 글자·숫자 칸만 받기 (사진까지 받는 load 보다 훨씬 가벼움). 공개 문서라 로그인 없이 REST 로 읽음
    async peek(id, fields) {
      const mask = fields.map((f) => "mask.fieldPaths=" + encodeURIComponent(f)).join("&");
      const res = await fetch(`https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)/documents/characters/${encodeURIComponent(id)}?${mask}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("peek " + res.status);
      const out = {};
      for (const [k, v] of Object.entries((await res.json()).fields || {})) {
        out[k] = "integerValue" in v ? Number(v.integerValue) : v.booleanValue ?? v.stringValue ?? null;
      }
      return out;
    }

    // 중계 서버에 "내가 이 캐릭터의 주인"임을 증명하는 토큰
    async idToken() {
      await this.init();
      return this.auth.currentUser.getIdToken();
    }

    // 링크로 처음 들어온 사람 수 +1 (보안 규칙이 +1 만 허용)
    async addView(id) {
      await this.init();
      await this.fs.updateDoc(this.fs.doc(this.db, "characters", id), { views: this.fs.increment(1) });
    }

    async load(id) {
      await this.init();
      const snap = await this.fs.getDoc(this.fs.doc(this.db, "characters", id));
      return snap.exists() ? snap.data() : null;
    }

    async remove(id) {
      await this.init();
      // 갤러리 요약도 같이 지움. 공개한 적 없으면 지울 문서가 없어 규칙에서 거절되므로 실패해도 넘어감
      await this.fs.deleteDoc(this.fs.doc(this.db, "gallery", id)).catch(() => {});
      await this.fs.deleteDoc(this.fs.doc(this.db, "characters", id));
    }

    // ---------------- 공개 갤러리: gallery/{캐릭터 id} 에 이름·작은 사진만 따로 둠 (목록이 가볍게)
    async publish(id, summary) {
      await this.init();
      const { fs, db } = this;
      const ref = fs.doc(db, "gallery", id);
      const old = await fs.getDoc(ref);
      const data = { ...summary, ownerUid: this.uid, updatedAt: fs.serverTimestamp() };
      if (old.exists()) await fs.updateDoc(ref, data);
      else await fs.setDoc(ref, { ...data, views: 0, likes: 0, createdAt: fs.serverTimestamp() });
    }
    async unpublish(id) {
      await this.init();
      await this.fs.deleteDoc(this.fs.doc(this.db, "gallery", id));
    }
    async galleryDoc(id) {
      await this.init();
      const snap = await this.fs.getDoc(this.fs.doc(this.db, "gallery", id));
      return snap.exists() ? snap.data() : null;
    }
    async isPublished(id) {
      await this.init();
      return (await this.fs.getDoc(this.fs.doc(this.db, "gallery", id))).exists();
    }
    // sortBy: views(인기) / likes(전체 랭킹) / week(이번 주 랭킹) / createdAt(최신)
    async gallery(sortBy) {
      await this.init();
      const { fs, db } = this;
      const col = fs.collection(db, "gallery");
      if (sortBy === "week") {
        // 이번 주에 좋아요를 받은 캐릭터만 골라 화면에서 정렬 (복합 색인 없이)
        const q = fs.query(col, fs.where("weekKey", "==", weekKey()), fs.limit(60));
        return (await fs.getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.weekLikes || 0) - (a.weekLikes || 0)).slice(0, 30);
      }
      const field = ["likes", "createdAt"].includes(sortBy) ? sortBy : "views";
      const q = fs.query(col, fs.orderBy(field, "desc"), fs.limit(40));
      return (await fs.getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    // 좋아요: 기기마다 한 번. 내 좋아요 문서와 숫자를 한 번에 바꿈 (보안 규칙이 짝이 맞는지 검사)
    async liked(id) {
      await this.init();
      return (await this.fs.getDoc(this.fs.doc(this.db, "gallery", id, "likes", this.uid))).exists();
    }
    async setLike(id, on) {
      await this.init();
      const { fs, db } = this;
      const gRef = fs.doc(db, "gallery", id);
      const lRef = fs.doc(db, "gallery", id, "likes", this.uid);
      const g = (await fs.getDoc(gRef)).data() || {};
      const batch = fs.writeBatch(db);
      if (on) {
        const wk = weekKey();
        batch.set(lRef, { weekKey: wk, at: fs.serverTimestamp() });
        batch.update(gRef, g.weekKey === wk
          ? { likes: fs.increment(1), weekLikes: fs.increment(1) }
          : { likes: fs.increment(1), weekLikes: 1, weekKey: wk });
      } else {
        const mine = (await fs.getDoc(lRef)).data() || {};
        batch.delete(lRef);
        batch.update(gRef, mine.weekKey === g.weekKey
          ? { likes: fs.increment(-1), weekLikes: fs.increment(-1) }
          : { likes: fs.increment(-1) });
      }
      await batch.commit();
      const after = (await fs.getDoc(gRef)).data() || {};
      return after.likes || 0;
    }
    async addGalleryView(id) {
      await this.init();
      await this.fs.updateDoc(this.fs.doc(this.db, "gallery", id), { views: this.fs.increment(1) });
    }

    // ---------------- 공개 캐릭터 댓글: gallery/{id}/comments
    async comments(id, max = 50) {
      await this.init();
      const { fs, db } = this;
      const q = fs.query(fs.collection(db, "gallery", id, "comments"), fs.orderBy("createdAt", "desc"), fs.limit(max));
      return (await fs.getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
    }
    // 개수만 세면 문서를 내려받지 않아 읽기 1회로 끝남 (보안 규칙상 50개까지만 셈)
    async commentCount(id) {
      await this.init();
      const { fs, db } = this;
      const q = fs.query(fs.collection(db, "gallery", id, "comments"), fs.limit(50));
      return (await fs.getCountFromServer(q)).data().count;
    }
    async addComment(id, nick, text) {
      await this.init();
      const { fs, db } = this;
      await fs.addDoc(fs.collection(db, "gallery", id, "comments"), { uid: this.uid, nick, text, createdAt: fs.serverTimestamp() });
    }
    async deleteComment(id, cid) {
      await this.init();
      await this.fs.deleteDoc(this.fs.doc(this.db, "gallery", id, "comments", cid));
    }

    // ---------------- 관리자 (보안 규칙의 관리자 uid 만 성공)
    async reports() {
      await this.init();
      const { fs, db } = this;
      const q = fs.query(fs.collection(db, "reports"), fs.orderBy("createdAt", "desc"), fs.limit(50));
      return (await fs.getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
    }
    async dismissReport(id) {
      await this.init();
      await this.fs.deleteDoc(this.fs.doc(this.db, "reports", id));
    }
    async takeDown(characterId) {
      await this.init();
      const { fs, db } = this;
      await fs.deleteDoc(fs.doc(db, "gallery", characterId)).catch(() => {});
      await fs.deleteDoc(fs.doc(db, "characters", characterId));
    }

    async report(id, reason) {
      await this.init();
      await this.fs.addDoc(this.fs.collection(this.db, "reports"), {
        characterId: id, reason: String(reason).slice(0, 200), reporterUid: this.uid, createdAt: this.fs.serverTimestamp(),
      });
    }
  }

  // 개발용: 같은 브라우저의 다른 탭/새로고침에서만 "공유"가 보임
  class DevBackend {
    constructor() { this.key = "aics.devcloud.v1"; this.dev = true; }
    read() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; } }
    write(all) { localStorage.setItem(this.key, JSON.stringify(all)); }
    async save(doc, existingId) {
      const all = this.read();
      const id = existingId && all[existingId] ? existingId : "dev" + Math.random().toString(36).slice(2, 10);
      all[id] = { views: 0, ...all[id], ...doc };
      this.write(all);
      return id;
    }
    async addView(id) { const all = this.read(); if (all[id]) { all[id].views = (all[id].views || 0) + 1; this.write(all); } }
    async load(id) { return this.read()[id] || null; }
    async peek(id) { return this.read()[id] || null; }
    async remove(id) { const all = this.read(); delete all[id]; this.write(all); }
    async report(id, reason) { console.info("[dev cloud] 신고", id, reason); }
    async publish() {}
    async unpublish() {}
    async isPublished() { return false; }
    async galleryDoc() { return null; }
    async gallery() { return []; }
    async liked() { return false; }
    async setLike() { return 0; }
    async addGalleryView() {}
    async reports() { return []; }
  }

  const galleryCache = new Map();
  const commentCounts = new Map();
  const cfg = window.APP_CONFIG && window.APP_CONFIG.firebase;
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  window.Cloud = {
    backend: cfg ? new FirebaseBackend(cfg) : isLocal ? new DevBackend() : null,
    get enabled() { return !!this.backend; },
    get isDev() { return !!(this.backend && this.backend.dev); },
    async share(c) { return this.backend.save(await toSharedDoc(c), c.cloudId); },
    load(id) { return this.backend.load(id); },
    peek(id, fields) { return this.backend.peek(id, fields); },
    idToken() { return this.backend.idToken ? this.backend.idToken() : Promise.resolve(""); },
    addView(id) { return this.backend.addView(id); },
    async remove(id) { await this.backend.remove(id); galleryCache.clear(); },
    report(id, reason) { return this.backend.report(id, reason); },
    // 갤러리용 요약: 이름·첫인사·작은 사진(약 30KB)만
    async publish(c) {
      const thumb = await recompress(c.photo, 240, 0.7);
      const lang = window.detectLang(c.greeting) || window.I18N.lang;
      galleryCache.clear();
      return this.backend.publish(c.cloudId, { name: c.name, greeting: c.greeting || "", thumb, sprite: !!c.sprite, lang });
    },
    unpublish(id) { galleryCache.clear(); return this.backend.unpublish(id); },
    isPublished(id) { return this.backend.isPublished(id); },
    galleryDoc(id) { return this.backend.galleryDoc(id); },
    // 탭을 오가거나 캐릭터를 보고 돌아올 때마다 다시 받지 않도록 잠시 기억해 둠
    async gallery(sortBy) {
      const hit = galleryCache.get(sortBy);
      if (hit && Date.now() - hit.at < GALLERY_CACHE_MS) return hit.items;
      const items = await this.backend.gallery(sortBy);
      galleryCache.set(sortBy, { at: Date.now(), items });
      return items;
    },
    addGalleryView(id) { return this.backend.addGalleryView(id); },
    liked(id) { return this.backend.liked(id); },
    async setLike(id, on) {
      const likes = await this.backend.setLike(id, on);
      for (const { items } of galleryCache.values()) {
        for (const g of items) {
          if (g.id === id) { g.likes = likes; g.weekLikes = Math.max(0, (g.weekLikes || 0) + (on ? 1 : -1)); }
        }
      }
      return likes;
    },
    reports() { return this.backend.reports(); },
    comments(id) { return this.backend.comments(id); },
    // 갤러리 카드용 개수: 목록을 오갈 때마다 다시 세지 않도록 잠시 기억해 둠
    async commentCount(id) {
      const hit = commentCounts.get(id);
      if (hit && Date.now() - hit.at < GALLERY_CACHE_MS) return hit.count;
      const count = await this.backend.commentCount(id);
      this.noteCommentCount(id, count);
      return count;
    },
    noteCommentCount(id, count) { commentCounts.set(id, { at: Date.now(), count }); },
    // 대화 화면의 댓글 줄: 개수와 최신 댓글 하나
    async commentSummary(id) {
      const [count, [latest]] = await Promise.all([this.backend.commentCount(id), this.backend.comments(id, 1)]);
      this.noteCommentCount(id, count);
      return { count, latest };
    },
    addComment(id, nick, text) { return this.backend.addComment(id, nick, text); },
    deleteComment(id, cid) { return this.backend.deleteComment(id, cid); },
    dismissReport(id) { return this.backend.dismissReport(id); },
    takeDown(id) { galleryCache.clear(); return this.backend.takeDown(id); },
    async uid() { if (this.backend.init) await this.backend.init(); return this.backend.uid || ""; },
    get isAdmin() {
      const ids = (window.APP_CONFIG && window.APP_CONFIG.adminUids) || [];
      return !!(this.backend && this.backend.uid && ids.includes(this.backend.uid));
    },
  };
})();

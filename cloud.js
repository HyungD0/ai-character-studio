// 캐릭터 공유용 저장소.
// - Firebase(Firestore + 익명 로그인): 실제 배포용. 사진은 Firestore 문서 안에 압축 JPEG 로 저장
//   (Firebase Storage 는 유료 요금제가 필요해서 쓰지 않음, 문서 하나는 1MB 이하여야 함)
// - DevBackend: Firebase 설정이 없을 때 localhost 에서만 쓰는 가짜 서버(이 브라우저 저장소)
(function () {
  const SDK = "https://www.gstatic.com/firebasejs/11.0.2/";
  const MAX_DOC_BYTES = 900 * 1024;

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

  // 로컬 캐릭터 → 공유 문서. 호칭(만든 사람의 이름)·호감도는 공유하지 않음
  async function toSharedDoc(c) {
    for (const [side, q] of [[512, 0.8], [400, 0.7], [320, 0.6]]) {
      const slots = {};
      for (const [emo, src] of Object.entries(c.slots || {})) slots[emo] = await recompress(src, Math.round(side * 0.75), q);
      const doc = {
        name: c.name, persona: c.persona, greeting: c.greeting, sprite: !!c.sprite, bio: c.bio || "",
        photo: await recompress(c.photo, side, q), slots,
        background: c.background ? await recompress(c.background, Math.round(side * 1.6), q) : "",
      };
      if (JSON.stringify(doc).length < MAX_DOC_BYTES) return doc;
    }
    throw new Error("사진이 너무 커서 공유할 수 없어요. 표정별 사진 수를 줄여 주세요.");
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
      const ref = await fs.addDoc(fs.collection(db, "characters"), { ...data, views: 0, createdAt: fs.serverTimestamp() });
      return ref.id;
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
      await this.fs.deleteDoc(this.fs.doc(this.db, "characters", id));
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
    async remove(id) { const all = this.read(); delete all[id]; this.write(all); }
    async report(id, reason) { console.info("[dev cloud] 신고", id, reason); }
  }

  const cfg = window.APP_CONFIG && window.APP_CONFIG.firebase;
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  window.Cloud = {
    backend: cfg ? new FirebaseBackend(cfg) : isLocal ? new DevBackend() : null,
    get enabled() { return !!this.backend; },
    get isDev() { return !!(this.backend && this.backend.dev); },
    async share(c) { return this.backend.save(await toSharedDoc(c), c.cloudId); },
    load(id) { return this.backend.load(id); },
    addView(id) { return this.backend.addView(id); },
    remove(id) { return this.backend.remove(id); },
    report(id, reason) { return this.backend.report(id, reason); },
  };
})();

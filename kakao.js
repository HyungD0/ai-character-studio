// 카카오톡 공유 (Kakao JavaScript SDK). config.js 의 kakaoJsKey 가 있을 때만 동작합니다.
// 카카오 개발자 콘솔에 사이트 도메인(예: http://localhost:8080, https://아이디.github.io)을 등록해야 합니다.
(function () {
  const SDK_URL = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js";
  const key = window.APP_CONFIG && window.APP_CONFIG.kakaoJsKey;
  let ready = null;
  const t = window.I18N.t;

  function load() {
    if (!ready) {
      ready = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = SDK_URL;
        s.crossOrigin = "anonymous";
        s.onload = () => {
          if (!window.Kakao.isInitialized()) window.Kakao.init(key);
          resolve(window.Kakao);
        };
        s.onerror = () => { ready = null; reject(new Error(t("kakao.loadFail"))); };
        document.head.appendChild(s);
      });
    }
    return ready;
  }

  function dataUrlToFile(dataUrl) {
    const [head, body] = dataUrl.split(",");
    const mime = head.match(/:(.*?);/)[1];
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], "character.jpg", { type: mime });
  }

  // 카톡 미리보기 썸네일은 공개 URL 이어야 함 → 직접 올린 사진은 카카오 서버에 임시 업로드
  async function thumbnailUrl(Kakao, photo) {
    if (!photo.startsWith("data:")) return new URL(photo, location.href).href;
    const res = await Kakao.Share.uploadImage({ file: [dataUrlToFile(photo)] });
    return res.infos.original.url;
  }

  window.KakaoShare = {
    get enabled() { return !!key; },
    // 페이지가 열릴 때 미리 SDK 로드 (버튼 누른 직후 팝업이 차단되지 않도록)
    preload() { if (key) load().catch((e) => console.warn("[kakao]", e)); },

    // 공유 시트가 열릴 때 미리 썸네일을 올려 둠. 버튼 클릭 후 기다리면 브라우저가 팝업을 막기 때문
    prepare(character) {
      if (!key) return;
      if (this.prepared && this.prepared.photo === character.photo) return;
      const entry = { photo: character.photo, url: null };
      this.prepared = entry;
      load()
        .then((Kakao) => thumbnailUrl(Kakao, character.photo))
        .then((url) => { entry.url = url; })
        .catch((e) => console.warn("[kakao] 썸네일 준비 실패", e));
    },

    // 대화 카드 이미지를 미리 카카오 서버에 올려 둠 (완료되면 Promise 가 URL 로 끝남)
    async prepareCard(blob) {
      const Kakao = await load();
      const res = await Kakao.Share.uploadImage({ file: [new File([blob], "card.png", { type: "image/png" })] });
      return res.infos.original.url;
    },

    // 클릭 이벤트 안에서 바로(await 없이) 호출해야 팝업이 열림
    // card: { imageUrl, affection } 를 주면 대화 카드 이미지로 보냄
    share(character, link, card) {
      const Kakao = window.Kakao;
      const p = this.prepared;
      if (!Kakao || !Kakao.isInitialized()) throw new Error(t("kakao.notReady"));
      const uploaded = p && p.photo === character.photo && p.url;
      const relay = window.AiChat.relayUrl;
      const imageUrl = card ? card.imageUrl
        : uploaded ? uploaded
        : character.cloudId && relay ? `${relay}/img/${character.cloudId}` // 업로드가 아직이면 중계 서버의 캐릭터 사진
        : new URL("assets/haru/happy.webp", location.href).href;
      const fromRelay = !card && !uploaded && character.cloudId && relay;
      Kakao.Share.sendDefault({
        objectType: "feed",
        content: {
          title: card
            ? t("kakao.cardTitle", { name: character.name, n: card.affection })
            : t("kakao.title", { name: character.name }),
          description: card
            ? t("kakao.cardDesc")
            : t("kakao.desc"),
          imageUrl,
          imageWidth: card ? 1080 : fromRelay ? 800 : 600,
          imageHeight: card ? 1350 : fromRelay ? 420 : 800,
          link: { mobileWebUrl: link, webUrl: link },
        },
        buttons: [
          { title: t("kakao.go"), link: { mobileWebUrl: link, webUrl: link } },
          {
            title: t("kakao.make"),
            link: { mobileWebUrl: location.origin + location.pathname + "?new=1", webUrl: location.origin + location.pathname + "?new=1" },
          },
        ],
      });
    },
  };
})();

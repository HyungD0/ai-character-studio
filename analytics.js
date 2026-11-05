// 방문 통계 (Google Analytics 4). config.js 의 gaMeasurementId 가 있을 때만 동작합니다.
// 화면 종류(홈/만들기/대화/공유 링크)만 보내고, 캐릭터 이름·대화 내용·공유 id 는 보내지 않습니다.
(function () {
  const id = window.APP_CONFIG && window.APP_CONFIG.gaMeasurementId;
  window.track = () => {};
  if (!id || !/^G-[A-Z0-9]+$/.test(id) || /^(localhost|127\.)/.test(location.hostname)) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  gtag("js", new Date());
  gtag("config", id, { send_page_view: false });
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
  document.head.appendChild(s);

  const SCREENS = { "": "home", new: "create", edit: "edit", chat: "chat", c: "shared_link" };
  function pageView() {
    const screen = SCREENS[location.hash.split("/")[1] || ""] || "home";
    gtag("event", "page_view", {
      page_title: screen,
      page_location: location.origin + location.pathname + "#/" + screen,
      ui_language: window.I18N.lang,
    });
  }
  pageView();
  window.addEventListener("hashchange", pageView);

  // 주요 행동: 캐릭터 만들기, 공유 방법, AI 대화 켜기 등
  window.track = (name, params) => gtag("event", name, params || {});
})();

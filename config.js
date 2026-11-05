// 배포 설정. 비워 둔 항목은 꺼진 상태로 동작합니다.
window.APP_CONFIG = {
  // 구글 스프레드시트(밤티 계정 "AI 캐릭터 대화 DB") Apps Script 웹 앱 주소 (README.md 참고)
  // 사용자가 가르친 대답은 시트 "대화" 탭에 pending 으로 쌓이고, 상태를 approved 로 바꾸면 모두에게 반영됨
  sheetUrl: "https://script.google.com/macros/s/AKfycbyQrjonsOhZkkZF1P6XAu5xu3BRs3w1zzwDLtl1wd4v4wQCE0t9Bd-eRJt8mSdeUDys/exec",

  // AI 대화 중계 서버 (Cloudflare Worker, web/relay/worker.js). 만든 사람이 허용하면 친구가 그 사람의 키로 AI 대화
  relayUrl: "https://ai-character-relay.bamtistudio.workers.dev",

  // Google Analytics 4 측정 ID (예: G-XXXXXXXXXX). 비워 두면 방문 통계를 보내지 않음
  gaMeasurementId: "G-BFJEDT5S4T",

  // 관리자(신고 처리 화면)로 인정할 익명 로그인 uid. firebase/firestore.rules 의 isAdmin() 과 같아야 함
  adminUids: ["WbUKEXAuLvb8TXE0rLDz8nBqoJY2"],

  // 카카오 JavaScript 키 (developers.kakao.com → 내 애플리케이션 → 앱 키). 비워 두면 카톡 버튼이 숨겨짐
  // (웹용 공개 키. 등록한 도메인에서만 동작하므로 노출돼도 괜찮음)
  kakaoJsKey: "fa2f7b6627e4d4eea745da83f23bbde7",

  // Firebase 웹 앱 설정 (README.md 참고). 비워 두면 localhost 에서만 "개발용 가짜 서버"로 공유 흐름을 시험할 수 있음
  // (웹 앱용 공개 식별값이라 사이트에 노출돼도 괜찮음. 보안은 firebase/firestore.rules 가 담당)
  firebase: {
    apiKey: "AIzaSyC2A0jdBR0QrXTb3dEjW2wlsaKG78V_gBM",
    authDomain: "ai-character-studio-fd38a.firebaseapp.com",
    projectId: "ai-character-studio-fd38a",
    storageBucket: "ai-character-studio-fd38a.firebasestorage.app",
    messagingSenderId: "713157013642",
    appId: "1:713157013642:web:edcc87a69d9de7b0593d73",
  },
};

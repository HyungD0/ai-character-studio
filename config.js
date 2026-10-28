// 배포 설정. 비워 둔 항목은 꺼진 상태로 동작합니다.
window.APP_CONFIG = {
  // 구글 스프레드시트 Apps Script 웹 앱 주소 (README.md 참고)
  // 예: "https://script.google.com/macros/s/AKfy.../exec"
  sheetUrl: "",

  // Firebase 웹 앱 설정 (README.md 참고). 콘솔의 "SDK 설정 및 구성"에 나오는 객체를 그대로 붙여넣기.
  // 비워 두면 localhost 에서만 "개발용 가짜 서버"(이 브라우저 저장소)로 공유 흐름을 시험할 수 있습니다.
  // 카카오 JavaScript 키 (developers.kakao.com → 내 애플리케이션 → 앱 키). 비워 두면 카톡 버튼이 숨겨짐
  // (웹용 공개 키. 등록한 도메인에서만 동작하므로 노출돼도 괜찮음)
  kakaoJsKey: "fa2f7b6627e4d4eea745da83f23bbde7",

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

// 기본 대화 DB (API 없이 동작). 구글 시트에서 불러온 행이 여기에 더해집니다.
// keywords: 띄어쓰기를 무시하고 포함 여부로 찾음 / emotion: neutral|happy|sad|embarrassed|angry
// affection: 호감도 변화 / {user} = 호칭(없으면 "너"), {name} = 캐릭터 이름
window.CHAT_DB = [
  { keywords: ["안녕", "하이", "ㅎㅇ", "반가"], emotion: "happy", affection: 1,
    replies: ["안녕, {user}! 기다리고 있었어.", "왔구나! 오늘 하루는 어땠어?", "헤헤, 반가워! 무슨 얘기 할까?"] },
  { keywords: ["잘자", "굿밤", "자러", "졸려"], emotion: "happy", affection: 1,
    replies: ["벌써 잘 시간이야? 잘 자, {user}. 좋은 꿈 꿔!", "푹 자고 내일 또 얘기하자!"] },
  { keywords: ["뭐해", "머해", "뭐하고"], emotion: "neutral", affection: 0,
    replies: ["{user}(이)랑 얘기하고 있지! 너는?", "음… 너 기다리는 중이었어."] },
  { keywords: ["밥", "먹었", "배고파", "점심", "저녁"], emotion: "happy", affection: 1,
    replies: ["밥은 꼭 챙겨 먹어야 해! 뭐 먹었어?", "나도 배고파졌어… 맛있는 거 먹자!"] },
  { keywords: ["귀여", "귀엽", "예쁘", "예뻐", "이쁘", "이뻐", "좋아해", "사랑", "멋지", "최고", "보고싶"], emotion: "embarrassed", affection: 3,
    replies: ["에, 에엑?! 갑자기 그런 말 하면 어떡해… 헤헤.", "그, 그런 말은 반칙이야! 얼굴 빨개졌잖아…", "…나도. 아, 아무것도 아니야!"] },
  { keywords: ["슬퍼", "우울", "힘들", "피곤", "망했", "떨어졌", "속상"], emotion: "sad", affection: 1,
    replies: ["그랬구나… 많이 힘들었겠다. 오늘은 내가 얘기 들어줄게.", "에휴, 나까지 마음이 아프네. 좀 쉬었다 하자.", "괜찮아, {user}. 넌 충분히 잘하고 있어."] },
  { keywords: ["바보", "싫어", "짜증", "멍청", "꺼져"], emotion: "angry", affection: -2,
    replies: ["흥! 그런 말 하면 나 진짜 화낸다?", "지금 그 말, 조금 서운한데… 사과해!"] },
  { keywords: ["미안", "사과", "잘못했"], emotion: "embarrassed", affection: 2,
    replies: ["…알았어, 이번만 봐줄게.", "흥, 사과하니까 용서해 줄게. 다음엔 안 돼!"] },
  { keywords: ["고마", "감사", "땡큐"], emotion: "happy", affection: 2,
    replies: ["에이, 뭘! 언제든지 말해.", "헤헤, 도움이 됐다니 기뻐!"] },
  { keywords: ["성공", "합격", "a+", "에이플", "칭찬받"], emotion: "happy", affection: 2,
    replies: ["우와, 진짜?! 축하해, {user}! 내가 다 뿌듯해!", "역시 내가 믿었다니까! 오늘은 축하 파티다!"] },
  { keywords: ["게임", "롤", "배그", "닌텐도"], emotion: "happy", affection: 1,
    replies: ["게임 얘기라면 나 자신 있어! 요즘 뭐 해?", "같이 하자! 나 은근 잘한다?"] },
  { keywords: ["케이크", "디저트", "마카롱", "아이스크림", "카페"], emotion: "happy", affection: 1,
    replies: ["디저트는 못 참지! 다음에 같이 가자!", "그거 완전 내 취향이야!"] },
  { keywords: ["날씨", "비와", "비가", "더워", "추워"], emotion: "neutral", affection: 0,
    replies: ["감기 조심해! 따뜻하게 입고 다녀.", "이런 날엔 집에서 쉬는 게 최고야."] },
  { keywords: ["너이름", "니이름", "이름이뭐", "누구야"], emotion: "happy", affection: 0,
    replies: ["내 이름? {name}(이)야! 벌써 잊은 거 아니지?"] },
  { keywords: ["ai야", "ai지", "로봇", "사람이야"], emotion: "embarrassed", affection: 0,
    replies: ["음… 그런 건 비밀로 해 두자. 대화가 즐거우면 됐지!"] },
];

// 아무 키워드도 맞지 않을 때
window.CHAT_FALLBACK = [
  "음, 그렇구나. 조금 더 자세히 말해 줄래?",
  "아하, 이해했어. 그래서 어떻게 됐어?",
  "흠흠… 그건 처음 들어 봐!",
];

// 공개 서비스용 금칙어 (학습·출력 모두 차단). 필요하면 더 추가하세요.
window.BANNED_WORDS = ["시발", "씨발", "ㅅㅂ", "병신", "ㅂㅅ", "좆", "섹스", "자살", "죽어", "개새", "fuck", "sex"];

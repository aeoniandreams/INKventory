// Firebase 웹 앱 설정 — 공개되어도 안전한 값입니다 (보안은 Firestore 보안 규칙이 담당).
// Firebase 콘솔 → 프로젝트 설정 → 내 앱 → SDK 설정에서 복사해 붙여 넣으세요.
window.INKVENTORY_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyAwaLbABzzlWoQpytou2G8RGwRfNJRYNDs',
    authDomain: 'inkventory-42cb6.firebaseapp.com',
    projectId: 'inkventory-42cb6',
    appId: '1:566931324501:web:eb2829a2d9c752d6151edc',
  },
  // 발색 사진 폴더(구글 드라이브, "링크가 있는 모든 사용자" 공개). 사진 파일 이름을 "브랜드 잉크명" 으로 지으면 해당 잉크에 연결된다.
  // apiKey 는 Drive API 전용 + 이 사이트 주소에서만 쓰도록 제한한 공개용 키입니다.
  drive: {
    apiKey: 'AIzaSyBczSN4UX_AGSPP65Eo1bTh4njX8xLoBeg',
    folderId: '1LrpJIpu031-zs1tme75ue3bcT99miqvm',
  },
  // 관리자 구글 계정의 UID. 비워 둔 채 한 번 로그인하면 화면에 UID가 표시됩니다.
  adminUid: 'oQMylq7c4jT92pEQleX3cl7sAaj2',
};

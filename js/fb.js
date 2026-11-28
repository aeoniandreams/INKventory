// Firebase SDK 지연 로더. 필요한 모듈만, 필요한 시점에 한 번만 불러온다.
//   INKFB.auth() → { auth, ...firebase-auth 함수들 }   (로그인/관리자 판별)
//   INKFB.db()   → { db,   ...firebase-firestore 함수들 } (데이터 읽기/쓰기)
(() => {
  'use strict';

  const VER = '10.14.1';
  const BASE = `https://www.gstatic.com/firebasejs/${VER}/`;
  const cfg = window.INKVENTORY_CONFIG || {};

  const modules = {};
  const load = (name) => (modules[name] = modules[name] || import(BASE + name + '.js'));

  let appP = null;
  let authP = null;
  let dbP = null;

  function app() {
    if (!appP) {
      appP = (async () => {
        if (!cfg.firebase || !cfg.firebase.apiKey) throw new Error('not-configured');
        const { initializeApp } = await load('firebase-app');
        return initializeApp(cfg.firebase);
      })();
      appP.catch(() => { appP = null; });
    }
    return appP;
  }

  function auth() {
    if (!authP) {
      authP = (async () => {
        const [a, m] = await Promise.all([app(), load('firebase-auth')]);
        const instance = m.getAuth(a);
        await m.setPersistence(instance, m.browserLocalPersistence);   // 브라우저를 껐다 켜도 로그인 유지 (최대 며칠인지는 js/app.js 의 LOGIN_DAYS)
        return { auth: instance, ...m };
      })();
      authP.catch(() => { authP = null; });
    }
    return authP;
  }

  function db() {
    if (!dbP) {
      dbP = (async () => {
        const [a, m] = await Promise.all([app(), load('firebase-firestore')]);
        // 폰·와이파이·일부 통신망에서는 Firestore 의 기본 연결(WebChannel 스트림)이 멈춰서 저장이 끝나지 않는 일이 있다.
        // 연결이 막히면 자동으로 롱폴링으로 바꾸도록 한다. (이미 만들어진 뒤라 설정이 안 먹으면 기본 설정 그대로)
        let fs;
        try { fs = m.initializeFirestore(a, { experimentalAutoDetectLongPolling: true }); } catch (e) { fs = m.getFirestore(a); }
        return { db: fs, ...m };
      })();
      dbP.catch(() => { dbP = null; });
    }
    return dbP;
  }

  // Firestore 의 쓰기(setDoc)는 서버가 받았다고 답해야 끝난다. 네트워크가 끊기거나 연결이 멈추면 성공도 실패도 하지 않고 계속 기다려서
  // "저장 중…" 이 끝나지 않고 뒤의 저장도 모두 막힌다. 정해 둔 시간 안에 안 끝나면 실패({ code: 'timeout' })로 보고 다시 시도하게 한다.
  function withTimeout(p, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject({ code: 'timeout' }), ms || 20000);
      Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }

  window.INKFB = { auth, db, withTimeout };
})();

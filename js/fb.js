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
        return { db: m.getFirestore(a), ...m };
      })();
      dbP.catch(() => { dbP = null; });
    }
    return dbP;
  }

  window.INKFB = { auth, db };
})();

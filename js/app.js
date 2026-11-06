(() => {
  'use strict';

  // 사이드바 카테고리 구조. 새 카테고리는 여기에만 추가하면 된다.
  const NAV = [
    {
      id: 'ink', label: 'INK',
      items: [
        { id: 'ink-owned',  label: '보유 잉크' },
        { id: 'ink-sale',   label: '잉팔잉사' },
        { id: 'ink-wish',   label: '위시' },
      ],
    },
    {
      id: 'pen', label: 'FOUNTAIN PEN',
      items: [
        { id: 'pen-owned', label: '보유 만년필' },
        { id: 'pen-wish',  label: '위시' },
      ],
    },
  ];

  const $ = (sel) => document.querySelector(sel);
  const sidebar = $('#sidebar');
  const nav = $('#nav');
  const main = $('#main');
  const pageTitle = $('#pageTitle');
  const toggleBtn = $('#sidebarToggle');
  const closeBtn = $('#sidebarClose');
  const backdrop = $('#backdrop');

  // 카테고리별 화면 모듈 (js/views/*.js 가 등록). 등록 안 된 항목은 "준비 중" 화면.
  const VIEWS = window.INKVENTORY_VIEWS || {};
  let currentView = null;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  const CHEVRON = '<svg class="nav__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  // ── 네비게이션 렌더 ─────────────────────
  function renderNav() {
    nav.innerHTML = NAV.map((g) => {
      const open = store.get('inkventory.group.' + g.id) !== 'closed';
      return `
        <section class="nav__group" data-id="${g.id}" data-open="${open}">
          <button class="nav__group-btn" type="button" aria-expanded="${open}" aria-controls="list-${g.id}">
            <span>${g.label}</span>${CHEVRON}
          </button>
          <div class="nav__list-wrap">
            <ul class="nav__list" id="list-${g.id}">
              ${g.items.map((i) => `<li><a class="nav__link" href="#/${i.id}" data-id="${i.id}">${i.label}</a></li>`).join('')}
            </ul>
          </div>
        </section>`;
    }).join('');

    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav__group-btn');
      if (btn) {
        const group = btn.closest('.nav__group');
        const open = group.dataset.open !== 'true';
        group.dataset.open = open;
        btn.setAttribute('aria-expanded', open);
        store.set('inkventory.group.' + group.dataset.id, open ? 'open' : 'closed');
        return;
      }
      if (e.target.closest('.nav__link')) setSidebar(false);
    });
  }

  // ── 사이드바 열기/닫기 (본문 위에 덮이는 오버레이) ──
  function isOpen() {
    return sidebar.classList.contains('is-open');
  }

  function setSidebar(open) {
    sidebar.classList.toggle('is-open', open);
    backdrop.classList.toggle('is-visible', open);
    toggleBtn.setAttribute('aria-expanded', open);
    if (open) closeBtn.focus({ preventScroll: true });
    else if (sidebar.contains(document.activeElement)) toggleBtn.focus({ preventScroll: true });
  }

  toggleBtn.addEventListener('click', () => setSidebar(!isOpen()));
  closeBtn.addEventListener('click', () => setSidebar(false));
  backdrop.addEventListener('click', () => setSidebar(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen() && !authDialog.open) setSidebar(false);
  });

  // ── 일반 / 관리자 모드 (Firebase Authentication · Google 로그인) ──
  // 관리자 = config.js 의 adminUid 와 UID 가 같은 구글 계정 한 개.
  // 화면 표시는 편의일 뿐이고, 실제 수정 권한은 Firestore 보안 규칙(서버)에서 같은 UID 로 막는다.
  const HINT_KEY = 'inkventory.signedin';   // 이 탭에서 로그인한 적이 있음 → 시작할 때 SDK 미리 로드
  const REDIRECT_KEY = 'inkventory.redirect';
  const cfg = window.INKVENTORY_CONFIG || {};

  const idBtn = $('#idBtn');
  const modeTag = $('#modeTag');
  const authDialog = $('#authDialog');
  const authError = $('#authError');
  const googleBtn = $('#googleBtn');
  const logoutBtn = $('#logoutBtn');

  const session = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) {} },
  };

  let isAdmin = false;
  let fb = null; // 로드된 Firebase SDK

  function applyMode() {
    document.documentElement.dataset.mode = isAdmin ? 'admin' : 'normal';
    modeTag.hidden = !isAdmin;
    logoutBtn.hidden = !isAdmin;
    idBtn.disabled = isAdmin; // 관리자 모드에서는 아이디를 눌러도 아무 일도 일어나지 않음
    idBtn.title = isAdmin ? '' : '관리자 모드로 전환';
    if (currentView && currentView.onMode) currentView.onMode(isAdmin);
  }

  // 일반 방문자는 로그인 SDK 를 받지 않도록, 로그인이 필요할 때만 불러온다. (js/fb.js)
  let fbPromise = null;
  function loadFirebase() {
    if (!fbPromise) {
      fbPromise = (async () => {
        fb = await INKFB.auth();
        fb.onAuthStateChanged(fb.auth, (user) => {
          isAdmin = !!user && !!cfg.adminUid && user.uid === cfg.adminUid;
          if (isAdmin) session.set(HINT_KEY, '1'); else session.del(HINT_KEY);
          applyMode();
        });
        return fb;
      })();
      fbPromise.catch(() => { fbPromise = null; });
    }
    return fbPromise;
  }

  function showError(msg) {
    authError.textContent = msg;
    authError.hidden = false;
  }

  function setBusy(busy) {
    googleBtn.disabled = busy;
    googleBtn.textContent = busy ? 'LOGGING IN…' : 'LOGIN';
  }

  function openAuth() {
    if (isAdmin) return;
    authError.hidden = true;
    setBusy(false);
    authDialog.showModal();
  }

  // 로그인 직후 확인: 관리자 계정이 아니면 즉시 로그아웃
  async function checkSignedIn(user) {
    if (!user) return;
    if (!cfg.adminUid) {
      showError(`관리자 UID가 아직 설정되지 않았습니다. 이 계정의 UID: ${user.uid}  (js/config.js 의 adminUid 와 Firestore 규칙에 넣어 주세요)`);
      await fb.signOut(fb.auth);
      return;
    }
    if (user.uid !== cfg.adminUid) {
      showError('관리자 계정이 아닙니다.');
      await fb.signOut(fb.auth);
      return;
    }
    authDialog.close();
  }

  async function signIn() {
    if (googleBtn.disabled) return;
    authError.hidden = true;
    setBusy(true);
    try {
      await loadFirebase();
      const provider = new fb.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        const res = await fb.signInWithPopup(fb.auth, provider);
        await checkSignedIn(res.user);
      } catch (err) {
        if (err.code === 'auth/popup-blocked') {
          session.set(REDIRECT_KEY, '1');
          await fb.signInWithRedirect(fb.auth, provider); // 팝업이 막히면 페이지 이동 방식으로
          return;
        }
        throw err;
      }
    } catch (err) {
      if (err.message === 'not-configured') showError('Firebase 설정이 아직 입력되지 않았습니다. (js/config.js)');
      else if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') { /* 사용자가 창을 닫음 */ }
      else if (err.code === 'auth/unauthorized-domain') showError('이 주소가 Firebase 승인된 도메인에 등록되지 않았습니다.');
      else showError('로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  // 안내 없이 즉시 일반 모드로 전환
  async function signOut() {
    isAdmin = false;
    session.del(HINT_KEY);
    applyMode();
    try {
      if (fb) await fb.signOut(fb.auth);
    } catch (err) { /* 화면은 이미 일반 모드. 서버 세션은 탭을 닫으면 사라짐 */ }
  }

  idBtn.addEventListener('click', openAuth);
  googleBtn.addEventListener('click', signIn);
  logoutBtn.addEventListener('click', signOut);
  authDialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => authDialog.close()));
  authDialog.addEventListener('click', (e) => { if (e.target === authDialog) authDialog.close(); }); // 바깥(backdrop) 클릭

  applyMode();

  // 이 탭에서 로그인한 적이 있거나 리다이렉트로 돌아온 경우에만 시작할 때 SDK 로드
  if (session.get(HINT_KEY) || session.get(REDIRECT_KEY)) {
    const fromRedirect = !!session.get(REDIRECT_KEY);
    loadFirebase().then(async () => {
      if (!fromRedirect) return;
      session.del(REDIRECT_KEY);
      try {
        const res = await fb.getRedirectResult(fb.auth);
        if (res && res.user) { openAuth(); await checkSignedIn(res.user); if (authError.hidden) return; }
      } catch (e) { /* 무시: 일반 모드 유지 */ }
    }).catch(() => {});
  }

  // ── 라우팅 (해시) ───────────────────────
  function findItem(id) {
    for (const g of NAV) {
      const item = g.items.find((i) => i.id === id);
      if (item) return { group: g, item };
    }
    return null;
  }

  function render() {
    const id = location.hash.replace(/^#\/?/, '');
    const found = findItem(id);

    nav.querySelectorAll('.nav__link').forEach((a) => {
      if (found && a.dataset.id === id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    if (currentView && currentView.unmount) currentView.unmount();
    currentView = null;
    main.className = 'main';
    const view = found && VIEWS[id];

    if (view) {
      pageTitle.textContent = `${found.group.label} · ${found.item.label}`;
      document.title = `${found.item.label} – INKventory`;
      main.replaceChildren();
      main.classList.add('main--table');
      view.mount(main, { isAdmin });
      currentView = view;
    } else if (found) {
      pageTitle.textContent = `${found.group.label} · ${found.item.label}`;
      document.title = `${found.item.label} – INKventory`;
      main.innerHTML = `
        <div class="placeholder view-enter">
          <div class="crumb">${found.group.label}</div>
          <h2>${found.item.label}</h2>
          <p>준비 중입니다.</p>
        </div>`;
    } else {
      pageTitle.textContent = '홈';
      document.title = 'INKventory';
      // 임시 시작 화면 — 내용은 추후 추가
      main.innerHTML = `
        <div class="hero view-enter">
          <div class="hero__mark" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c3.5 4.2 6 7.3 6 10.5a6 6 0 0 1-12 0C6 10.3 8.5 7.2 12 3Z"/></svg>
          </div>
          <h1>INKventory</h1>
          <p>잉크와 만년필 인벤토리 — 곧 채워질 예정입니다.</p>
        </div>`;
    }
    main.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', render);

  renderNav();
  render();
})();

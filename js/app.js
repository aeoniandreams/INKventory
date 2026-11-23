(() => {
  'use strict';

  // 사이드바 카테고리 구조. 새 카테고리는 여기에만 추가하면 된다.
  const NAV = [
    {
      id: 'own', label: 'OWN', icon: 'img/home/ink.png',
      items: [
        { id: 'ink-owned', label: '잉크' },       // 보유 잉크
        { id: 'pen-owned', label: '만년필' },     // 보유 만년필
      ],
    },
    // SELL: 2차 카테고리 잉팔잉사. 아이콘은 Lucide "store" (lucide.dev, ISC 라이선스)로, 다른 아이콘 이미지와 같은 크기·선 굵기로 시작 화면에서 그린다.
    // title: 그 화면의 상단 바·탭 제목 (카테고리 이름 SELL 을 붙이지 않고 '잉팔잉사' 그대로)
    {
      id: 'sale', label: 'SELL',
      iconSvg: '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>',
      items: [
        { id: 'ink-sale', label: '잉팔잉사', title: '잉팔잉사' },
      ],
    },
    // (2차 카테고리 없이 누르면 바로 화면으로 들어가는 1차 카테고리는 route: '화면 주소' 로 쓴다)
    // WISH: 관리자 모드에서만 보인다 (adminOnly). 일반 모드에서는 사이드바·시작 화면에 나오지 않고, 주소로 들어와도 시작 화면으로 돌려보낸다.
    {
      id: 'wish', label: 'WISH', icon: 'img/home/wish.png', adminOnly: true,
      items: [
        { id: 'wish-ink', label: '잉크' },
        { id: 'wish-pen', label: '만년필' },
      ],
    },
    // NEW ARRIVALS: 얻은 잉크·만년필과 얻은 날짜 목록 (관리자 모드에서만 보인다). 아이콘은 Lucide "package-plus" (lucide.dev, ISC 라이선스).
    {
      id: 'arrivals', label: 'NEW ARRIVALS', adminOnly: true,
      iconSvg: '<path d="M12 22V12"/><path d="M16 17h6"/><path d="M19 14v6"/><path d="M21 10.535V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l1.675-.955"/><path d="M3.29 7 12 12l8.71-5"/><path d="m7.5 4.27 8.997 5.148"/>',
      items: [
        { id: 'arrivals-ink', label: '잉크' },
        { id: 'arrivals-pen', label: '만년필' },
      ],
    },
  ];

  const ROUTE_ALIAS = { wish: 'wish-ink' };   // 예전 주소(#/wish)로 들어와도 열리게

  const $ = (sel) => document.querySelector(sel);
  const sidebar = $('#sidebar');
  const nav = $('#nav');
  const main = $('#main');
  const pageTitle = $('#pageTitle');
  const toggleBtn = $('#sidebarToggle');
  const collapseBtn = $('#sidebarCollapse');   // 사이드바 안의 닫기 아이콘 (없어도 앱은 동작)
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
  // 지금 모드에서 보여 줄 1차 카테고리 (adminOnly 는 관리자 모드에서만)
  const visibleNav = () => NAV.filter((g) => !g.adminOnly || isAdmin);

  function renderNav() {
    nav.innerHTML = visibleNav().map((g) => {
      if (g.route) {
        return `
        <section class="nav__group" data-id="${g.id}">
          <a class="nav__group-btn nav__group-btn--link" href="#/${g.route}" data-id="${g.route}"><span>${g.navLabel || g.label}</span></a>
        </section>`;
      }
      const open = false;   // 사이드바는 늘 1차 카테고리만 보이는 모습으로 시작하고, 펼친 상태는 기억하지 않는다 (사이드바를 닫으면 다시 접힘)
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
  }

  // 사이드바 클릭 (한 번만 등록: 카테고리 펼치기/접기, 항목을 누르면 사이드바 닫기)
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav__group-btn:not(.nav__group-btn--link)');
    if (btn) {
      const group = btn.closest('.nav__group');
      const open = group.dataset.open !== 'true';
      group.dataset.open = open;
      btn.setAttribute('aria-expanded', open);
      return;
    }
    if (e.target.closest('.nav__link, .nav__group-btn--link')) setSidebar(false);
  });

  // 사이드바에서 지금 보고 있는 화면 표시
  function markCurrent(id) {
    const found = findItem(id);
    nav.querySelectorAll('.nav__link, .nav__group-btn--link').forEach((a) => {
      if (found && a.dataset.id === id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  // ── 사이드바 열기/닫기 (본문 위에 덮이는 오버레이) ──
  function isOpen() {
    return sidebar.classList.contains('is-open');
  }

  // 사이드바의 본병/소분 개수: 처음 사이드바를 열 때 데이터를 불러오고(표 화면이면 이미 불러온 것을 씀), 바뀌면 숫자 갱신
  let statsStarted = false;
  function startStats() {
    const api = window.INKVENTORY_STATS;
    if (!api) return;
    if (!statsStarted) {
      statsStarted = true;
      api.subscribe((s) => {
        document.querySelectorAll('#inkStats .stat__num').forEach((el) => {
          el.textContent = String(s[el.dataset.k]);
        });
      });
    }
    api.init();
  }

  // 사이드바를 닫으면(닫히는 동작이 끝난 뒤) 펼쳐 둔 2차 카테고리를 모두 접어, 다시 열면 1차 카테고리만 보이게 한다
  let collapseTimer = null;
  function collapseGroups() {
    nav.querySelectorAll('.nav__group[data-open]').forEach((g) => {
      g.dataset.open = 'false';
      const b = g.querySelector('.nav__group-btn');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  }

  function setSidebar(open) {
    clearTimeout(collapseTimer);
    if (!open) collapseTimer = setTimeout(collapseGroups, 320);   // 닫히는 시간(260ms)이 지난 뒤
    if (open) startStats();
    sidebar.classList.toggle('is-open', open);
    backdrop.classList.toggle('is-visible', open);
    toggleBtn.setAttribute('aria-expanded', open);
    if (open && collapseBtn) collapseBtn.focus({ preventScroll: true });
    else if (sidebar.contains(document.activeElement)) toggleBtn.focus({ preventScroll: true });
  }

  toggleBtn.addEventListener('click', () => setSidebar(!isOpen()));
  // 사이트명 왼쪽의 아이콘(열기 버튼과 같은 모양)으로 닫기. (index.html 이 예전 것이어도 앱 전체가 멈추지 않게 없을 때는 건너뜀)
  if (collapseBtn) collapseBtn.addEventListener('click', () => setSidebar(false));
  // 사이드바에서 사이트 이름을 눌러 시작 화면으로 갈 때도 사이드바를 닫는다 (사이드바 안에서 이동할 때는 늘 닫힘)
  const brandLink = document.querySelector('#sidebar .brand');
  if (brandLink) brandLink.addEventListener('click', () => setSidebar(false));
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

  // 화면 배치(layout)는 일반/관리자 모드에 따라 다르다(표의 열 구성 등). 새로고침해도 관리자 배치가 깜빡이지 않도록,
  // 이 탭에서 로그인한 적이 있으면(힌트) 로그인 확인이 끝날 때까지는 관리자 배치로 미리 보여 준다. (index.html 의 head 스크립트가 처음 값을 정함)
  const hintAtStart = !!session.get(HINT_KEY);
  let authResolved = false;

  function applyMode() {
    document.documentElement.dataset.mode = isAdmin ? 'admin' : 'normal';
    document.documentElement.dataset.layout = (isAdmin || (hintAtStart && !authResolved)) ? 'admin' : 'normal';
    modeTag.hidden = !isAdmin;
    logoutBtn.hidden = !isAdmin;
    idBtn.disabled = isAdmin; // 관리자 모드에서는 아이디를 눌러도 아무 일도 일어나지 않음
    idBtn.title = isAdmin ? '' : '관리자 모드로 전환';
    if (currentView && currentView.onMode) currentView.onMode(isAdmin);
    onModeChanged();
  }

  // 일반 ↔ 관리자 모드가 바뀌면: 사이드바 목록 다시 그리기, 시작 화면이면 다시 그리기, 관리자 전용 화면이면 다시 판단(열기 또는 돌려보내기)
  let appStarted = false;
  function onModeChanged() {
    if (!appStarted) return;
    renderNav();
    const id = location.hash.replace(/^#\/?/, '');
    const found = findItem(id);
    markCurrent(id);
    if (!found || found.group.adminOnly) render();
  }

  // 일반 방문자는 로그인 SDK 를 받지 않도록, 로그인이 필요할 때만 불러온다. (js/fb.js)
  let fbPromise = null;
  function loadFirebase() {
    if (!fbPromise) {
      fbPromise = (async () => {
        fb = await INKFB.auth();
        fb.onAuthStateChanged(fb.auth, (user) => {
          authResolved = true;
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
    }).catch(() => { authResolved = true; applyMode(); }); // 로그인 확인에 실패하면 일반 배치로
  }

  // ── 라우팅 (해시) ───────────────────────
  function findItem(id) {
    for (const g of NAV) {
      if (g.route) { if (g.route === id) return { group: g, item: { id: g.route, label: g.label }, top: true }; continue; }
      const item = g.items.find((i) => i.id === id);
      if (item) return { group: g, item };
    }
    return null;
  }

  // 시작 화면의 1차 카테고리 네모 (NAV 에서 만든다). 2차 카테고리가 있으면 네모·이름이 펼침 버튼, 없으면(WISH) 바로 이동하는 링크.
  function homeCatHtml(g) {
    const name = g.homeLabel || g.label;   // 시작 화면에서만 다른 이름을 쓸 수 있다 (상단 바·탭 제목·사이드바는 label)
    const img = g.iconSvg
      ? `<svg class="cat__icon cat__icon--svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${g.iconSvg}</svg>`
      : `<img class="cat__icon" src="${g.icon}?v=20261118g" alt="" width="62" height="62" draggable="false">`;
    if (g.route) {
      return `<div class="cat" data-id="${g.id}">
        <a class="cat__tile" href="#/${g.route}" aria-label="${name}">${img}</a>
        <a class="cat__title" href="#/${g.route}"><span>${name}</span></a>
      </div>`;
    }
    const sid = 'cat-sub-' + g.id;
    return `<div class="cat" data-id="${g.id}" data-has-sub>
      <button class="cat__tile cat__toggle" type="button" aria-expanded="false" aria-controls="${sid}" aria-label="${name} 펼치기">${img}</button>
      <button class="cat__title cat__toggle" type="button" aria-expanded="false" aria-controls="${sid}"><span>${name}</span></button>
      <div class="cat__sub-wrap"><ul class="cat__sub" id="${sid}">${g.items.map((i) => `<li><a href="#/${i.id}">${i.label}</a></li>`).join('')}</ul></div>
    </div>`;
  }

  function render() {
    const id = location.hash.replace(/^#\/?/, '');
    if (ROUTE_ALIAS[id]) { location.replace('#/' + ROUTE_ALIAS[id]); return; }   // 예전 주소 → 새 주소
    const found = findItem(id);

    // 관리자 전용 화면(WISH): 일반 모드면 시작 화면으로 돌려보낸다. 단, 관리자로 로그인해 둔 탭을 새로고침한 직후에는
    // 로그인 확인이 끝날 때까지 기다린다(끝나면 applyMode 가 다시 그린다).
    if (found && found.group.adminOnly && !isAdmin) {
      if (hintAtStart && !authResolved) {
        if (currentView && currentView.unmount) currentView.unmount();
        currentView = null;
        main.className = 'main';
        main.replaceChildren();
        pageTitle.textContent = '';
        markCurrent('');
        return;
      }
      location.replace('#/');
      return;
    }

    markCurrent(id);

    if (currentView && currentView.unmount) currentView.unmount();
    currentView = null;
    main.className = 'main';
    const view = found && VIEWS[id];

    if (view) {
      pageTitle.textContent = found.item.title || (found.top ? found.group.label : `${found.group.label} · ${found.item.label}`);
      document.title = `${pageTitle.textContent} – INKventory`;
      main.replaceChildren();
      main.classList.add('main--table');
      view.mount(main, { isAdmin });
      currentView = view;
    } else if (found) {
      pageTitle.textContent = found.item.title || (found.top ? found.group.label : `${found.group.label} · ${found.item.label}`);
      document.title = `${pageTitle.textContent} – INKventory`;
      main.innerHTML = `
        <div class="placeholder view-enter">
          <div class="crumb">${found.group.label}</div>
          <h2>${found.item.label}</h2>
          <p>준비 중입니다.</p>
        </div>`;
    } else {
      pageTitle.textContent = 'HOME';
      document.title = 'INKventory';
      // 시작 화면: 위쪽 소개 + 1차 카테고리(OWN / 잉팔잉사 / WISH) 네모. 네모나 이름을 누르면 2차 카테고리가 아래로 펼쳐진다 (잉팔잉사·WISH 는 2차가 없어 바로 이동)
      main.innerHTML = `
        <div class="hero view-enter">
          <div class="hero__mark" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c3.5 4.2 6 7.3 6 10.5a6 6 0 0 1-12 0C6 10.3 8.5 7.2 12 3Z"/></svg>
          </div>
          <h1>INKventory</h1>
          <p class="hero__by">of 明(@wishupona__)</p>
        </div>
        <div class="home-cats view-enter${visibleNav().length >= 4 ? ' is-dense' : ''}" style="--cats:${visibleNav().length}">${visibleNav().map(homeCatHtml).join('')}</div>`;
      main.querySelectorAll('.cat[data-has-sub] .cat__toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cat = btn.closest('.cat');
          const open = !cat.classList.contains('is-open');
          cat.classList.toggle('is-open', open);
          cat.querySelectorAll('.cat__toggle').forEach((b) => b.setAttribute('aria-expanded', String(open)));
        });
      });
    }
    main.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', render);

  renderNav();
  render();
  appStarted = true;
})();

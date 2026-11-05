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
    if (e.key === 'Escape' && isOpen()) setSidebar(false);
  });

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

    if (found) {
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

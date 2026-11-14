// WISH 화면 (전체 화면 표). 사이드바의 WISH 를 누르면 #/wish 로 들어온다. (2차 카테고리 없음)
// 위쪽의 [잉크] [만년필] 두 박스로 표를 바꿔 본다: 잉크 = 브랜드명·잉크명 표, 만년필 = 제품명 표.
// 데이터: 공개 문서 inventory/inkOwned 의 wishInk: [{brand, name, gray, bold}], wishPens: [{name, gray, bold}] (누구나 읽기 / 관리자만 쓰기).
// 일반 모드: 읽기만 (비어 있는 행은 감춤). 관리자 모드: 보유 잉크 표와 같은 방식으로 고친다.
//   · 칸을 고치면 자동 저장, 행과 행 사이에 마우스를 두면 나오는 아이콘으로 행 추가, 우클릭(폰은 길게 누르기)으로 행 삭제
//   · 상단 바: [정렬] (가나다순, 회색 행은 맨 아래), [회색] [굵게] (선택한 행에 적용)
//   · 행 선택: 칸을 누르면 그 행이 선택된다. Shift 를 누르고 다른 칸을 누르면 그 사이 행이 모두 선택된다.
(() => {
  'use strict';

  const DOC_PATH = ['inventory', 'inkOwned'];
  const MAX_ROWS = 300;
  const MIN_ROWS = 30;           // 관리자 화면에는 처음부터 빈 행을 이만큼 둔다 (보유 잉크의 빈 행처럼)
  const SAVE_DELAY = 600;
  const TABS = [
    { id: 'ink', label: '잉크', field: 'wishInk', empty: '등록된 위시 잉크가 없습니다.', cols: [
      { k: 'brand', label: '브랜드명', w: 40, max: 100 },
      { k: 'name', label: '잉크명', w: 60, max: 100 },
    ] },
    { id: 'pen', label: '만년필', field: 'wishPens', empty: '등록된 위시 만년필이 없습니다.', cols: [
      { k: 'name', label: '제품명', w: 100, max: 100 },
    ] },
  ];
  const tabOf = (id) => TABS.find((t) => t.id === id);

  const ROW_ADD_ICON = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 17a2 2 0 0 1-2 2H7.2l-5.2 2L4 15.8V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8v6"/><path d="M10 11h6"/></svg>';
  const ROW_ADD_SIZE = 19;
  const TAIL_Y = (22 / 24) * ROW_ADD_SIZE;
  const NEAR = 12;
  const SORT_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/></svg>';
  // 옅은 회색 원 안에 색이 채워진 동그라미
  const GRAY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>';
  const BOLD_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/></svg>';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const blankRow = (t) => { const o = {}; t.cols.forEach((c) => { o[c.k] = ''; }); o.gray = false; o.bold = false; return o; };
  const isBlank = (t, r) => !t.cols.some((c) => String(r[c.k] || '').trim());
  const cleanRows = (t, rows) => (Array.isArray(rows) ? rows : []).slice(0, MAX_ROWS).map((r) => {
    const o = {};
    t.cols.forEach((c) => { o[c.k] = str(r && r[c.k], c.max); });
    o.gray = !!(r && r.gray === true);
    o.bold = !!(r && r.bold === true);
    return o;
  });

  const isAdminMode = () => document.documentElement.dataset.mode === 'admin';

  // ── 상태 ──
  let root = null;                       // 화면이 열려 있을 때의 컨테이너
  let tab = 'ink';
  let fresh = false;                     // 이 화면을 연 뒤로 최신 내용을 받음 (그 전에는 고칠 수 없다)
  let loadState = 'idle';                // idle | loading | ready | error
  let loadedOnce = false;
  const data = { ink: [], pen: [] };
  const dirty = { ink: false, pen: false };
  const timers = { ink: null, pen: null };
  let chain = Promise.resolve();
  let saving = 0;
  let saveState = '';                    // '' | saving | saved | error | denied
  let selA = null;                       // 선택한 행 범위 (rows 번호)
  let selB = null;
  let shiftHold = false;
  let sortBtn = null;
  let grayBtn = null;
  let boldBtn = null;
  let ctxEl = null;
  let ctxRow = -1;
  let longPress = null;
  let noticeTimer = null;

  const canEdit = () => !!root && isAdminMode() && fresh;
  const rowsOf = (id) => data[id || tab];
  const tabNow = () => tabOf(tab);

  // ── 저장 상태 (상단 바) ──
  const STATUS_TEXT = { saving: '저장 중…', saved: '저장됨', error: '저장 실패 · 다시 시도 중', denied: '저장 권한이 없습니다' };
  function showStatus() {
    const el = document.getElementById('saveStatus');
    if (!el) return;
    const visible = !!root && isAdminMode() && !!saveState;
    el.hidden = !visible;
    el.textContent = STATUS_TEXT[saveState] || '';
    el.dataset.state = saveState;
  }
  function setStatus(s) { saveState = s; showStatus(); }

  function showNotice(msg, ms) {
    const el = root && root.querySelector('.notice');
    if (!el) return;
    clearTimeout(noticeTimer);
    el.hidden = !msg;
    el.textContent = msg || '';
    if (msg && ms) noticeTimer = setTimeout(() => showNotice(''), ms);
  }

  // ── 불러오기: 가벼운 공개 읽기 주소(REST)로 문서를 한 번 받는다 ──
  function restUrl() {
    const c = (window.INKVENTORY_CONFIG || {}).firebase || {};
    return `https://firestore.googleapis.com/v1/projects/${c.projectId}/databases/(default)/documents/${DOC_PATH.join('/')}?key=${c.apiKey}`;
  }
  function decodeRows(v) {
    const vals = v && v.arrayValue && v.arrayValue.values;
    if (!Array.isArray(vals)) return [];
    return vals.map((x) => {
      const f = (x && x.mapValue && x.mapValue.fields) || {};
      const o = {};
      Object.keys(f).forEach((k) => {
        const fv = f[k] || {};
        o[k] = typeof fv.stringValue === 'string' ? fv.stringValue : (typeof fv.booleanValue === 'boolean' ? fv.booleanValue : '');
      });
      return o;
    });
  }

  async function load() {
    if (loadState === 'loading') return;
    loadState = 'loading';
    try {
      const c = (window.INKVENTORY_CONFIG || {}).firebase;
      if (!c || !c.apiKey) throw new Error('not-configured');
      const r = await fetch(restUrl(), { cache: 'no-store' });
      let fields = {};
      if (r.status !== 404) {
        if (!r.ok) throw new Error('http ' + r.status);
        fields = (await r.json()).fields || {};
      }
      TABS.forEach((t) => {
        if (dirty[t.id] || timers[t.id] !== null) return;   // 아직 저장 안 된 내 수정이 있으면 덮어쓰지 않음
        data[t.id] = cleanRows(t, decodeRows(fields[t.field]));
      });
      loadState = 'ready';
      loadedOnce = true;
      fresh = true;
    } catch (err) {
      loadState = 'error';
    }
    if (root) { applyEditable(); if (loadState === 'error' && !loadedOnce) render(); }
  }

  // ── 저장 ──
  function schedule(t, delay) {
    clearTimeout(timers[t.id]);
    dirty[t.id] = true;
    timers[t.id] = setTimeout(() => flush(t), delay == null ? SAVE_DELAY : delay);
    setStatus('saving');
  }

  function flush(t) {
    clearTimeout(timers[t.id]);
    timers[t.id] = null;
    if (!dirty[t.id]) return chain;
    dirty[t.id] = false;
    const rows = cleanRows(t, data[t.id]);          // 빈 행도 그대로 저장 (행 위치를 보유 잉크처럼 유지)
    saving++;
    setStatus('saving');
    chain = chain.then(async () => {
      try {
        const { db, doc, setDoc } = await INKFB.db();
        await setDoc(doc(db, ...DOC_PATH), { [t.field]: rows }, { merge: true });
        saving--;
        if (!saving && !dirty.ink && !dirty.pen) setStatus('saved');
      } catch (err) {
        saving--;
        dirty[t.id] = true;                           // 다음 수정이나 화면을 떠날 때 다시 시도
        if (err && err.code === 'permission-denied') { setStatus('denied'); return; }
        setStatus('error');
        clearTimeout(timers[t.id]);
        timers[t.id] = setTimeout(() => flush(t), 8000);
      }
    });
    return chain;
  }
  const flushAll = () => TABS.forEach((t) => flush(t));

  window.addEventListener('beforeunload', (e) => {
    if (dirty.ink || dirty.pen || saving) { flushAll(); e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });

  // ── 표 그리기 ──
  function rowHtml(t, r, i, edit) {
    const cls = [r.gray ? 'is-gray' : '', r.bold ? 'is-bold' : ''].filter(Boolean).join(' ');
    let h = `<tr data-i="${i}"${cls ? ` class="${cls}"` : ''}>`;
    t.cols.forEach((c) => {
      h += `<td class="c-text"><div class="cell-wrap" data-v="${esc(r[c.k])}"><textarea class="cell" rows="1" data-k="${c.k}" maxlength="${c.max}" aria-label="${esc(c.label)} ${i + 1}행" autocomplete="off" spellcheck="false"${edit ? '' : ' readonly tabindex="-1"'}>${esc(r[c.k])}</textarea></div></td>`;
    });
    return h + '</tr>';
  }

  function render() {
    if (!root) return;
    const t = tabNow();
    const edit = canEdit();
    const rows = rowsOf();
    root.querySelectorAll('.notice-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const wrap = root.querySelector('.table-wrap');
    const msg = root.querySelector('.exch-empty');
    const table = root.querySelector('table.grid');
    if (!loadedOnce) {
      wrap.hidden = true; msg.hidden = false;
      msg.textContent = loadState === 'error' ? '불러오지 못했습니다. 새로고침해 주세요.' : '불러오는 중…';
      return;
    }
    if (edit) {
      while (rows.length < MIN_ROWS) rows.push(blankRow(t));
      if (rows.length < MAX_ROWS && !isBlank(t, rows[rows.length - 1])) rows.push(blankRow(t));
    }
    const shown = rows.map((r, i) => i).filter((i) => edit || !isBlank(t, rows[i]));
    if (!shown.length) {
      wrap.hidden = true; msg.hidden = false; msg.textContent = t.empty;
      return;
    }
    wrap.hidden = false; msg.hidden = true;
    const total = t.cols.reduce((n, c) => n + c.w, 0);
    const top = wrap.scrollTop;
    table.innerHTML = `<colgroup>${t.cols.map((c) => `<col style="width:${((c.w / total) * 100).toFixed(2)}%">`).join('')}</colgroup>`
      + `<thead><tr>${t.cols.map((c) => `<th scope="col">${esc(c.label)}</th>`).join('')}</tr></thead>`
      + `<tbody>${shown.map((i) => rowHtml(t, rows[i], i, edit)).join('')}</tbody>`;
    wrap.scrollTop = top;
    paintSel();
  }

  function applyEditable() {
    if (!root) return;
    const edit = canEdit();
    root.classList.toggle('is-editable', edit);
    if (sortBtn) sortBtn.hidden = !edit;
    if (grayBtn) grayBtn.hidden = !edit;
    if (boldBtn) boldBtn.hidden = !edit;
    if (!edit) { selA = selB = null; closeCtx(); }
    render();
    showStatus();
  }

  // ── 행 선택 (칸을 누르면 그 행, Shift + 누르기로 범위) ──
  function selRange() {
    if (selA == null) return null;
    return [Math.min(selA, selB), Math.max(selA, selB)];
  }
  function paintSel() {
    if (!root) return;
    const r = selRange();
    root.querySelectorAll('tbody tr').forEach((tr) => {
      const i = Number(tr.dataset.i);
      tr.classList.toggle('is-sel', !!r && i >= r[0] && i <= r[1]);
    });
    syncToolButtons();
  }
  function setSel(a, b) { selA = a; selB = b; paintSel(); }
  function clearSel() { selA = selB = null; paintSel(); }

  function selectedRows() {
    const r = selRange();
    const rows = rowsOf();
    if (!r) return [];
    return rows.slice(r[0], r[1] + 1);
  }
  function syncToolButtons() {
    const sr = selectedRows();
    if (grayBtn) grayBtn.setAttribute('aria-pressed', String(sr.length > 0 && sr.every((x) => x.gray)));
    if (boldBtn) boldBtn.setAttribute('aria-pressed', String(sr.length > 0 && sr.every((x) => x.bold)));
  }

  // 선택한 행 전부가 이미 켜져 있으면 끄고, 아니면 모두 켠다
  function toggleFlag(flag) {
    if (!canEdit()) return;
    const sr = selectedRows();
    if (!sr.length) { showNotice('먼저 행을 선택해 주세요. (칸을 누르면 그 행이 선택됩니다)', 3000); return; }
    const on = !sr.every((x) => x[flag]);
    sr.forEach((x) => { x[flag] = on; });
    const r = selRange();
    root.querySelectorAll('tbody tr').forEach((tr) => {
      const i = Number(tr.dataset.i);
      if (i >= r[0] && i <= r[1]) tr.classList.toggle(flag === 'gray' ? 'is-gray' : 'is-bold', on);
    });
    root.querySelectorAll('tbody textarea').forEach(fit);
    syncToolButtons();
    schedule(tabNow());
  }

  // ── 정렬 ──
  // 가나다순(잉크: 브랜드 → 잉크명, 만년필: 제품명). 회색 행은 맨 아래로 내려가고 그 안에서도 가나다순. 빈 행은 맨 끝.
  function sortRows() {
    if (!canEdit()) return;
    const t = tabNow();
    const S = window.INKSORT || { sortText: (s) => String(s || '').toLowerCase(), compareText: (a, b) => (a < b ? -1 : a > b ? 1 : 0) };
    const rows = rowsOf();
    const keys = new Map(rows.map((r) => [r, t.cols.map((c) => S.sortText(r[c.k]))]));
    const next = rows.slice().sort((x, y) => {
      const bx = isBlank(t, x);
      const by = isBlank(t, y);
      if (bx !== by) return bx ? 1 : -1;                         // 빈 행은 맨 끝
      if (x.gray !== y.gray) return x.gray ? 1 : -1;             // 회색은 그다음 맨 아래
      const a = keys.get(x);
      const b = keys.get(y);
      for (let i = 0; i < a.length; i++) {
        if (!a[i] !== !b[i]) return a[i] ? -1 : 1;               // 같은 열이 빈 행은 뒤
        const c = S.compareText(a[i], b[i]);
        if (c) return c;
      }
      return 0;                                                   // 완전히 같으면 지금 순서 유지 (정렬은 안정적)
    });
    if (next.every((r, i) => r === rows[i])) { showNotice('이미 정렬되어 있습니다.', 2500); return; }
    data[tab] = next;
    clearSel();
    closeCtx();
    render();
    schedule(t, 0);
  }

  // ── 행 추가 / 삭제 ──
  function insertRow(b) {
    if (!canEdit()) return;
    const rows = rowsOf();
    if (!Number.isInteger(b) || b < 1 || b > rows.length) return;
    if (rows.length >= MAX_ROWS) { showNotice(`행은 최대 ${MAX_ROWS}개까지 추가할 수 있습니다.`, 3500); return; }
    const t = tabNow();
    rows.splice(b, 0, blankRow(t));
    clearSel();
    render();
    const tr = root.querySelector(`tbody tr[data-i="${b}"]`);
    if (tr) { tr.classList.add('row-new'); const c = tr.querySelector('.cell'); if (c) c.focus(); }
    schedule(t, 0);
  }

  function deleteRow(i) {
    if (!canEdit()) return;
    const t = tabNow();
    const rows = rowsOf();
    const r = rows[i];
    if (!r) return;
    // 내용이 하나도 없는 빈 행은 물어보지 않고 바로 지운다. 내용이 있으면 한 번 확인.
    if (!isBlank(t, r)) {
      const label = t.cols.map((c) => String(r[c.k] || '').trim()).filter(Boolean).join(' ');
      if (!window.confirm(`"${label}" 행을 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
    }
    rows.splice(i, 1);
    if (!rows.length) rows.push(blankRow(t));
    clearSel();
    closeCtx();
    render();
    schedule(t, 0);
  }

  // 우클릭(폰은 길게 누르기) 메뉴: 행 삭제
  function ensureCtx() {
    if (ctxEl) return ctxEl;
    ctxEl = document.createElement('ul');
    ctxEl.className = 'menu ctx-menu';
    ctxEl.setAttribute('role', 'menu');
    ctxEl.setAttribute('aria-label', '행');
    ctxEl.hidden = true;
    ctxEl.innerHTML = '<li role="menuitem" tabindex="-1" data-act="row" class="menu-danger">행 삭제</li>';
    document.body.appendChild(ctxEl);
    ctxEl.addEventListener('click', (e) => { if (e.target.closest('[role="menuitem"]')) { const i = ctxRow; closeCtx(); deleteRow(i); } });
    ctxEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const i = ctxRow; closeCtx(); deleteRow(i); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeCtx(); }
    });
    return ctxEl;
  }
  function openCtx(x, y, i) {
    const el = ensureCtx();
    ctxRow = i;
    el.hidden = false;
    el.style.left = Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8)) + 'px';
    el.querySelector('[role="menuitem"]').focus();
  }
  function closeCtx() { if (ctxEl) ctxEl.hidden = true; ctxRow = -1; }
  document.addEventListener('pointerdown', (e) => { if (ctxEl && !ctxEl.hidden && !ctxEl.contains(e.target)) closeCtx(); });
  window.addEventListener('resize', closeCtx);
  const cancelLongPress = () => { if (longPress) { clearTimeout(longPress.timer); longPress = null; } };

  // ── 칸 ──
  function fit(el) { el.parentNode.dataset.v = el.value; }

  function focusCell(el) {
    el.focus({ preventScroll: true });
    const tr = el.closest('tr');
    if (tr) tr.scrollIntoView({ block: 'nearest' });
  }

  // 행과 행 사이 선 근처에서 나타나는 행 추가 아이콘 (보유 잉크와 같은 방식)
  function setupRowAdd(container) {
    const area = container.querySelector('.table-area');
    const wrap = container.querySelector('.table-wrap');
    const btn = container.querySelector('.row-add');
    const hide = () => btn.classList.remove('is-on');
    const tbodyEl = () => wrap.querySelector('tbody');

    function boundaryAt(clientY) {
      const tbody = tbodyEl();
      const thead = wrap.querySelector('thead');
      if (!tbody || !tbody.rows.length) return null;
      const rows = tbody.rows;
      const top = wrap.getBoundingClientRect().top + wrap.clientTop;
      if (clientY < top + thead.offsetHeight || clientY > top + wrap.clientHeight) return null;
      const rel = clientY - top + wrap.scrollTop;
      let lo = 0; let hi = rows.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rows[mid].offsetTop <= rel) lo = mid; else hi = mid - 1; }
      const rt = rows[lo].offsetTop;
      const rb = rt + rows[lo].offsetHeight;
      if (rel < rt || rel >= rb) return null;
      const n = rel - rt <= NEAR ? lo : (rb - rel <= NEAR ? lo + 1 : null);
      return n !== null && n >= 1 && n <= rows.length - 1 ? n : null;
    }

    function update(e) {
      if (!canEdit() || e.target.closest('.row-add')) return;
      const n = boundaryAt(e.clientY);
      if (n === null) { hide(); return; }
      const top = wrap.getBoundingClientRect().top + wrap.clientTop;
      const thead = wrap.querySelector('thead');
      const row = tbodyEl().rows[n];
      const lineY = top + row.offsetTop - wrap.scrollTop - 0.5;
      if (lineY < top + thead.offsetHeight || lineY > top + wrap.clientHeight) { hide(); return; }
      btn.style.top = (lineY - area.getBoundingClientRect().top - TAIL_Y) + 'px';
      btn.dataset.before = row.dataset.i;           // 이 번호의 행 앞에 추가
      btn.classList.add('is-on');
    }

    area.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') update(e); });
    area.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') update(e); });
    area.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    wrap.addEventListener('scroll', hide, { passive: true });
    btn.addEventListener('click', () => { const b = Number(btn.dataset.before); hide(); insertRow(b); });
  }

  function setupTopbar() {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    const mk = (cls, title, html, fn) => {
      const b = document.createElement('button');
      b.className = cls;
      b.type = 'button';
      b.hidden = true;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = html;
      b.addEventListener('mousedown', (e) => e.preventDefault());   // 눌러도 칸의 커서(선택)가 그대로 있게
      b.addEventListener('click', fn);
      topbar.appendChild(b);
      return b;
    };
    sortBtn = mk('sort-btn', '가나다순으로 정렬 (회색 행은 맨 아래)', SORT_ICON + '<span class="lbl">정렬</span>', sortRows);
    grayBtn = mk('sort-btn tool-btn gray-btn', '선택한 행을 회색으로 (다시 누르면 해제)', GRAY_ICON, () => toggleFlag('gray'));
    boldBtn = mk('sort-btn tool-btn', '선택한 행을 굵게 (다시 누르면 해제)', BOLD_ICON, () => toggleFlag('bold'));
    grayBtn.setAttribute('aria-pressed', 'false');
    boldBtn.setAttribute('aria-pressed', 'false');
  }
  function teardownTopbar() {
    [sortBtn, grayBtn, boldBtn].forEach((b) => { if (b) b.remove(); });
    sortBtn = grayBtn = boldBtn = null;
  }

  // 표 바깥(상단 바 버튼 제외)을 누르면 선택 해제
  document.addEventListener('pointerdown', (e) => {
    if (!root || selA == null) return;
    if (e.target.closest('.table-wrap') || e.target.closest('.menu') || e.target.closest('.topbar .sort-btn')) return;
    clearSel();
  });

  function mount(container) {
    root = container;
    container.classList.add('is-wish');
    fresh = false;
    selA = selB = null;
    container.innerHTML = `
      <p class="notice" role="alert" hidden></p>
      <div class="wish-layout">
        <div class="table-area view-enter">
          <button class="row-add" type="button" title="행 추가" aria-label="이 위치에 행 추가">${ROW_ADD_ICON}</button>
          <div class="wish-tabs" role="tablist" aria-label="잉크 / 만년필">
            ${TABS.map((t) => `<button class="notice-tab" type="button" role="tab" data-tab="${t.id}" aria-selected="${t.id === tab}">${t.label}</button>`).join('')}
          </div>
          <div class="exch-empty" hidden></div>
          <div class="table-wrap" tabindex="0" role="region" aria-label="위시 표">
            <table class="grid"></table>
          </div>
        </div>
      </div>`;
    setupTopbar();
    setupRowAdd(container);
    const wrap = container.querySelector('.table-wrap');

    container.querySelector('.wish-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.notice-tab');
      if (!b || b.dataset.tab === tab) return;
      tab = b.dataset.tab;
      clearSel();
      closeCtx();
      render();
      wrap.scrollTop = 0;
    });

    wrap.addEventListener('focusin', (e) => {
      const tr = e.target.closest('tbody tr');
      if (!tr || !canEdit()) return;
      const i = Number(tr.dataset.i);
      if (shiftHold && selA != null) setSel(selA, i); else setSel(i, i);
    });
    wrap.addEventListener('pointerdown', (e) => {
      const tr = e.target.closest('tbody tr');
      if (!tr || !canEdit()) return;
      if (e.shiftKey && selA != null) { shiftHold = true; setSel(selA, Number(tr.dataset.i)); setTimeout(() => { shiftHold = false; }, 0); }
      if (e.pointerType !== 'mouse') {                // 터치: 길게 누르면 행 삭제 메뉴
        cancelLongPress();
        const i = Number(tr.dataset.i);
        longPress = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { longPress = null; setSel(i, i); openCtx(e.clientX, e.clientY, i); }, 550) };
      }
    });
    wrap.addEventListener('pointermove', (e) => { if (longPress && Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > 8) cancelLongPress(); });
    wrap.addEventListener('pointerup', cancelLongPress);
    wrap.addEventListener('pointercancel', cancelLongPress);
    wrap.addEventListener('scroll', () => { closeCtx(); cancelLongPress(); }, { passive: true });

    wrap.addEventListener('contextmenu', (e) => {
      const tr = e.target.closest('tbody tr');
      if (!tr || !canEdit()) return;
      e.preventDefault();
      cancelLongPress();
      let x = e.clientX;
      let y = e.clientY;
      if (!x && !y) { const r = tr.getBoundingClientRect(); x = r.left + 24; y = r.bottom; }   // 키보드로 열었을 때
      const i = Number(tr.dataset.i);
      setSel(i, i);
      openCtx(x, y, i);
    });

    wrap.addEventListener('input', (e) => {
      const el = e.target.closest('textarea.cell');
      if (!el || !canEdit()) return;
      const tr = el.closest('tr');
      const rows = rowsOf();
      const i = Number(tr.dataset.i);
      if (!rows[i]) return;
      rows[i][el.dataset.k] = el.value;
      fit(el);
      const t = tabNow();
      if (i === rows.length - 1 && rows.length < MAX_ROWS && !isBlank(t, rows[i])) {   // 맨 아래 행에 쓰기 시작하면 아래에 빈 행을 하나 더
        rows.push(blankRow(t));
        tr.parentNode.insertAdjacentHTML('beforeend', rowHtml(t, rows[rows.length - 1], rows.length - 1, true));
      }
      schedule(t);
    });

    // ↓ / Enter: 아래 칸, ↑: 위 칸. Shift + Enter: 줄바꿈 (Ctrl/Alt/Cmd + Enter 는 아무 동작도 안 함)
    wrap.addEventListener('keydown', (e) => {
      const el = e.target.closest('textarea.cell');
      if (!el || e.isComposing || e.keyCode === 229) return;
      let dir = 0;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        if (el.value.includes('\n') || el.offsetHeight > 41) {     // 여러 줄 칸은 글자 맨 앞/맨 뒤에서만 다른 칸으로
          if (e.key === 'ArrowUp' ? el.selectionStart > 0 : el.selectionEnd < el.value.length) return;
        }
        dir = e.key === 'ArrowDown' ? 1 : -1;
      } else if (e.key === 'Enter') {
        if (e.ctrlKey || e.altKey || e.metaKey) { e.preventDefault(); return; }
        if (e.shiftKey) {
          if (!canEdit() || el.readOnly) return;
          e.preventDefault();
          if (el.maxLength > 0 && el.value.length - (el.selectionEnd - el.selectionStart) >= el.maxLength) return;
          el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
        dir = 1;
      }
      if (!dir) return;
      e.preventDefault();
      let tr = el.closest('tr');
      tr = dir > 0 ? tr.nextElementSibling : tr.previousElementSibling;
      const next = tr && tr.querySelector(`textarea[data-k="${el.dataset.k}"]`);
      if (next) focusCell(next);
    });

    applyEditable();      // 처음 그리기 (관리자 모드이고 이미 받아 둔 내용이 있으면 최신 내용이 올 때까지는 읽기만)
    load();
  }

  function unmount() {
    flushAll();
    cancelLongPress();
    closeCtx();
    teardownTopbar();
    clearTimeout(noticeTimer);
    root = null;
    fresh = false;
    if (loadState === 'error') loadState = 'idle';
    showStatus();
  }

  window.INKVENTORY_VIEWS = window.INKVENTORY_VIEWS || {};
  window.INKVENTORY_VIEWS.wish = {
    mount,
    unmount,
    onMode() { if (root) { if (isAdminMode()) { INKFB.db().catch(() => {}); } applyEditable(); } },
  };
})();

// 보유 잉크 표: 브랜드 / 잉크명 / 본병·소분 / 잔량 / 비고 / 소분 가능 / 가격 (처음 270행, 행 사이에 추가 가능)
//  - 잔량 막대: 10칸. 칸을 누르면 그 칸과 왼쪽 칸이 모두 채워진다. 같은 칸을 다시 누르면 0.
//    화면이 넓어지면 잔량 열만 늘어나고 막대도 같이 길어진다(칸 폭은 항상 정수 px).
//  - 글자 칸: 관리자 모드에서 바로 입력.
//  - 본병/소분 칸: 클릭하면 드롭다운. "소분"을 고른 행의 소분 가능·가격 칸은 대각선이 그어지고 입력할 수 없다.
//  - 행과 행 사이에 마우스를 두면 나타나는 아이콘으로 그 자리에 빈 행을 추가.
//  - 칸을 선택하면 오른쪽 아래 꼭짓점에 작은 원(채우기 핸들)이 나타나고, 아래로 끌면 같은 내용이 채워진다.
//  - 모든 변경은 자동 저장(Firestore 문서 하나: inventory/inkOwned). 수정은 관리자 모드에서만 가능.
//    (화면에서 막는 것은 편의일 뿐, 실제 쓰기 권한은 Firestore 보안 규칙이 서버에서 막는다.)
//
// 저장 구조:  { order: ["0","1",...,"n8x2k1ab",...],            ← 행 순서 (행 id 목록)
//               rows:  { "<행 id>": { brand, name, kind, level, note, portions, price } } }
//   - 행마다 바뀌지 않는 id 를 가진다. 중간에 행을 끼워 넣어도 다른 행의 데이터는 건드리지 않고 order 만 바뀐다.
//   - order 가 없는 예전 데이터는 id "0"~"269" 순서로 본다.
(() => {
  'use strict';

  const DEFAULT_ROWS = 270;
  const MAX_ROWS = 600;                          // 문서 하나(1MiB 제한)에 안전하게 담기 위한 상한
  const STEPS = 10;
  const DOC_PATH = ['inventory', 'inkOwned'];
  const SAVE_DELAY = 600;                        // 입력을 멈추고 이 시간(ms)이 지나면 저장
  const RETRY_DELAY = 5000;

  // width 는 기본 너비. 잔량 열만 화면이 넓으면 늘어난다(width 는 그때의 최소값).
  const COLUMNS = [
    { key: 'brand',    label: '브랜드',          width: 180, max: 100 },
    { key: 'name',     label: '잉크명',          width: 180, max: 100, pearlToggle: true },   // 펄 잉크는 셀을 샌드 베이지로 칠함
    { key: 'kind',     label: '본병/소분',       width: 128, pick: true },   // 클릭하면 드롭다운
    { key: 'level',    label: '잔량',            width: 205 },               // 막대 180px + 좌우 여백 12px씩 + 오른쪽 선 1px
    { key: 'note',     label: '비고',            width: 260, max: 300 },
    { key: 'portions', label: '소분 가능 (5ml)', width: 130, max: 20, lockable: true },
    { key: 'price',    label: '가격',            width: 110, max: 50, lockable: true },
  ];
  const BASE_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0);
  const LEVEL_COL = COLUMNS.findIndex((c) => c.key === 'level');
  const BAR_MIN = 180;        // 막대 최소 길이(px). 항상 10의 배수

  // 본병/소분 드롭다운 선택지 (저장되는 값은 보이는 글자 그대로)
  const KIND_OPTIONS = [
    '소분 (5ml)', '소분 (10ml)', '소분 (15ml)', '소분 (20ml)',
    '본병 (15ml)', '본병 (20ml)', '본병 (25ml)', '본병 (30ml)', '본병 (38ml)', '본병 (50ml)', '본병 (65ml)', '본병 (80ml)',
  ];

  // ── 상태 ────────────────────────────────
  const defaultOrder = () => Array.from({ length: DEFAULT_ROWS }, (_, i) => String(i));
  let order = defaultOrder();   // 화면에 보이는 행 순서 (행 id)
  const data = {};              // 행 id → { 필드: 값 }
  let loadState = 'idle';       // idle | loading | ready | error
  let root = null;              // 현재 화면 컨테이너
  const pending = new Map();    // 아직 저장 안 된 변경. 키: "id|필드" 또는 "@order"
  let saveTimer = null;
  let saving = false;
  let saveStatus = '';          // '' | saving | saved | error | denied

  const isAdminMode = () => document.documentElement.dataset.mode === 'admin';
  const canEdit = () => isAdminMode() && loadState === 'ready';
  const esc = (s) => String(s).replace(/[&"'<>]/g, (c) => `&#${c.charCodeAt(0)};`);
  const newId = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ── 저장 상태 표시 (상단 바) ────────────
  const STATUS_TEXT = {
    saving: '저장 중…',
    saved: '저장됨',
    error: '저장 실패 · 다시 시도 중',
    denied: '저장 권한이 없습니다',
  };

  function showStatus() {
    const el = document.getElementById('saveStatus');
    if (!el) return;
    const visible = !!root && isAdminMode() && !!saveStatus;
    el.hidden = !visible;
    el.textContent = STATUS_TEXT[saveStatus] || '';
    el.dataset.state = saveStatus;
  }

  function setStatus(s) { saveStatus = s; showStatus(); }

  // ── 저장 ────────────────────────────────
  function queueSave(id, field, value) {
    (data[id] = data[id] || {})[field] = value;
    pending.set(id + '|' + field, { id, field, value });
    setStatus('saving');
    if (field === 'kind' || field === 'name' || field === 'pearl') emitStats();   // 사이드바 개수 갱신
    scheduleFlush(field === 'level' ? 0 : SAVE_DELAY);
  }

  function queueOrder() {
    pending.set('@order', { order: order.slice() });
    setStatus('saving');
    scheduleFlush(0);
  }

  function scheduleFlush(delay) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, delay);
  }

  async function flush() {
    clearTimeout(saveTimer);
    if (saving || !pending.size) return;
    saving = true;
    setStatus('saving');
    const batch = [...pending.entries()];
    try {
      const { db, doc, setDoc } = await INKFB.db();
      const payload = {};
      batch.forEach(([, e]) => {
        if (e.order) { payload.order = e.order; return; }
        payload.rows = payload.rows || {};
        (payload.rows[e.id] = payload.rows[e.id] || {})[e.field] = e.value;
      });
      await setDoc(doc(db, ...DOC_PATH), payload, { merge: true });
      batch.forEach(([k, e]) => { if (pending.get(k) === e) pending.delete(k); });
      saving = false;
      saveCache();   // 다음에 들어올 때 바로 보여 줄 최신 내용을 보관
      if (pending.size) { scheduleFlush(0); } else { setStatus('saved'); }
    } catch (err) {
      saving = false;
      if (err && err.code === 'permission-denied') { setStatus('denied'); return; } // 재시도해도 소용없음
      setStatus('error');
      scheduleFlush(RETRY_DELAY);
    }
  }

  // 닫기 전에 저장 안 된 게 있으면 즉시 저장 시도 + 경고
  window.addEventListener('beforeunload', (e) => {
    if (pending.size || saving) { flush(); e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pending.size) flush();
  });

  // ── 불러오기 (빠르게) ────────────────────
  // 1) 읽기에는 무거운 Firebase SDK 를 쓰지 않고, 공개 읽기 주소(REST)로 한 번 요청한다.
  //    index.html 이 보유 잉크 화면으로 들어오는 경우 자바스크립트가 준비되기도 전에 이 요청을 먼저 시작해 둔다(window.__inkDoc).
  // 2) 가장 최근에 받은 내용을 브라우저에 보관해 두었다가, 다시 들어오면 그 내용을 즉시 보여 주고
  //    서버의 최신 내용이 오면 바뀐 경우에만 다시 그린다. (최신 내용이 오기 전에는 수정할 수 없다)
  // SDK 는 저장(쓰기)할 때만 쓴다.
  const CACHE_KEY = 'inkventory.cache.v1';
  let hydrated = false;     // 보관해 둔 내용으로 화면을 채운 적이 있음
  let shownSnapshot = '';   // 지금 화면에 반영된 내용의 요약(바뀌었는지 비교용)

  function restUrl() {
    const c = (window.INKVENTORY_CONFIG || {}).firebase || {};
    return `https://firestore.googleapis.com/v1/projects/${c.projectId}/databases/(default)/documents/${DOC_PATH.join('/')}?key=${c.apiKey}`;
  }

  // Firestore REST 의 값 형식({stringValue: ..} 등)을 일반 값으로
  function decodeValue(v) {
    if (!v) return undefined;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
    if ('mapValue' in v) return decodeMap(v.mapValue.fields || {});
    return undefined;
  }
  function decodeMap(fields) {
    const out = {};
    Object.keys(fields).forEach((k) => { out[k] = decodeValue(fields[k]); });
    return out;
  }

  async function fetchDoc() {
    const request = () => fetch(restUrl()).then((r) => (r.status === 404 ? null : r.ok ? r.json() : Promise.reject(new Error('http ' + r.status))));
    const early = window.__inkDoc;
    window.__inkDoc = null;
    let json;
    try { json = await (early || request()); } catch (err) { json = await request(); } // 먼저 보낸 요청이 실패하면 한 번 더
    return json ? decodeMap(json.fields || {}) : {};
  }

  // 문서 내용(순서 + 행 데이터)을 상태에 반영
  function applyDoc(d) {
    const rows = d.rows || {};
    let loaded = Array.isArray(d.order) ? [...new Set(d.order.filter((x) => typeof x === 'string' && x))] : [];
    if (!loaded.length) loaded = defaultOrder();
    const known = new Set(loaded);
    Object.keys(rows).forEach((id) => { if (!known.has(id)) loaded.push(id); }); // 안전장치: 데이터가 있는데 순서에 없는 행
    order = loaded;
    Object.keys(data).forEach((id) => { delete data[id]; });
    Object.keys(rows).forEach((id) => { data[id] = rows[id]; });
  }

  const snapshot = () => JSON.stringify({ order, rows: data });

  function saveCache() {
    shownSnapshot = snapshot();
    try { localStorage.setItem(CACHE_KEY, shownSnapshot); } catch (err) { /* 보관 못 해도 괜찮음 */ }
  }

  function hydrateFromCache() {
    if (hydrated || loadState === 'ready') return;
    try {
      const d = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!d || !Array.isArray(d.order) || !d.rows || typeof d.rows !== 'object') return;
      applyDoc(d);
      hydrated = true;
      shownSnapshot = snapshot();
    } catch (err) { /* 깨진 보관본은 무시 */ }
  }

  async function load() {
    if (loadState === 'loading' || loadState === 'ready') return;
    loadState = 'loading';
    showNotice('');
    try {
      const d = await fetchDoc();
      applyDoc(d);
      loadState = 'ready';
      const fresh = snapshot();
      const changed = fresh !== shownSnapshot;
      shownSnapshot = fresh;
      saveCache();
      emitStats();
      if (root) {
        if (changed) rebuildRows();       // 처음이거나 보관본과 달라졌을 때만 다시 그림
        applyEditable();
      }
    } catch (err) {
      loadState = 'error';
      showNotice(hydrated
        ? '최신 내용을 불러오지 못해 이전에 받아 둔 내용을 보여 드리고 있습니다. 새로고침해 주세요.'
        : '데이터를 불러오지 못했습니다. 새로고침해 주세요.');
      if (root) applyEditable();
    }
  }

  function showNotice(msg) {
    const el = root && root.querySelector('.notice');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg;
  }

  // ── 화면 ────────────────────────────────
  // Lucide "sparkles" (펄 표시 버튼)
  const SPARKLES_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/></svg>';

  function barHtml() {
    let segs = '';
    for (let i = 1; i <= STEPS; i++) {
      segs += `<button class="seg" type="button" data-i="${i}" aria-label="잔량 ${i}/${STEPS}"></button>`;
    }
    return `<div class="bar" role="group" aria-label="잔량"><div class="track" aria-hidden="true"><i class="pv"></i><i class="fill"></i></div>${segs}</div>`;
  }

  function rowHtml(id, n) {
    const cells = COLUMNS.map((c) => {
      if (c.key === 'level') return `<td class="c-level">${barHtml()}</td>`;
      if (c.pick) {
        return `<td class="c-text"><button class="pick" type="button" data-f="${c.key}" data-label="${c.label}" aria-label="${c.label} ${n}행" aria-haspopup="listbox" aria-expanded="false" tabindex="-1"><span class="pick-text"></span></button></td>`;
      }
      const input = `<input class="cell" type="text" data-f="${c.key}" data-label="${c.label}" maxlength="${c.max}" aria-label="${c.label} ${n}행" autocomplete="off" spellcheck="false" readonly tabindex="-1">`;
      if (c.pearlToggle) {
        return `<td class="c-text c-name">${input}<button class="pearl-btn" type="button" tabindex="-1" aria-pressed="false" title="펄 잉크로 표시" aria-label="펄 잉크로 표시">${SPARKLES_ICON}</button></td>`;
      }
      return `<td class="c-text${c.lockable ? ' c-lockable' : ''}">${input}</td>`;
    }).join('');
    return `<tr data-id="${esc(id)}">${cells}</tr>`;
  }

  function rowsHtml() {
    return order.map((id, i) => rowHtml(id, i + 1)).join('');
  }

  function rebuildRows() {
    closeMenu(false);
    clearSelection();
    root.querySelector('tbody').innerHTML = rowsHtml();
    fillAll();
  }

  // 접근성 라벨의 "n행" 번호를 from(0부터) 이후로 다시 매김
  function relabel(from) {
    const rows = root.querySelectorAll('tbody tr');
    for (let i = from; i < rows.length; i++) {
      rows[i].querySelectorAll('.cell, .pick').forEach((el) => {
        el.setAttribute('aria-label', `${el.dataset.label} ${i + 1}행`);
      });
    }
  }

  function paintLevel(row, level) {
    const bar = row.querySelector('.bar');
    bar.style.setProperty('--lv', level);
    bar.dataset.level = level;
    // 채워진 영역 안에 놓인 구분선은 어두운 색으로 (CSS .seg.in)
    bar.querySelectorAll('.seg').forEach((seg, idx) => seg.classList.toggle('in', idx + 1 <= level));
  }

  // "소분"인 행: 소분 가능·가격 칸에 대각선, 입력 불가
  function syncLock(tr) {
    const id = tr.dataset.id;
    const sample = ((data[id] && data[id].kind) || '').startsWith('소분');
    tr.classList.toggle('is-sample', sample);
    tr.querySelectorAll('td.c-lockable .cell').forEach((input) => { input.disabled = sample; });
  }

  // 펄 잉크 행: 잉크명 칸을 샌드 베이지로 칠함 (CSS .is-pearl)
  function syncPearl(tr) {
    const pearl = !!(data[tr.dataset.id] && data[tr.dataset.id].pearl);
    tr.classList.toggle('is-pearl', pearl);
    const btn = tr.querySelector('.pearl-btn');
    if (btn) btn.setAttribute('aria-pressed', String(pearl));
  }

  function fillRow(row) {
    const d = data[row.dataset.id];
    if (!d) return;
    syncPearl(row);
    row.querySelectorAll('.cell').forEach((input) => {
      const v = d[input.dataset.f];
      if (typeof v === 'string' && input.value !== v && document.activeElement !== input) input.value = v;
    });
    row.querySelectorAll('.pick').forEach((p) => {
      const v = d[p.dataset.f];
      setPick(p, typeof v === 'string' ? v : '');
    });
    if (d.level) paintLevel(row, d.level);
    syncLock(row);
  }

  function fillAll() {
    root.querySelectorAll('tbody tr').forEach(fillRow);
  }

  function applyEditable() {
    if (!root) return;
    const edit = canEdit();
    root.querySelectorAll('.bar').forEach((bar) => { bar.inert = !edit; });
    if (!edit) root.querySelector('.row-add').classList.remove('is-on');
    root.querySelectorAll('.cell').forEach((input) => {
      input.readOnly = !edit;
      input.tabIndex = edit ? 0 : -1;
    });
    root.querySelectorAll('.pick').forEach((p) => { p.tabIndex = edit ? 0 : -1; });
    root.classList.toggle('is-editable', edit);
    if (!edit) { closeMenu(false); clearSelection(); }
    if (isAdminMode()) INKFB.db().catch(() => {});   // 관리자 모드가 되면 저장용 SDK 를 미리 받아 둠 (첫 저장이 빠르게)
    showStatus();
  }

  // ── 잔량 열만 늘어나고 막대도 같이 길어지게 ──
  // 막대 길이는 10의 배수(칸 폭이 정수 px)로 맞추고, 남는 몇 px 는 좌우로 나눠서 가운데에 둔다.
  let resizeObs = null;

  function setupBarFit(container) {
    const table = container.querySelector('table.grid');
    const th = table.querySelectorAll('thead th')[LEVEL_COL];
    const fit = () => {
      const inner = th.getBoundingClientRect().width - 24 - 1;   // 좌우 여백 12px씩 + 오른쪽 선 1px
      const bar = Math.max(BAR_MIN, Math.floor(inner / STEPS) * STEPS);
      const ml = Math.max(0, Math.floor((inner - bar) / 2));
      table.style.setProperty('--bar-w', bar + 'px');
      table.style.setProperty('--bar-ml', ml + 'px');
      positionSelection();
    };
    if (resizeObs) resizeObs.disconnect();
    resizeObs = new ResizeObserver(fit);
    resizeObs.observe(th);
    fit();
  }

  // ── 본병/소분 드롭다운 ──────────────────
  // 칸에 값을 표시: 본병/소분은 색이 다른 알약(칩). 목록에 없는 예전 글자는 회색 칩.
  function setPick(btn, value) {
    const text = btn.querySelector('.pick-text');
    text.textContent = value;
    text.dataset.kind = value.startsWith('본병') ? 'bottle' : value.startsWith('소분') ? 'sample' : (value ? 'other' : '');
    btn.classList.toggle('has-value', !!value);
  }

  let menuEl = null;    // <ul class="menu"> (표 바깥에 둬서 스크롤 영역에 잘리지 않음)
  let menuFor = null;   // 지금 메뉴가 열려 있는 칸의 버튼(.pick)

  function openMenu(btn) {
    if (!root || !menuEl) return;
    const id = btn.closest('tr').dataset.id;
    const current = (data[id] && data[id].kind) || '';
    const firstBottle = KIND_OPTIONS.findIndex((v) => v.startsWith('본병'));

    let html = '';
    KIND_OPTIONS.forEach((v, i) => {
      if (i === firstBottle) html += '<li class="menu-sep" role="separator"></li>'; // 소분 / 본병 구분선
      html += `<li role="option" tabindex="-1" data-v="${esc(v)}" aria-selected="${v === current}">${esc(v)}</li>`;
    });
    if (current) html += '<li class="menu-sep" role="separator"></li><li class="menu-clear" role="option" tabindex="-1" data-v="" aria-selected="false">비우기</li>';
    menuEl.innerHTML = html;
    menuEl.hidden = false;

    // 칸 바로 아래에 띄우되, 화면 아래로 넘치면 위로
    const area = root.querySelector('.table-area').getBoundingClientRect();
    const cell = btn.closest('td').getBoundingClientRect();
    menuEl.style.minWidth = cell.width + 'px';
    menuEl.style.maxHeight = '';
    const mw = menuEl.offsetWidth;
    const fullH = menuEl.offsetHeight;
    const spaceBelow = window.innerHeight - cell.bottom - 8;
    const spaceAbove = cell.top - 8;
    const below = spaceBelow >= fullH || spaceBelow >= spaceAbove;   // 공간이 더 넓은 쪽으로
    const mh = Math.min(fullH, below ? spaceBelow : spaceAbove);     // 그래도 모자라면 메뉴 안에서 스크롤
    menuEl.style.maxHeight = mh + 'px';
    const left = Math.max(0, Math.min(cell.left, window.innerWidth - mw - 8));
    menuEl.style.left = (left - area.left) + 'px';
    menuEl.style.top = ((below ? cell.bottom : cell.top - mh) - area.top) + 'px';

    menuFor = btn;
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('is-open');
    (menuEl.querySelector('[aria-selected="true"]') || menuEl.querySelector('[role="option"]')).focus();
  }

  function closeMenu(focusBtn) {
    if (menuEl) menuEl.hidden = true;
    if (!menuFor) return;
    const btn = menuFor;
    menuFor = null;
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('is-open');
    if (focusBtn) btn.focus();
  }

  function choose(value) {
    const btn = menuFor;
    if (!btn) return;
    const tr = btn.closest('tr');
    const id = tr.dataset.id;
    const current = (data[id] && data[id].kind) || '';
    closeMenu(true);
    if (!canEdit() || value === current) return;
    setPick(btn, value);
    queueSave(id, 'kind', value);
    syncLock(tr);          // 소분이면 소분 가능·가격 칸에 대각선 + 입력 잠금
    positionSelection();
  }

  // 메뉴 바깥을 누르면 닫기 (한 번만 등록)
  document.addEventListener('pointerdown', (e) => {
    if (menuFor && !menuEl.contains(e.target) && !menuFor.contains(e.target)) closeMenu(false);
  });
  window.addEventListener('resize', () => closeMenu(false));

  // ── 칸 선택 + 채우기 핸들 (스프레드시트처럼) ──
  // 내용이 있는 칸을 선택하면 테두리 오른쪽 아래 꼭짓점에 작은 원이 나타난다.
  // 그 원을 누른 채 아래로 끌면, 지나간 칸에 선택한 칸과 같은 내용이 채워진다.
  // (끌어서 지나간 칸의 기존 내용은 덮어쓴다. 소분 행의 대각선 칸은 건너뛴다.)
  let sel = null;       // { c: 열 번호, r0: 원본 행, r1: 마지막 행 }
  let drag = null;      // 끄는 중: { c, s, t, y }
  let selBox = null;
  let handle = null;
  let dragRaf = 0;

  const tbodyEl = () => root.querySelector('tbody');

  function valueAt(r, c) {
    const tr = tbodyEl().rows[r];
    if (!tr) return '';
    const d = data[tr.dataset.id] || {};
    const key = COLUMNS[c].key;
    return key === 'level' ? (d.level || 0) : (typeof d[key] === 'string' ? d[key] : '');
  }

  function clearSelection() {
    sel = null;
    if (selBox) { selBox.hidden = true; handle.hidden = true; }
  }

  function positionSelection() {
    if (!root || !selBox) return;
    if (!sel || !canEdit()) { selBox.hidden = true; handle.hidden = true; return; }
    const tbody = tbodyEl();
    const top = tbody.rows[sel.r0] && tbody.rows[sel.r0].cells[sel.c];
    const bottom = tbody.rows[sel.r1] && tbody.rows[sel.r1].cells[sel.c];
    if (!top || !bottom) { selBox.hidden = true; handle.hidden = true; return; }

    const wrap = root.querySelector('.table-wrap');
    const table = root.querySelector('table.grid');
    const w = wrap.getBoundingClientRect();
    const a = top.getBoundingClientRect();
    const b = bottom.getBoundingClientRect();
    const left = a.left - w.left - wrap.clientLeft + wrap.scrollLeft;
    const y = a.top - w.top - wrap.clientTop + wrap.scrollTop;
    const width = a.width;
    const height = b.bottom - a.top;

    selBox.style.cssText = `left:${left}px;top:${y}px;width:${width}px;height:${height}px`;
    selBox.hidden = false;

    // 핸들은 원본 칸에 내용이 있을 때만. (표 가장자리 밖으로 삐져나가 스크롤이 생기지 않게 안쪽으로 맞춤)
    const hasValue = !!valueAt(sel.r0, sel.c);
    handle.hidden = !hasValue;
    handle.style.left = Math.min(left + width, table.offsetWidth - 5) + 'px';
    handle.style.top = Math.min(y + height, table.offsetHeight - 5) + 'px';
  }

  function selectCell(td) {
    if (!canEdit() || !td || !td.parentElement) return;
    sel = { c: td.cellIndex, r0: td.parentElement.sectionRowIndex, r1: td.parentElement.sectionRowIndex };
    positionSelection();
  }

  function applyFill(c, s, t) {
    const key = COLUMNS[c].key;
    const val = valueAt(s, c);
    const tbody = tbodyEl();
    for (let i = s + 1; i <= t; i++) {
      const tr = tbody.rows[i];
      if (!tr) break;
      if (COLUMNS[c].lockable && tr.classList.contains('is-sample')) continue; // 대각선 칸은 건너뜀
      if (valueAt(i, c) === val) continue;
      if (key === 'level') paintLevel(tr, val);
      else if (key === 'kind') setPick(tr.querySelector('.pick'), val);
      else tr.querySelector(`.cell[data-f="${key}"]`).value = val;
      queueSave(tr.dataset.id, key, val);
      if (key === 'kind') syncLock(tr);
    }
  }

  function setupFill(container) {
    const wrap = container.querySelector('.table-wrap');
    const thead = container.querySelector('thead');
    selBox = container.querySelector('.sel-box');
    handle = container.querySelector('.fill-handle');
    sel = null;
    drag = null;

    function updateDragTarget() {
      const tbody = tbodyEl();
      const rowH = tbody.rows[0].offsetHeight;
      const rel = drag.y - wrap.getBoundingClientRect().top - wrap.clientTop - thead.offsetHeight + wrap.scrollTop;
      const t = Math.max(drag.s, Math.min(tbody.rows.length - 1, Math.floor(rel / rowH)));
      if (t !== drag.t) { drag.t = t; sel = { c: drag.c, r0: drag.s, r1: t }; positionSelection(); }
    }

    function autoScroll() {
      if (!drag) return;
      const wr = wrap.getBoundingClientRect();
      const edge = 40;
      if (drag.y > wr.bottom - edge) {
        wrap.scrollTop += Math.min(28, (drag.y - (wr.bottom - edge)) / 2 + 4); // 아래쪽 가장자리에서는 표가 따라 내려감
        updateDragTarget();
        positionSelection();
      }
      dragRaf = requestAnimationFrame(autoScroll);
    }

    function endDrag(commit) {
      if (!drag) return;
      const d = drag;
      drag = null;
      cancelAnimationFrame(dragRaf);
      root.classList.remove('is-filling');
      if (commit && d.t > d.s) applyFill(d.c, d.s, d.t);
      positionSelection();
    }

    handle.addEventListener('pointerdown', (e) => {
      if (!sel || !canEdit() || e.button > 0) return;
      e.preventDefault();
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 포인터를 못 잡아도 동작은 계속 */ }
      drag = { c: sel.c, s: sel.r0, t: sel.r1, y: e.clientY };
      root.classList.add('is-filling');
      closeMenu(false);
      dragRaf = requestAnimationFrame(autoScroll);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.y = e.clientY;
      updateDragTarget();
    });
    handle.addEventListener('pointerup', () => endDrag(true));
    handle.addEventListener('pointercancel', () => endDrag(false));
    handle.addEventListener('lostpointercapture', () => endDrag(false));
  }

  // 아무 곳에도 커서가 없을 때(빈 곳을 눌렀거나 처음 들어왔을 때) ↑ ↓ 로 표를 스크롤.
  // 표(또는 표 안)에 커서가 있으면 브라우저 기본 스크롤/위의 칸 이동이 처리한다.
  document.addEventListener('keydown', (e) => {
    if (!root || e.defaultPrevented || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    const wrap = root.querySelector('.table-wrap');
    if (!wrap) return;
    e.preventDefault();
    wrap.scrollBy({ top: (e.key === 'ArrowDown' ? 1 : -1) * 40 });
  });

  // 표 바깥을 누르면 선택 해제 (끄는 중에는 유지)
  document.addEventListener('pointerdown', (e) => {
    if (!root || drag || !sel) return;
    if (!e.target.closest('.table-wrap') && !e.target.closest('.menu')) clearSelection();
  });

  // ── 행 추가 ─────────────────────────────
  // b: 새 행이 들어갈 자리(0부터). b번째 행 "앞"에 빈 행을 끼워 넣는다.
  function insertRow(b) {
    if (!root || !canEdit() || b < 1 || b > order.length) return;
    if (order.length >= MAX_ROWS) {
      showNotice(`행은 최대 ${MAX_ROWS}개까지 추가할 수 있습니다.`);
      setTimeout(() => showNotice(''), 3500);
      return;
    }
    const id = newId();
    order.splice(b, 0, id);
    queueOrder();

    const tbody = tbodyEl();
    tbody.rows[b].insertAdjacentHTML('beforebegin', rowHtml(id, b + 1));
    const tr = tbody.rows[b];
    tr.classList.add('row-new');
    relabel(b + 1);
    clearSelection();
    applyEditable();
    tr.querySelector('.cell').focus(); // 바로 입력할 수 있게 첫 칸에 커서
  }

  // ── 행 추가 버튼 위치 (행과 행 사이 선에 말풍선 꼬리 끝을 맞춤) ──
  // Lucide "message-square-plus" 를 바탕으로, 꼬리를 message-circle-plus 처럼 모서리의 대각선(45°) 위치에 둔 모양을 좌우반전.
  // 반전하면 꼬리가 오른쪽 아래로 가서 표를 향한다.
  const ROW_ADD_ICON = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 17a2 2 0 0 1-2 2H7.2l-5.2 2L4 15.8V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8v6"/><path d="M10 11h6"/></svg>';
  const ROW_ADD_SIZE = 19;
  const TAIL_Y = (22 / 24) * ROW_ADD_SIZE; // 아이콘 맨 아래(꼬리 끝, 선 굵기 포함)의 높이
  const NEAR = 12;                         // 선에서 이 거리(px) 안이면 "행과 행 사이"로 본다

  function setupRowAdd(container) {
    const area = container.querySelector('.table-area');
    const wrap = container.querySelector('.table-wrap');
    const thead = container.querySelector('thead');
    const tbody = container.querySelector('tbody');
    const btn = container.querySelector('.row-add');

    const hide = () => btn.classList.remove('is-on');

    // 포인터 높이(clientY)가 가리키는 "행 사이 경계 번호"(1 ~ 행 수-1). 없으면 null.
    function boundaryAt(clientY) {
      if (!tbody.rows.length) return null;
      const top = wrap.getBoundingClientRect().top + wrap.clientTop;
      const headH = thead.offsetHeight;
      const rowH = tbody.rows[0].offsetHeight;
      const rel = clientY - top - headH + wrap.scrollTop;
      if (clientY < top + headH || clientY > top + wrap.clientHeight || rel < 0) return null;
      const r = Math.floor(rel / rowH);
      const within = rel - r * rowH;
      const b = within <= NEAR ? r : (within >= rowH - NEAR ? r + 1 : null);
      return b !== null && b >= 1 && b <= tbody.rows.length - 1 ? b : null;
    }

    function update(e) {
      if (drag || !canEdit() || e.target.closest('.row-add')) return; // 버튼 위에 있으면 그대로 유지
      const b = boundaryAt(e.clientY);
      if (b === null) { hide(); return; }
      const top = wrap.getBoundingClientRect().top + wrap.clientTop;
      const headH = thead.offsetHeight;
      const rowH = tbody.rows[0].offsetHeight;
      const lineY = top + headH + b * rowH - wrap.scrollTop - 0.5; // 경계선(1px)의 중앙
      if (lineY < top + headH || lineY > top + wrap.clientHeight) { hide(); return; }
      btn.style.top = (lineY - area.getBoundingClientRect().top - TAIL_Y) + 'px';
      btn.dataset.before = b; // b번째 행(0부터) 앞에 추가
      btn.classList.add('is-on');
    }

    area.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') update(e); });
    area.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') update(e); }); // 터치: 선 근처를 누르면 표시
    area.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    wrap.addEventListener('scroll', hide, { passive: true });

    btn.addEventListener('click', () => {
      const b = Number(btn.dataset.before);
      hide();
      insertRow(b);
    });
  }

  function mount(container) {
    root = container;
    hydrateFromCache();   // 전에 받아 둔 내용이 있으면 처음부터 채워서 그림
    container.innerHTML = `
      <p class="notice" role="alert" hidden></p>
      <div class="table-area view-enter">
        <button class="row-add" type="button" title="행 추가" aria-label="이 위치에 행 추가">${ROW_ADD_ICON}</button>
        <ul class="menu" role="listbox" aria-label="본병/소분" hidden></ul>
        <div class="table-wrap" tabindex="0" role="region" aria-label="보유 잉크 표">
          <table class="grid" style="min-width:${BASE_WIDTH}px">
            <colgroup>${COLUMNS.map((c, i) => (i === LEVEL_COL ? '<col>' : `<col style="width:${c.width}px">`)).join('')}</colgroup>
            <thead><tr>${COLUMNS.map((c) => `<th scope="col">${c.label}</th>`).join('')}</tr></thead>
            <tbody>${rowsHtml()}</tbody>
          </table>
          <div class="sel-box" hidden></div>
          <button class="fill-handle" type="button" tabindex="-1" aria-label="아래로 끌어서 채우기" hidden></button>
        </div>
      </div>`;

    const tbody = container.querySelector('tbody');
    menuEl = container.querySelector('.menu');
    menuFor = null;
    setupRowAdd(container);
    setupFill(container);
    setupBarFit(container);
    fillAll();
    applyEditable();
    if (loadState === 'error') loadState = 'idle'; // 오류였다면 화면에 다시 들어올 때 재시도
    load();

    // 칸에 커서가 들어가면 그 칸을 선택
    tbody.addEventListener('focusin', (e) => {
      const td = e.target.closest('td');
      if (td && canEdit() && !drag) selectCell(td);
    });

    // 글자 입력 → 자동 저장
    tbody.addEventListener('input', (e) => {
      const input = e.target.closest('.cell');
      if (!input || !canEdit()) return;
      queueSave(input.closest('tr').dataset.id, input.dataset.f, input.value);
      positionSelection(); // 내용이 생기거나 사라지면 핸들 표시도 바뀜
    });

    // 칸 안에서 ↓ / Enter: 아래 칸으로, ↑ / Shift+Enter: 위 칸으로 (표가 따라 스크롤됨).
    // 한글 조합 중에는 무시. 잠긴(대각선) 칸은 건너뜀. 본병/소분 칸은 ↑↓로 이동, Alt+↑↓ / Enter / Space 로 목록 열기.
    tbody.addEventListener('keydown', (e) => {
      const el = e.target.closest('.cell, .pick');
      if (!el || e.isComposing || e.keyCode === 229) return;
      const isPick = el.classList.contains('pick');
      let dir = 0;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (e.shiftKey || e.ctrlKey || e.metaKey) return;
        if (isPick && e.altKey) { if (canEdit()) { e.preventDefault(); openMenu(el); } return; }
        if (e.altKey) return;
        dir = e.key === 'ArrowDown' ? 1 : -1;
      } else if (e.key === 'Enter' && !isPick) {
        dir = e.shiftKey ? -1 : 1;
      }
      if (!dir) return;
      e.preventDefault();
      let tr = el.closest('tr');
      for (;;) {
        tr = dir > 0 ? tr.nextElementSibling : tr.previousElementSibling;
        if (!tr) return;
        const next = tr.querySelector(`[data-f="${el.dataset.f}"]`);
        if (next && !next.disabled) { next.focus(); return; }
      }
    });

    // 잔량 막대: 마우스를 올린 칸까지 미리보기 (관리자 모드에서만 bar 가 inert 가 아니라서 동작)
    tbody.addEventListener('mouseover', (e) => {
      const seg = e.target.closest('.seg');
      if (seg && !seg.closest('.bar').inert) seg.closest('.bar').style.setProperty('--pv', seg.dataset.i);
    });
    tbody.addEventListener('mouseout', (e) => {
      const bar = e.target.closest('.bar');
      if (bar && !bar.contains(e.relatedTarget)) bar.style.removeProperty('--pv');
    });

    // 본병/소분 칸: 누르면 드롭다운
    tbody.addEventListener('click', (e) => {
      const pick = e.target.closest('.pick');
      if (!pick || !canEdit()) return;
      selectCell(pick.closest('td'));
      if (menuFor === pick) closeMenu(true); else openMenu(pick);
    });
    menuEl.addEventListener('click', (e) => {
      const li = e.target.closest('[role="option"]');
      if (li) choose(li.dataset.v);
    });
    menuEl.addEventListener('keydown', (e) => {
      const items = [...menuEl.querySelectorAll('[role="option"]')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (i >= 0) choose(items[i].dataset.v); }
      else if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
      else if (e.key === 'Tab') { closeMenu(false); }
    });
    container.querySelector('.table-wrap').addEventListener('scroll', () => closeMenu(false), { passive: true });

    // 잉크명 칸의 ✦ 버튼: 펄 잉크 표시 켜기/끄기
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('.pearl-btn');
      if (!btn || !canEdit()) return;
      const tr = btn.closest('tr');
      const id = tr.dataset.id;
      queueSave(id, 'pearl', !(data[id] && data[id].pearl));
      syncPearl(tr);
    });

    // 잔량 막대 클릭
    tbody.addEventListener('click', (e) => {
      const seg = e.target.closest('.seg');
      if (!seg || !canEdit()) return;
      const row = seg.closest('tr');
      const id = row.dataset.id;
      const i = Number(seg.dataset.i);
      const current = (data[id] && data[id].level) || 0;
      const next = current === i ? 0 : i;
      paintLevel(row, next);
      queueSave(id, 'level', next);
      selectCell(seg.closest('td'));
    });
  }

  function unmount() {
    closeMenu(false);
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    cancelAnimationFrame(dragRaf);
    drag = null;
    sel = null;
    selBox = null;
    handle = null;
    menuEl = null;
    root = null;
    showStatus();
  }

  // ── 사이드바용 개수 (본병 / 소분) ────────
  // 표 데이터에서 바로 세기 때문에 표를 고치면 사이드바 숫자도 같이 바뀐다.
  // 화면(app.js)은 subscribe 로 숫자를 받고, 처음 사이드바를 열 때 init 으로 데이터를 불러온다.
  const statsSubs = [];

  // 본병/소분: 종류 칸 기준. 펄/스탠다드: 잉크명이 있는 행 중 펄 표시가 된 것 / 아닌 것.
  function computeStats() {
    let bottle = 0;
    let sample = 0;
    let pearl = 0;
    let standard = 0;
    order.forEach((id) => {
      const d = data[id] || {};
      const kind = d.kind || '';
      if (kind.startsWith('본병')) bottle++;
      else if (kind.startsWith('소분')) sample++;
      if (d.name) { if (d.pearl) pearl++; else standard++; }
    });
    return { total: pearl + standard, bottle, sample, pearl, standard };   // 잉크 개수 = 잉크명이 있는 행
  }

  function emitStats() {
    if (loadState !== 'ready' && !hydrated) return;   // 보관해 둔 내용도 일단 보여 주고, 최신 내용이 오면 갱신
    const s = computeStats();
    statsSubs.forEach((fn) => fn(s));
  }

  window.INKVENTORY_STATS = {
    subscribe(fn) { statsSubs.push(fn); emitStats(); },
    init() { hydrateFromCache(); emitStats(); load(); },
  };

  window.INKVENTORY_VIEWS = window.INKVENTORY_VIEWS || {};
  window.INKVENTORY_VIEWS['ink-owned'] = {
    mount,
    unmount,
    onMode() { applyEditable(); },
  };
})();

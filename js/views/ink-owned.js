// 보유 잉크 표: 브랜드 / 잉크명 / 본병·소분 / 잔량 / 비고 / 소분 가능 / 가격 (처음 270행, 행 사이에 추가 가능)
//  - 잔량 막대: 10칸. 칸을 누르면 그 칸과 왼쪽 칸이 모두 채워진다. 같은 칸을 다시 누르면 0.
//    화면이 넓어지면 잔량 열만 늘어나고 막대도 같이 길어진다(칸 폭은 항상 정수 px).
//  - 글자 칸: 관리자 모드에서 바로 입력.
//  - 본병/소분 칸: 클릭하면 드롭다운. "소분"을 고른 행의 소분 가능·가격 칸은 대각선이 그어지고 입력할 수 없다.
//  - 행과 행 사이에 마우스를 두면 나타나는 아이콘으로 그 자리에 빈 행을 추가.
//  - 잔량 칸의 막대(병)는 우클릭(폰은 길게 누르기) 메뉴로 추가·삭제한다.
//  - 칸을 선택하면 오른쪽 아래 꼭짓점에 작은 원(채우기 핸들)이 나타나고, 아래로 끌면 같은 내용이 채워진다. (잔량 칸 제외)
//  - 모든 변경은 자동 저장. 수정은 관리자 모드에서만 가능.
//    (화면에서 막는 것은 편의일 뿐, 실제 쓰기 권한은 Firestore 보안 규칙이 서버에서 막는다.)
//
// 저장 구조 (문서 둘):
//  ① 공개 문서 inventory/inkOwned — 누구나 읽을 수 있음
//     { order: ["0","1",...,"n8x2k1ab",...],            ← 행 순서 (행 id 목록)
//       rows:  { "<행 id>": { brand, name, kind, note, pearl, hasPortions } } }
//  ② 관리자 전용 문서 inventory/inkPrivate — 읽기·쓰기 모두 관리자만 (일반 모드에서는 아예 불러오지 않음)
//     { rows: { "<행 id>": { levels:[막대별 잔량], price, portions } } }
//   - hasPortions 는 "소분 가능 개수가 적혀 있는지"만 알려 주는 공개 표시. 일반 모드는 이것으로 O 를 그린다.
//   - 공개 문서에 혹시 level / price / portions 가 들어 있어도 읽을 때 무시한다(비공개 값은 ② 에서만 읽는다).
//   - 행마다 바뀌지 않는 id 를 가진다. 중간에 행을 끼워 넣어도 다른 행의 데이터는 건드리지 않고 order 만 바뀐다.
//   - order 가 없는 예전 데이터는 id "0"~"269" 순서로 본다.
(() => {
  'use strict';

  const DEFAULT_ROWS = 270;
  const MAX_ROWS = 600;                          // 문서 하나(1MiB 제한)에 안전하게 담기 위한 상한
  const STEPS = 10;
  const DOC_PATH = ['inventory', 'inkOwned'];            // 공개 문서
  const PRIVATE_PATH = ['inventory', 'inkPrivate'];      // 관리자 전용 문서
  const PRIVATE_FIELDS = ['levels', 'price', 'portions'];   // 관리자 전용 문서에만 저장하는 필드 (예전 level 도 여기로 옮김)
  const LEGACY_PRIVATE = ['level', ...PRIVATE_FIELDS];
  const SAVE_DELAY = 600;                       // 입력을 멈추고 이 시간(ms)이 지나면 저장
  const RETRY_DELAY = 5000;

  // width 는 기본 너비. 잔량 열만 화면이 넓으면 늘어난다(width 는 그때의 최소값).
  const COLUMNS = [
    { key: 'brand',    label: '브랜드',          width: 180, max: 100 },
    { key: 'name',     label: '잉크명',          width: 260, max: 100, pearlToggle: true },   // 펄 잉크는 셀을 연한 파랑으로 칠함
    { key: 'kind',     label: '본병/소분',       width: 128, pick: true },   // 클릭하면 드롭다운
    { key: 'swatch',   label: '발색',            width: 64 },                // 잉크 발색 사진이 들어가는 원 (img/swatch/ 의 사진)
    { key: 'level',    label: '잔량',            width: 205 },               // 막대 180px + 좌우 여백 12px씩 + 오른쪽 선 1px
    { key: 'note',     label: '비고',            width: 180, max: 300 },
    { key: 'portions', label: '소분 가능 (5ml)', width: 130, max: 20, lockable: true },
    { key: 'price',    label: '가격',            width: 110, max: 50, lockable: true },
  ];
  const BASE_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0);
  const LEVEL_COL = COLUMNS.findIndex((c) => c.key === 'level');
  const BAR_MIN = 180;        // 막대 최소 길이(px). 항상 10의 배수
  const MAX_BARS = 6;         // 한 칸에 둘 수 있는 막대(병) 수의 안전 상한. 보통은 3개 이내
  // 일반 모드 배치: 가격 열은 없애고, 잔량 열은 내용 없이 펄 칸 색으로 채운다. 소분 가능 열은 좁게(O 표시만). (CSS html[data-layout="normal"])
  const NORMAL_PORTIONS_W = 72;   // 일반 모드의 소분 가능 열 너비
  const HIDDEN_IN_NORMAL = ['price', 'kind', 'level'];   // 일반 모드에서 없애는 열
  const NORMAL_W = COLUMNS.reduce((sum, c) => sum + (HIDDEN_IN_NORMAL.includes(c.key) ? 0 : c.key === 'portions' ? NORMAL_PORTIONS_W : c.width), 0);

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
  // 관리자 전용 데이터(잔량·가격·소분 가능 개수): 관리자 모드에서만 불러온다
  let privState = 'idle';       // idle | loading | ready | error
  let privData = null;          // 관리자 전용 문서 내용 { rows: {...} }
  let root = null;              // 현재 화면 컨테이너
  const pending = new Map();    // 아직 저장 안 된 변경. 키: "id|필드" 또는 "@order"
  let saveTimer = null;
  let saving = false;
  let saveStatus = '';          // '' | saving | saved | error | denied

  const isAdminMode = () => document.documentElement.dataset.mode === 'admin';
  const canEdit = () => isAdminMode() && loadState === 'ready' && privState === 'ready';
  const hasText = (v) => { const s = String(v == null ? '' : v).trim(); return !!s && s !== '0'; };
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
    if (field === 'portions') {   // 개수 자체는 관리자 전용, "적혀 있는지"만 공개 표시(hasPortions)로 함께 저장
      data[id].hasPortions = hasText(value);
      pending.set(id + '|hasPortions', { id, field: 'hasPortions', value: data[id].hasPortions });
    }
    setStatus('saving');
    if (field === 'kind' || field === 'name' || field === 'pearl') emitStats();   // 사이드바 개수 갱신
    scheduleFlush(field === 'level' || field === 'levels' ? 0 : SAVE_DELAY);
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
      // 공개 문서와 관리자 전용 문서로 나눠서 저장
      const pub = {};
      const priv = {};
      batch.forEach(([, e]) => {
        if (e.order) { pub.order = e.order; return; }
        const target = PRIVATE_FIELDS.includes(e.field) ? priv : (pub.rows = pub.rows || {});
        (target[e.id] = target[e.id] || {})[e.field] = e.value;
      });
      const jobs = [];
      if (pub.order || pub.rows) jobs.push(setDoc(doc(db, ...DOC_PATH), pub, { merge: true }));
      if (Object.keys(priv).length) jobs.push(setDoc(doc(db, ...PRIVATE_PATH), { rows: priv }, { merge: true }));
      await Promise.all(jobs);
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
  const CACHE_KEY = 'inkventory.cache.v2';   // 공개 내용만 보관. (v1 보관본에는 잔량·가격이 들어 있어 지운다)
  try { localStorage.removeItem('inkventory.cache.v1'); } catch (err) { /* 무시 */ }
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
    Object.keys(rows).forEach((id) => {
      const src = rows[id] || {};
      const pub = {};
      Object.keys(src).forEach((k) => { if (!LEGACY_PRIVATE.includes(k)) pub[k] = src[k]; });   // 비공개 필드는 공개 문서에서 읽지 않는다
      pub.hasPortions = src.hasPortions === true;   // 일반 모드에서 O 를 그릴 공개 표시
      data[id] = pub;
    });
    if (privData) mergePrivate();   // 관리자 전용 값을 이미 불러왔다면 다시 합침
  }

  // 관리자 전용 문서의 값을 화면용 data 에 합친다. 관리자 모드에서만 호출됨.
  function mergePrivate() {
    const rows = (privData && privData.rows) || {};
    Object.keys(data).forEach((id) => {
      const p = rows[id] || {};
      PRIVATE_FIELDS.forEach((k) => { if (p[k] !== undefined) data[id][k] = p[k]; });
    });
  }

  // 일반 모드로 돌아가면 메모리에서도 관리자 전용 값을 지운다
  function dropPrivate() {
    privData = null;
    privState = 'idle';
    Object.keys(data).forEach((id) => { LEGACY_PRIVATE.forEach((k) => { delete data[id][k]; }); });
    if (root) {   // 화면에 남은 값도 지움
      root.querySelectorAll('.cell[data-f="price"], .cell[data-f="portions"]').forEach((input) => { input.value = ''; });
      fillAll();
    }
  }

  async function loadPrivate() {
    if (!isAdminMode() || loadState !== 'ready' || privState === 'loading' || privState === 'ready') return;
    privState = 'loading';
    try {
      const { db, doc, getDoc } = await INKFB.db();
      const snap = await getDoc(doc(db, ...PRIVATE_PATH));
      privData = snap.exists() ? snap.data() : { rows: {} };
      privState = 'ready';
      mergePrivate();
      if (root) { fillAll(); applyEditable(); }
    } catch (err) {
      privState = 'error';
      showNotice('관리자 전용 데이터(잔량·가격·소분 가능)를 불러오지 못했습니다. 새로고침해 주세요.');
    }
  }

  // 공개 내용만 요약 (보관본·변경 비교용). 관리자 전용 값은 절대 넣지 않는다.
  function publicRows() {
    const out = {};
    Object.keys(data).forEach((id) => {
      const row = {};
      Object.keys(data[id]).forEach((k) => { if (!LEGACY_PRIVATE.includes(k)) row[k] = data[id][k]; });
      out[id] = row;
    });
    return out;
  }
  const snapshot = () => JSON.stringify({ order, rows: publicRows() });

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

  // ── 잔량 막대 여러 개 ──
  // 저장: rows[id].levels = [막대1 잔량, 막대2 잔량, ...] (0~10). 예전 데이터(level 숫자 하나)는 첫 번째 막대로 읽는다.
  const clampLevel = (v) => Math.max(0, Math.min(STEPS, Number(v) || 0));

  function getLevels(id) {
    const d = data[id] || {};
    if (Array.isArray(d.levels) && d.levels.length) return d.levels.slice(0, MAX_BARS).map(clampLevel);
    return [clampLevel(d.level)];
  }

  function setLevels(id, levels) {
    queueSave(id, 'levels', levels.slice());
  }

  const lineHtml = () => `<div class="bar-line">${barHtml()}</div>`;

  function paintBar(bar, level) {
    bar.style.setProperty('--lv', level);
    bar.dataset.level = level;
    // 채워진 영역 안에 놓인 구분선은 어두운 색으로 (CSS .seg.in)
    bar.querySelectorAll('.seg').forEach((seg, idx) => seg.classList.toggle('in', idx + 1 <= level));
  }

  // 행의 막대 줄 수와 값을 데이터에 맞춘다 (2개 이상이면 칸에 .multi → 촘촘하게 쌓음)
  function syncBars(tr) {
    const levels = getLevels(tr.dataset.id);
    const holder = tr.querySelector('.bars');
    let lines = holder.querySelectorAll('.bar-line');
    while (lines.length < levels.length) { holder.insertAdjacentHTML('beforeend', lineHtml()); lines = holder.querySelectorAll('.bar-line'); }
    while (lines.length > levels.length) { lines[lines.length - 1].remove(); lines = holder.querySelectorAll('.bar-line'); }
    const edit = canEdit();
    lines.forEach((line, i) => {
      const bar = line.querySelector('.bar');
      paintBar(bar, levels[i]);
      bar.inert = !edit;
      bar.title = edit ? '우클릭: 막대 추가·삭제' : '';
      bar.setAttribute('aria-label', levels.length > 1 ? `잔량 ${i + 1}번째 병` : '잔량');
    });
    tr.querySelector('td.c-level').classList.toggle('multi', levels.length > 1);
  }

  // 소분 가능 칸: 일반 모드에서는 숫자 대신 O 표시(내용이 있을 때만). CSS 가 .has-val 로 그린다.
  // (공개 표시 hasPortions 로 그린다. 개수 자체는 관리자 전용이라 일반 모드에는 없음)
  function syncPortionsMark(tr) {
    const td = tr.querySelector('td.col-portions');
    if (td) td.classList.toggle('has-val', !!(data[tr.dataset.id] && data[tr.dataset.id].hasPortions));
  }

  function rowHtml(id, n) {
    const cells = COLUMNS.map((c) => {
      if (c.key === 'level') return `<td class="c-level col-level"><div class="bars">${lineHtml()}</div></td>`;
      if (c.key === 'swatch') return `<td class="c-swatch col-swatch"><span class="swatch"></span></td>`;
      if (c.pick) {
        return `<td class="c-text col-${c.key}"><button class="pick" type="button" data-f="${c.key}" data-label="${c.label}" aria-label="${c.label} ${n}행" aria-haspopup="listbox" aria-expanded="false" tabindex="-1"><span class="pick-text"></span></button></td>`;
      }
      const input = `<textarea class="cell" rows="1" wrap="off" data-f="${c.key}" data-label="${c.label}" maxlength="${c.max}" aria-label="${c.label} ${n}행" autocomplete="off" spellcheck="false" readonly tabindex="-1"></textarea>`;
      if (c.pearlToggle) {
        return `<td class="c-text c-name col-${c.key}">${input}<button class="pearl-btn" type="button" tabindex="-1" aria-pressed="false" title="펄 잉크로 표시" aria-label="펄 잉크로 표시">${SPARKLES_ICON}</button></td>`;
      }
      return `<td class="c-text col-${c.key}${c.lockable ? ' c-lockable' : ''}">${input}</td>`;
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
    prevOrder = null;
    renderBrands();
  }

  // ── 브랜드별 잉크 개수 (표 왼쪽 패널) ──
  // 브랜드 칸 글자의 "가장 앞 단어(들)"로 묶는다. 예: "디아민", "디아민 뉴욕 에디션", "디아민 X 컬트펜" → 디아민 /
  // "코바야시 문구관", "코바야시 문구관 Team Love" → 코바야시 문구관.
  // 묶는 기준 이름: 아래 목록 + 표에서 다른 브랜드 글자의 앞부분이 되는 브랜드(예: 표에 "디아민"이 따로 있으면 자동).
  // 새 브랜드가 "세일러"처럼 단독 행 없이 변형만 있을 때는 이 목록에 추가해 주면 된다.
  // 잉크명이 있는 행만 센다(사이드바 '잉크 개수'와 같은 기준). 순서는 표에 처음 나온 순서. 이름을 누르면 그 브랜드의 첫 행으로 이동.
  const BRAND_NAMES = [
    '3•O', '글입다', '나가사와 고베', '도미넌트 인더스트리', '디아민', '로버트 오스터',
    '빈타', '세일러', '코바야시 문구관', '토노 앤 림스', '펜하우스',
    '파이롯트', '펠리칸', '오로라', '타치아', '반미',
  ];
  const cleanBrand = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();

  function renderBrands() {
    const list = root && root.querySelector('.brand-list');
    if (!list) return;
    const rows = [];
    order.forEach((id) => {
      const d = data[id] || {};
      if (!String(d.name || '').trim()) return;
      rows.push({ id, b: cleanBrand(d.brand) });
    });
    // 묶는 기준 이름: 목록 + 다른 브랜드 글자의 앞부분(단어 경계)이 되는 브랜드
    const present = [...new Set(rows.map((r) => r.b).filter(Boolean))];
    const keys = new Set(BRAND_NAMES.map(cleanBrand));
    present.forEach((s) => { if (present.some((t) => t !== s && t.startsWith(s + ' '))) keys.add(s); });
    const keyList = [...keys].sort((x, y) => x.length - y.length);   // 가장 짧은(가장 앞) 이름을 우선
    const groupOf = (b) => {
      if (!b) return '(브랜드 없음)';
      const k = keyList.find((c) => b === c || b.startsWith(c + ' '));
      return k || b;
    };
    const groups = [];
    const byName = new Map();
    let total = 0;
    rows.forEach(({ id, b: raw }) => {
      const b = groupOf(raw);
      let g = byName.get(b);
      if (!g) { g = { b, n: 0, id }; byName.set(b, g); groups.push(g); }
      g.n++;
      total++;
    });
    list.innerHTML = groups.map((g) => `<li><button type="button" data-id="${esc(g.id)}" title="${esc(g.b)}"><span class="bn">${esc(g.b)}</span><span class="bc">${g.n}</span></button></li>`).join('');
    const sum = root.querySelector('.brand-panel__sum');
    if (sum) sum.textContent = `${groups.length}곳 · ${total}개`;
  }

  // ── 정렬 ──
  // 브랜드 가나다순 → 같은 브랜드 안에서 잉크명 가나다순. 숫자는 크기순(No.22 < No.79), 영문은 대소문자 무시.
  // 글자 종류 순서: 기호 → 숫자 → 한글 → 영문 → 그 밖(그리스 문자 등). 한글이 있는 이름에서는 한자를 무시(한자 뒤의 한글 읽기로 정렬).
  // 그래서 "글입다" → "글입다 만우절 에디션" → "글입다 X 민음사" 처럼 기본 브랜드가 앞, 한글 변형, 콜라보(X) 순이 된다.
  let prevOrder = null;   // 정렬 직전 순서 (되돌리기용)

  function sortText(s) {
    let t = String(s == null ? '' : s).normalize('NFC').toLowerCase();
    if (/[가-힣ㄱ-ㆎ]/.test(t)) t = t.replace(/[㐀-䶿一-鿿豈-﫿]/g, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  function charRank(cp) {
    if (cp === 32) return 0;
    if (cp >= 48 && cp <= 57) return 2;
    if ((cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x3131 && cp <= 0x318e) || (cp >= 0x1100 && cp <= 0x11ff)) return 3;
    if (cp >= 97 && cp <= 122) return 4;
    if (cp < 128 || (cp >= 0x2000 && cp <= 0x2bff)) return 1;
    return 5;
  }

  function compareText(a, b) {
    const isDigit = (c) => c >= 48 && c <= 57;
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      const ca = a.codePointAt(i);
      const cb = b.codePointAt(j);
      if (isDigit(ca) && isDigit(cb)) {
        let ei = i; while (ei < a.length && isDigit(a.charCodeAt(ei))) ei++;
        let ej = j; while (ej < b.length && isDigit(b.charCodeAt(ej))) ej++;
        const na = Number(a.slice(i, ei));
        const nb = Number(b.slice(j, ej));
        if (na !== nb) return na < nb ? -1 : 1;
        i = ei; j = ej;
        continue;
      }
      if (ca !== cb) {
        const ra = charRank(ca);
        const rb = charRank(cb);
        if (ra !== rb) return ra - rb;
        return ca < cb ? -1 : 1;
      }
      i += ca > 0xffff ? 2 : 1;
      j += cb > 0xffff ? 2 : 1;
    }
    return (a.length - i) - (b.length - j);   // 한쪽이 먼저 끝나면 짧은 쪽이 앞
  }

  function sortedOrder() {
    const keys = new Map(order.map((id) => { const d = data[id] || {}; return [id, { b: sortText(d.brand), n: sortText(d.name) }]; }));
    return order.slice().sort((x, y) => {
      const a = keys.get(x);
      const b = keys.get(y);
      if (!a.b !== !b.b) return a.b ? -1 : 1;                  // 브랜드가 비어 있는 행은 맨 뒤
      const c = compareText(a.b, b.b);
      if (c) return c;
      if (!a.n !== !b.n) return a.n ? -1 : 1;                  // 같은 브랜드 안에서 잉크명이 빈 행은 뒤
      return compareText(a.n, b.n);                            // 완전히 같으면 지금 순서 유지 (정렬은 안정적)
    });
  }

  function reorderRows() {
    const tbody = tbodyEl();
    const byId = new Map([...tbody.rows].map((tr) => [tr.dataset.id, tr]));
    const frag = document.createDocumentFragment();
    order.forEach((id) => { const tr = byId.get(id); if (tr) frag.appendChild(tr); });
    tbody.appendChild(frag);
    relabel(0);
    closeMenu(false);
    closeCtx();
    clearSelection();
  }

  function syncUndo() {
    const b = root && root.querySelector('.sort-undo');
    if (b) b.hidden = !(prevOrder && canEdit());
  }

  function sortRows() {
    if (!root || !canEdit()) return;
    const next = sortedOrder();
    if (next.every((id, i) => id === order[i])) {
      showNotice('이미 정렬되어 있습니다.');
      setTimeout(() => showNotice(''), 2500);
      return;
    }
    prevOrder = order.slice();
    order = next;
    queueOrder();
    reorderRows();
    renderBrands();
    syncUndo();
  }

  function undoSort() {
    if (!root || !canEdit() || !prevOrder) return;
    order = prevOrder;
    prevOrder = null;
    queueOrder();
    reorderRows();
    renderBrands();
    syncUndo();
  }

  // ── 구글 시트와 "소분 가능" 맞추기 (관리자 모드, 패널 위의 '시트' 버튼) ──
  // 시트 주소는 이 브라우저에만 기억한다(저장소·서버에 올리지 않음). 시트는 "링크가 있는 모든 사용자" 공개여야 읽을 수 있다.
  // 브랜드+잉크명(띄어쓰기·대소문자·'오리지널' 글자 무시)으로 같은 행을 찾아, 시트와 다른 소분 가능 값만 보여 주고 확인을 받은 뒤 바꾼다.
  const SHEET_KEY = 'inkventory.sheet.v1';
  let sheetBusy = false;

  function loadSheetTable(id, gid) {
    return new Promise((resolve, reject) => {
      const cb = '__inkSheet' + Date.now();
      const s = document.createElement('script');
      let timer = null;
      const done = (err, val) => {
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        s.remove();
        if (err) reject(err); else resolve(val);
      };
      timer = setTimeout(() => done(new Error('timeout')), 15000);
      window[cb] = (res) => (res && res.status === 'ok' && res.table ? done(null, res.table) : done(new Error('bad response')));
      s.onerror = () => done(new Error('load'));
      s.src = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=responseHandler:${cb}&headers=1${gid ? '&gid=' + gid : ''}`;
      document.head.appendChild(s);
    });
  }

  const syncKey = (b, n) => (cleanBrand(b) + cleanBrand(n)).replace(/오리지널/g, '').replace(/\s+/g, '').toLowerCase();

  async function syncPortions() {
    if (!root || !canEdit() || sheetBusy) return;
    const flash = (msg, ms) => { showNotice(msg); if (ms) setTimeout(() => showNotice(''), ms); };
    let link = '';
    try { link = localStorage.getItem(SHEET_KEY) || ''; } catch (err) { /* 무시 */ }
    if (!link) {
      link = window.prompt('소분 가능을 비교할 구글 스프레드시트 주소를 붙여넣어 주세요.\n("링크가 있는 모든 사용자"가 볼 수 있어야 하고, 이 주소는 이 브라우저에만 기억됩니다.)') || '';
      if (!link.trim()) return;
    }
    const id = (link.match(/\/d\/([\w-]+)/) || [])[1];
    const gid = (link.match(/[#&?]gid=(\d+)/) || [])[1];
    if (!id) { flash('시트 주소를 알아볼 수 없습니다. 다시 눌러 주소를 입력해 주세요.', 5000); try { localStorage.removeItem(SHEET_KEY); } catch (err) { /* 무시 */ } return; }

    sheetBusy = true;
    flash('시트를 불러오는 중…');
    let table;
    try { table = await loadSheetTable(id, gid); } catch (err) {
      sheetBusy = false;
      try { localStorage.removeItem(SHEET_KEY); } catch (e) { /* 무시 */ }
      flash('시트를 불러오지 못했습니다. 주소와 공유 설정("링크가 있는 모든 사용자")을 확인해 주세요.', 6000);
      return;
    }
    sheetBusy = false;
    if (!root || !canEdit()) return;
    try { localStorage.setItem(SHEET_KEY, link); } catch (err) { /* 무시 */ }

    const col = (word) => table.cols.findIndex((c) => String(c.label || '').includes(word));
    const cb = col('브랜드');
    const cn = col('잉크명');
    const cp = col('소분 가능');
    if (cb < 0 || cn < 0 || cp < 0) { flash('시트에서 "브랜드", "잉크명", "소분 가능" 열을 찾지 못했습니다.', 6000); return; }
    const cell = (r, i) => { const c = r.c && r.c[i]; return c && c.v !== null && c.v !== undefined ? String(c.v).trim() : ''; };

    const sheetRows = (table.rows || []).map((r) => ({ b: cell(r, cb), n: cell(r, cn), p: cell(r, cp) })).filter((r) => r.b || r.n);
    const siteBy = new Map();
    order.forEach((rid) => {
      const d = data[rid] || {};
      if (!cleanBrand(d.brand) && !String(d.name || '').trim()) return;
      const k = syncKey(d.brand, d.name);
      if (!siteBy.has(k)) siteBy.set(k, []);
      siteBy.get(k).push(rid);
    });
    const seen = new Map();
    const changes = [];
    const missing = [];
    sheetRows.forEach((r) => {
      const k = syncKey(r.b, r.n);
      const j = seen.get(k) || 0;
      seen.set(k, j + 1);
      const rid = (siteBy.get(k) || [])[j];
      const label = `${cleanBrand(r.b)} ${cleanBrand(r.n)}`.trim();
      if (!rid) { missing.push(label); return; }
      const d = data[rid] || {};
      if (String(d.kind || '').startsWith('소분')) return;          // 소분 행은 소분 가능 칸이 잠겨 있음
      const cur = String(d.portions === undefined || d.portions === null ? '' : d.portions).trim();
      if (cur !== r.p) changes.push({ rid, label, from: cur, to: r.p });
    });

    if (!changes.length) {
      flash(`소분 가능이 시트와 이미 같습니다.${missing.length ? ` (시트에서 사이트에 없는 이름 ${missing.length}곳은 건너뜀)` : ''}`, 6000);
      return;
    }
    const show = (v) => (v === '' ? '(빈칸)' : v);
    let msg = `시트와 다른 소분 가능 ${changes.length}곳:\n\n` +
      changes.slice(0, 30).map((c) => `${c.label}: ${show(c.from)} → ${show(c.to)}`).join('\n') +
      (changes.length > 30 ? `\n… 외 ${changes.length - 30}곳` : '');
    if (missing.length) msg += `\n\n(사이트에서 같은 이름을 못 찾아 건너뛴 시트 행 ${missing.length}곳: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''})`;
    msg += '\n\n시트와 같게 바꿀까요?';
    if (!window.confirm(msg)) return;

    const rowsById = new Map([...tbodyEl().rows].map((tr) => [tr.dataset.id, tr]));
    changes.forEach((c) => {
      queueSave(c.rid, 'portions', c.to);
      const tr = rowsById.get(c.rid);
      const input = tr && tr.querySelector('.cell[data-f="portions"]');
      if (input) { input.value = c.to; fitCell(input); syncPortionsMark(tr); }
    });
    positionSelection();
    flash(`소분 가능 ${changes.length}곳을 시트와 같게 바꿨습니다.`, 5000);
  }

  // ── 폰(800px 이하): 브랜드 패널을 오른쪽 사이드바로 ──
  // 상단 바 오른쪽 버튼으로 열고, 어두운 부분 / Esc / 브랜드 선택으로 닫는다. (스타일은 CSS .brand-panel 의 @media 참고)
  const PANEL_RIGHT_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/></svg>';
  let brandToggleBtn = null;
  let brandBackdrop = null;

  function brandPanelEl() { return root && root.querySelector('.brand-panel'); }

  function setBrandDrawer(open) {
    const panel = brandPanelEl();
    if (panel) panel.classList.toggle('is-open', open);
    if (brandBackdrop) brandBackdrop.classList.toggle('is-visible', open);
    if (brandToggleBtn) brandToggleBtn.setAttribute('aria-expanded', String(open));
  }

  function teardownBrandDrawer() {
    if (brandToggleBtn) brandToggleBtn.remove();
    if (brandBackdrop) brandBackdrop.remove();
    brandToggleBtn = null;
    brandBackdrop = null;
  }

  function setupBrandDrawer() {
    teardownBrandDrawer();
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    brandToggleBtn = document.createElement('button');
    brandToggleBtn.className = 'icon-btn brand-toggle';
    brandToggleBtn.type = 'button';
    brandToggleBtn.setAttribute('aria-label', '브랜드 목록 열기');
    brandToggleBtn.setAttribute('aria-expanded', 'false');
    brandToggleBtn.innerHTML = PANEL_RIGHT_ICON;
    brandToggleBtn.addEventListener('click', () => { const p = brandPanelEl(); setBrandDrawer(!(p && p.classList.contains('is-open'))); });
    topbar.appendChild(brandToggleBtn);
    brandBackdrop = document.createElement('div');
    brandBackdrop.className = 'backdrop';
    brandBackdrop.addEventListener('click', () => setBrandDrawer(false));
    document.body.appendChild(brandBackdrop);
  }

  document.addEventListener('keydown', (e) => {
    const p = brandPanelEl();
    if (e.key === 'Escape' && p && p.classList.contains('is-open')) setBrandDrawer(false);
  });
  window.addEventListener('resize', () => { if (!window.matchMedia('(max-width: 800px)').matches) setBrandDrawer(false); });

  // ── 폰용 확대·축소: 두 손가락으로 벌리거나 오므리기 (일반 모드, 800px 이하) ──
  // 표 전체를 CSS zoom(--tz)으로 키우고 줄인다. 처음 50%, 범위 30~200%. 손가락 사이의 점이 제자리에 있도록 스크롤 위치를 맞춘다.
  // 마지막 배율은 이 기기에 기억한다. (한 손가락은 그대로 스크롤)
  const ZOOM_KEY = 'inkventory.zoom.v3';
  const ZOOM_MAX = 2;

  function setupZoom(container) {
    const wrap = container.querySelector('.table-wrap');
    const area = container.querySelector('.table-area');
    const hint = container.querySelector('.zoom-hint');
    // 가장 작게 줄였을 때(최소 배율) 표의 가로 너비 = 기기(화면) 가로 너비. 이보다 더 줄어들지 않는다.
    const minZoom = () => {
      const sb = Math.max(0, wrap.offsetWidth - wrap.clientWidth - 2);   // 세로 스크롤 막대 너비 (테두리 2px 제외)
      const avail = area.clientWidth - 2 - sb;
      return avail > 0 ? Math.min(1, Math.floor((avail / NORMAL_W) * 1000) / 1000) : 0.4;
    };
    const clampZ = (n) => Math.floor(Math.max(minZoom(), Math.min(ZOOM_MAX, n)) * 1000) / 1000;
    let z = minZoom();
    let follow = true;   // 아직 손가락으로 조절한 적이 없으면 화면 너비에 계속 맞춤 (돌려서 가로로 봐도)
    try { const s = Number(localStorage.getItem(ZOOM_KEY)); if (s > 0) { z = s; follow = false; } } catch (err) { /* 기억 못 해도 괜찮음 */ }
    const apply = (n) => { z = clampZ(n); container.style.setProperty('--tz', String(z)); };
    apply(z);

    const active = () => document.documentElement.dataset.layout === 'normal' && window.matchMedia('(max-width: 800px)').matches;
    if (window.ResizeObserver) new ResizeObserver(() => { if (active()) apply(follow ? minZoom() : z); }).observe(area);
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    let pinch = null;
    let hintTimer = null;

    wrap.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2 && active()) {
        const r = wrap.getBoundingClientRect();
        pinch = {
          d: dist(e.touches),
          z,
          cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left,
          cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top,
          sl: wrap.scrollLeft,
          st: wrap.scrollTop,
        };
      } else {
        pinch = null;
      }
    }, { passive: true });

    wrap.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();                                   // 두 손가락일 때는 브라우저의 화면 확대 대신 표를 확대
      const nz = clampZ(pinch.z * (dist(e.touches) / pinch.d));
      if (nz === z) return;
      const k = nz / pinch.z;
      follow = false;
      apply(nz);
      wrap.scrollLeft = (pinch.sl + pinch.cx) * k - pinch.cx;
      wrap.scrollTop = (pinch.st + pinch.cy) * k - pinch.cy;
      hint.textContent = Math.round(z * 100) + '%';
      hint.classList.add('is-on');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hint.classList.remove('is-on'), 900);
    }, { passive: false });

    const end = (e) => {
      if (e.touches.length < 2 && pinch) {
        pinch = null;
        try { localStorage.setItem(ZOOM_KEY, String(z)); } catch (err) { /* 무시 */ }
      }
    };
    wrap.addEventListener('touchend', end, { passive: true });
    wrap.addEventListener('touchcancel', end, { passive: true });
  }

  // 브랜드 이름을 누르면 표를 그 브랜드의 첫 행으로 이동
  function scrollToRow(id) {
    const wrap = root && root.querySelector('.table-wrap');
    const tr = wrap && [...tbodyEl().rows].find((r) => r.dataset.id === id);
    if (!tr) return;
    // 화면 위치(getBoundingClientRect)로 계산해야 폰의 확대·축소(CSS zoom) 상태에서도 정확하다
    const head = wrap.querySelector('thead');
    const y = tr.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
    wrap.scrollTo({ top: Math.max(0, y - (head ? head.getBoundingClientRect().height : 40)), behavior: 'smooth' });
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

  // "소분"인 행: 소분 가능·가격 칸에 대각선, 입력 불가
  function syncLock(tr) {
    const id = tr.dataset.id;
    const sample = ((data[id] && data[id].kind) || '').startsWith('소분');
    tr.classList.toggle('is-sample', sample);
    tr.querySelectorAll('td.c-lockable .cell').forEach((input) => { input.disabled = sample; });
  }

  // 펄 잉크 행: 잉크명 칸을 연한 파랑으로 칠함 (CSS .is-pearl)
  function syncPearl(tr) {
    const pearl = !!(data[tr.dataset.id] && data[tr.dataset.id].pearl);
    tr.classList.toggle('is-pearl', pearl);
    const btn = tr.querySelector('.pearl-btn');
    if (btn) btn.setAttribute('aria-pressed', String(pearl));
  }

  // ── 발색 사진 ──
  // 사진 파일은 저장소의 img/swatch/ 에 두고, img/swatch/manifest.json 에 { "행 id": "img/swatch/파일명?v=버전" } 으로 연결한다.
  // (사진을 건네주면 작은 정사각형으로 잘라 넣고 이 목록을 갱신해 올린다. 링크를 따로 만들 필요가 없다)
  //
  // 구글 드라이브 폴더(config.js 의 drive)에 "브랜드 잉크명.jpg" 로 넣은 사진도 연결된다. 두 곳에 모두 있으면 저장소 사진이 우선.
  // 이름 비교: 한자·일본어 글자와 띄어쓰기·대소문자는 무시 (예: "Zerkon No.50 炕川 항천" = "zerkon no.50 항천.jpg").
  let swatchMap = null;
  let driveMap = {};                                   // 정리된 파일 이름 → 드라이브 파일 id
  const DRIVE_CACHE = 'inkventory.drive.v1';

  // 비교용 이름: 확장자·한자·가나·공백 제거, 소문자, 글자 조합 방식 통일
  function normName(s) {
    return String(s || '').normalize('NFC')
      .replace(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/g, '')
      .replace(/\s+/g, '').toLowerCase();
  }

  function setDriveFiles(files) {
    const m = {};
    (files || []).forEach((f) => {
      if (!f || !f.id || !/^image\//.test(f.mimeType || '')) return;
      const k = normName(String(f.name || '').replace(/\.[^.]+$/, ''));
      if (k && !m[k]) m[k] = f.id;
    });
    driveMap = m;
  }

  async function fetchDriveFiles() {
    const cfg = (window.INKVENTORY_CONFIG || {}).drive;
    if (!cfg || !cfg.apiKey || !cfg.folderId) return null;
    const files = [];
    let token = '';
    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams({
        q: `'${cfg.folderId}' in parents and trashed = false and mimeType contains 'image/'`,
        fields: 'nextPageToken,files(id,name,mimeType)',
        pageSize: '1000',
        key: cfg.apiKey,
      });
      if (token) qs.set('pageToken', token);
      const r = await fetch('https://www.googleapis.com/drive/v3/files?' + qs);
      if (!r.ok) throw new Error('drive ' + r.status);
      const j = await r.json();
      files.push(...(j.files || []));
      token = j.nextPageToken || '';
      if (!token) break;
    }
    return files;
  }

  function resyncSwatches() { if (root) root.querySelectorAll('tbody tr').forEach(syncSwatch); }

  async function loadSwatches() {
    if (swatchMap) return;
    swatchMap = {};
    // 지난번에 받아 둔 드라이브 목록으로 먼저 보여 주고, 새 목록을 받으면 갱신
    try {
      const c = JSON.parse(localStorage.getItem(DRIVE_CACHE) || 'null');
      if (c && Array.isArray(c.files)) setDriveFiles(c.files);
    } catch (err) { /* 무시 */ }
    const manifest = (async () => {
      try {
        const r = await fetch('img/swatch/manifest.json', { cache: 'no-cache' });   // 사진 자체는 오래 보관, 목록은 매번 확인
        if (r.ok) swatchMap = await r.json();
      } catch (err) { /* 사진이 없으면 빈 원 */ }
      resyncSwatches();
    })();
    const drive = (async () => {
      try {
        const files = await fetchDriveFiles();
        if (!files) return;
        setDriveFiles(files);
        try { localStorage.setItem(DRIVE_CACHE, JSON.stringify({ files })); } catch (err) { /* 저장 공간이 없어도 동작 */ }
      } catch (err) { /* 드라이브를 못 읽으면 저장소 사진만 */ }
      resyncSwatches();
    })();
    await Promise.all([manifest, drive]);
  }

  // 이 행에 쓸 사진: { thumb, full } 또는 null
  function swatchFor(tr) {
    const id = tr.dataset.id;
    const repo = swatchMap && swatchMap[id];
    if (repo) return { thumb: repo, full: fullSrc(repo) };
    const d = data[id];
    // 콜라보 브랜드("나가사와 고베 X 큐포도")는 가장 앞의 이름("나가사와 고베")만 써도 찾는다. 전체 이름으로 지어도 된다.
    const brand = (d && d.brand) || '';
    const lead = brand.split(/\s+[xX×]\s+/)[0];
    const fid = d && (driveMap[normName(brand + (d.name || ''))] || (lead !== brand && driveMap[normName(lead + (d.name || ''))]));
    if (fid) {
      const u = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fid) + '&sz=w';
      return { thumb: u + '96', full: u + '1600' };
    }
    return null;
  }

  function syncSwatch(tr) {
    const holder = tr.querySelector('.swatch');
    if (!holder) return;
    const s = swatchFor(tr);
    const cur = holder.querySelector('img');
    if (!s) {
      if (cur) cur.remove();
      holder.classList.remove('has-img');
      holder.removeAttribute('role');
      holder.removeAttribute('tabindex');
      holder.removeAttribute('aria-label');
      delete holder.dataset.full;
      return;
    }
    holder.dataset.full = s.full;
    if (cur && cur.getAttribute('src') === s.thumb) return;
    holder.innerHTML = `<img src="${esc(s.thumb)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="28" height="28">`;
    holder.classList.add('has-img');
    holder.setAttribute('role', 'button');
    holder.setAttribute('tabindex', '0');
    holder.setAttribute('aria-label', '발색 사진 크게 보기');
  }

  // 원을 누르면 원본(img/swatch/full/ 의 같은 파일명)을 화면 가득 보여 주고, 뒤는 어둡게 가린다.
  // 어두운 부분을 누르면(또는 Esc) 닫힌다. 원본이 불러와지는 동안에는 작은 사진을 먼저 보여 준다.
  let lightbox = null;
  let lightboxFrom = null;

  function fullSrc(src) { return src.replace(/^img\/swatch\//, 'img/swatch/full/'); }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.remove();
    lightbox = null;
    document.documentElement.classList.remove('has-lightbox');
    if (lightboxFrom && lightboxFrom.isConnected) { try { lightboxFrom.focus({ preventScroll: true }); } catch (err) { /* 무시 */ } }
    lightboxFrom = null;
  }

  function openLightbox(holder) {
    const img = holder.querySelector('img');
    if (!img) return;
    closeLightbox();
    closeCtx();
    const thumb = img.getAttribute('src');
    const full = holder.dataset.full || fullSrc(thumb);
    const tr = holder.closest('tr');
    const d = tr && data[tr.dataset.id];
    const label = d ? [d.brand, d.name].filter(Boolean).join(' ') : '';

    lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', label ? `${label} 발색 사진` : '발색 사진');
    lightbox.tabIndex = -1;
    const big = document.createElement('img');
    big.className = 'lightbox__img';
    big.alt = label;
    big.referrerPolicy = 'no-referrer';
    big.src = thumb;                       // 원본이 오기 전까지 작은 사진을 보여 줌
    lightbox.appendChild(big);
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });   // 어두운 부분만 닫기
    document.body.appendChild(lightbox);
    document.documentElement.classList.add('has-lightbox');
    lightboxFrom = holder;
    lightbox.focus({ preventScroll: true });

    const loader = new Image();
    loader.onload = () => { if (lightbox && big.isConnected) big.src = full; };
    loader.src = full;                     // 원본이 없으면 작은 사진을 그대로 둠
  }

  document.addEventListener('keydown', (e) => {
    if (lightbox && e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
  });

  function fillRow(row) {
    syncSwatch(row);
    const d = data[row.dataset.id];
    if (!d) return;
    syncPearl(row);
    row.querySelectorAll('.cell').forEach((input) => {
      const v = d[input.dataset.f];
      if (typeof v === 'string' && input.value !== v && document.activeElement !== input) input.value = v;
      fitCell(input);
    });
    row.querySelectorAll('.pick').forEach((p) => {
      const v = d[p.dataset.f];
      setPick(p, typeof v === 'string' ? v : '');
    });
    syncBars(row);
    syncPortionsMark(row);
    syncLock(row);
  }

  // 칸 안의 줄 수에 맞게 높이를 늘린다 (줄바꿈은 Shift/Ctrl/Alt + Enter)
  function fitCell(el) {
    const n = el.value.split('\n').length;
    if (el.rows !== n) el.rows = n;
  }

  function fillAll() {
    root.querySelectorAll('tbody tr').forEach(fillRow);
  }

  function applyEditable() {
    if (!root) return;
    if (isAdminMode()) loadPrivate();                    // 관리자 모드가 되면 관리자 전용 데이터를 불러옴
    else if (privState !== 'idle') dropPrivate();        // 일반 모드로 돌아오면 메모리와 화면에서 지움
    const edit = canEdit();
    root.querySelectorAll('.bar').forEach((bar) => { bar.inert = !edit; bar.title = edit ? '우클릭: 막대 추가·삭제' : ''; });
    if (!edit) closeCtx();
    if (!edit) root.querySelector('.row-add').classList.remove('is-on');
    root.querySelectorAll('.cell').forEach((input) => {
      input.readOnly = !edit;
      input.tabIndex = edit ? 0 : -1;
    });
    root.querySelectorAll('.pick').forEach((p) => { p.tabIndex = edit ? 0 : -1; });
    root.classList.toggle('is-editable', edit);
    root.querySelector('.sort-btn').hidden = !edit;     // 정렬은 관리자 모드에서만
    root.querySelector('.sync-btn').hidden = !edit;
    syncUndo();
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
    container.style.setProperty('--normal-w', NORMAL_W + 'px');   // 일반 모드 배치의 표 너비 (표와 바깥 배치가 함께 참고)
    const fit = () => {
      if (document.documentElement.dataset.layout === 'normal') { positionSelection(); return; } // 일반 배치에는 막대가 없음
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

  // 칸의 값 (채우기용). 잔량 칸은 채우기 대상이 아니라서 비워 둔다.
  function valueAt(r, c) {
    const tr = tbodyEl().rows[r];
    if (!tr) return '';
    const d = data[tr.dataset.id] || {};
    const v = d[COLUMNS[c].key];
    return typeof v === 'string' ? v : '';
  }
  const isEmptyValue = (v) => !v;
  const sameValue = (a, b) => a === b;

  // 표 위쪽 기준 높이(rel)에 해당하는 행 번호 (행마다 높이가 달라도 됨)
  function rowIndexAtRel(rel) {
    const rows = tbodyEl().rows;
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rows[mid].offsetTop <= rel) lo = mid; else hi = mid - 1;
    }
    return lo;
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

    // 핸들은 원본 칸에 내용이 있을 때만(잔량 칸은 제외). 표 가장자리 밖으로 삐져나가 스크롤이 생기지 않게 안쪽으로 맞춤
    const fillable = COLUMNS[sel.c].key !== 'level';
    handle.hidden = !(fillable && !isEmptyValue(valueAt(sel.r0, sel.c)));
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
    if (key === 'level') return;   // 잔량 칸은 채우기 제외
    const val = valueAt(s, c);
    const tbody = tbodyEl();
    for (let i = s + 1; i <= t; i++) {
      const tr = tbody.rows[i];
      if (!tr) break;
      if (COLUMNS[c].lockable && tr.classList.contains('is-sample')) continue; // 대각선 칸은 건너뜀
      if (sameValue(valueAt(i, c), val)) continue;
      if (key === 'kind') setPick(tr.querySelector('.pick'), val);
      else { const cell = tr.querySelector(`.cell[data-f="${key}"]`); cell.value = val; fitCell(cell); }
      queueSave(tr.dataset.id, key, val);
      if (key === 'kind') syncLock(tr);
      if (key === 'portions') syncPortionsMark(tr);
      if (key === 'brand' || key === 'name') syncSwatch(tr);
    }
    if (key === 'brand' || key === 'name') renderBrands();
  }

  // ── 잔량 칸 우클릭(폰은 길게 누르기) 메뉴: 막대 추가 / 이 막대 삭제 ──
  let ctxEl = null;           // 메뉴 요소 (body 에 한 번만 만듦)
  let ctxTarget = null;       // { id, bi }  (어느 행의 몇 번째 막대에서 열었는지)
  let longPress = null;       // 길게 누르기 감시 { timer, x, y }
  let suppressClick = false;  // 길게 눌러 메뉴를 연 뒤 따라오는 클릭은 무시

  function ensureCtx() {
    if (ctxEl) return ctxEl;
    ctxEl = document.createElement('ul');
    ctxEl.className = 'menu ctx-menu';
    ctxEl.setAttribute('role', 'menu');
    ctxEl.setAttribute('aria-label', '잔량 막대');
    ctxEl.hidden = true;
    ctxEl.innerHTML = '<li role="menuitem" tabindex="-1" data-act="add">막대 추가</li><li role="menuitem" tabindex="-1" data-act="del">이 막대 삭제</li>';
    document.body.appendChild(ctxEl);
    ctxEl.addEventListener('click', (e) => {
      const li = e.target.closest('[role="menuitem"]');
      if (li && li.getAttribute('aria-disabled') !== 'true') runCtx(li.dataset.act);
    });
    ctxEl.addEventListener('keydown', (e) => {
      const items = [...ctxEl.querySelectorAll('[role="menuitem"]')].filter((li) => li.getAttribute('aria-disabled') !== 'true');
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (i >= 0) runCtx(items[i].dataset.act); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeCtx(); }
    });
    return ctxEl;
  }

  function openCtx(x, y, tr, bi) {
    const el = ensureCtx();
    const levels = getLevels(tr.dataset.id);
    ctxTarget = { id: tr.dataset.id, bi };
    const add = el.querySelector('[data-act="add"]');
    const del = el.querySelector('[data-act="del"]');
    add.setAttribute('aria-disabled', String(levels.length >= MAX_BARS));
    del.setAttribute('aria-disabled', String(levels.length <= 1));
    el.hidden = false;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
    (add.getAttribute('aria-disabled') === 'true' ? del : add).focus();
  }

  function closeCtx() {
    if (ctxEl) ctxEl.hidden = true;
    ctxTarget = null;
  }

  function runCtx(act) {
    const t = ctxTarget;
    closeCtx();
    if (!t || !root || !canEdit()) return;
    const tr = [...tbodyEl().rows].find((r) => r.dataset.id === t.id);
    if (!tr) return;
    const levels = getLevels(t.id);
    if (act === 'add') {
      if (levels.length >= MAX_BARS) return;
      levels.push(0);
    } else {
      if (levels.length <= 1) return;
      if (levels[t.bi] > 0 && !window.confirm('이 막대를 삭제할까요? 기록해 둔 잔량이 사라집니다.')) return;
      levels.splice(t.bi, 1);
    }
    setLevels(t.id, levels);
    syncBars(tr);
    positionSelection();   // 행 높이가 바뀌므로 선택 테두리를 다시 맞춤
  }

  function cancelLongPress() {
    if (longPress) { clearTimeout(longPress.timer); longPress = null; }
  }

  // 메뉴 바깥을 누르거나 창이 바뀌면 닫기 (한 번만 등록)
  document.addEventListener('pointerdown', (e) => {
    if (ctxEl && !ctxEl.hidden && !ctxEl.contains(e.target)) closeCtx();
  });
  window.addEventListener('resize', closeCtx);

  function setupFill(container) {
    const wrap = container.querySelector('.table-wrap');
    const thead = container.querySelector('thead');
    selBox = container.querySelector('.sel-box');
    handle = container.querySelector('.fill-handle');
    sel = null;
    drag = null;

    function updateDragTarget() {
      const tbody = tbodyEl();
      const rel = drag.y - wrap.getBoundingClientRect().top - wrap.clientTop + wrap.scrollTop;   // 표 위쪽 기준
      const t = Math.max(drag.s, Math.min(tbody.rows.length - 1, rowIndexAtRel(rel)));
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
    prevOrder = null;     // 새 행이 생기면 정렬 되돌리기는 더 이상 쓸 수 없음
    syncUndo();

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
  // Lucide "arrow-down-a-z" (정렬 버튼)
  const SORT_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/></svg>';
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
    // 행마다 높이가 달라도 되도록, 행의 실제 위치(offsetTop)로 찾는다.
    function boundaryAt(clientY) {
      const rows = tbody.rows;
      if (!rows.length) return null;
      const top = wrap.getBoundingClientRect().top + wrap.clientTop;
      const headH = thead.offsetHeight;
      if (clientY < top + headH || clientY > top + wrap.clientHeight) return null;
      const rel = clientY - top + wrap.scrollTop;          // 표 위쪽 기준
      const r = rowIndexAtRel(rel);
      const rt = rows[r].offsetTop;
      const rb = rt + rows[r].offsetHeight;
      if (rel < rt || rel >= rb) return null;
      const b = rel - rt <= NEAR ? r : (rb - rel <= NEAR ? r + 1 : null);
      return b !== null && b >= 1 && b <= rows.length - 1 ? b : null;
    }

    function update(e) {
      if (drag || !canEdit() || e.target.closest('.row-add')) return; // 버튼 위에 있으면 그대로 유지
      const b = boundaryAt(e.clientY);
      if (b === null) { hide(); return; }
      const top = wrap.getBoundingClientRect().top + wrap.clientTop;
      const headH = thead.offsetHeight;
      const lineY = top + tbody.rows[b].offsetTop - wrap.scrollTop - 0.5; // 경계선(1px)의 중앙
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
      <div class="ink-layout">
      <aside class="brand-panel" aria-label="브랜드별 잉크 개수">
        <div class="brand-panel__head">
          <span class="brand-panel__title">브랜드</span><span class="brand-panel__sum"></span>
          <span class="brand-panel__tools">
            <button class="sync-btn" type="button" hidden title="구글 시트와 소분 가능 비교하고 맞추기">시트</button>
            <button class="sort-undo" type="button" hidden>되돌리기</button>
            <button class="sort-btn" type="button" hidden title="브랜드 → 잉크명 가나다순으로 정렬">${SORT_ICON}정렬</button>
          </span>
        </div>
        <ul class="brand-list"></ul>
      </aside>
      <div class="table-area view-enter">
        <span class="zoom-hint" aria-hidden="true"></span>
        <button class="row-add" type="button" title="행 추가" aria-label="이 위치에 행 추가">${ROW_ADD_ICON}</button>
        <ul class="menu" role="listbox" aria-label="본병/소분" hidden></ul>
        <div class="table-wrap" tabindex="0" role="region" aria-label="보유 잉크 표">
          <table class="grid" style="min-width:${BASE_WIDTH}px">
            <colgroup>${COLUMNS.map((c, i) => (i === LEVEL_COL ? `<col class="col-${c.key}">` : `<col class="col-${c.key}" style="width:${c.width}px">`)).join('')}</colgroup>
            <thead><tr>${COLUMNS.map((c) => `<th scope="col" class="col-${c.key}">${c.label}</th>`).join('')}</tr></thead>
            <tbody>${rowsHtml()}</tbody>
          </table>
          <div class="sel-box" hidden></div>
          <button class="fill-handle" type="button" tabindex="-1" aria-label="아래로 끌어서 채우기" hidden></button>
        </div>
      </div>
      </div>`;

    const tbody = container.querySelector('tbody');
    menuEl = container.querySelector('.menu');
    menuFor = null;
    prevOrder = null;
    renderBrands();
    setupZoom(container);
    setupBrandDrawer();
    container.querySelector('.sort-btn').addEventListener('click', sortRows);
    container.querySelector('.sync-btn').addEventListener('click', syncPortions);
    container.querySelector('.sort-undo').addEventListener('click', undoSort);
    container.querySelector('.brand-list').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]');
      if (b) { scrollToRow(b.dataset.id); setBrandDrawer(false); }
    });
    setupRowAdd(container);
    setupFill(container);
    setupBarFit(container);
    fillAll();
    loadSwatches();
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
      fitCell(input);
      queueSave(input.closest('tr').dataset.id, input.dataset.f, input.value);
      if (input.dataset.f === 'portions') syncPortionsMark(input.closest('tr'));
      if (input.dataset.f === 'brand' || input.dataset.f === 'name') {
        syncSwatch(input.closest('tr'));   // 이름이 바뀌면 드라이브 사진도 다시 찾음
        renderBrands();                    // 브랜드별 개수도 바로 갱신
      }
      positionSelection(); // 내용이 생기거나 사라지면 핸들 표시도 바뀜
    });

    // 칸 안에서 ↓ / Enter: 아래 칸으로, ↑: 위 칸으로 (표가 따라 스크롤됨).
    // Shift / Ctrl / Alt + Enter: 칸 안에서 줄바꿈. 여러 줄 칸에서는 ↑↓가 먼저 줄 사이를 움직이고, 맨 윗줄·맨 아랫줄에서만 다른 칸으로 넘어감.
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
        if (!isPick && el.value.includes('\n')) {   // 여러 줄 칸: 같은 칸 안에서 줄 이동이 먼저
          const before = el.value.slice(0, el.selectionStart);
          const after = el.value.slice(el.selectionEnd);
          if (e.key === 'ArrowUp' ? before.includes('\n') : after.includes('\n')) return;
        }
        dir = e.key === 'ArrowDown' ? 1 : -1;
      } else if (e.key === 'Enter' && !isPick) {
        if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {   // 줄바꿈
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
    container.querySelector('.table-wrap').addEventListener('scroll', () => { closeMenu(false); closeCtx(); }, { passive: true });

    // 잔량 막대 우클릭(키보드는 메뉴 키 / Shift+F10) → 막대 추가·삭제 메뉴
    tbody.addEventListener('contextmenu', (e) => {
      const line = e.target.closest('.bar-line');
      if (!line || !canEdit()) return;
      e.preventDefault();
      cancelLongPress();
      const tr = line.closest('tr');
      const lines = [...tr.querySelectorAll('.bar-line')];
      let x = e.clientX;
      let y = e.clientY;
      if (!x && !y) { const r = line.getBoundingClientRect(); x = r.left + 24; y = r.bottom; }   // 키보드로 열었을 때
      selectCell(line.closest('td'));
      openCtx(x, y, tr, lines.indexOf(line));
    });
    // 터치(폰): 막대를 길게 누르면 같은 메뉴. (iOS 는 contextmenu 이벤트가 없어서 직접 감시)
    tbody.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || !canEdit()) return;
      const line = e.target.closest('.bar-line');
      if (!line) return;
      cancelLongPress();
      longPress = {
        x: e.clientX,
        y: e.clientY,
        timer: setTimeout(() => {
          longPress = null;
          suppressClick = true;
          setTimeout(() => { suppressClick = false; }, 800);
          const tr = line.closest('tr');
          selectCell(line.closest('td'));
          openCtx(e.clientX, e.clientY, tr, [...tr.querySelectorAll('.bar-line')].indexOf(line));
        }, 550),
      };
    });
    tbody.addEventListener('pointermove', (e) => {
      if (longPress && Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > 8) cancelLongPress();
    });
    tbody.addEventListener('pointerup', cancelLongPress);
    tbody.addEventListener('pointercancel', cancelLongPress);

    // 발색 원: 누르면(키보드는 Enter / Space) 원본 사진 보기
    tbody.addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch.has-img');
      if (sw) openLightbox(sw);
    });
    tbody.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const sw = e.target.closest('.swatch.has-img');
      if (!sw || e.target !== sw) return;
      e.preventDefault();
      openLightbox(sw);
    });

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
      if (suppressClick) { suppressClick = false; return; }          // 길게 눌러 메뉴를 연 직후의 클릭은 잔량을 바꾸지 않음
      const row = seg.closest('tr');
      const id = row.dataset.id;
      const i = Number(seg.dataset.i);
      const lines = [...row.querySelectorAll('.bar-line')];
      const bi = lines.indexOf(seg.closest('.bar-line'));          // 몇 번째 막대(병)인지
      const levels = getLevels(id);
      if (bi < 0 || bi >= levels.length) return;
      levels[bi] = levels[bi] === i ? 0 : i;                       // 같은 칸을 다시 누르면 0
      setLevels(id, levels);
      paintBar(lines[bi].querySelector('.bar'), levels[bi]);
      selectCell(seg.closest('td'));
    });
  }

  function unmount() {
    teardownBrandDrawer();
    prevOrder = null;
    closeLightbox();
    closeMenu(false);
    closeCtx();
    cancelLongPress();
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

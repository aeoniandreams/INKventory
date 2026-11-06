// 보유 잉크 표: 브랜드 / 잉크명 / 본병·소분 / 잔량 / 비고 / 가격 (270행)
//  - 잔량 막대: 10칸. 칸을 누르면 그 칸과 왼쪽 칸이 모두 채워진다. 같은 칸을 다시 누르면 0.
//  - 글자 칸: 관리자 모드에서 바로 입력.
//  - 모든 변경은 자동 저장(Firestore 문서 하나: inventory/inkOwned). 수정은 관리자 모드에서만 가능.
//    (화면에서 막는 것은 편의일 뿐, 실제 쓰기 권한은 Firestore 보안 규칙이 서버에서 막는다.)
(() => {
  'use strict';

  const ROWS = 270;
  const STEPS = 10;
  const DOC_PATH = ['inventory', 'inkOwned'];   // 문서 구조: { rows: { "0": { brand, name, kind, level, note, price }, ... } }
  const SAVE_DELAY = 600;                        // 입력을 멈추고 이 시간(ms)이 지나면 저장
  const RETRY_DELAY = 5000;

  const COLUMNS = [
    { key: 'brand', label: '브랜드',    width: 140, max: 100 },
    { key: 'name',  label: '잉크명',    width: 200, max: 100 },
    { key: 'kind',  label: '본병/소분', width: 96,  max: 50 },
    { key: 'level', label: '잔량',      width: 230 },
    { key: 'note',  label: '비고',      width: 260, max: 300 },
    { key: 'price', label: '가격',      width: 110, max: 50 },
  ];

  // ── 상태 ────────────────────────────────
  const data = {};              // 행 번호 → { 필드: 값 }
  let loadState = 'idle';       // idle | loading | ready | error
  let root = null;              // 현재 화면 컨테이너
  const pending = new Map();    // "행|필드" → { idx, field, value }  (아직 저장 안 된 변경)
  let saveTimer = null;
  let saving = false;
  let saveStatus = '';          // '' | saving | saved | error | denied

  const isAdminMode = () => document.documentElement.dataset.mode === 'admin';
  const canEdit = () => isAdminMode() && loadState === 'ready';

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
  function queueSave(idx, field, value) {
    (data[idx] = data[idx] || {})[field] = value;
    pending.set(idx + '|' + field, { idx, field, value });
    setStatus('saving');
    scheduleFlush(field === 'level' ? 0 : SAVE_DELAY);
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
      const rows = {};
      batch.forEach(([, e]) => { (rows[e.idx] = rows[e.idx] || {})[e.field] = e.value; });
      await setDoc(doc(db, ...DOC_PATH), { rows }, { merge: true });
      batch.forEach(([k, e]) => { if (pending.get(k) === e) pending.delete(k); });
      saving = false;
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

  // ── 불러오기 ────────────────────────────
  async function load() {
    if (loadState === 'loading' || loadState === 'ready') return;
    loadState = 'loading';
    showNotice('');
    try {
      const { db, doc, getDoc } = await INKFB.db();
      const snap = await getDoc(doc(db, ...DOC_PATH));
      const rows = (snap.exists() && snap.data().rows) || {};
      Object.keys(rows).forEach((k) => {
        const idx = Number(k);
        if (idx >= 0 && idx < ROWS) data[idx] = Object.assign(rows[k], data[idx]); // 불러오는 동안 입력한 값 우선
      });
      loadState = 'ready';
      if (root) { fillAll(); applyEditable(); }
    } catch (err) {
      loadState = 'error';
      showNotice('데이터를 불러오지 못했습니다. 새로고침해 주세요.');
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
  function barHtml() {
    let segs = '';
    for (let i = 1; i <= STEPS; i++) {
      segs += `<button class="seg" type="button" data-i="${i}" aria-label="잔량 ${i}/${STEPS}"></button>`;
    }
    return `<div class="bar" role="group" aria-label="잔량"><div class="track" aria-hidden="true"><i class="pv"></i><i class="fill"></i></div>${segs}</div>`;
  }

  function rowsHtml() {
    const bar = barHtml();
    let html = '';
    for (let r = 0; r < ROWS; r++) {
      const cells = COLUMNS.map((c) => (c.key === 'level'
        ? `<td class="c-level">${bar}</td>`
        : `<td class="c-text"><input class="cell" type="text" data-f="${c.key}" maxlength="${c.max}" aria-label="${c.label} ${r + 1}행" autocomplete="off" spellcheck="false" readonly tabindex="-1"></td>`
      )).join('');
      html += `<tr data-row="${r}">${cells}</tr>`;
    }
    return html;
  }

  function paintLevel(row, level) {
    const bar = row.querySelector('.bar');
    bar.style.setProperty('--lv', level);
    bar.dataset.level = level;
    // 채워진 영역 안에 놓인 구분선은 어두운 색으로 (CSS .seg.in)
    bar.querySelectorAll('.seg').forEach((seg, idx) => seg.classList.toggle('in', idx + 1 <= level));
  }

  function fillRow(row) {
    const d = data[row.dataset.row];
    if (!d) return;
    row.querySelectorAll('.cell').forEach((input) => {
      const v = d[input.dataset.f];
      if (typeof v === 'string' && input.value !== v && document.activeElement !== input) input.value = v;
    });
    if (d.level) paintLevel(row, d.level);
  }

  function fillAll() {
    root.querySelectorAll('tbody tr').forEach(fillRow);
  }

  function applyEditable() {
    if (!root) return;
    const edit = canEdit();
    root.querySelectorAll('.bar').forEach((bar) => { bar.inert = !edit; });
    root.querySelectorAll('.cell').forEach((input) => {
      input.readOnly = !edit;
      input.tabIndex = edit ? 0 : -1;
    });
    showStatus();
  }

  function mount(container) {
    root = container;
    container.innerHTML = `
      <p class="notice" role="alert" hidden></p>
      <div class="table-wrap view-enter">
        <table class="grid">
          <colgroup>${COLUMNS.map((c) => `<col style="width:${c.width}px">`).join('')}</colgroup>
          <thead><tr>${COLUMNS.map((c) => `<th scope="col">${c.label}</th>`).join('')}</tr></thead>
          <tbody>${rowsHtml()}</tbody>
        </table>
      </div>`;

    const tbody = container.querySelector('tbody');
    fillAll();
    applyEditable();
    if (loadState === 'error') loadState = 'idle'; // 오류였다면 화면에 다시 들어올 때 재시도
    load();

    // 글자 입력 → 자동 저장
    tbody.addEventListener('input', (e) => {
      const input = e.target.closest('.cell');
      if (!input || !canEdit()) return;
      queueSave(Number(input.closest('tr').dataset.row), input.dataset.f, input.value);
    });

    // Enter: 아래 칸으로 (Shift+Enter: 위 칸). 한글 조합 중에는 무시.
    tbody.addEventListener('keydown', (e) => {
      const input = e.target.closest('.cell');
      if (!input || e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      const tr = input.closest('tr');
      const target = e.shiftKey ? tr.previousElementSibling : tr.nextElementSibling;
      const next = target && target.querySelector(`.cell[data-f="${input.dataset.f}"]`);
      if (next) next.focus();
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

    tbody.addEventListener('click', (e) => {
      const seg = e.target.closest('.seg');
      if (!seg || !canEdit()) return;
      const row = seg.closest('tr');
      const idx = Number(row.dataset.row);
      const i = Number(seg.dataset.i);
      const current = (data[idx] && data[idx].level) || 0;
      const next = current === i ? 0 : i;
      paintLevel(row, next);
      queueSave(idx, 'level', next);
    });
  }

  function unmount() {
    root = null;
    showStatus();
  }

  window.INKVENTORY_VIEWS = window.INKVENTORY_VIEWS || {};
  window.INKVENTORY_VIEWS['ink-owned'] = {
    mount,
    unmount,
    onMode() { applyEditable(); },
  };
})();

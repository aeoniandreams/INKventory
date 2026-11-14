// WISH 창. 사이드바의 WISH 를 누르면 (페이지 이동 없이) 바로 뜬다.
// 위쪽의 [잉크] [만년필] 두 박스로 내용을 바꿔 본다: 잉크 = 브랜드명·잉크명 표, 만년필 = 제품명 표.
//   window.INKWISH.open()
// 데이터: 공개 문서 inventory/inkOwned 의 wishInk: [{brand, name}], wishPens: [{name}] (누구나 읽기 / 관리자만 쓰기).
// 일반 모드: 읽기만. 관리자 모드: 칸을 고치면 바로 저장되고, 표 아래 "+ 행 추가" 로 행을 더한다.
// (행 삭제 버튼은 없다: 한 행의 칸을 모두 지우고 다른 곳으로 옮기면 그 행이 없어진다. 완전히 빈 행은 저장하지 않는다)
(() => {
  'use strict';

  const DOC_PATH = ['inventory', 'inkOwned'];
  const MAX_ROWS = 300;
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

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const blankRow = (t) => { const o = {}; t.cols.forEach((c) => { o[c.k] = ''; }); return o; };
  const isBlank = (t, r) => !t.cols.some((c) => String(r[c.k]).trim());
  const clean = (t, rows) => (Array.isArray(rows) ? rows : []).slice(0, MAX_ROWS).map((r) => {
    const o = {};
    t.cols.forEach((c) => { o[c.k] = str(r && r[c.k], c.max); });
    return o;
  });

  let dlg = null;
  let tab = 'ink';
  let editable = false;           // 관리자 모드이고 최신 내용을 받은 뒤에만 true
  let fresh = false;              // 이번에 연 뒤로 최신 내용을 받음
  let loaded = false;             // 한 번이라도 받음
  let loadFailed = false;
  let loading = null;
  const data = { ink: [], pen: [] };
  const dirty = { ink: false, pen: false };
  const timers = { ink: null, pen: null };
  let chain = Promise.resolve();
  let saving = 0;

  const isAdminMode = () => document.documentElement.dataset.mode === 'admin';

  // ── 불러오기: 가벼운 공개 읽기 주소(REST)로 문서를 한 번 받는다 ──
  function restUrl() {
    const c = (window.INKVENTORY_CONFIG || {}).firebase || {};
    return `https://firestore.googleapis.com/v1/projects/${c.projectId}/databases/(default)/documents/${DOC_PATH.join('/')}?key=${c.apiKey}`;
  }
  const sv = (v) => (v && typeof v.stringValue === 'string' ? v.stringValue : '');
  function decodeRows(v) {
    const vals = v && v.arrayValue && v.arrayValue.values;
    if (!Array.isArray(vals)) return [];
    return vals.map((x) => {
      const f = (x && x.mapValue && x.mapValue.fields) || {};
      const o = {};
      Object.keys(f).forEach((k) => { o[k] = sv(f[k]); });
      return o;
    });
  }

  function load() {
    if (loading) return loading;
    loading = (async () => {
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
          if (dirty[t.id] || timers[t.id] !== null) return;     // 아직 저장 안 된 내 수정이 있으면 덮어쓰지 않음
          data[t.id] = clean(t, decodeRows(fields[t.field]));
        });
        loaded = true; fresh = true; loadFailed = false;
      } catch (err) {
        loadFailed = true;
      } finally {
        loading = null;
      }
      if (dlg && dlg.open) { editable = isAdminMode() && fresh; render(); }
    })();
    return loading;
  }

  // ── 저장 ──
  function setStatus(s) {
    if (!dlg) return;
    const el = dlg.querySelector('.wish-status');
    el.textContent = { saving: '저장 중…', saved: '저장됨', error: '저장하지 못했습니다. 잠시 뒤 다시 시도됩니다.', denied: '저장 권한이 없습니다.' }[s] || '';
    el.dataset.s = s || '';
    el.hidden = !s || !isAdminMode();
  }

  function schedule(t) {
    clearTimeout(timers[t.id]);
    dirty[t.id] = true;
    timers[t.id] = setTimeout(() => flush(t), 600);
    setStatus('saving');
  }

  function flush(t) {
    clearTimeout(timers[t.id]);
    timers[t.id] = null;
    if (!dirty[t.id]) return chain;
    dirty[t.id] = false;
    const rows = clean(t, data[t.id]).filter((r) => !isBlank(t, r));
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
        dirty[t.id] = true;                                    // 다음 수정이나 닫을 때 다시 시도
        if (err && err.code === 'permission-denied') { setStatus('denied'); return; }
        setStatus('error');
        clearTimeout(timers[t.id]);
        timers[t.id] = setTimeout(() => flush(t), 8000);
      }
    });
    return chain;
  }

  window.addEventListener('beforeunload', (e) => {
    if (dirty.ink || dirty.pen || saving) { TABS.forEach((t) => flush(t)); e.preventDefault(); e.returnValue = ''; }
  });

  // ── 화면 ──
  function rowHtml(t, r, i) {
    let h = `<tr data-i="${i}">`;
    t.cols.forEach((c) => {
      if (editable) h += `<td><div class="cell-wrap" data-v="${esc(r[c.k])}"><textarea class="cell" rows="1" data-i="${i}" data-k="${c.k}" maxlength="${c.max}" aria-label="${esc(c.label)} ${i + 1}행" autocomplete="off" spellcheck="false">${esc(r[c.k])}</textarea></div></td>`;
      else h += `<td><div class="xc">${esc(r[c.k])}</div></td>`;
    });
    return h + '</tr>';
  }

  function render() {
    if (!dlg) return;
    const t = tabOf(tab);
    const box = dlg.querySelector('.notice-exch');
    dlg.querySelectorAll('.notice-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    if (!loaded) {
      box.innerHTML = `<div class="exch-empty">${loadFailed ? '불러오지 못했습니다. 새로고침해 주세요.' : '불러오는 중…'}</div>`;
      return;
    }
    const rows = data[tab];
    if (editable && !rows.length) rows.push(blankRow(t));
    const shown = editable ? rows : rows.filter((r) => !isBlank(t, r));
    if (!shown.length) { box.innerHTML = `<div class="exch-empty">${t.empty}</div>`; return; }
    const total = t.cols.reduce((n, c) => n + c.w, 0);
    box.innerHTML = `<table class="exch-table"><thead><tr>${t.cols.map((c) => `<th style="width:${((c.w / total) * 100).toFixed(2)}%">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${shown.map((r, i) => rowHtml(t, r, i)).join('')}</tbody></table>`
      + (editable ? '<button class="btn x-add" type="button">+ 행 추가</button>' : '');
  }

  // 맨 아래에 빈 행을 더하고 커서 (이미 맨 아래가 빈 행이면 거기로 커서만)
  function addRow(col) {
    const t = tabOf(tab);
    const rows = data[tab];
    const box = dlg.querySelector('.notice-exch');
    const last = rows.length - 1;
    if (last < 0 || !isBlank(t, rows[last])) {
      if (rows.length >= MAX_ROWS) return;
      rows.push(blankRow(t));
      const tb = box.querySelector('tbody');
      if (!tb) render(); else tb.insertAdjacentHTML('beforeend', rowHtml(t, rows[rows.length - 1], rows.length - 1));
    }
    const f = box.querySelector(`textarea[data-i="${rows.length - 1}"][data-k="${col || t.cols[0].k}"]`);
    if (f) f.focus();
  }

  function setTab(id) {
    tab = id;
    render();
  }

  function ensure() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'dialog notice-dialog wish-dialog is-exch';
    dlg.setAttribute('aria-label', 'WISH');
    dlg.innerHTML = `
      <div class="notice-view">
        <div class="notice-tabs" role="tablist" aria-label="잉크 / 만년필">
          ${TABS.map((t) => `<button class="notice-tab" type="button" role="tab" data-tab="${t.id}" aria-selected="${t.id === tab}">${t.label}</button>`).join('')}
        </div>
        <div class="notice-exch" role="tabpanel"></div>
        <div class="notice-actions">
          <span class="wish-status" role="status" aria-live="polite" hidden></span>
          <button class="btn btn--primary" type="button" data-ok>확인</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    const box = dlg.querySelector('.notice-exch');

    dlg.querySelector('[data-ok]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { TABS.forEach((t) => flush(t)); });
    dlg.querySelector('.notice-tabs').addEventListener('click', (e) => { const b = e.target.closest('.notice-tab'); if (b) setTab(b.dataset.tab); });

    box.addEventListener('input', (e) => {
      const ta = e.target.closest('textarea[data-i]');
      if (!ta) return;
      const row = data[tab][Number(ta.dataset.i)];
      if (!row) return;
      row[ta.dataset.k] = ta.value;
      ta.parentNode.dataset.v = ta.value;
      schedule(tabOf(tab));
    });
    box.addEventListener('keydown', (e) => {
      const ta = e.target.closest('textarea[data-i]');
      if (!ta || e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      const next = box.querySelector(`textarea[data-i="${Number(ta.dataset.i) + 1}"][data-k="${ta.dataset.k}"]`);
      if (next) next.focus(); else addRow(ta.dataset.k);          // 맨 아래 행에서 Enter → 새 행의 같은 열
    });
    box.addEventListener('click', (e) => { if (e.target.closest('.x-add')) addRow(); });
    // 모두 지운 행은 포커스가 다른 칸으로 옮겨 간 뒤에 없앤다
    box.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!dlg.open || !editable) return;
        const t = tabOf(tab);
        const rows = data[tab];
        const active = document.activeElement;
        let removed = false;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (!isBlank(t, rows[i])) continue;
          const tr = box.querySelector(`tr[data-i="${i}"]`);
          if (tr && active && tr.contains(active)) continue;               // 아직 그 행에서 입력 중
          if (rows.length === 1) continue;                                  // 표에는 늘 한 행은 남겨 둔다
          rows.splice(i, 1);
          if (tr) tr.remove();
          box.querySelectorAll('tbody tr').forEach((r, n) => { r.dataset.i = n; r.querySelectorAll('textarea').forEach((x) => { x.dataset.i = n; x.setAttribute('aria-label', `${x.getAttribute('aria-label').replace(/ \d+행$/, '')} ${n + 1}행`); }); });
          removed = true;
        }
        if (removed) schedule(t);
      }, 0);
    });
    return dlg;
  }

  window.INKWISH = {
    open() {
      const d = ensure();
      tab = 'ink';
      fresh = false;
      editable = false;
      loadFailed = false;
      setStatus('');
      render();
      if (!d.open) d.showModal();
      load();
    },
  };
})();

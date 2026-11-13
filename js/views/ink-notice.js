// 잉팔잉사 처음 접속 알림창. 위쪽의 [안내] [교환] 두 박스로 내용을 바꿔 본다: 안내 = 알림글, 교환 = 교환 희망 잉크 표(브랜드·잉크명·비고 세 열의 작은 표, 관리자는 그 자리에서 고침). ink-owned.js 가 INKNOTICE.open({ html, editable, onSave }) 로 연다.
//   · 화면 가운데 알림창, 바깥은 어둡게(딤). 오른쪽 아래 "확인"을 눌러야 닫힌다.
//   · 관리자 모드에서만 오른쪽 위 연필 버튼이 보이고, 누르면 수정창: 위쪽에 고정된 바(회색 글씨 / 굵게 / 취소선) + 글 입력칸.
//   · 내용은 안전한 HTML 조각으로만 저장한다: <div> 한 줄씩, 그 안에 <b> <s> <span class="gray"> 만 허용 (sanitize). 보여 줄 때도 한 번 더 거른다.
(() => {
  'use strict';

  const GRAY = '#8892ab';
  const PENCIL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>';
  const ICON_BOLD = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/></svg>';
  const ICON_STRIKE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/></svg>';
  const ICON_GRAY = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16"/><path d="m6 16 6-12 6 12"/><path d="M8 12h8"/></svg>';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 글 한 줄씩 → <div> 묶음 (기본 알림글을 만들 때도 사용)
  function linesToHtml(lines) {
    return lines.map((ln) => `<div>${ln === '' ? '<br>' : esc(ln)}</div>`).join('');
  }

  const isGray = (v) => {
    const c = String(v || '').replace(/\s+/g, '').toLowerCase();
    return c === GRAY || c === 'rgb(136,146,171)';
  };

  // 어떤 HTML 이 들어와도 <div>줄</div> 묶음(안에는 b / s / span.gray 만)으로 정리한다.
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<div id="r">${html || ''}</div>`, 'text/html');
    const root = doc.getElementById('r');
    let buf = '';
    const BLOCK = /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|TABLE|TR)$/;
    const nl = () => { buf += '\n'; };
    const walk = (node, fmt) => {
      node.childNodes.forEach((ch) => {
        if (ch.nodeType === 3) {
          const t = ch.nodeValue.replace(/ /g, ' ');
          t.split('\n').forEach((part, i) => {
            if (i > 0) nl();
            if (!part) return;
            let h = esc(part);
            if (fmt.gray) h = `<span class="gray">${h}</span>`;
            if (fmt.s) h = `<s>${h}</s>`;
            if (fmt.b) h = `<b>${h}</b>`;
            buf += h;
          });
        } else if (ch.nodeType === 1) {
          const tag = ch.tagName;
          if (tag === 'BR') { nl(); return; }
          const next = { ...fmt };
          if (tag === 'B' || tag === 'STRONG') next.b = true;
          else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.s = true;
          else if (tag === 'FONT' && ch.getAttribute('color')) next.gray = isGray(ch.getAttribute('color'));
          else if (tag === 'SPAN') {
            if (ch.classList.contains('gray')) next.gray = true;
            else if (ch.style && ch.style.color) next.gray = isGray(ch.style.color);
            if (ch.style && /^(bold|[6-9]00)$/.test(ch.style.fontWeight)) next.b = true;
            if (ch.style && /line-through/.test(ch.style.textDecoration || ch.style.textDecorationLine || '')) next.s = true;
          } else if (tag === 'SCRIPT' || tag === 'STYLE') return;
          if (BLOCK.test(tag)) {
            if (buf && !buf.endsWith('\n')) nl();
            walk(ch, next);
            if (!buf.endsWith('\n')) nl();
            else if (!ch.textContent && !ch.querySelector('br')) nl();   // 완전히 빈 블록 = 빈 줄
          } else {
            walk(ch, next);
          }
        }
      });
    };
    walk(root, {});
    let lines = buf.split('\n');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();     // 끝의 빈 줄은 버림
    if (lines.length > 200) lines = lines.slice(0, 200);
    return lines.map((l) => `<div>${l === '' ? '<br>' : l}</div>`).join('');
  }

  const DEFAULT_LINES = [
    '잉크가 너무 많아져서 정말로 마셔야 할 판이라 조금 보내려 합니다 ^-ㅠ... 어째 팔수록 점점 많아지고 있습니다',
    '',
    '- 삼우과학 5ml 바이알에 병 어깨선까지 소분하여 파라필름 감아 배송합니다. 한 잉크를 10ml 구매하실 시에는 10ml 바이알에 소분하고 있습니다. 혹여 꼭 5ml 병 두 개에 소분되어야 한다면 말씀 부탁드립니다. (보유 바이알 재고에 따라 불가할 수도 있으나 최대한 맞추어 소분해 드리려 합니다.)',
    '- 입금 확인 후 소분 진행합니다. 소분 시 일회용 스포이드 사용하며, 스포이드는 재활용하지 않습니다.',
    '- 문의는 잉크 가격 도합 10000원 이상부터 부탁드립니다.',
    '- 배송은 GS 반값택배 (2000원) / GS 일반택배 (4000원) 으로만 진행합니다.',
    '',
    '- 교환도 구하고 있습니다. 교환 희망 잉크 목록은 마지막 이미지에서 확인 부탁드립니다. 대략적인 가격대에 맞추어 교환 희망합니다.',
  ];

  // ── 교환 표 ──
  // 데이터: [{ brand, name, note }] (공개 문서의 exchangeRows). 열은 브랜드 / 잉크명 / 비고 세 개뿐.
  // 관리자 모드: 칸을 고치거나 행을 더하고 뺄 수 있다. 일반 모드: 읽기만.
  const EX_COLS = [
    { k: 'brand', label: '브랜드', w: 32, max: 100 },
    { k: 'name', label: '잉크명', w: 40, max: 100 },
    { k: 'note', label: '비고', w: 28, max: 300 },
  ];
  const EX_MAX_ROWS = 100;

  function cleanExchange(rows) {
    const str = (v, n) => String(v == null ? '' : v).slice(0, n);
    return (Array.isArray(rows) ? rows : []).slice(0, EX_MAX_ROWS).map((r) => {
      const o = {};
      EX_COLS.forEach((c) => { o[c.k] = str(r && r[c.k], c.max); });
      return o;
    });
  }

  let dlg = null;
  let tab = 'info';
  let exTimer = null;
  let ctx = { html: '', editable: false, emptyMessage: '', exchange: [], onSave: null, onExchange: null, onClose: null };

  function render(el, html, emptyMessage) {
    const clean = sanitize(html);
    if (!clean && emptyMessage) { el.innerHTML = `<div class="gray">${esc(emptyMessage)}</div>`; return; }   // 비어 있을 때 안내 문구 (저장되는 내용이 아님)
    el.innerHTML = clean;
    el.querySelectorAll(':scope > div').forEach((d) => { if (d.textContent.startsWith('- ')) d.classList.add('bullet'); });   // "- " 로 시작하는 줄은 걸어 들여쓰기
  }

  const BLANK = () => ({ brand: '', name: '', note: '' });
  const isBlank = (r) => !EX_COLS.some((c) => String(r[c.k]).trim());

  function exRowHtml(r, i, admin) {
    let h = `<tr data-i="${i}">`;
    EX_COLS.forEach((c) => {
      if (admin) h += `<td><div class="cell-wrap" data-v="${esc(r[c.k])}"><textarea class="cell" rows="1" data-i="${i}" data-k="${c.k}" maxlength="${c.max}" aria-label="${esc(c.label)} ${i + 1}행" autocomplete="off" spellcheck="false">${esc(r[c.k])}</textarea></div></td>`;
      else h += `<td><div class="xc">${esc(r[c.k])}</div></td>`;
    });
    return h + '</tr>';
  }

  // 관리자: 표 아래의 "+ 행 추가" 버튼으로 행을 더한다 (일반 모드에는 버튼이 없다). 행 삭제 버튼(×)은 없고,
  // 한 행의 칸을 모두 지우고 다른 곳으로 옮기면 그 행이 없어진다. (완전히 빈 행은 저장하지 않는다)
  function renderExchange() {
    const box = dlg.querySelector('.notice-exch');
    const admin = !!ctx.editable;
    const shown = admin ? ctx.exchange : ctx.exchange.filter((r) => !isBlank(r));
    if (!admin && !shown.length) { box.innerHTML = '<div class="exch-empty">등록된 교환 목록이 없습니다.</div>'; return; }
    const total = EX_COLS.reduce((n, c) => n + c.w, 0);
    const pct = (w) => `${((w / total) * 100).toFixed(2)}%`;
    box.innerHTML = `<table class="exch-table"><thead><tr>${EX_COLS.map((c) => `<th style="width:${pct(c.w)}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${shown.map((r, i) => exRowHtml(r, i, admin)).join('')}</tbody></table>`
      + (admin ? '<button class="btn x-add" type="button">+ 행 추가</button>' : '');
  }

  // 맨 아래에 빈 행을 하나 더하고 첫 칸에 커서 (이미 맨 아래가 빈 행이면 거기로 커서만)
  function addExchangeRow(col) {
    const ex = dlg.querySelector('.notice-exch');
    const last = ctx.exchange.length - 1;
    if (last < 0 || !isBlank(ctx.exchange[last])) {
      if (ctx.exchange.length >= EX_MAX_ROWS) return;
      ctx.exchange.push(BLANK());
      const tb = ex.querySelector('tbody');
      if (!tb) { renderExchange(); } else tb.insertAdjacentHTML('beforeend', exRowHtml(ctx.exchange[ctx.exchange.length - 1], ctx.exchange.length - 1, true));
    }
    const f = ex.querySelector(`textarea[data-i="${ctx.exchange.length - 1}"][data-k="${col || 'brand'}"]`);
    if (f) f.focus();
  }

  // 편집 내용을 잠시 모았다가 저장 요청 (닫을 때는 바로). 완전히 빈 행은 저장하지 않는다.
  function scheduleExchange() { clearTimeout(exTimer); exTimer = setTimeout(flushExchange, 600); }
  function flushExchange() {
    if (exTimer === null) return;
    clearTimeout(exTimer);
    exTimer = null;
    if (ctx.onExchange) ctx.onExchange(cleanExchange(ctx.exchange).filter((r) => EX_COLS.some((c) => String(r[c.k]).trim())));
  }

  function updatePencil() {
    if (dlg) dlg.querySelector('.notice-edit-btn').hidden = !(ctx.editable && tab === 'info');
  }

  function setTab(t) {
    tab = t;
    dlg.querySelectorAll('.notice-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    dlg.querySelector('.notice-body').hidden = t !== 'info';
    dlg.querySelector('.notice-exch').hidden = t !== 'exch';
    dlg.classList.toggle('is-exch', t === 'exch');
    if (t === 'exch') renderExchange();
    updatePencil();
  }

  function ensure() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'dialog notice-dialog';
    dlg.setAttribute('aria-label', '잉팔잉사 안내');
    dlg.innerHTML = `
      <div class="notice-view">
        <button class="notice-edit-btn" type="button" title="알림글 수정" aria-label="알림글 수정" hidden>${PENCIL}</button>
        <div class="notice-tabs" role="tablist" aria-label="안내 / 교환">
          <button class="notice-tab" type="button" role="tab" data-tab="info" aria-selected="true">안내</button>
          <button class="notice-tab" type="button" role="tab" data-tab="exch" aria-selected="false">교환</button>
        </div>
        <div class="notice-body" role="tabpanel"></div>
        <div class="notice-exch" role="tabpanel" hidden></div>
        <div class="notice-actions"><button class="btn btn--primary" type="button" data-ok>확인</button></div>
      </div>
      <div class="notice-edit" hidden>
        <div class="notice-bar" role="toolbar" aria-label="글자 서식">
          <button type="button" class="notice-tool" data-cmd="gray" title="회색 글씨" aria-label="회색 글씨" style="color:${GRAY}">${ICON_GRAY}</button>
          <button type="button" class="notice-tool" data-cmd="bold" title="굵게" aria-label="굵게">${ICON_BOLD}</button>
          <button type="button" class="notice-tool" data-cmd="strikeThrough" title="취소선" aria-label="취소선">${ICON_STRIKE}</button>
        </div>
        <div class="notice-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="알림글 내용" spellcheck="false"></div>
        <div class="notice-actions">
          <button class="btn" type="button" data-cancel>취소</button>
          <button class="btn btn--primary" type="button" data-save>저장</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    const q = (s) => dlg.querySelector(s);
    const editor = q('.notice-editor');

    q('[data-ok]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { flushExchange(); if (ctx.onClose) ctx.onClose(); });
    q('.notice-tabs').addEventListener('click', (e) => { const b = e.target.closest('.notice-tab'); if (b) setTab(b.dataset.tab); });
    const ex = q('.notice-exch');
    // 교환 표 편집 (관리자): 입력 → 데이터에 반영 + 잠시 뒤 저장, 모두 지운 행은 삭제, Enter 는 아래 행의 같은 열로
    ex.addEventListener('input', (e) => {
      const t = e.target.closest('textarea[data-i]');
      if (!t) return;
      const i = Number(t.dataset.i);
      if (!ctx.exchange[i]) return;
      ctx.exchange[i][t.dataset.k] = t.value;
      t.parentNode.dataset.v = t.value;
      scheduleExchange();
    });
    ex.addEventListener('keydown', (e) => {
      const t = e.target.closest('textarea[data-i]');
      if (!t || e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      const i = Number(t.dataset.i);
      const next = ex.querySelector(`textarea[data-i="${i + 1}"][data-k="${t.dataset.k}"]`);
      if (next) next.focus();
      else addExchangeRow(t.dataset.k);                                      // 맨 아래 행에서 Enter → 새 행의 같은 열
    });
    ex.addEventListener('click', (e) => { if (e.target.closest('.x-add')) addExchangeRow(); });
    // 모두 지운 행은 포커스가 다른 칸으로 옮겨 간 뒤에 없앤다
    ex.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!dlg.open || q('.notice-exch').hidden || !ctx.editable) return;
        const active = document.activeElement;
        for (let i = ctx.exchange.length - 1; i >= 0; i--) {
          if (!isBlank(ctx.exchange[i])) continue;
          const tr = ex.querySelector(`tr[data-i="${i}"]`);
          if (tr && active && tr.contains(active)) continue;               // 아직 그 행에서 입력 중
          ctx.exchange.splice(i, 1);
          if (tr) tr.remove();
          ex.querySelectorAll('tbody tr').forEach((r, n) => { r.dataset.i = n; r.querySelectorAll('textarea').forEach((t) => { t.dataset.i = n; t.setAttribute('aria-label', `${t.getAttribute('aria-label').replace(/ \d+행$/, '')} ${n + 1}행`); }); });
          scheduleExchange();
        }
      }, 0);
    });
    q('.notice-edit-btn').addEventListener('click', () => {
      editor.innerHTML = sanitize(ctx.html);
      q('.notice-view').hidden = true;
      q('.notice-edit').hidden = false;
      editor.focus();
    });
    const back = () => { q('.notice-edit').hidden = true; q('.notice-view').hidden = false; };
    q('[data-cancel]').addEventListener('click', back);
    q('[data-save]').addEventListener('click', () => {
      const html = sanitize(editor.innerHTML);
      ctx.html = html;
      if (ctx.onSave) ctx.onSave(html);
      render(q('.notice-body'), html, ctx.emptyMessage);
      back();
    });

    // 서식 버튼 (글자를 골라 둔 상태에서 누름). 버튼을 눌러도 글자 선택이 풀리지 않게 mousedown 을 막는다.
    const exec = (cmd) => {
      editor.focus();
      try { document.execCommand('styleWithCSS', false, false); } catch (err) { /* 무시 */ }
      if (cmd === 'gray') document.execCommand('foreColor', false, selectionIsGray() ? '#1f2430' : GRAY);
      else document.execCommand(cmd, false, null);
      sync();
    };
    q('.notice-bar').addEventListener('mousedown', (e) => e.preventDefault());
    q('.notice-bar').addEventListener('click', (e) => { const b = e.target.closest('.notice-tool'); if (b) exec(b.dataset.cmd); });
    editor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); exec('bold'); }
    });
    // 입력칸에 붙여넣을 때는 서식 없는 글자만
    editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, t);
    });
    function selectionIsGray() {
      const sel = window.getSelection();
      if (!sel.rangeCount) return false;
      let n = sel.anchorNode;
      if (n && n.nodeType === 3) n = n.parentElement;
      return !!n && editor.contains(n) && isGray(getComputedStyle(n).color);
    }
    function sync() {
      const on = (c) => { try { return document.queryCommandState(c); } catch (err) { return false; } };
      q('[data-cmd="bold"]').setAttribute('aria-pressed', String(on('bold')));
      q('[data-cmd="strikeThrough"]').setAttribute('aria-pressed', String(on('strikeThrough')));
      q('[data-cmd="gray"]').setAttribute('aria-pressed', String(selectionIsGray()));
    }
    document.addEventListener('selectionchange', () => { if (dlg.open && !q('.notice-edit').hidden) sync(); });
    return dlg;
  }

  window.INKNOTICE = {
    sanitize,
    cleanExchange,
    defaultHtml: () => linesToHtml(DEFAULT_LINES),
    open(c) {
      ctx = Object.assign({ html: '', editable: false, emptyMessage: '', exchange: [], onSave: null, onExchange: null, onClose: null }, c);
      ctx.exchange = cleanExchange(ctx.exchange);
      const d = ensure();
      d.querySelector('.notice-edit').hidden = true;
      d.querySelector('.notice-view').hidden = false;
      render(d.querySelector('.notice-body'), ctx.html, ctx.emptyMessage);
      setTab('info');
      if (!d.open) d.showModal();
      d.querySelector('[data-ok]').focus();
    },
    setEditable(v) {
      if (ctx) ctx.editable = !!v;
      if (dlg) { updatePencil(); if (tab === 'exch') renderExchange(); }
    },
    close() { if (dlg && dlg.open) dlg.close(); },
  };
})();

// 잉팔잉사 처음 접속 알림창. ink-owned.js 가 INKNOTICE.open({ html, editable, onSave }) 로 연다.
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

  let dlg = null;
  let ctx = { html: '', editable: false, onSave: null, onClose: null };

  function render(el, html) {
    el.innerHTML = sanitize(html);
    el.querySelectorAll(':scope > div').forEach((d) => { if (d.textContent.startsWith('- ')) d.classList.add('bullet'); });   // "- " 로 시작하는 줄은 걸어 들여쓰기
  }

  function ensure() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'dialog notice-dialog';
    dlg.setAttribute('aria-label', '잉팔잉사 안내');
    dlg.innerHTML = `
      <div class="notice-view">
        <button class="notice-edit-btn" type="button" title="알림글 수정" aria-label="알림글 수정" hidden>${PENCIL}</button>
        <div class="notice-body"></div>
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
    dlg.addEventListener('close', () => { if (ctx.onClose) ctx.onClose(); });
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
      render(q('.notice-body'), html);
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
    defaultHtml: () => linesToHtml(DEFAULT_LINES),
    open(c) {
      ctx = Object.assign({ html: '', editable: false, onSave: null, onClose: null }, c);
      const d = ensure();
      d.querySelector('.notice-edit').hidden = true;
      d.querySelector('.notice-view').hidden = false;
      render(d.querySelector('.notice-body'), ctx.html);
      d.querySelector('.notice-edit-btn').hidden = !ctx.editable;
      if (!d.open) d.showModal();
      d.querySelector('[data-ok]').focus();
    },
    setEditable(v) {
      if (ctx) ctx.editable = !!v;
      if (dlg) dlg.querySelector('.notice-edit-btn').hidden = !v;
    },
    close() { if (dlg && dlg.open) dlg.close(); },
  };
})();

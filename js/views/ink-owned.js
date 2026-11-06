// 보유 잉크 표: 브랜드 / 잉크명 / 본병·소분 / 잔량 / 비고 / 가격 (270행)
// 잔량 막대는 10칸. 칸을 누르면 그 칸과 왼쪽 칸이 모두 채워진다(관리자 모드에서만).
// 같은 칸(현재 잔량)을 다시 누르면 0으로 비운다.
// 아직 저장소가 없어서 잔량은 새로고침하면 초기화된다. (Firestore 연결은 다음 단계)
(() => {
  'use strict';

  const ROWS = 270;
  const STEPS = 10;
  const COLUMNS = [
    { label: '브랜드',     width: 140 },
    { label: '잉크명',     width: 200 },
    { label: '본병/소분',  width: 96 },
    { label: '잔량',       width: 230 },
    { label: '비고',       width: 260 },
    { label: '가격',       width: 110 },
  ];
  const LEVEL_COL = 3;

  const levels = new Uint8Array(ROWS); // 화면을 오가도 유지(새로고침 전까지)

  const isAdminMode = () => document.documentElement.dataset.mode === 'admin';

  function barHtml() {
    let segs = '';
    for (let i = 1; i <= STEPS; i++) {
      segs += `<button class="seg" type="button" data-i="${i}" aria-label="잔량 ${i}/${STEPS}"></button>`;
    }
    return `<div class="bar" role="group" aria-label="잔량"><div class="track" aria-hidden="true"><i class="pv"></i><i class="fill"></i></div>${segs}</div>`;
  }

  function rowsHtml() {
    const bar = barHtml();
    const cells = COLUMNS.map((_, c) => (c === LEVEL_COL ? `<td class="c-level">${bar}</td>` : '<td></td>')).join('');
    let html = '';
    for (let r = 0; r < ROWS; r++) html += `<tr data-row="${r}">${cells}</tr>`;
    return html;
  }

  function paint(row, level) {
    const bar = row.querySelector('.bar');
    bar.style.setProperty('--lv', level);
    bar.dataset.level = level;
    // 채워진 영역 안에 놓인 구분선은 어두운 색으로 (CSS .seg.in)
    bar.querySelectorAll('.seg').forEach((seg, idx) => seg.classList.toggle('in', idx + 1 <= level));
  }

  function setEditable(root, admin) {
    root.querySelectorAll('.bar').forEach((bar) => { bar.inert = !admin; });
  }

  function mount(container) {
    container.innerHTML = `
      <div class="table-wrap view-enter">
        <table class="grid">
          <colgroup>${COLUMNS.map((c) => `<col style="width:${c.width}px">`).join('')}</colgroup>
          <thead><tr>${COLUMNS.map((c) => `<th scope="col">${c.label}</th>`).join('')}</tr></thead>
          <tbody>${rowsHtml()}</tbody>
        </table>
      </div>`;

    const tbody = container.querySelector('tbody');
    tbody.querySelectorAll('tr').forEach((row) => { if (levels[row.dataset.row]) paint(row, levels[row.dataset.row]); });
    setEditable(container, isAdminMode());

    // 마우스를 올린 칸까지 미리보기 (관리자 모드에서만 bar 가 inert 가 아니라서 동작)
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
      if (!seg || !isAdminMode()) return;
      const row = seg.closest('tr');
      const idx = Number(row.dataset.row);
      const i = Number(seg.dataset.i);
      levels[idx] = levels[idx] === i ? 0 : i;
      paint(row, levels[idx]);
    });
  }

  window.INKVENTORY_VIEWS = window.INKVENTORY_VIEWS || {};
  window.INKVENTORY_VIEWS['ink-owned'] = {
    mount,
    onMode(admin) {
      const main = document.getElementById('main');
      if (main) setEditable(main, admin);
    },
  };
})();

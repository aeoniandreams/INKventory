// 폰의 두 손가락 확대·축소 중에만 쓰는 "보이는 행만 그리기".
//
// 표가 크면(수백 행) 배율(CSS zoom)을 바꿀 때마다 표 전체를 다시 배치하느라 버벅인다.
// 확대·축소를 시작하면 화면 근처에 있는 행만 남기고, 나머지 행은 숨긴 뒤 "같은 높이의 빈 칸" 두 개(위·아래)로 대신한다.
// 숨긴 행의 높이는 배율에 거의 비례하므로 빈 칸 높이는 그 비례로 따라가고, 표 모양·스크롤바 길이는 거의 그대로다.
// (CSS 의 1px 테두리가 작은 배율에서 더 굵게 보이는 만큼의 작은 차이는 손가락을 뗄 때 보이는 행이 제자리에 있도록 스크롤을 맞춰서 감춘다.)
// 배율이 바뀔 때마다 sync 가 화면에 들어온 행은 더 보이게 하고 멀어진 행은 다시 숨긴다.
// 손가락을 떼면 숨긴 행을 모두 되돌리고 빈 칸을 없앤다. (표 자료·행 순서는 건드리지 않는다)
//
// 사용: const pw = PinchWindow.begin(gridTable, 지금 배율);  // 숨길 행이 적으면 null
//       배율을 바꾼 직후마다 pw.sync(새 배율);
//       끝나면 pw.end();
(function () {
  'use strict';

  const MIN_HIDE = 30;     // 처음에 숨길 행이 이보다 적으면 이득이 작으니 하지 않는다

  function begin(grid, z) {
    const body = grid && grid.tBodies && grid.tBodies[0];
    if (!body || !(z > 0)) return null;
    const rows = Array.from(body.rows);
    const vh = window.innerHeight;
    const margin = vh * 0.5;           // 화면 위·아래로 반 화면씩 여유
    const rects = rows.map((r) => r.getBoundingClientRect());
    let lo = -1;
    let hi = -1;
    rows.forEach((r, i) => {
      const b = rects[i];
      if (b.height > 0 && b.bottom > -margin && b.top < vh + margin) { if (lo < 0) lo = i; hi = i; }
    });
    if (lo < 0) return null;
    let hideable = 0;
    rows.forEach((r, i) => { if ((i < lo || i > hi) && rects[i].height > 0) hideable++; });
    if (hideable < MIN_HIDE) return null;

    const hs = rects.map((b) => b.height / z);               // 배율 1 기준 높이
    const mine = rows.map(() => false);                      // 내가 숨긴 행
    const cols = Math.max(1, ...Array.from(grid.rows || [], (r) => r.cells.length));
    const total0 = grid.getBoundingClientRect().height;
    const y0 = rects[lo].top;

    const mkSp = () => {
      const tr = document.createElement('tr');
      tr.className = 'pz-spacer';
      tr.setAttribute('aria-hidden', 'true');
      const td = document.createElement('td');
      td.colSpan = cols;
      td.style.cssText = 'padding:0;border:0;height:0';
      tr.appendChild(td);
      return tr;
    };
    const topSp = mkSp();
    const botSp = mkSp();
    let topH = 0;
    let botH = 0;
    // 빈 칸을 제자리에 놓는다. 높이가 없으면 표에서 뺀다 (마지막 행의 모양은 :last-child 에 걸려 있어서 빈 칸이 마지막이 되면 안 된다)
    const place = () => {
      if (topH > 0.5) { topSp.firstChild.style.height = topH + 'px'; body.insertBefore(topSp, rows[lo]); } else topSp.remove();
      if (botH > 0.5) { botSp.firstChild.style.height = botH + 'px'; body.insertBefore(botSp, rows[hi].nextSibling); } else botSp.remove();
    };
    const hide = (i, side) => {
      if (mine[i] || !(hs[i] > 0)) return;
      rows[i].style.display = 'none';
      mine[i] = true;
      if (side === 0) topH += hs[i]; else botH += hs[i];
    };
    const show = (i, side) => {
      if (!mine[i]) return;
      rows[i].style.display = '';
      mine[i] = false;
      if (side === 0) topH -= hs[i]; else botH -= hs[i];
    };

    for (let i = 0; i < lo; i++) hide(i, 0);
    for (let i = hi + 1; i < rows.length; i++) hide(i, 1);
    place();
    // 브라우저마다 CSS zoom 아래의 길이 계산이 조금 다를 수 있어서, 빈 칸을 넣은 뒤 실제로 어긋난 만큼 보정한다
    const dy = rows[lo].getBoundingClientRect().top - y0;
    if (Math.abs(dy) > 0.5 && topH > 0.5) { topH -= dy / z; place(); }
    const dt = total0 - grid.getBoundingClientRect().height;
    if (Math.abs(dt) > 0.5 && botH > 0.5) { botH += dt / z; place(); }

    // 배율이 바뀐 뒤: 화면에서 멀어진 행은 다시 숨기고, 화면(+여유)에 들어온 행은 더 보이게 한다
    function sync(nz) {
      const h = window.innerHeight;
      const m = h * 0.5;
      const rc = [];
      for (let i = lo; i <= hi; i++) rc[i] = rows[i].getBoundingClientRect();     // 읽기를 먼저 몰아서 한다 (다시 배치를 한 번만 하려고)
      let nlo = lo;
      let nhi = hi;
      while (nlo < nhi && (rc[nlo].height === 0 || rc[nlo].bottom < -m)) nlo++;
      while (nhi > nlo && (rc[nhi].height === 0 || rc[nhi].top > h + m)) nhi--;
      const oldLo = lo;
      const oldHi = hi;
      for (let i = oldLo; i < nlo; i++) hide(i, 0);
      for (let i = nhi + 1; i <= oldHi; i++) hide(i, 1);
      lo = nlo;
      hi = nhi;
      if (topH > 0.5 && rc[lo].top > -m) {
        let need = rc[lo].top + m;
        while (lo > 0 && need > 0) { lo--; if (mine[lo]) need -= hs[lo] * nz; show(lo, 0); }
      }
      if (botH > 0.5 && rc[hi].bottom < h + m) {
        let need = h + m - rc[hi].bottom;
        while (hi < rows.length - 1 && need > 0) { hi++; if (mine[hi]) need -= hs[hi] * nz; show(hi, 1); }
      }
      place();
    }

    function end() {
      const ref = rows[Math.min(lo, rows.length - 1)];
      const before = ref.getBoundingClientRect().top;
      topSp.remove();
      botSp.remove();
      rows.forEach((r, i) => { if (mine[i]) { r.style.display = ''; mine[i] = false; } });
      const shift = ref.getBoundingClientRect().top - before;      // 행 높이의 작은 차이로 생길 수 있는 어긋남을 바로잡는다
      if (Math.abs(shift) > 0.5) window.scrollBy(0, shift);
    }

    return { sync, end };
  }

  window.PinchWindow = { begin };
})();

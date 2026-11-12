// 잉팔잉사 이미지 저장 (관리자 모드 전용). ink-owned.js 의 "이미지" 버튼이 INKEXPORT.open({ items }) 로 연다.
//   · 발색 모음: 발색 사진을 4열 × 5행(한 장에 20개)으로 이어 붙인 이미지. 사진 사이 여백 없음. 사진 위에 브랜드·잉크명을 쓰고,
//     글자색은 그 자리의 사진 밝기를 재서 어두우면 흰색, 밝으면 검은색(가장자리에 반대색 테두리를 얇게 둘러 읽기 쉽게).
//   · 표: 잉팔잉사 표를 20행씩 나눠 그린 이미지 (발색 모음의 장 순서와 같은 묶음).
// items: [{ brand, name, pearl, note, portions, price, src }]  (src = 사진 주소, 없으면 '')
// 사진은 CORS 를 허용하는 주소여야 캔버스로 합쳐서 저장할 수 있다 (저장소 사진은 같은 사이트, 드라이브 사진은 lh3.googleusercontent.com).
(() => {
  'use strict';

  const PER_PAGE = 20;      // 한 이미지에 넣는 최대 개수
  const GRID_COLS = 4;      // 발색 모음: 4열 × 5행
  const TILE_H = 500;       // 발색 한 칸의 높이(px). 1:1 이면 500×500, 3:4 이면 375×500
  const FONT = '"Pretendard JP Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
  const TABLE_COLS = [
    { k: 'brand', label: '브랜드', w: 180 },
    { k: 'name', label: '잉크명', w: 260 },
    { k: 'swatch', label: '발색', w: 64 },
    { k: 'note', label: '비고', w: 180 },
    { k: 'portions', label: '소분 가능\n(5ml)', w: 98 },
    { k: 'price', label: '가격', w: 83 },
  ];

  let dialog = null;
  let urls = [];

  const pages = (list) => {
    const out = [];
    for (let i = 0; i < list.length; i += PER_PAGE) out.push(list.slice(i, i + PER_PAGE));
    return out;
  };

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) { resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // 사진을 칸(dw×dh)에 꽉 차게 가운데 기준으로 잘라 그림
  function drawCover(ctx, img, x, y, dw, dh) {
    const r = Math.max(dw / img.width, dh / img.height);
    const sw = dw / r;
    const sh = dh / r;
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, dw, dh);
  }

  // 글자를 maxW 안에 줄바꿈(한글은 글자 단위). maxLines 를 넘으면 마지막 줄 끝을 …로
  function wrapText(ctx, text, maxW, maxLines) {
    const lines = [];
    let cur = '';
    for (const ch of Array.from(text)) {
      if (ctx.measureText(cur + ch).width > maxW && cur) {
        lines.push(cur.trimEnd());
        cur = ch === ' ' ? '' : ch;
      } else {
        cur += ch;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      let last = lines[maxLines - 1];
      while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '…';
    }
    return lines;
  }

  function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = Array.from(text);
    while (t.length && ctx.measureText(t.join('') + '…').width > maxW) t.pop();
    return t.join('') + '…';
  }

  // 사진 아랫부분의 밝기(0~1). 캔버스가 막혀 있으면(허용 안 된 사진) null
  function brightness(ctx, x, y, w, h) {
    try {
      const d = ctx.getImageData(x, y, w, h).data;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 16) {      // 4픽셀마다 한 번
        sum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        n++;
      }
      return n ? sum / n : null;
    } catch (err) { return null; }
  }

  // ── 발색 모음 한 장 ──
  function drawCollage(list, imgs, ratio) {
    const tileW = ratio === '3:4' ? Math.round(TILE_H * 3 / 4) : TILE_H;
    const rows = Math.ceil(list.length / GRID_COLS);
    const cv = document.createElement('canvas');
    cv.width = tileW * GRID_COLS;
    cv.height = TILE_H * rows;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#e6e9f1';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const k = tileW / 500;      // 글자 크기 기준 (칸 너비에 비례)
    list.forEach((it, i) => {
      const x = (i % GRID_COLS) * tileW;
      const y = Math.floor(i / GRID_COLS) * TILE_H;
      const img = imgs[i];
      if (img) drawCover(ctx, img, x, y, tileW, TILE_H);
      // 글자: 아래쪽 왼쪽 정렬. 브랜드(작게, 한 줄) 위에 잉크명(크게, 최대 두 줄)
      const padX = 16 * k;
      const maxW = tileW - padX * 2;
      ctx.textBaseline = 'alphabetic';
      ctx.font = `700 ${Math.round(32 * k)}px ${FONT}`;
      const nameLines = wrapText(ctx, it.name, maxW, 2);
      ctx.font = `500 ${Math.round(22 * k)}px ${FONT}`;
      const brand = ellipsize(ctx, it.brand, maxW);
      const nameLH = 38 * k;
      const brandLH = 28 * k;
      const textH = nameLines.length * nameLH + brandLH;
      const regionH = Math.min(TILE_H, Math.ceil(textH + 32 * k));
      const lum = img ? brightness(ctx, x, y + TILE_H - regionH, tileW, regionH) : null;
      const dark = lum !== null && lum < 0.6;                    // 어두운 사진 → 흰 글자, 밝은 사진 → 검은 글자
      const fg = dark ? '#ffffff' : '#111111';
      const halo = dark ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.6)';
      let ty = y + TILE_H - 18 * k;
      ctx.lineJoin = 'round';
      const put = (text, font, lh, lw) => {
        ctx.font = font;
        ctx.lineWidth = lw;
        ctx.strokeStyle = halo;
        ctx.strokeText(text, x + padX, ty);
        ctx.fillStyle = fg;
        ctx.fillText(text, x + padX, ty);
        ty -= lh;
      };
      for (let j = nameLines.length - 1; j >= 0; j--) put(nameLines[j], `700 ${Math.round(32 * k)}px ${FONT}`, nameLH, 5 * k);
      put(brand, `500 ${Math.round(22 * k)}px ${FONT}`, brandLH, 4 * k);
    });
    return cv;
  }

  // ── 표 한 장 (20행) ──
  function drawTable(list, imgs, pageNo, pageCount) {
    const S = 2;
    const PAD = 24;
    const HEAD = 40;
    const FOOT = 26;
    const W = TABLE_COLS.reduce((s, c) => s + c.w, 0);
    const meas = document.createElement('canvas').getContext('2d');
    const lineCount = (it) => Math.max(1, ...['brand', 'name', 'note', 'portions', 'price'].map((f) => String(it[f] || '').split('\n').length));
    const heights = list.map((it) => Math.max(40, lineCount(it) * 20 + 20));
    const H = HEAD + heights.reduce((a, b) => a + b, 0);
    const cv = document.createElement('canvas');
    cv.width = (W + PAD * 2) * S;
    cv.height = (H + PAD * 2 + FOOT) * S;
    const ctx = cv.getContext('2d');
    ctx.scale(S, S);
    ctx.fillStyle = '#eff1f6';
    ctx.fillRect(0, 0, cv.width, cv.height);
    // 표 바탕 + 둥근 테두리
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); };
    ctx.save();
    rr(PAD, PAD, W, H, 12);
    ctx.clip();
    ctx.fillStyle = '#f7f8fb';
    ctx.fillRect(PAD, PAD, W, H);
    // 제목 줄
    ctx.fillStyle = '#dfe7f7';
    ctx.fillRect(PAD, PAD, W, HEAD);
    ctx.textBaseline = 'middle';
    let x = PAD;
    TABLE_COLS.forEach((c) => {
      ctx.fillStyle = '#6f7380';
      ctx.font = `700 13px ${FONT}`;
      const lines = c.label.split('\n');
      const centered = c.k === 'swatch';
      ctx.textAlign = centered ? 'center' : 'left';
      lines.forEach((ln, i) => ctx.fillText(ln, centered ? x + c.w / 2 : x + 12, PAD + HEAD / 2 + (i - (lines.length - 1) / 2) * 16));
      x += c.w;
    });
    ctx.textAlign = 'left';
    // 행
    let y = PAD + HEAD;
    list.forEach((it, ri) => {
      const h = heights[ri];
      let cx = PAD;
      TABLE_COLS.forEach((c) => {
        if (c.k === 'name' && it.pearl) { ctx.fillStyle = '#e6e9f1'; ctx.fillRect(cx, y, c.w, h); }
        if (c.k === 'swatch') {
          const r = 14;
          const mx = cx + c.w / 2;
          const my = y + h / 2;
          ctx.save();
          ctx.beginPath();
          ctx.arc(mx, my, r, 0, Math.PI * 2);
          ctx.clip();
          ctx.fillStyle = '#eef0f6';
          ctx.fillRect(mx - r, my - r, r * 2, r * 2);
          if (imgs[ri]) drawCover(ctx, imgs[ri], mx - r, my - r, r * 2, r * 2);
          ctx.restore();
          ctx.beginPath();
          ctx.arc(mx, my, r - 0.5, 0, Math.PI * 2);
          ctx.strokeStyle = imgs[ri] ? 'rgba(31,36,48,.14)' : '#cfd4e0';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          ctx.fillStyle = '#1f2430';
          ctx.font = `400 14px ${FONT}`;
          String(it[c.k] || '').split('\n').forEach((ln, li) => ctx.fillText(ellipsize(ctx, ln, c.w - 24), cx + 12, y + 20 + li * 20));
        }
        // 오른쪽 선
        ctx.fillStyle = '#d7dbe4';
        if (c !== TABLE_COLS[TABLE_COLS.length - 1]) ctx.fillRect(cx + c.w - 1, y, 1, h);
        cx += c.w;
      });
      if (ri < list.length - 1) { ctx.fillStyle = '#d7dbe4'; ctx.fillRect(PAD, y + h - 1, W, 1); }
      y += h;
    });
    // 제목 줄 열 구분선
    ctx.fillStyle = '#d7dbe4';
    x = PAD;
    TABLE_COLS.forEach((c, i) => { x += c.w; if (i < TABLE_COLS.length - 1) ctx.fillRect(x - 1, PAD, 1, HEAD); });
    ctx.fillRect(PAD, PAD + HEAD - 1, W, 1);
    ctx.restore();
    rr(PAD + 0.5, PAD + 0.5, W - 1, H - 1, 12);
    ctx.strokeStyle = '#d7dbe4';
    ctx.lineWidth = 1;
    ctx.stroke();
    // 쪽 번호
    ctx.fillStyle = '#6f7380';
    ctx.font = `500 12px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`INKventory · 잉팔잉사 ${pageNo}/${pageCount}`, PAD + W, PAD + H + 18);
    ctx.textAlign = 'left';
    void meas;
    return cv;
  }

  // ── 창 ──
  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'dialog exp-dialog';
    dialog.innerHTML = `
      <div class="dialog__body">
        <h2 class="dialog__title">이미지 저장</h2>
        <div class="exp-form">
          <label><input type="radio" name="expKind" value="swatch" checked> 발색 모음 <span class="exp-hint">(한 장에 최대 ${PER_PAGE}개, 4열 × 5행)</span></label>
          <label><input type="radio" name="expKind" value="table"> 표 <span class="exp-hint">(${PER_PAGE}행씩 나눔)</span></label>
          <div class="exp-row">
            <label class="exp-ratio">발색 사진 비율
              <select name="expRatio"><option value="1:1">1:1</option><option value="3:4">3:4</option></select></label>
            <label>형식
              <select name="expFmt"><option value="png">PNG</option><option value="jpg">JPG</option></select></label>
          </div>
        </div>
        <p class="exp-info" aria-live="polite"></p>
        <div class="exp-out"></div>
        <div class="dialog__actions">
          <button class="btn" type="button" data-close>닫기</button>
          <button class="btn" type="button" data-saveall hidden>모두 저장</button>
          <button class="btn btn--primary" type="button" data-make>이미지 만들기</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('close', cleanup);
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('change', () => { syncForm(); });
    return dialog;
  }

  function cleanup() {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
    if (dialog) {
      dialog.querySelector('.exp-out').innerHTML = '';
      dialog.querySelector('[data-saveall]').hidden = true;
    }
  }

  let current = null;

  function kindOf() { return dialog.querySelector('input[name="expKind"]:checked').value; }

  function syncForm() {
    if (!current) return;
    const swatch = kindOf() === 'swatch';
    dialog.querySelector('.exp-ratio').style.display = swatch ? '' : 'none';
    const withPhoto = current.items.filter((it) => it.src);
    const n = swatch ? withPhoto.length : current.items.length;
    const skipped = current.items.length - withPhoto.length;
    const info = dialog.querySelector('.exp-info');
    if (!n) info.textContent = swatch ? '사진이 있는 잉크가 없습니다.' : '표에 행이 없습니다.';
    else info.textContent = `${n}개 → ${Math.ceil(n / PER_PAGE)}장${swatch && skipped ? ` (사진 없는 ${skipped}곳은 제외)` : ''}`;
    dialog.querySelector('[data-make]').disabled = !n;
  }

  async function make() {
    const d = dialog;
    const out = d.querySelector('.exp-out');
    const info = d.querySelector('.exp-info');
    const makeBtn = d.querySelector('[data-make]');
    const swatch = kindOf() === 'swatch';
    const ratio = d.querySelector('select[name="expRatio"]').value;
    const fmt = d.querySelector('select[name="expFmt"]').value;
    const list = swatch ? current.items.filter((it) => it.src) : current.items;
    if (!list.length) return;
    cleanup();
    makeBtn.disabled = true;
    try {
      info.textContent = '글꼴과 사진을 불러오는 중…';
      const text = list.map((it) => `${it.brand}${it.name}${it.note}${it.portions}${it.price}`).join('') + '0123456789소분 가능 (5ml)브랜드잉크명발색비고가격INKventory잉팔잉사/·…';
      try { await Promise.all(['400', '500', '700'].map((w) => document.fonts.load(`${w} 16px "Pretendard JP Variable"`, text))); } catch (err) { /* 글꼴을 못 받아도 기본 글꼴로 그림 */ }
      const imgs = await Promise.all(list.map((it) => loadImage(it.src)));
      const failed = imgs.filter((im, i) => list[i].src && !im).length;
      const groups = pages(list.map((it, i) => ({ it, img: imgs[i] })));
      const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
      let k = 0;
      for (const g of groups) {
        k++;
        info.textContent = `이미지 만드는 중… (${k}/${groups.length})`;
        await new Promise((r) => setTimeout(r, 0));          // 화면이 멈춰 보이지 않게 한 장마다 숨 돌림
        const its = g.map((x) => x.it);
        const ims = g.map((x) => x.img);
        const cv = swatch ? drawCollage(its, ims, ratio) : drawTable(its, ims, k, groups.length);
        const blob = await new Promise((res) => cv.toBlob(res, mime, 0.92));
        if (!blob) throw new Error('blob');
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const name = `잉팔잉사-${swatch ? '발색' : '표'}-${k}.${fmt}`;
        const fig = document.createElement('figure');
        fig.className = 'exp-fig';
        fig.innerHTML = '<img alt=""><figcaption><span></span><a class="btn" download>저장</a></figcaption>';
        fig.querySelector('img').src = url;
        fig.querySelector('span').textContent = `${k}/${groups.length} · ${cv.width}×${cv.height}px · ${(blob.size / 1024 / 1024).toFixed(1)}MB`;
        const a = fig.querySelector('a');
        a.href = url;
        a.download = name;
        out.appendChild(fig);
      }
      info.textContent = `${groups.length}장을 만들었습니다.${failed ? ` (사진 ${failed}개를 불러오지 못해 빈 칸으로 그림)` : ''}`;
      const all = d.querySelector('[data-saveall]');
      all.hidden = groups.length < 2;
      all.onclick = () => { out.querySelectorAll('a[download]').forEach((a, i) => setTimeout(() => a.click(), i * 400)); };
    } catch (err) {
      info.textContent = '이미지를 만들지 못했습니다. 다시 시도해 주세요.';
    }
    makeBtn.disabled = false;
  }

  window.INKEXPORT = {
    open(ctx) {
      current = ctx;
      const d = ensureDialog();
      cleanup();
      d.querySelector('[data-make]').onclick = make;
      syncForm();
      if (!d.open) d.showModal();
    },
  };
})();

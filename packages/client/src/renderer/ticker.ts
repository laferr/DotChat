// 전광판 렌더러 — 모니터 상단에서 주가 요약/뉴스/상폐/광고가 오른쪽→왼쪽으로 흐른다.
// 항목들은 컨베이어처럼 400px 간격을 두고 연달아 흐름 (이전 항목이 다 지나가길 기다리지 않음)
// (전역 오염 방지 IIFE — overlay.ts와 같은 tsc 프로그램이라 Window.overlay 타입 공유)

(() => {
  const bar = document.getElementById('bar')!;

  interface TickerItemLike {
    id: string;
    ts: number;
    kind: 'stocks' | 'news' | 'delist' | 'relist' | 'ad';
    text: string;
    from?: string;
  }

  const KIND_COLORS: Record<string, string> = {
    stocks: '#ffd66e',
    news: '#9fdcff',
    delist: '#ff6b6b',
    relist: '#8be06a',
    ad: '#ff8dc7',
  };

  const SPEED = 120; // px/s
  const GAP = 400; // 항목 사이 간격

  interface ActiveRun {
    el: HTMLSpanElement;
    x: number;
    w: number;
  }
  const active: ActiveRun[] = [];
  let lastTime = 0;

  function spawn(item: TickerItemLike): void {
    const el = document.createElement('span');
    el.className = 'tk-run';
    if (item.kind === 'stocks') {
      el.innerHTML = formatStocksTickerHtml(item.text); // 업체명 노랑 · 주가 흰색 · ▲빨강 ▼파랑
    } else {
      el.textContent = item.kind === 'ad' && item.from ? `${item.text}  — ${item.from}` : item.text;
    }
    el.style.color = KIND_COLORS[item.kind] ?? '#ffd66e';
    bar.appendChild(el);
    const w = el.offsetWidth;
    // 마지막 항목 꼬리 + 간격 뒤에 이어붙임 (화면 오른쪽 끝보다는 안쪽으로 안 들어옴)
    const last = active[active.length - 1];
    const x = Math.max(window.innerWidth, last ? last.x + last.w + GAP : window.innerWidth);
    el.style.transform = `translate(${x}px, -50%)`;
    active.push({ el, x, w });
    if (active.length > 30) {
      const drop = active.shift()!;
      drop.el.remove();
    }
    bar.classList.add('show');
  }

  function tick(time: number): void {
    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    for (let i = active.length - 1; i >= 0; i--) {
      const run = active[i];
      run.x -= SPEED * dt;
      run.el.style.transform = `translate(${run.x}px, -50%)`;
      if (run.x + run.w < -20) {
        run.el.remove();
        active.splice(i, 1);
      }
    }
    if (active.length === 0) bar.classList.remove('show');
    requestAnimationFrame(tick);
  }

  window.overlay.on('net:ticker', (data) => {
    const item = data as TickerItemLike;
    if (!item || typeof item.text !== 'string') return;
    spawn(item);
  });

  // 오버레이 투명도 설정을 전광판에도 적용
  function applyOpacity(s: { opacity?: number }): void {
    document.body.style.opacity = String(Math.min(1, Math.max(0.1, Number(s.opacity) || 1)));
  }
  window.overlay.on('self:settings', (data) => applyOpacity(data as { opacity?: number }));
  void window.overlay.getSettings().then(applyOpacity);

  requestAnimationFrame((t) => {
    lastTime = t;
    requestAnimationFrame(tick);
  });
})();

// 전광판 렌더러 — 모니터 상단에서 주가 요약/뉴스/상폐/광고가 오른쪽→왼쪽으로 흐른다
// (전역 오염 방지 IIFE — overlay.ts와 같은 tsc 프로그램이라 Window.overlay 타입 공유)

(() => {
  const bar = document.getElementById('bar')!;
  const scrollEl = document.getElementById('scroll')!;

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
  const queue: TickerItemLike[] = [];
  let current: TickerItemLike | null = null;
  let x = 0;
  let lastTime = 0;

  function startNext(): void {
    current = queue.shift() ?? null;
    if (!current) {
      bar.classList.remove('show');
      return;
    }
    scrollEl.textContent =
      current.kind === 'ad' && current.from ? `${current.text}  — ${current.from}` : current.text;
    scrollEl.style.color = KIND_COLORS[current.kind] ?? '#ffd66e';
    x = window.innerWidth;
    scrollEl.style.transform = `translate(${x}px, -50%)`;
    bar.classList.add('show');
  }

  function tick(time: number): void {
    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    if (current) {
      x -= SPEED * dt;
      scrollEl.style.transform = `translate(${x}px, -50%)`;
      if (x < -scrollEl.offsetWidth - 20) startNext();
    } else if (queue.length > 0) {
      startNext();
    }
    requestAnimationFrame(tick);
  }

  window.overlay.on('net:ticker', (data) => {
    const item = data as TickerItemLike;
    if (!item || typeof item.text !== 'string') return;
    queue.push(item);
    if (queue.length > 20) queue.shift(); // 폭주 방지
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

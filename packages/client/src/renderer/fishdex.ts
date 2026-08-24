// 낚시도감 팝업 — 책 배경(256x146 크롭)을 2배 픽셀 고정으로 표시

(async () => {
  const bookEl = document.getElementById('book')!;
  const countEl = document.getElementById('count')!;
  const tooltip = document.getElementById('tooltip')!;
  const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;
  closeBtn.addEventListener('click', () => window.overlay.closeFishdex());

  const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
  function loadImg(rel: string): Promise<HTMLImageElement | null> {
    let cached = imageCache.get(rel);
    if (!cached) {
      cached = window.overlay.loadExtra(rel).then((dataUrl) => {
        if (!dataUrl) return null;
        return new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = dataUrl;
        });
      });
      imageCache.set(rel, cached);
    }
    return cached;
  }

  const manifest = await window.overlay.getExtras();
  if (!manifest) {
    countEl.textContent = '에셋 없음';
    return;
  }

  // 책 배경 (상단 펼친 책 영역만 크롭, 2배)
  const book = await loadImg('book.png');
  if (book) {
    const crop = document.createElement('canvas');
    crop.width = 256;
    crop.height = 146;
    crop.getContext('2d')!.drawImage(book, 0, 0, 256, 146, 0, 0, 256, 146);
    bookEl.style.background = `url(${crop.toDataURL()})`;
    bookEl.style.backgroundSize = '512px 292px';
  }

  // 페이지 배치 (1x 좌표, x2 렌더) — book.png 픽셀 스캔 실측: 좌 18~117 / 우 123~221 / 세로 4~123
  const PAGE_X = [22, 127];
  const PAGE_Y = 11;
  const DX = 25;
  const DY = 18;
  const PER_PAGE = 24;
  const PER_SPREAD = PER_PAGE * 2; // 펼친 책 한 화면 (좌+우 페이지)

  // 구(스트립) + 새(단일 이미지) 물고기 전체 — 스프레드 단위로 넘겨 본다
  const ALL_FISH = [...manifest.fish, ...(manifest.fish2 ?? [])];
  const fish2Set = new Set(manifest.fish2 ?? []);
  const totalSpreads = Math.max(1, Math.ceil(ALL_FISH.length / PER_SPREAD));
  let spread = 0;

  const prevBtn = document.getElementById('prev-btn') as HTMLButtonElement;
  const nextBtn = document.getElementById('next-btn') as HTMLButtonElement;
  const pageLabel = document.getElementById('page-label')!;

  function drawCell(cell: HTMLCanvasElement, fishId: string, isCaught: boolean, img: HTMLImageElement): void {
    const ctx = cell.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    if (!fish2Set.has(fishId)) {
      // 구 물고기 스트립: 1번 프레임 = 물고기, 3번 프레임 = 그림자 실루엣
      ctx.drawImage(img, isCaught ? 0 : 32, 0, 16, 16, 0, 0, 16, 16);
      return;
    }
    // 새 물고기: 전체 이미지를 16x16 칸에 비율 유지로 맞춤
    const nw = img.naturalWidth || 16;
    const nh = img.naturalHeight || 16;
    const s = Math.min(16 / nw, 16 / nh);
    const w = Math.max(1, Math.round(nw * s));
    const h = Math.max(1, Math.round(nh * s));
    ctx.drawImage(img, 0, 0, nw, nh, Math.floor((16 - w) / 2), Math.floor((16 - h) / 2), w, h);
    if (!isCaught) {
      // 못 잡은 것은 단색 실루엣 처리
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = '#3d3229';
      ctx.fillRect(0, 0, 16, 16);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  async function render(): Promise<void> {
    const wallet = (await window.overlay.getWallet()) as { fish?: string[] };
    const caught = new Set(wallet.fish ?? []);
    countEl.textContent = `${[...caught].filter((f) => ALL_FISH.includes(f)).length} / ${ALL_FISH.length}`;
    pageLabel.textContent = `${spread + 1}/${totalSpreads}`;
    prevBtn.disabled = spread === 0;
    nextBtn.disabled = spread >= totalSpreads - 1;
    bookEl.innerHTML = '';
    ALL_FISH.slice(spread * PER_SPREAD, (spread + 1) * PER_SPREAD).forEach((fishId, i) => {
      const page = Math.floor(i / PER_PAGE);
      const slot = i % PER_PAGE;
      const col = slot % 4;
      const row = Math.floor(slot / 4);
      const isCaught = caught.has(fishId);
      const cell = document.createElement('canvas');
      cell.className = isCaught ? 'fish caught' : 'fish uncaught';
      cell.width = 16;
      cell.height = 16;
      const cellLeft = (PAGE_X[page] + col * DX) * 2;
      const cellTop = (PAGE_Y + row * DY) * 2;
      cell.style.left = `${cellLeft}px`;
      cell.style.top = `${cellTop}px`;
      // 투명 프레임리스 창에서는 네이티브 title 툴팁이 안 떠서 커스텀 툴팁 사용
      const label = isCaught ? fishId.replace(/_/g, ' ') : '???';
      cell.addEventListener('mouseenter', () => {
        tooltip.textContent = label;
        tooltip.style.display = 'block';
        // #book 오프셋(10, 24) 반영해 물고기 위 중앙 배치
        const tw = tooltip.offsetWidth;
        tooltip.style.left = `${Math.max(2, Math.min(532 - tw - 2, 10 + cellLeft + 16 - tw / 2))}px`;
        tooltip.style.top = `${24 + cellTop - 22}px`;
      });
      cell.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
      });
      const rel = fish2Set.has(fishId) ? `fish2/${fishId}.png` : `fish/${fishId}.png`;
      void loadImg(rel).then((img) => {
        if (img) drawCell(cell, fishId, isCaught, img);
      });
      bookEl.appendChild(cell);
    });
  }

  prevBtn.addEventListener('click', () => {
    if (spread > 0) {
      spread--;
      void render();
    }
  });
  nextBtn.addEventListener('click', () => {
    if (spread < totalSpreads - 1) {
      spread++;
      void render();
    }
  });

  window.overlay.on('self:wallet', () => void render());
  await render();
})();

// 낚시도감 팝업 — 책 배경(256x146 크롭)을 2배 픽셀 고정으로 표시

(async () => {
  const bookEl = document.getElementById('book')!;
  const countEl = document.getElementById('count')!;
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

  // 페이지 배치 (1x 좌표 기준, x2로 렌더): 페이지당 4x6칸
  const PAGE_X = [18, 134];
  const PAGE_Y = 12;
  const DX = 25;
  const DY = 18;
  const PER_PAGE = 24;

  async function render(): Promise<void> {
    const wallet = (await window.overlay.getWallet()) as { fish?: string[] };
    const caught = new Set(wallet.fish ?? []);
    countEl.textContent = `${caught.size} / ${manifest!.fish.length}`;
    bookEl.innerHTML = '';
    manifest!.fish.forEach((fishId, i) => {
      const page = Math.floor(i / PER_PAGE);
      const slot = i % PER_PAGE;
      const col = slot % 4;
      const row = Math.floor(slot / 4);
      const isCaught = caught.has(fishId);
      const cell = document.createElement('canvas');
      cell.className = isCaught ? 'fish caught' : 'fish uncaught';
      cell.width = 16;
      cell.height = 16;
      cell.style.left = `${(PAGE_X[page] + col * DX) * 2}px`;
      cell.style.top = `${(PAGE_Y + row * DY) * 2}px`;
      cell.title = isCaught ? fishId : '???';
      void loadImg(`fish/${fishId}.png`).then((img) => {
        if (!img) return;
        const ctx = cell.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        // 1번 프레임 = 물고기, 3번 프레임 = 그림자 실루엣
        ctx.drawImage(img, isCaught ? 0 : 32, 0, 16, 16, 0, 0, 16, 16);
      });
      bookEl.appendChild(cell);
    });
  }

  window.overlay.on('self:wallet', () => void render());
  await render();
})();

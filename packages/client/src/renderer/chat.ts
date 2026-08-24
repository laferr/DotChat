// 채팅창 렌더러 — 전역 오염 방지를 위해 IIFE로 감쌈 (overlay.ts와 같은 tsc 프로그램)

(async () => {
  const messagesEl = document.getElementById('messages')!;
  const inputEl = document.getElementById('chat-input') as HTMLInputElement;
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
  const onlineEl = document.getElementById('online')!;
  const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;

  let chatSelfId: string | null = null;

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function addMessage(msg: NetChatMessage): void {
    const wrap = document.createElement('div');
    wrap.className = msg.id === chatSelfId ? 'msg self' : 'msg';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const nick = document.createElement('span');
    nick.className = 'nick';
    nick.textContent = msg.tag ? `${msg.nickname}#${msg.tag}` : msg.nickname;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(msg.ts);
    meta.append(nick, time);

    const body = document.createElement('div');
    body.className = 'text';
    if (msg.image) {
      const imgEl = document.createElement('img');
      imgEl.className = 'msg-image';
      imgEl.src = msg.image.thumb;
      imgEl.title = '클릭하면 원본 보기';
      const url = msg.image.url;
      imgEl.addEventListener('click', () => window.overlay.openImage(url));
      body.appendChild(imgEl);
    } else {
      body.textContent = msg.text;
    }

    wrap.append(meta, body);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addSystemMessage(text: string): void {
    const el = document.createElement('div');
    el.className = 'sysmsg';
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setStatus(connected: boolean, online: number): void {
    onlineEl.textContent = connected ? `${online}명 접속중` : '서버 연결 끊김 — 재접속 중…';
    inputEl.disabled = !connected;
    sendBtn.disabled = !connected;
  }

  function send(): void {
    const text = inputEl.value.trim();
    if (!text) return;
    window.overlay.sendChat(text);
    inputEl.value = '';
    inputEl.focus();
  }

  // ---- 이미지 전송 ----

  const imgBtn = document.getElementById('img-btn') as HTMLButtonElement;
  const imgInput = document.getElementById('img-input') as HTMLInputElement;

  const IMG_MAX_SIDE = 1024;
  const THUMB_MAX_SIDE = 140;

  function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function processAndSendImage(file: Blob): Promise<void> {
    if (file.size > 20_000_000) {
      addSystemMessage('20MB보다 큰 이미지는 보낼 수 없어요.');
      return;
    }
    imgBtn.disabled = true;
    try {
      // 원본 → 최대 1024px WebP로 재인코딩 (업로드 용량 절감)
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, IMG_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
      const blob = await canvasToBlob(canvas, 'image/webp', 0.8);
      if (!blob) throw new Error('encode failed');

      // 말풍선/목록용 소형 썸네일 (브로드캐스트에 포함되므로 작게)
      const tScale = Math.min(1, THUMB_MAX_SIDE / Math.max(w, h));
      const tw = Math.max(1, Math.round(w * tScale));
      const th = Math.max(1, Math.round(h * tScale));
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = tw;
      thumbCanvas.height = th;
      thumbCanvas.getContext('2d')!.drawImage(canvas, 0, 0, tw, th);
      const thumb = thumbCanvas.toDataURL('image/webp', 0.7);

      const buffer = await blob.arrayBuffer();
      const result = (await window.overlay.sendImage({ buffer, mime: 'image/webp', thumb, w, h })) as {
        ok: boolean;
        error?: string;
      };
      if (!result.ok) addSystemMessage(result.error ?? '이미지 전송에 실패했어요.');
    } catch {
      addSystemMessage('이미지 처리에 실패했어요.');
    } finally {
      imgBtn.disabled = false;
    }
  }

  imgBtn.addEventListener('click', () => imgInput.click());
  imgInput.addEventListener('change', () => {
    const file = imgInput.files?.[0];
    if (file) void processAndSendImage(file);
    imgInput.value = '';
  });
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void processAndSendImage(file);
        }
        return;
      }
    }
  });

  // ---- 외모 변경 패널 ----

  const appearanceBtn = document.getElementById('appearance-btn') as HTMLButtonElement;
  const panel = document.getElementById('appearance-panel')!;
  const panelClose = document.getElementById('panel-close') as HTMLButtonElement;
  const charGrid = document.getElementById('char-grid')!;
  const ownedCountEl = document.getElementById('owned-count')!;

  const sheetImgs = new Map<string, Promise<HTMLImageElement>>();
  let sheetUrlMap: Map<string, string> | null = null;

  function sheetImage(name: string, url: string): Promise<HTMLImageElement> {
    let promise = sheetImgs.get(name);
    if (!promise) {
      promise = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('sheet image load failed'));
        img.src = url;
      });
      sheetImgs.set(name, promise);
    }
    return promise;
  }

  async function renderGrid(): Promise<void> {
    if (!sheetUrlMap) {
      const sheets = await window.overlay.loadSprites();
      sheetUrlMap = new Map(sheets.map((s) => [s.name, s.dataUrl]));
    }
    const inv = await window.overlay.getInventory();
    ownedCountEl.textContent = `${inv.owned.length}/${sheetUrlMap.size}`;
    charGrid.innerHTML = '';
    for (const name of inv.owned) {
      const url = sheetUrlMap.get(name);
      if (!url) continue;
      const cell = document.createElement('button');
      cell.className = name === inv.current ? 'char-cell current' : 'char-cell';
      cell.title = name;
      const thumb = document.createElement('canvas');
      const label = document.createElement('span');
      label.className = 'cname';
      label.textContent = name.replace('character_', '#');
      cell.append(thumb, label);
      void sheetImage(name, url).then((img) => {
        const cw = Math.floor(img.width / 3);
        const ch = Math.floor(img.height / 4);
        thumb.width = cw;
        thumb.height = ch;
        const tctx = thumb.getContext('2d')!;
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(img, cw, 0, cw, ch, 0, 0, cw, ch); // 정면 idle 셀 (1행 가운데)
      });
      cell.addEventListener('click', () => window.overlay.equip(name));
      charGrid.appendChild(cell);
    }
  }

  // ---- 옵션 패널 (투명도) ----

  const optionsBtn = document.getElementById('options-btn') as HTMLButtonElement;
  const optionsPanel = document.getElementById('options-panel')!;
  const optionsClose = document.getElementById('options-close') as HTMLButtonElement;
  const opacitySlider = document.getElementById('opacity-slider') as HTMLInputElement;
  const opacityVal = document.getElementById('opacity-val')!;

  function showOpacity(value: number): void {
    opacitySlider.value = String(Math.round(value * 100));
    opacityVal.textContent = `${Math.round(value * 100)}%`;
  }

  optionsBtn.addEventListener('click', async () => {
    panel.classList.remove('open');
    optionsPanel.classList.toggle('open');
    if (optionsPanel.classList.contains('open')) {
      const s = (await window.overlay.getSettings()) as { opacity: number };
      showOpacity(s.opacity);
    }
  });
  optionsClose.addEventListener('click', () => optionsPanel.classList.remove('open'));
  opacitySlider.addEventListener('input', () => {
    const v = Number(opacitySlider.value) / 100;
    opacityVal.textContent = `${opacitySlider.value}%`;
    window.overlay.setOpacity(v);
  });
  window.overlay.on('self:settings', (data) => {
    if (optionsPanel.classList.contains('open')) showOpacity((data as { opacity: number }).opacity);
  });

  appearanceBtn.addEventListener('click', () => {
    optionsPanel.classList.remove('open');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) void renderGrid();
  });
  panelClose.addEventListener('click', () => panel.classList.remove('open'));
  window.overlay.on('self:appearance', () => {
    if (panel.classList.contains('open')) void renderGrid();
  });
  // 패널이 열린 채로 선물상자를 획득해도 새 스킨이 바로 보이도록
  window.overlay.on('self:inventory', () => {
    if (panel.classList.contains('open')) void renderGrid();
  });

  inputEl.addEventListener('keydown', (e) => {
    // isComposing 체크: 한글 IME 조합 중 Enter로 이중 전송 방지
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener('click', send);
  closeBtn.addEventListener('click', () => window.overlay.closeChat());

  // 초기 상태 + 이벤트 구독
  const state = await window.overlay.getNetState();
  chatSelfId = state.selfId;
  setStatus(state.connected, state.online);

  const history = await window.overlay.getChatHistory();
  for (const msg of history) addMessage(msg);

  window.overlay.on('net:chat', (data) => addMessage(data as NetChatMessage));
  window.overlay.on('net:welcome', (data) => {
    chatSelfId = (data as { selfId: string }).selfId;
  });
  window.overlay.on('net:status', (data) => {
    const s = data as { connected: boolean; online: number };
    setStatus(s.connected, s.online);
  });

  inputEl.focus();
})();

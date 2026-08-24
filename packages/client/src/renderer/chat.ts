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

  // ---- 캐릭터 얼굴 아바타 (외형 스냅샷 → 합성 idle 프레임의 얼굴 크롭) ----

  const chatPartProvider: PartImageProvider = (layer, name) =>
    window.overlay.loadPart(layer, name).then((dataUrl) => {
      if (!dataUrl) return null;
      return new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      });
    });
  const chatComposer = new PartComposer(chatPartProvider);
  const faceCache = new Map<string, Promise<HTMLCanvasElement | null>>();

  function faceFor(appearance: Appearance): Promise<HTMLCanvasElement | null> {
    const key = JSON.stringify(appearance);
    let cached = faceCache.get(key);
    if (!cached) {
      cached = chatComposer.compose(appearance).then((frames) => {
        if (!frames) return null;
        const face = document.createElement('canvas');
        face.width = 32;
        face.height = 32;
        const ctx = face.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        // 64x64 셀에서 얼굴 근처(16,12)-(48,44) 크롭
        ctx.drawImage(frames.idle[0], 16, 12, 32, 32, 0, 0, 32, 32);
        return face;
      });
      faceCache.set(key, cached);
    }
    return cached;
  }

  function addMessage(msg: NetChatMessage): void {
    const wrap = document.createElement('div');
    wrap.className = msg.id === chatSelfId ? 'msg self' : 'msg';

    // 아바타 (본인은 오른쪽, 타인은 왼쪽 — CSS row-reverse)
    const avatar = document.createElement('canvas');
    avatar.className = 'avatar';
    avatar.width = 32;
    avatar.height = 32;
    if (msg.senderAppearance) {
      void faceFor(msg.senderAppearance).then((face) => {
        if (face) avatar.getContext('2d')!.drawImage(face, 0, 0);
      });
    }

    const content = document.createElement('div');
    content.className = 'content';

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

    content.append(meta, body);
    wrap.append(avatar, content);
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

  // 채팅 명령어 → 액션 (대사는 메인 프로세스가 랜덤 선택)
  const CHAT_COMMANDS: Record<string, string> = {
    공격: 'attack', // 활 장착 시 자동으로 활쏘기
    베기: 'slash',
    찌르기: 'jab',
    쏘기: 'shot',
    막기: 'block',
    구르기: 'roll',
    점프: 'jump',
    죽은척: 'death',
    엎드려: 'crawl',
    전투준비: 'ready',
  };

  function send(): void {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    inputEl.focus();

    if (text.startsWith('/')) {
      const word = text.slice(1).split(/\s+/)[0];
      if (word === '명령어' || word === '도움말') {
        addSystemMessage(`명령어: ${Object.keys(CHAT_COMMANDS).map((c) => '/' + c).join(' ')}`);
        return;
      }
      const command = CHAT_COMMANDS[word];
      if (command) {
        window.overlay.sendAction(command);
        return;
      }
      addSystemMessage(`알 수 없는 명령어예요. /명령어 로 목록을 볼 수 있어요.`);
      return;
    }

    window.overlay.sendChat(text);
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

  // ---- 외모 변경 패널 (파츠 슬롯 + HSV) ----

  const appearanceBtn = document.getElementById('appearance-btn') as HTMLButtonElement;
  const panel = document.getElementById('appearance-panel')!;
  const panelClose = document.getElementById('panel-close') as HTMLButtonElement;
  const slotTabs = document.getElementById('slot-tabs')!;
  const charGrid = document.getElementById('char-grid')!;
  const ownedCountEl = document.getElementById('owned-count')!;
  const hsvH = document.getElementById('hsv-h') as HTMLInputElement;
  const hsvS = document.getElementById('hsv-s') as HTMLInputElement;
  const hsvV = document.getElementById('hsv-v') as HTMLInputElement;

  interface SlotDef {
    key: string;
    label: string;
    layer: string;
    removable: boolean;
  }
  const SLOTS: SlotDef[] = [
    { key: 'race', label: '종족', layer: 'Head', removable: false },
    { key: 'hair', label: '머리', layer: 'Hair', removable: true },
    { key: 'armor', label: '갑옷', layer: 'Armor', removable: true },
    { key: 'helmet', label: '헬멧', layer: 'Helmet', removable: true },
    { key: 'weapon', label: '무기', layer: 'Weapon', removable: true },
    { key: 'shield', label: '방패', layer: 'Shield', removable: true },
    { key: 'mask', label: '마스크', layer: 'Mask', removable: true },
    { key: 'back', label: '등', layer: 'Back', removable: true },
    { key: 'cape', label: '망토', layer: 'Cape', removable: true },
    { key: 'horns', label: '뿔', layer: 'Horns', removable: true },
    { key: 'eyes', label: '눈', layer: 'Eyes', removable: false },
    { key: 'ears', label: '귀', layer: 'Ears', removable: true },
  ];

  let currentSlot = 'race';
  let manifest: { layers: Record<string, string[]>; races: { name: string; ears: boolean }[] } | null =
    null;

  const iconCache = new Map<string, Promise<HTMLImageElement | null>>();
  function partIcon(layer: string, name: string): Promise<HTMLImageElement | null> {
    const key = `${layer}/${name}`;
    let cached = iconCache.get(key);
    if (!cached) {
      cached = window.overlay.loadPart(layer, name).then((dataUrl) => {
        if (!dataUrl) return null;
        return new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = dataUrl;
        });
      });
      iconCache.set(key, cached);
    }
    return cached;
  }

  function ownedRaces(owned: string[]): string[] {
    return owned.filter((id) => id.startsWith('race:')).map((id) => id.slice(5));
  }

  function slotOptions(slot: SlotDef, owned: string[]): string[] {
    if (slot.key === 'race' || slot.key === 'eyes') return ownedRaces(owned);
    if (slot.key === 'ears') {
      return ownedRaces(owned).filter((n) => manifest?.races.find((r) => r.name === n)?.ears);
    }
    return owned.filter((id) => id.startsWith(`${slot.layer}/`)).map((id) => id.split('/')[1]);
  }

  function equippedIn(slot: string, equipped: Appearance): PartChoice | null {
    if (slot === 'race') return equipped.race;
    const choice = (equipped as unknown as Record<string, PartChoice | undefined>)[slot];
    if (choice) return choice;
    if (slot === 'eyes') return { name: equipped.race.name }; // 눈 기본값 = 종족
    return null;
  }

  function setSliders(choice: PartChoice | null): void {
    const enabled = !!choice;
    for (const el of [hsvH, hsvS, hsvV]) el.disabled = !enabled;
    hsvH.value = String(choice?.h ?? 0);
    hsvS.value = String(choice?.s ?? 0);
    hsvV.value = String(choice?.v ?? 0);
  }

  async function renderPanel(): Promise<void> {
    if (!manifest) manifest = (await window.overlay.getManifest()) as typeof manifest;
    const inv = await window.overlay.getInventory();
    ownedCountEl.textContent = `보유 ${inv.owned.length}개`;

    // 슬롯 탭
    slotTabs.innerHTML = '';
    for (const slot of SLOTS) {
      const btn = document.createElement('button');
      btn.className = slot.key === currentSlot ? 'slot-tab active' : 'slot-tab';
      btn.textContent = slot.label;
      btn.addEventListener('click', () => {
        currentSlot = slot.key;
        void renderPanel();
      });
      slotTabs.appendChild(btn);
    }

    const slotDef = SLOTS.find((s) => s.key === currentSlot)!;
    const equipped = equippedIn(currentSlot, inv.equipped);
    setSliders(equipped);

    // 파츠 그리드
    charGrid.innerHTML = '';
    if (slotDef.removable) {
      const removeCell = document.createElement('button');
      removeCell.className = equipped ? 'char-cell remove-cell' : 'char-cell remove-cell current';
      removeCell.textContent = '∅';
      removeCell.title = '해제';
      removeCell.addEventListener('click', () => window.overlay.equip({ slot: currentSlot, name: null }));
      charGrid.appendChild(removeCell);
    }
    for (const name of slotOptions(slotDef, inv.owned)) {
      const cell = document.createElement('button');
      cell.className = equipped?.name === name ? 'char-cell current' : 'char-cell';
      cell.title = name;
      const thumb = document.createElement('canvas');
      thumb.width = 32;
      thumb.height = 32;
      const label = document.createElement('span');
      label.className = 'cname';
      label.textContent = name.replace(' [ShowEars]', '');
      cell.append(thumb, label);
      void partIcon(slotDef.layer, name).then((img) => {
        if (!img) return;
        const tctx = thumb.getContext('2d')!;
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(img, 0, 0, 32, 32, 0, 0, 32, 32); // 시트 좌상단 32x32 아이콘
      });
      cell.addEventListener('click', () =>
        window.overlay.equip({
          slot: currentSlot,
          name,
          h: Number(hsvH.value),
          s: Number(hsvS.value),
          v: Number(hsvV.value),
        }),
      );
      charGrid.appendChild(cell);
    }
  }

  function applySliderChange(): void {
    void window.overlay.getInventory().then((inv) => {
      const equipped = equippedIn(currentSlot, inv.equipped);
      if (!equipped) return;
      window.overlay.equip({
        slot: currentSlot,
        name: equipped.name,
        h: Number(hsvH.value),
        s: Number(hsvS.value),
        v: Number(hsvV.value),
      });
    });
  }
  for (const el of [hsvH, hsvS, hsvV]) el.addEventListener('change', applySliderChange);

  appearanceBtn.addEventListener('click', () => {
    optionsPanel.classList.remove('open');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) void renderPanel();
  });
  panelClose.addEventListener('click', () => panel.classList.remove('open'));
  window.overlay.on('self:appearance', () => {
    if (panel.classList.contains('open')) void renderPanel();
  });
  // 패널이 열린 채로 선물상자를 획득해도 새 파츠가 바로 보이도록
  window.overlay.on('self:inventory', () => {
    if (panel.classList.contains('open')) void renderPanel();
  });

  // ---- 옵션 패널 (투명도 / 표시 배율) ----

  const optionsBtn = document.getElementById('options-btn') as HTMLButtonElement;
  const optionsPanel = document.getElementById('options-panel')!;
  const optionsClose = document.getElementById('options-close') as HTMLButtonElement;
  const opacitySlider = document.getElementById('opacity-slider') as HTMLInputElement;
  const opacityVal = document.getElementById('opacity-val')!;
  const scaleBtns = [...document.querySelectorAll('#scale-btns button')] as HTMLButtonElement[];
  const swatchRow = document.getElementById('color-swatches')!;
  const colorInput = document.getElementById('chat-color') as HTMLInputElement;

  // ---- 채팅창 테마 색상 (기준색에서 헤더/말풍선 색 파생) ----

  const COLOR_PRESETS = ['#d94f63', '#4f7bd9', '#3fa66a', '#8a5fd9', '#d98a3f', '#e06fa8', '#5a5f6b'];
  let currentChatColor = '#d94f63';

  function hexToHsl(hex: string): { h: number; s: number; l: number } {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d > 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function applyChatTheme(hex: string): void {
    currentChatColor = hex;
    const { h, s, l } = hexToHsl(hex);
    const root = document.documentElement.style;
    root.setProperty('--accent', hex);
    root.setProperty('--accent-hover', `hsl(${h} ${s}% ${Math.min(l + 8, 88)}%)`);
    root.setProperty('--header', `hsl(${h} 30% 25%)`);
    root.setProperty('--header-hover', `hsl(${h} 30% 34%)`);
    root.setProperty('--self-bubble', `hsl(${h} 25% 32%)`);
    colorInput.value = hex;
    for (const el of swatchRow.children) {
      el.classList.toggle('active', (el as HTMLElement).dataset.color === hex);
    }
  }

  for (const preset of COLOR_PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'swatch';
    btn.style.background = preset;
    btn.dataset.color = preset;
    btn.title = preset;
    btn.addEventListener('click', () => window.overlay.setChatColor(preset));
    swatchRow.appendChild(btn);
  }
  colorInput.addEventListener('change', () => window.overlay.setChatColor(colorInput.value));

  function showOpacity(value: number): void {
    opacitySlider.value = String(Math.round(value * 100));
    opacityVal.textContent = `${Math.round(value * 100)}%`;
  }

  function showScale(scale: number): void {
    for (const btn of scaleBtns) {
      btn.classList.toggle('active', Number(btn.dataset.scale) === scale);
    }
  }

  optionsBtn.addEventListener('click', async () => {
    panel.classList.remove('open');
    optionsPanel.classList.toggle('open');
    if (optionsPanel.classList.contains('open')) {
      const s = await window.overlay.getSettings();
      showOpacity(s.opacity);
      showScale(s.scale);
      applyChatTheme(s.chatColor ?? currentChatColor);
    }
  });
  optionsClose.addEventListener('click', () => optionsPanel.classList.remove('open'));
  opacitySlider.addEventListener('input', () => {
    const v = Number(opacitySlider.value) / 100;
    opacityVal.textContent = `${opacitySlider.value}%`;
    window.overlay.setOpacity(v);
  });
  for (const btn of scaleBtns) {
    btn.addEventListener('click', () => {
      window.overlay.setScale(Number(btn.dataset.scale));
      showScale(Number(btn.dataset.scale));
    });
  }
  window.overlay.on('self:settings', (data) => {
    const s = data as { opacity: number; scale: number; chatColor: string };
    if (s.chatColor) applyChatTheme(s.chatColor); // 테마는 항상 즉시 반영
    if (optionsPanel.classList.contains('open')) {
      showOpacity(s.opacity);
      showScale(s.scale);
    }
  });

  // ---- 입력/버튼 ----

  inputEl.addEventListener('keydown', (e) => {
    // isComposing 체크: 한글 IME 조합 중 Enter로 이중 전송 방지
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener('click', send);
  closeBtn.addEventListener('click', () => window.overlay.closeChat());

  // ---- 초기 상태 + 이벤트 구독 ----

  applyChatTheme((await window.overlay.getSettings()).chatColor ?? currentChatColor);

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

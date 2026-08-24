// 채팅창 렌더러 — 전역 오염 방지를 위해 IIFE로 감쌈 (overlay.ts와 같은 tsc 프로그램)

(async () => {
  const messagesEl = document.getElementById('messages')!;
  const inputEl = document.getElementById('chat-input') as HTMLInputElement;
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
  const onlineEl = document.getElementById('online')!;
  const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;

  let chatSelfId: string | null = null;

  // ---- 읽음 확인: 접속자별 읽음 위치 + 내 메시지 안읽음 배지 ----

  const readStates = new Map<string, number>(); // playerId → lastReadTs
  const readBadges: { ts: number; el: HTMLElement }[] = [];
  let latestTs = 0;

  function recomputeReadBadges(): void {
    for (const badge of readBadges) {
      let count = 0;
      for (const [pid, rts] of readStates) {
        if (pid !== chatSelfId && rts < badge.ts) count++;
      }
      badge.el.textContent = count > 0 ? String(count) : '';
    }
  }

  function maybeMarkRead(): void {
    if (document.visibilityState === 'visible' && latestTs > 0) {
      window.overlay.markRead(latestTs);
    }
  }
  document.addEventListener('visibilitychange', maybeMarkRead);

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
        return phMakeFace(frames.idle[0]);
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
    if (msg.senderAppearance?.nameColor) nick.style.color = msg.senderAppearance.nameColor;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(msg.ts);
    meta.append(nick, time);

    const body = document.createElement('div');
    body.className = 'text';
    if (msg.reaction != null) {
      const icon = document.createElement('canvas');
      icon.className = 'msg-reaction';
      icon.width = 16;
      icon.height = 16;
      const rIdx = msg.reaction;
      void loadImageFromExtra('reaction.png').then((sheet) => {
        if (!sheet) return;
        const rctx = icon.getContext('2d')!;
        rctx.imageSmoothingEnabled = false;
        rctx.drawImage(sheet, (rIdx % 9) * 16, Math.floor(rIdx / 9) * 16, 16, 16, 0, 0, 16, 16);
      });
      body.appendChild(icon);
    } else if (msg.image) {
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

    // 내 메시지엔 안읽은 사람 수 배지 (말풍선 왼쪽, 카톡 스타일)
    const row = document.createElement('div');
    row.className = 'bubble-row';
    if (msg.id === chatSelfId) {
      const badge = document.createElement('span');
      badge.className = 'read-count';
      row.append(badge, body);
      readBadges.push({ ts: msg.ts, el: badge });
      if (readBadges.length > 200) readBadges.shift();
    } else {
      row.append(body);
    }

    content.append(meta, row);
    wrap.append(avatar, content);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    latestTs = Math.max(latestTs, msg.ts);
    maybeMarkRead();
    if (msg.id === chatSelfId) recomputeReadBadges();
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
        addSystemMessage(`명령어: ${Object.keys(CHAT_COMMANDS).map((c) => '/' + c).join(' ')} /랭킹`);
        return;
      }
      if (word === '랭킹') {
        void showRanking();
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

  panelClose.addEventListener('click', () => panel.classList.remove('open'));
  window.overlay.on('self:appearance', () => {
    if (panel.classList.contains('open')) void renderPanel();
  });
  // 패널이 열린 채로 선물상자를 획득해도 새 파츠가 바로 보이도록
  window.overlay.on('self:inventory', () => {
    if (panel.classList.contains('open')) void renderPanel();
  });

  // ---- 슬롯머신 ----

  const slotPanel = document.getElementById('slot-panel')!;
  const slotClose = document.getElementById('slot-close') as HTMLButtonElement;
  const slotBalance = document.getElementById('slot-balance')!;
  const coinBalanceEl = document.getElementById('coin-balance')!;
  const reelEls = [...document.querySelectorAll('#slot-reels span')] as HTMLElement[];
  const slotResult = document.getElementById('slot-result')!;
  const slotSpin = document.getElementById('slot-spin') as HTMLButtonElement;

  const SLOT_SYMBOLS = ['🍒', '🍋', '⭐', '🎁', '💎', '7️⃣'];
  let coins = 0;
  let spinning = false;

  interface SlotPlayResult {
    ok: boolean;
    error?: string;
    kind?: string;
    delta?: number;
    reels?: string[];
    coins?: number;
    partLabel?: string | null;
  }

  function updateCoins(value: number): void {
    coins = value;
    coinBalanceEl.textContent = `🪙 ${value}`;
    slotBalance.textContent = `🪙 ${value}`;
    if (!spinning) slotSpin.disabled = value < 3;
  }

  function slotResultText(res: SlotPlayResult): string {
    switch (res.kind) {
      case 'small':
        return '🍒 +1 코인';
      case 'back':
        return '🍒🍒🍒 본전! +3 코인';
      case 'double':
        return '🍋 더블! +6 코인';
      case 'triple':
        return '⭐ 트리플! +9 코인';
      case 'part':
        return res.partLabel ? `🎁 파츠 당첨! '${res.partLabel}' 획득!` : '🎁 이미 모든 파츠 보유!';
      case 'jackpot':
        return '💎 잭팟!! +20 코인!';
      case 'mega':
        return res.partLabel
          ? `7️⃣ 메가 잭팟!!! +60 코인 + '${res.partLabel}'!`
          : '7️⃣ 메가 잭팟!!! +60 코인!';
      default:
        return '꽝... 다음 기회에!';
    }
  }

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function spinSlot(): Promise<void> {
    if (spinning) return;
    spinning = true;
    slotSpin.disabled = true;
    slotResult.textContent = '두구두구...';
    const shuffle = setInterval(() => {
      for (const reel of reelEls) {
        reel.textContent = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
      }
    }, 80);
    const [res] = await Promise.all([
      window.overlay.playSlot() as Promise<SlotPlayResult>,
      delay(1000),
    ]);
    clearInterval(shuffle);
    if (!res.ok || !res.reels) {
      for (const reel of reelEls) reel.textContent = '❔';
      slotResult.textContent = res.error ?? '오류가 발생했어요.';
    } else {
      for (let i = 0; i < reelEls.length; i++) {
        reelEls[i].textContent = res.reels[i];
        await delay(280);
      }
      slotResult.textContent = slotResultText(res);
      if (typeof res.coins === 'number') updateCoins(res.coins);
    }
    spinning = false;
    slotSpin.disabled = coins < 3;
  }

  slotSpin.addEventListener('click', () => void spinSlot());
  slotClose.addEventListener('click', () => slotPanel.classList.remove('open'));

  window.overlay.on('self:coins', (data) => updateCoins(Number(data) || 0));
  window.overlay.on('net:slot-win', (data) => {
    const d = data as { id: string; nickname: string; tag: string; kind: string; delta: number };
    if (d.id === chatSelfId) return; // 본인은 슬롯 결과창으로 충분
    const label =
      d.kind === 'mega' ? '메가 잭팟(7️⃣7️⃣7️⃣)을' : d.kind === 'jackpot' ? '잭팟(💎💎💎)을' : '파츠(🎁🎁🎁)를';
    addSystemMessage(`🎰 ${d.nickname}#${d.tag}님이 ${label} 터뜨렸어요!`);
  });

  // ---- 옵션 패널 (투명도 / 표시 배율) ----

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
    // 배경/폰트도 기준색의 색조를 따라감
    root.setProperty('--bg', `hsl(${h} 12% 16%)`);
    root.setProperty('--bg-input', `hsl(${h} 14% 12%)`);
    root.setProperty('--bubble-other', `hsl(${h} 10% 23%)`);
    root.setProperty('--text', `hsl(${h} 15% 92%)`);
    root.setProperty('--text-dim', `hsl(${h} 10% 55%)`);
    root.setProperty('--nick', `hsl(${h} 55% 75%)`);
    root.setProperty('--nick-self', `hsl(${(h + 45) % 360} 65% 72%)`);
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

  async function loadOptions(): Promise<void> {
    const s = await window.overlay.getSettings();
    showOpacity(s.opacity);
    showScale(s.scale);
    applyChatTheme(s.chatColor ?? currentChatColor);
  }
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

  // ---- 고정메시지 패널 (머리 위 꼬리 없는 말풍선) ----

  const pinnedPanel = document.getElementById('pinned-panel')!;
  const pinnedClose = document.getElementById('pinned-close') as HTMLButtonElement;
  const pinnedInput = document.getElementById('pinned-input') as HTMLInputElement;
  const pinnedOnEl = document.getElementById('pinned-on') as HTMLInputElement;
  const pinnedPreview = document.getElementById('pinned-preview')!;

  function renderPinnedPreview(): void {
    const text = pinnedInput.value.trim();
    pinnedPreview.textContent = text || '(메시지를 입력하면 여기에 보여요)';
    pinnedPreview.classList.toggle('off', !text || !pinnedOnEl.checked);
  }

  let pinnedSaveTimer = 0;

  function applyPinned(): void {
    window.clearTimeout(pinnedSaveTimer);
    window.overlay.setPinned({ text: pinnedInput.value, enabled: pinnedOnEl.checked });
    renderPinnedPreview();
  }

  // 타이핑 중엔 디바운스, 확정(blur/Enter)·체크박스 변경은 즉시 반영
  pinnedInput.addEventListener('input', () => {
    renderPinnedPreview();
    window.clearTimeout(pinnedSaveTimer);
    pinnedSaveTimer = window.setTimeout(applyPinned, 600);
  });
  pinnedInput.addEventListener('change', applyPinned);
  pinnedOnEl.addEventListener('change', applyPinned);
  pinnedClose.addEventListener('click', () => pinnedPanel.classList.remove('open'));

  async function loadPinned(): Promise<void> {
    const s = await window.overlay.getSettings();
    pinnedInput.value = s.pinnedMsg ?? '';
    pinnedOnEl.checked = s.pinnedOn === true;
    renderPinnedPreview();
  }

  // ---- 상점 (오오라 / 말풍선 스킨 / 닉네임 색) ----

  const shopPanel = document.getElementById('shop-panel')!;
  const shopClose = document.getElementById('shop-close') as HTMLButtonElement;
  const shopList = document.getElementById('shop-list')!;
  const shopCoinsEl = document.getElementById('shop-coins')!;

  function stylePreview(el: HTMLElement, item: CosmeticItem): void {
    if (item.kind === 'aura' && item.id.startsWith('aura-fx-')) {
      // 이펙트 시트 오오라: 첫 프레임 미리보기
      const effectId = item.id.slice(8);
      const preview = document.createElement('canvas');
      preview.width = 26;
      preview.height = 26;
      preview.style.width = '26px';
      preview.style.height = '26px';
      el.appendChild(preview);
      void (async () => {
        if (!extrasManifest) extrasManifest = await window.overlay.getExtras();
        const def = extrasManifest?.effects?.find((e) => e.id === effectId);
        if (!def) return;
        const sheet = await loadImageFromExtra(`effects/${def.file}`);
        if (!sheet) return;
        const pctx = preview.getContext('2d')!;
        pctx.imageSmoothingEnabled = false;
        pctx.drawImage(sheet, 0, 0, def.fw, def.fh, 0, 0, 26, 26);
      })();
      return;
    }
    if (item.kind === 'aura') {
      const colors = AURA_COLORS[item.id];
      el.style.borderRadius = '50%';
      el.style.width = '26px';
      el.style.background = colors
        ? `radial-gradient(circle, ${colors[1]}, ${colors[0]})`
        : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)';
    } else if (item.kind === 'bubble') {
      const st = BUBBLE_STYLES[item.id] ?? BUBBLE_STYLES.default;
      el.style.background = st.fill;
      el.style.border = `2px solid ${st.stroke}`;
      el.style.borderRadius = '8px';
    } else {
      el.textContent = 'Aa';
      el.style.color = item.value ?? '#fff';
      el.style.fontWeight = '700';
    }
  }

  async function renderShop(): Promise<void> {
    const wallet = (await window.overlay.getWallet()) as { coins: number; items: string[] };
    updateCoins(wallet.coins);
    shopCoinsEl.textContent = `🪙 ${wallet.coins}`;
    const inv = await window.overlay.getInventory();
    const eq = inv.equipped;
    shopList.innerHTML = '';
    let lastKind = '';
    for (const item of COSMETIC_ITEMS) {
      if (item.kind !== lastKind) {
        lastKind = item.kind;
        const head = document.createElement('div');
        head.className = 'shop-group';
        head.textContent =
          item.kind === 'aura' ? '✨ 오오라' : item.kind === 'bubble' ? '💬 말풍선 스킨' : '🎨 닉네임 색상';
        shopList.appendChild(head);
      }
      const row = document.createElement('div');
      row.className = 'shop-item';
      const preview = document.createElement('div');
      preview.className = 'shop-preview';
      stylePreview(preview, item);
      const name = document.createElement('span');
      name.className = 'shop-name';
      name.textContent = item.name;
      const btn = document.createElement('button');
      btn.className = 'shop-btn';
      const owned = wallet.items.includes(item.id);
      const equipped =
        item.kind === 'aura'
          ? eq.aura === item.id
          : item.kind === 'bubble'
            ? eq.bubbleSkin === item.id
            : eq.nameColor === item.value;
      if (!owned) {
        btn.textContent = `${item.price} 🪙`;
        btn.disabled = wallet.coins < item.price;
        btn.addEventListener('click', async () => {
          const res = (await window.overlay.buyItem(item.id)) as { ok: boolean; error?: string };
          addSystemMessage(res.ok ? `🛒 '${item.name}' 구매 완료!` : (res.error ?? '구매에 실패했어요.'));
          void renderShop();
        });
      } else {
        const slotKey = item.kind === 'aura' ? 'aura' : item.kind === 'bubble' ? 'bubble' : 'namecolor';
        btn.textContent = equipped ? '해제' : '장착';
        btn.classList.toggle('equipped', equipped);
        btn.addEventListener('click', () => {
          window.overlay.equip({ slot: slotKey, name: equipped ? null : item.id });
          setTimeout(() => void renderShop(), 150);
        });
      }
      row.append(preview, name, btn);
      shopList.appendChild(row);
    }
  }

  shopClose.addEventListener('click', () => shopPanel.classList.remove('open'));
  window.overlay.on('self:wallet', () => {
    if (shopPanel.classList.contains('open')) void renderShop();
  });

  // ---- 미니게임 메뉴 ----

  const minigamePanel = document.getElementById('minigame-panel')!;
  const minigameClose = document.getElementById('minigame-close') as HTMLButtonElement;
  const runnerCdEl = document.getElementById('runner-cd')!;

  async function renderMinigame(): Promise<void> {
    const state = await window.overlay.getMinigameState();
    runnerCdEl.textContent =
      state.runnerRemainSec > 0
        ? `쿨타임 ${state.runnerRemainSec}초 남음`
        : '5분마다 1회 · ↑점프 ↓엎드리기';
  }

  minigameClose.addEventListener('click', () => minigamePanel.classList.remove('open'));
  for (const card of document.querySelectorAll('.mg-card')) {
    card.addEventListener('click', async () => {
      const game = (card as HTMLElement).dataset.game!;
      const res = await window.overlay.startMinigame(game);
      if (!res.ok) {
        addSystemMessage(res.error ?? '시작할 수 없어요.');
        void renderMinigame();
        return;
      }
      addSystemMessage(game === 'fishing' ? '🎣 낚시 시작/중지를 전환했어요.' : '🏃 달리기 시작! (↑점프 ↓엎드리기)');
      minigamePanel.classList.remove('open');
    });
  }

  // ---- 엑스트라 이미지 로더 (이모지/리액션 공용) ----

  let extrasManifest: ExtrasManifest | null = null;
  const fishSheetCache = new Map<string, Promise<HTMLImageElement | null>>();

  function loadImageFromExtra(rel: string): Promise<HTMLImageElement | null> {
    let cached = fishSheetCache.get(rel);
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
      fishSheetCache.set(rel, cached);
    }
    return cached;
  }

  // ---- 리액션 이모지 피커 ----

  const emojiBtn = document.getElementById('emoji-btn') as HTMLButtonElement;
  const emojiPopup = document.getElementById('emoji-popup')!;
  let emojiBuilt = false;

  async function buildEmojiPopup(): Promise<void> {
    if (emojiBuilt) return;
    if (!extrasManifest) extrasManifest = await window.overlay.getExtras();
    const sheet = await loadImageFromExtra('reaction.png');
    if (!sheet || !extrasManifest) return;
    emojiBuilt = true;
    const { cell, cols, rows } = extrasManifest.reaction;
    const probe = document.createElement('canvas');
    probe.width = cell;
    probe.height = cell;
    const probeCtx = probe.getContext('2d')!;
    for (let i = 0; i < cols * rows; i++) {
      const sx = (i % cols) * cell;
      const sy = Math.floor(i / cols) * cell;
      // 빈 셀 스킵 (알파 검사)
      probeCtx.clearRect(0, 0, cell, cell);
      probeCtx.drawImage(sheet, sx, sy, cell, cell, 0, 0, cell, cell);
      const alpha = probeCtx.getImageData(0, 0, cell, cell).data;
      let hasPixel = false;
      for (let a = 3; a < alpha.length; a += 4) {
        if (alpha[a] > 0) {
          hasPixel = true;
          break;
        }
      }
      if (!hasPixel) continue;
      const btn = document.createElement('button');
      const icon = document.createElement('canvas');
      icon.width = cell;
      icon.height = cell;
      const ictx = icon.getContext('2d')!;
      ictx.imageSmoothingEnabled = false;
      ictx.drawImage(sheet, sx, sy, cell, cell, 0, 0, cell, cell);
      btn.appendChild(icon);
      const index = i;
      btn.addEventListener('click', () => {
        window.overlay.sendReaction(index);
        emojiPopup.classList.remove('open');
      });
      emojiPopup.appendChild(btn);
    }
  }

  emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void buildEmojiPopup().then(() => emojiPopup.classList.toggle('open'));
  });
  document.addEventListener('click', (e) => {
    if (!emojiPopup.contains(e.target as Node) && e.target !== emojiBtn) {
      emojiPopup.classList.remove('open');
    }
  });

  // ---- 코인 랭킹 ----

  async function showRanking(): Promise<void> {
    const rows = (await window.overlay.getRanking()) as { name: string; coins: number }[];
    if (!rows.length) {
      addSystemMessage('랭킹 정보를 가져오지 못했어요.');
      return;
    }
    const medals = ['🥇', '🥈', '🥉', '4위', '5위'];
    addSystemMessage('🏆 코인 랭킹 TOP5');
    rows.forEach((r, i) => addSystemMessage(`${medals[i]} ${r.name} — ${r.coins} 🪙`));
  }

  // ---- ☰ 메뉴 드롭다운 ----

  const menuBtn = document.getElementById('menu-btn') as HTMLButtonElement;
  const menuDropdown = document.getElementById('menu-dropdown')!;

  function closeAllPanels(): void {
    panel.classList.remove('open');
    optionsPanel.classList.remove('open');
    pinnedPanel.classList.remove('open');
    slotPanel.classList.remove('open');
    shopPanel.classList.remove('open');
    minigamePanel.classList.remove('open');
  }

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!menuDropdown.contains(e.target as Node)) menuDropdown.classList.remove('open');
  });
  menuDropdown.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('button');
    if (!item) return;
    menuDropdown.classList.remove('open');
    closeAllPanels();
    switch (item.dataset.menu) {
      case 'minigame':
        minigamePanel.classList.add('open');
        void renderMinigame();
        break;
      case 'fishdex':
        window.overlay.toggleFishdex();
        break;
      case 'slot':
        slotPanel.classList.add('open');
        break;
      case 'shop':
        shopPanel.classList.add('open');
        void renderShop();
        break;
      case 'appearance':
        panel.classList.add('open');
        void renderPanel();
        break;
      case 'pinned':
        pinnedPanel.classList.add('open');
        void loadPinned();
        break;
      case 'ranking':
        void showRanking();
        break;
      case 'options':
        optionsPanel.classList.add('open');
        void loadOptions();
        break;
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

  // ---- 업데이트 알림 벨 ----

  const updateBell = document.getElementById('update-bell') as HTMLButtonElement;
  let pendingUpdate: { version: string; ready: boolean } | null = null;

  function showUpdateBell(info: { version: string; ready: boolean }): void {
    pendingUpdate = info;
    updateBell.hidden = false;
    updateBell.title = info.ready
      ? `새 업데이트 v${info.version} 준비됨 — 클릭하여 재시작·설치`
      : `새 버전 v${info.version} 감지 — 다운로드 중`;
  }

  updateBell.addEventListener('click', () => {
    if (!pendingUpdate) return;
    if (!pendingUpdate.ready) {
      addSystemMessage(`🔔 새 버전 v${pendingUpdate.version}를 다운로드하고 있어요. 잠시 후 벨을 다시 눌러주세요.`);
      return;
    }
    if (window.confirm(`새 버전 v${pendingUpdate.version}가 준비됐어요.\n지금 재시작하여 설치할까요?`)) {
      window.overlay.installUpdate();
    }
  });
  window.overlay.on('self:update', (data) => {
    const d = data as { version: string };
    showUpdateBell({ version: d.version, ready: true });
  });
  // 서버-클라이언트 버전 불일치 감지 (다운로드 완료 전 단계)
  window.overlay.on('self:update-hint', (data) => {
    const d = data as { version: string };
    if (!pendingUpdate?.ready) showUpdateBell({ version: d.version, ready: false });
  });

  // ---- 초기 상태 + 이벤트 구독 ----

  const updateState = (await window.overlay.getUpdateState()) as {
    version: string;
    ready: boolean;
  } | null;
  if (updateState) showUpdateBell(updateState);

  updateCoins(await window.overlay.getCoins());

  applyChatTheme((await window.overlay.getSettings()).chatColor ?? currentChatColor);

  const state = await window.overlay.getNetState();
  chatSelfId = state.selfId;
  setStatus(state.connected, state.online);
  for (const p of state.players) readStates.set(p.id, p.lastReadTs ?? 0);

  const history = await window.overlay.getChatHistory();
  for (const msg of history) addMessage(msg);

  window.overlay.on('net:chat', (data) => addMessage(data as NetChatMessage));
  // 서버 보관 내역 도착(접속/재접속) 시 목록 갱신
  window.overlay.on('net:history', (data) => {
    messagesEl.innerHTML = '';
    readBadges.length = 0;
    for (const msg of data as NetChatMessage[]) addMessage(msg);
    recomputeReadBadges();
  });
  window.overlay.on('net:welcome', (data) => {
    const d = data as { selfId: string; players: NetPlayer[] };
    chatSelfId = d.selfId;
    readStates.clear();
    for (const p of d.players) readStates.set(p.id, p.lastReadTs ?? 0);
    recomputeReadBadges();
  });
  window.overlay.on('net:player-joined', (data) => {
    const p = data as NetPlayer;
    readStates.set(p.id, p.lastReadTs ?? 0);
    recomputeReadBadges();
  });
  window.overlay.on('net:player-left', (data) => {
    readStates.delete(data as string);
    recomputeReadBadges();
  });
  window.overlay.on('net:player-read', (data) => {
    const d = data as { id: string; ts: number };
    readStates.set(d.id, d.ts);
    recomputeReadBadges();
  });
  window.overlay.on('net:reset', () => {
    readStates.clear();
    recomputeReadBadges();
  });
  window.overlay.on('net:status', (data) => {
    const s = data as { connected: boolean; online: number };
    setStatus(s.connected, s.online);
  });

  inputEl.focus();
})();

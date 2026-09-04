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

  // 팝아웃 모드: ?panel=<id> 로 열리면 해당 패널만 보이는 독립 창으로 동작
  const POPOUT = new URLSearchParams(location.search).get('panel');

  function maybeMarkRead(): void {
    if (POPOUT) return; // 팝아웃 창은 채팅을 실제로 보는 창이 아니므로 읽음 보고 금지
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
    if (msg.senderTitle) {
      const titleEl = document.createElement('span');
      titleEl.className = 'nick-title';
      titleEl.textContent = `「${msg.senderTitle}」`;
      meta.append(titleEl);
    }
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
  /** 액션 상점 가격표 (protocol.ts ACTION_SHOP과 동일) */
  const ACTION_SHOP_UI: { id: string; word: string; price: number }[] = [
    { id: 'slash', word: '베기', price: 8 },
    { id: 'jab', word: '찌르기', price: 8 },
    { id: 'shot', word: '쏘기', price: 8 },
    { id: 'block', word: '막기', price: 6 },
    { id: 'roll', word: '구르기', price: 6 },
    { id: 'jump', word: '점프', price: 6 },
    { id: 'death', word: '죽은척', price: 10 },
    { id: 'crawl', word: '엎드려', price: 6 },
    { id: 'ready', word: '전투준비', price: 6 },
  ];
  /** 🐾 펫 용품 가격 (protocol.ts PET_FOOD_PRICE / PET_CARD_PRICE_GEM / PET_ITEM_BUY_MAX) */
  const PET_SHOP_UI = { food: 200, card: 1, max: 999 };
  /** 💱 환전 환율 (protocol.ts EXCHANGE_*와 동일 — 판정은 서버) */
  const EXCHANGE_UI = { buy: 1000, sell: 900, max: 1000 };
  /** 서버 지갑 기준 보유 액션 (self:wallet으로 갱신) */
  let ownedActions: string[] = [];

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
        openRankBar();
        return;
      }
      const command = CHAT_COMMANDS[word];
      if (command) {
        if (!actionUsable(command)) {
          addSystemMessage(`🔒 '/${word}' 액션은 상점에서 💎로 구매해야 쓸 수 있어요.`);
          return;
        }
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

  const gemBalanceEl = document.getElementById('gem-balance')!;
  function updateGems(value: number): void {
    gemBalanceEl.textContent = `💎 ${value}`;
  }
  window.overlay.on('self:gems', (data) => updateGems(Number(data) || 0));
  window.overlay.on('net:slot-win', (data) => {
    const d = data as { id: string; nickname: string; tag: string; kind: string; delta: number };
    if (d.id === chatSelfId) return; // 본인은 슬롯 결과창으로 충분
    const label =
      d.kind === 'mega' ? '메가 잭팟(7️⃣7️⃣7️⃣)을' : d.kind === 'jackpot' ? '잭팟(💎💎💎)을' : '파츠(🎁🎁🎁)를';
    addSystemMessage(`🎰 ${d.nickname}#${d.tag}님이 ${label} 터뜨렸어요!`);
  });

  // ---- 대장간 (낚싯대 강화, 스타포스식 연출) ----

  const forgePanel = document.getElementById('forge-panel')!;
  const forgeClose = document.getElementById('forge-close') as HTMLButtonElement;
  const forgeBalance = document.getElementById('forge-balance')!;
  const forgeRod = document.getElementById('forge-rod')!;
  const forgeGlow = document.getElementById('forge-glow')!;
  const forgeStage = document.getElementById('forge-stage')!;
  const forgeSparks = document.getElementById('forge-sparks')!;
  const forgeFlash = document.getElementById('forge-flash')!;
  const forgeResult = document.getElementById('forge-result')!;
  const forgeFallstar = document.getElementById('forge-fallstar')!;
  const forgeStars = document.getElementById('forge-stars')!;
  const forgeRates = document.getElementById('forge-rates')!;
  const forgeBtn = document.getElementById('forge-btn') as HTMLButtonElement;

  let forging = false;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  function renderForgeStars(stars: number, popIndex = -1): void {
    forgeStars.innerHTML = '';
    for (let i = 0; i < FORGE_MAX; i++) {
      if (i === 15) {
        const br = document.createElement('span');
        br.className = 'fbreak';
        forgeStars.appendChild(br);
      }
      const s = document.createElement('span');
      s.className =
        'fstar' +
        (i < stars ? ' on' : '') +
        ((i + 1) % 5 === 0 && i !== 14 && i !== 29 ? ' gap' : '') +
        (i === popIndex ? ' pop' : '');
      s.textContent = '★';
      forgeStars.appendChild(s);
    }
  }

  async function renderForge(popIndex = -1): Promise<void> {
    const w = (await window.overlay.getWallet()) as {
      coins: number;
      rodStars?: number;
      rodFails?: number;
    };
    updateCoins(w.coins);
    const stars = w.rodStars ?? 0;
    const fails = w.rodFails ?? 0;
    forgeBalance.textContent = `🪙 ${w.coins}`;
    forgeRod.className = `rod-tier-${rodTier(stars)}`;
    forgeGlow.className = `glow-tier-${rodTier(stars)}`; // 뒤 은은한 후광도 티어 색
    renderForgeStars(stars, popIndex);
    if (stars >= FORGE_MAX) {
      forgeRates.innerHTML = '🌈 <b>30성 만렙!</b> 전설의 낚싯대입니다.';
      forgeBtn.disabled = true;
      forgeBtn.textContent = 'MAX';
      return;
    }
    const st = FORGE_TABLE[stars];
    const friday = forgeFriday();
    const drop = round1(st.drop * (friday ? 0.7 : 1));
    const keep = round1(Math.max(0, 100 - st.succ - drop));
    forgeRates.innerHTML =
      `<b>${stars}성 → ${stars + 1}성</b> · 성공 <b>${st.succ}%</b> · 유지 ${keep}%` +
      (st.drop > 0 ? ` · 하락 ${drop}%${friday ? ' <span style="color:#8be06a">금요일↓</span>' : ''}` : '') +
      '<br />' +
      (fails >= FORGE_PITY
        ? '<span class="pity-full">✨ 다음 강화 성공 보장! (천장)</span>'
        : `연속 실패 ${fails}/${FORGE_PITY}`);
    forgeBtn.disabled = forging || w.coins < st.cost;
    forgeBtn.textContent = `강화하기 (${st.cost} 🪙)`;
  }

  // 두구두구: 사방에서 반짝이가 낚싯대로 모여듦
  function spawnConvergeSparks(): void {
    forgeSparks.innerHTML = '';
    for (let i = 0; i < 14; i++) {
      const sp = document.createElement('span');
      sp.className = 'forge-spark in';
      const angle = Math.random() * Math.PI * 2;
      const dist = 50 + Math.random() * 35;
      const sx = 80 + Math.cos(angle) * dist;
      const sy = 48 + Math.sin(angle) * dist * 0.7;
      sp.style.left = `${sx}px`;
      sp.style.top = `${sy}px`;
      sp.style.setProperty('--tx', `${80 - sx}px`);
      sp.style.setProperty('--ty', `${48 - sy}px`);
      sp.style.animationDelay = `${(Math.random() * 0.8).toFixed(2)}s`;
      sp.style.background = i % 3 ? '#ffd66e' : '#fffdf7';
      forgeSparks.appendChild(sp);
    }
  }

  // 결과: 중심에서 사방으로 터짐
  function spawnBurstSparks(count: number, color: string): void {
    forgeSparks.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const sp = document.createElement('span');
      sp.className = 'forge-spark out';
      sp.style.left = '80px';
      sp.style.top = '48px';
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 40 + Math.random() * 45;
      sp.style.setProperty('--bx', `${Math.cos(angle) * dist}px`);
      sp.style.setProperty('--by', `${Math.sin(angle) * dist * 0.8}px`);
      sp.style.background = i % 3 ? color : '#fffdf7';
      forgeSparks.appendChild(sp);
    }
  }

  function showForgeResult(cls: string, text: string): void {
    forgeResult.className = '';
    void forgeResult.offsetWidth; // 같은 클래스여도 애니메이션 재시작
    forgeResult.textContent = text;
    forgeResult.className = cls;
  }

  async function doForge(): Promise<void> {
    if (forging) return;
    forging = true;
    forgeBtn.disabled = true;
    forgeResult.className = '';
    forgeFlash.className = '';
    forgeFallstar.className = '';
    forgeRod.classList.add('charging');
    forgeStage.classList.add('charging'); // 글로우도 빠르게 고동
    spawnConvergeSparks();

    const [res] = await Promise.all([
      window.overlay.enhance(),
      delay(1700), // 두구두구 최소 연출 시간
    ]);
    forgeRod.classList.remove('charging');
    forgeStage.classList.remove('charging');

    if (!res.ok) {
      forgeSparks.innerHTML = '';
      showForgeResult('keep', res.error ?? '오류가 발생했어요.');
    } else if (res.result === 'success') {
      void forgeFlash.offsetWidth;
      forgeFlash.className = 'white';
      spawnBurstSparks(18, '#ffd66e');
      showForgeResult('success', res.guaranteed ? `✨ 보장 성공! ${res.stars}성!` : `강화 성공! ${res.stars}성!`);
    } else if (res.result === 'keep') {
      forgeSparks.innerHTML = '';
      showForgeResult('keep', '실패... 단계 유지');
    } else {
      void forgeFlash.offsetWidth;
      forgeFlash.className = 'red';
      forgePanel.classList.remove('shake');
      void forgePanel.offsetWidth;
      forgePanel.classList.add('shake');
      forgeFallstar.className = 'falling';
      spawnBurstSparks(10, '#ff6b6b');
      showForgeResult('down', `하락... ${res.stars}성`);
    }

    forging = false;
    await renderForge(res.ok && res.result === 'success' ? (res.stars ?? 1) - 1 : -1);
  }

  forgeBtn.addEventListener('click', () => void doForge());
  forgeClose.addEventListener('click', () => forgePanel.classList.remove('open'));

  // 자랑하기 — 내 강화도를 전체 채팅에 브로드캐스트 (쿨타임 1분)
  const forgeBragBtn = document.getElementById('forge-brag') as HTMLButtonElement;
  let bragCooldownTimer = 0;

  forgeBragBtn.addEventListener('click', async () => {
    forgeBragBtn.disabled = true;
    const res = (await window.overlay.brag()) as { ok: boolean; error?: string };
    if (!res.ok) {
      addSystemMessage(res.error ?? '자랑에 실패했어요.');
      forgeBragBtn.disabled = false;
      return;
    }
    let remain = 60;
    window.clearInterval(bragCooldownTimer);
    const tickCd = () => {
      if (remain <= 0) {
        window.clearInterval(bragCooldownTimer);
        forgeBragBtn.disabled = false;
        forgeBragBtn.textContent = '📢 자랑';
        return;
      }
      forgeBragBtn.textContent = `📢 ${remain}s`;
      remain--;
    };
    tickCd();
    bragCooldownTimer = window.setInterval(tickCd, 1000);
  });

  window.overlay.on('net:brag-news', (data) => {
    const d = data as { nickname: string; tag: string; stars: number };
    const flair =
      d.stars >= 30 ? ' 🌈' : d.stars >= 25 ? ' ✨' : d.stars >= 20 ? ' 🔥' : d.stars >= 15 ? ' 💜' : d.stars >= 10 ? ' 💙' : d.stars >= 5 ? ' 🤍' : '';
    addSystemMessage(`📢 ${d.nickname}#${d.tag}님이 낚싯대 ${d.stars}성을 자랑합니다!${flair}`);
  });
  window.overlay.on('self:wallet', () => {
    if (forgePanel.classList.contains('open') && !forging) void renderForge();
  });
  window.overlay.on('net:enhance-news', (data) => {
    const d = data as { id: string; nickname: string; tag: string; stars: number; result: string };
    if (d.id === chatSelfId) return; // 본인은 대장간 연출로 충분
    addSystemMessage(
      d.result === 'success'
        ? `🔨 ${d.nickname}#${d.tag}님의 낚싯대가 ${d.stars}성 강화에 성공했습니다!!`
        : `💥 ${d.nickname}#${d.tag}님의 낚싯대가 ${d.stars}성으로 하락했습니다...`,
    );
  });

  // ---- 그림 쪽지 (64x64 픽셀 그림판 → 5코인으로 전송) ----

  const notePanel = document.getElementById('note-panel')!;
  const noteClose = document.getElementById('note-close') as HTMLButtonElement;
  const noteCanvas = document.getElementById('note-canvas') as HTMLCanvasElement;
  const notePalette = document.getElementById('note-palette')!;
  const noteRecipient = document.getElementById('note-recipient') as HTMLSelectElement;
  const noteSendBtn = document.getElementById('note-send-btn') as HTMLButtonElement;
  const nctx = noteCanvas.getContext('2d')!;

  const NOTE_COLORS = [
    '#000000', '#5a5f6b', '#ffffff', '#d94f63', '#ff8dc7', '#ff7b3f', '#ffd66e',
    '#8be06a', '#3fa66a', '#6ec3ff', '#4f7bd9', '#8a5fd9', '#8a6d3b', '#3a2430',
  ];
  let noteColor = NOTE_COLORS[0];
  let noteBrush = 1;
  let noteEraser = false;
  let notePainting = false;
  let noteLast: { x: number; y: number } | null = null;

  for (const color of NOTE_COLORS) {
    const btn = document.createElement('button');
    btn.className = color === noteColor ? 'npal active' : 'npal';
    btn.style.background = color;
    btn.title = color;
    btn.addEventListener('click', () => {
      noteColor = color;
      noteEraser = false;
      for (const el of notePalette.children) el.classList.toggle('active', el === btn);
      noteEraserBtn.classList.remove('active');
    });
    notePalette.appendChild(btn);
  }

  const notePen1 = document.getElementById('note-pen1') as HTMLButtonElement;
  const notePen3 = document.getElementById('note-pen3') as HTMLButtonElement;
  const noteEraserBtn = document.getElementById('note-eraser') as HTMLButtonElement;
  const noteClearBtn = document.getElementById('note-clear') as HTMLButtonElement;

  notePen1.addEventListener('click', () => {
    noteBrush = 1;
    notePen1.classList.add('active');
    notePen3.classList.remove('active');
  });
  notePen3.addEventListener('click', () => {
    noteBrush = 3;
    notePen3.classList.add('active');
    notePen1.classList.remove('active');
  });
  noteEraserBtn.addEventListener('click', () => {
    noteEraser = !noteEraser;
    noteEraserBtn.classList.toggle('active', noteEraser);
  });
  noteClearBtn.addEventListener('click', () => nctx.clearRect(0, 0, 64, 64));

  function notePos(e: PointerEvent): { x: number; y: number } {
    const rect = noteCanvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(63, Math.floor(((e.clientX - rect.left) / rect.width) * 64))),
      y: Math.max(0, Math.min(63, Math.floor(((e.clientY - rect.top) / rect.height) * 64))),
    };
  }

  function notePlot(x: number, y: number): void {
    const off = noteBrush >> 1;
    if (noteEraser) {
      nctx.clearRect(x - off, y - off, noteBrush, noteBrush);
    } else {
      nctx.fillStyle = noteColor;
      nctx.fillRect(x - off, y - off, noteBrush, noteBrush);
    }
  }

  function noteLine(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
    for (let i = 0; i <= steps; i++) {
      notePlot(
        Math.round(from.x + ((to.x - from.x) * i) / steps),
        Math.round(from.y + ((to.y - from.y) * i) / steps),
      );
    }
  }

  noteCanvas.addEventListener('pointerdown', (e) => {
    notePainting = true;
    noteCanvas.setPointerCapture(e.pointerId);
    const p = notePos(e);
    notePlot(p.x, p.y);
    noteLast = p;
  });
  noteCanvas.addEventListener('pointermove', (e) => {
    if (!notePainting) return;
    const p = notePos(e);
    if (noteLast) noteLine(noteLast, p);
    noteLast = p;
  });
  const noteEnd = () => {
    notePainting = false;
    noteLast = null;
  };
  noteCanvas.addEventListener('pointerup', noteEnd);
  noteCanvas.addEventListener('pointercancel', noteEnd);

  async function populateNoteRecipients(): Promise<void> {
    const state = await window.overlay.getNetState();
    const prev = noteRecipient.value;
    noteRecipient.innerHTML = '';
    const others = state.players.filter((p) => p.id !== chatSelfId);
    if (others.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = '접속 중인 사람이 없어요';
      opt.value = '';
      noteRecipient.appendChild(opt);
      return;
    }
    const seen = new Set<string>();
    for (const p of others) {
      const key = `${p.nickname}#${p.tag}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = key;
      noteRecipient.appendChild(opt);
    }
    if (prev && seen.has(prev)) noteRecipient.value = prev;
  }

  let noteCooldownTimer = 0;

  function startNoteCooldown(sec: number): void {
    window.clearInterval(noteCooldownTimer);
    let remain = sec;
    noteSendBtn.disabled = true;
    const tickCd = () => {
      if (remain <= 0) {
        window.clearInterval(noteCooldownTimer);
        noteSendBtn.disabled = false;
        noteSendBtn.textContent = '보내기 (5 🪙)';
        return;
      }
      noteSendBtn.textContent = `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, '0')}`;
      remain--;
    };
    tickCd();
    noteCooldownTimer = window.setInterval(tickCd, 1000);
  }

  noteSendBtn.addEventListener('click', async () => {
    const to = noteRecipient.value;
    if (!to) {
      addSystemMessage('받는 사람을 선택해주세요.');
      return;
    }
    noteSendBtn.disabled = true;
    const res = (await window.overlay.sendNote({ to, image: noteCanvas.toDataURL('image/png') })) as {
      ok: boolean;
      error?: string;
    };
    if (res.ok) {
      addSystemMessage(`✉️ ${to}님에게 쪽지를 보냈어요! (-5🪙)`);
      nctx.clearRect(0, 0, 64, 64);
      startNoteCooldown(180);
    } else {
      addSystemMessage(res.error ?? '쪽지 전송에 실패했어요.');
      noteSendBtn.disabled = false;
    }
  });

  noteClose.addEventListener('click', () => notePanel.classList.remove('open'));
  window.overlay.on('net:player-joined', () => {
    if (notePanel.classList.contains('open')) void populateNoteRecipients();
  });
  window.overlay.on('net:player-left', () => {
    if (notePanel.classList.contains('open')) void populateNoteRecipients();
  });

  // ---- 가상 주식 (5분 틱, 서버 권위 — 시세는 net:stocks) ----

  const stockPanel = document.getElementById('stock-panel')!;
  const stockClose = document.getElementById('stock-close') as HTMLButtonElement;
  const stockBalance = document.getElementById('stock-balance')!;
  const stockEval = document.getElementById('stock-eval')!;
  const stockPl = document.getElementById('stock-pl')!;
  const stockTimer = document.getElementById('stock-timer')!;
  const stockList = document.getElementById('stock-list')!;
  const stockDetail = document.getElementById('stock-detail')!;
  const stockChart = document.getElementById('stock-chart') as HTMLCanvasElement;
  const stockDetailLeft = document.getElementById('stock-detail-left')!;
  const stockDetailRight = document.getElementById('stock-detail-right')!;
  const stockQty = document.getElementById('stock-qty') as HTMLInputElement;
  const stockMaxBtn = document.getElementById('stock-max') as HTMLButtonElement;
  const stockBuyBtn = document.getElementById('stock-buy') as HTMLButtonElement;
  const stockSellBtn = document.getElementById('stock-sell') as HTMLButtonElement;

  interface StockStateLike {
    id: string;
    price: number;
    prev: number;
    delistedUntil?: number;
    history: number[];
  }
  let stockMarket: { stocks: StockStateLike[]; nextTickTs: number } | null = null;
  let myHoldings: Record<string, { qty: number; avg: number }> = {};
  let selectedStock: string | null = null;
  let stockTrading = false;

  const stockDef = (id: string) => STOCK_DEFS.find((d) => d.id === id);
  const marketOf = (id: string) => stockMarket?.stocks.find((s) => s.id === id);

  function diffText(s: StockStateLike): { text: string; cls: string } {
    if (s.delistedUntil) return { text: '💀상폐', cls: 'delisted' };
    const d = s.prev > 0 ? ((s.price - s.prev) / s.prev) * 100 : 0;
    if (d > 0.05) return { text: `▲${d.toFixed(1)}%`, cls: 'diff-up' };
    if (d < -0.05) return { text: `▼${Math.abs(d).toFixed(1)}%`, cls: 'diff-down' };
    return { text: '—', cls: '' };
  }

  function renderStockList(): void {
    if (!stockMarket) return;
    // 요약: 총 평가액 / 손익
    let evalSum = 0;
    let costSum = 0;
    for (const [id, h] of Object.entries(myHoldings)) {
      const m = marketOf(id);
      if (!m || h.qty <= 0) continue;
      evalSum += m.price * h.qty;
      costSum += h.avg * h.qty;
    }
    stockEval.textContent = `${evalSum.toLocaleString()}🪙`;
    const pl = Math.round(evalSum - costSum);
    stockPl.textContent = `${pl >= 0 ? '+' : ''}${pl.toLocaleString()}🪙`;
    (stockPl as HTMLElement).style.color = pl > 0 ? '#ff6b6b' : pl < 0 ? '#6ec3ff' : '';

    stockList.innerHTML = '';
    for (const s of stockMarket.stocks) {
      const def = stockDef(s.id);
      if (!def) continue;
      const row = document.createElement('div');
      const d = diffText(s);
      row.className =
        'stock-row' + (s.id === selectedStock ? ' selected' : '') + (s.delistedUntil ? ' delisted' : '');
      const h = myHoldings[s.id];
      row.innerHTML =
        `<span class="stock-name">${def.name}</span>` +
        `<span class="stock-price">${s.delistedUntil ? '-' : s.price.toLocaleString()}</span>` +
        `<span class="stock-diff ${d.cls}">${d.text}</span>` +
        `<span class="stock-hold">${h && h.qty > 0 ? `${h.qty}주` : ''}</span>`;
      row.addEventListener('click', () => {
        selectedStock = s.id;
        renderStockList();
        renderStockDetail();
      });
      stockList.appendChild(row);
    }
  }

  function renderStockDetail(): void {
    const id = selectedStock;
    const m = id ? marketOf(id) : null;
    const def = id ? stockDef(id) : null;
    if (!m || !def) {
      stockDetail.classList.remove('open');
      return;
    }
    stockDetail.classList.add('open');
    const delisted = !!m.delistedUntil;
    stockBuyBtn.disabled = delisted || stockTrading;
    stockSellBtn.disabled = delisted || stockTrading;
    const h = myHoldings[id!];
    const warn = !delisted && m.price <= Math.max(1, Math.floor(def.initial * 0.03)) * 2;
    stockDetailLeft.innerHTML = delisted
      ? `<span class="delist-warn">💀 상장폐지 — 재상장 대기 중</span>`
      : `시작가 ${def.initial.toLocaleString()} · 현재 ${((m.price / def.initial) * 100).toFixed(0)}%` +
        (warn ? ' <span class="delist-warn">⚠️상폐위험</span>' : '');
    stockDetailRight.textContent =
      h && h.qty > 0 ? `보유 ${h.qty}주 · 평단 ${Math.round(h.avg).toLocaleString()}` : '보유 없음';

    // 미니 차트 (최근 48틱)
    const ctx = stockChart.getContext('2d')!;
    const W = stockChart.width;
    const H = stockChart.height;
    ctx.clearRect(0, 0, W, H);
    const hist = m.history.slice(-48);
    if (hist.length >= 2) {
      const lo = Math.min(...hist, def.initial);
      const hi = Math.max(...hist, def.initial);
      const span = Math.max(1, hi - lo);
      const px = (i: number) => 4 + (i / (hist.length - 1)) * (W - 8);
      const py = (v: number) => H - 6 - ((v - lo) / span) * (H - 12);
      // 시작가 점선
      ctx.strokeStyle = 'rgba(255,214,110,0.4)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(4, py(def.initial));
      ctx.lineTo(W - 4, py(def.initial));
      ctx.stroke();
      ctx.setLineDash([]);
      // 가격선
      ctx.strokeStyle = hist[hist.length - 1] >= hist[0] ? '#ff6b6b' : '#6ec3ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      hist.forEach((v, i) => (i === 0 ? ctx.moveTo(px(0), py(v)) : ctx.lineTo(px(i), py(v))));
      ctx.stroke();
      // 고가/저가 라벨
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '9px "Segoe UI", sans-serif';
      ctx.fillText(String(hi.toLocaleString()), 6, 10);
      ctx.fillText(String(lo.toLocaleString()), 6, H - 8);
    }
  }

  let stockTimerHandle = 0;

  function updateStockTimer(): void {
    if (!stockMarket) return;
    // 주말(KST 토·일)은 휴장 — 서버가 시세를 동결하고 매매를 거부한다
    const kstDay = new Date(Date.now() + 9 * 3600_000).getUTCDay();
    if (kstDay === 0 || kstDay === 6) {
      stockTimer.textContent = '주말 휴장 💤';
      return;
    }
    const remain = Math.max(0, Math.floor((stockMarket.nextTickTs - Date.now()) / 1000));
    stockTimer.textContent = `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, '0')}`;
  }

  async function openStockPanel(): Promise<void> {
    const w = (await window.overlay.getWallet()) as {
      coins: number;
      stocks?: Record<string, { qty: number; avg: number }>;
    };
    updateCoins(w.coins);
    stockBalance.textContent = `🪙 ${w.coins.toLocaleString()}`;
    myHoldings = w.stocks ?? {};
    const market = await window.overlay.getStocks();
    if (market) stockMarket = market;
    renderStockList();
    renderStockDetail();
    updateStockTimer();
    window.clearInterval(stockTimerHandle);
    stockTimerHandle = window.setInterval(updateStockTimer, 1000);
  }

  async function doTrade(kind: 'buy' | 'sell'): Promise<void> {
    if (!selectedStock || stockTrading) return;
    const qty = Math.floor(Number(stockQty.value));
    if (!Number.isFinite(qty) || qty < 1) {
      addSystemMessage('수량을 확인해주세요.');
      return;
    }
    stockTrading = true;
    renderStockDetail();
    const def = stockDef(selectedStock)!;
    const res =
      kind === 'buy'
        ? await window.overlay.stockBuy(selectedStock, qty)
        : await window.overlay.stockSell(selectedStock, qty);
    stockTrading = false;
    if (!res.ok) {
      addSystemMessage(res.error ?? '거래에 실패했어요.');
    } else {
      const m = marketOf(selectedStock);
      const amount = (m?.price ?? 0) * qty;
      addSystemMessage(
        kind === 'buy'
          ? `📈 ${def.name} ${qty}주 매수 (-${amount.toLocaleString()}🪙)`
          : `📉 ${def.name} ${qty}주 매도 (+${amount.toLocaleString()}🪙)`,
      );
      if (res.holding) {
        if (res.holding.qty > 0) myHoldings[selectedStock] = res.holding;
        else delete myHoldings[selectedStock];
      }
      if (typeof res.coins === 'number') stockBalance.textContent = `🪙 ${res.coins.toLocaleString()}`;
    }
    renderStockList();
    renderStockDetail();
  }

  stockMaxBtn.addEventListener('click', async () => {
    if (!selectedStock) return;
    const m = marketOf(selectedStock);
    const w = (await window.overlay.getWallet()) as { coins: number };
    if (m && m.price > 0) stockQty.value = String(Math.max(1, Math.min(9999, Math.floor(w.coins / m.price))));
  });
  stockBuyBtn.addEventListener('click', () => void doTrade('buy'));
  stockSellBtn.addEventListener('click', () => void doTrade('sell'));
  stockClose.addEventListener('click', () => {
    stockPanel.classList.remove('open');
    window.clearInterval(stockTimerHandle);
  });

  window.overlay.on('net:stocks', (data) => {
    stockMarket = data as { stocks: StockStateLike[]; nextTickTs: number };
    if (stockPanel.classList.contains('open')) {
      renderStockList();
      renderStockDetail();
      updateStockTimer();
    }
  });

  // ---- 전광판 (유료 광고 + 기록) ----

  const tickerlogPanel = document.getElementById('tickerlog-panel')!;
  const tickerlogClose = document.getElementById('tickerlog-close') as HTMLButtonElement;
  const tickerlogList = document.getElementById('tickerlog-list')!;
  const tickeradInput = document.getElementById('tickerad-input') as HTMLInputElement;
  const tickeradSend = document.getElementById('tickerad-send') as HTMLButtonElement;

  interface TickerItemLike {
    id: string;
    ts: number;
    kind: string;
    text: string;
    from?: string;
  }

  function tickerItemEl(item: TickerItemLike): HTMLElement {
    const el = document.createElement('div');
    el.className = `tk-item tk-${item.kind}`;
    const d = new Date(item.ts);
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    el.innerHTML = `<span class="tk-time">${time}</span>`;
    if (item.kind === 'stocks') {
      const span = document.createElement('span');
      span.innerHTML = formatStocksTickerHtml(item.text);
      el.appendChild(span);
    } else {
      el.appendChild(
        document.createTextNode(item.kind === 'ad' && item.from ? `${item.text} — ${item.from}` : item.text),
      );
    }
    return el;
  }

  async function openTickerlogPanel(): Promise<void> {
    tickerlogList.innerHTML = '';
    const items = (await window.overlay.getTickerLog()) as TickerItemLike[];
    for (const item of items) tickerlogList.appendChild(tickerItemEl(item)); // 이미 최신순
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tk-item';
      empty.textContent = '아직 전광판 기록이 없어요.';
      tickerlogList.appendChild(empty);
    }
  }

  let tickeradCooldown = 0;

  tickeradSend.addEventListener('click', async () => {
    const text = tickeradInput.value.trim();
    if (!text) return;
    tickeradSend.disabled = true;
    const res = await window.overlay.sendTickerAd(text);
    if (res.ok) {
      addSystemMessage('🗞️ 전광판에 메시지를 띄웠어요! (-50🪙)');
      tickeradInput.value = '';
      let remain = 60;
      window.clearInterval(tickeradCooldown);
      const tickCd = () => {
        if (remain <= 0) {
          window.clearInterval(tickeradCooldown);
          tickeradSend.disabled = false;
          tickeradSend.textContent = '보내기 (50 🪙)';
          return;
        }
        tickeradSend.textContent = `${remain}s`;
        remain--;
      };
      tickCd();
      tickeradCooldown = window.setInterval(tickCd, 1000);
    } else {
      addSystemMessage(res.error ?? '전광판 전송에 실패했어요.');
      tickeradSend.disabled = false;
    }
  });

  tickerlogClose.addEventListener('click', () => tickerlogPanel.classList.remove('open'));
  window.overlay.on('net:ticker', (data) => {
    if (!tickerlogPanel.classList.contains('open')) return;
    tickerlogList.prepend(tickerItemEl(data as TickerItemLike));
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

  // ---- 표시 디스플레이 선택 ----

  const displayBtns = document.getElementById('display-btns')!;

  async function renderDisplays(): Promise<void> {
    const list = await window.overlay.getDisplays();
    displayBtns.innerHTML = '';
    for (const d of list) {
      const btn = document.createElement('button');
      btn.classList.toggle('active', d.current);
      const name = document.createElement('span');
      name.textContent = `모니터 ${d.index}${d.primary ? ' (주)' : ''}`;
      const res = document.createElement('span');
      res.className = 'display-res';
      res.textContent = `${d.width}×${d.height}`;
      btn.append(name, res);
      btn.addEventListener('click', () => window.overlay.setDisplay(d.id));
      displayBtns.appendChild(btn);
    }
  }

  const tickerOnEl = document.getElementById('ticker-on') as HTMLInputElement;
  tickerOnEl.addEventListener('change', () => window.overlay.setTicker(tickerOnEl.checked));

  async function loadOptions(): Promise<void> {
    const s = await window.overlay.getSettings();
    showOpacity(s.opacity);
    showScale(s.scale);
    applyChatTheme(s.chatColor ?? currentChatColor);
    tickerOnEl.checked = s.tickerOn !== false;
    void renderDisplays();
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
      void renderDisplays();
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
    const wallet = (await window.overlay.getWallet()) as {
      coins: number;
      items: string[];
      gems?: number;
      actions?: string[];
    };
    updateCoins(wallet.coins);
    const gems = wallet.gems ?? 0;
    updateGems(gems);
    shopCoinsEl.textContent = `🪙 ${wallet.coins} · 💎 ${gems}`;
    const inv = await window.overlay.getInventory();
    const eq = inv.equipped;
    shopList.innerHTML = '';

    // 💱 환전 (골드↔젬) — 수량 입력 + MAX, 판정·잔액은 서버 exchange 이벤트. 🐾 펫 효과(exBuy/exSell)로 실효 환율 표시
    const petFxShop = (wallet as { petFx?: Record<string, number> }).petFx ?? {};
    const exBuyRate = EXCHANGE_UI.buy - Math.floor(petFxShop.exBuy ?? 0);
    const exSellRate = Math.min(EXCHANGE_UI.sell + Math.floor(petFxShop.exSell ?? 0), exBuyRate - 20);
    const exHead = document.createElement('div');
    exHead.className = 'shop-group';
    exHead.textContent = `💱 환전 (🪙 ${exBuyRate.toLocaleString()} → 💎 1 · 💎 1 → 🪙 ${exSellRate})`;
    shopList.appendChild(exHead);
    for (const dir of ['gold-to-gem', 'gem-to-gold'] as const) {
      const toGem = dir === 'gold-to-gem';
      const maxQty = Math.min(EXCHANGE_UI.max, toGem ? Math.floor(wallet.coins / exBuyRate) : gems);
      const row = document.createElement('div');
      row.className = 'shop-item';
      const preview = document.createElement('div');
      preview.className = 'shop-preview';
      preview.textContent = toGem ? '💎' : '🪙';
      const name = document.createElement('span');
      name.className = 'shop-name';
      const label = document.createElement('div');
      label.textContent = toGem ? '골드 → 젬' : '젬 → 골드';
      const sub = document.createElement('small');
      name.append(label, sub);
      const qty = document.createElement('input');
      qty.type = 'number';
      qty.className = 'shop-qty';
      qty.min = '1';
      qty.max = String(Math.max(1, maxQty));
      qty.value = '1';
      qty.title = '교환할 💎 수량';
      const maxBtn = document.createElement('button');
      maxBtn.className = 'shop-btn shop-max';
      maxBtn.textContent = 'MAX';
      maxBtn.title = `최대 ${maxQty}`;
      const btn = document.createElement('button');
      btn.className = 'shop-btn';
      const readQty = () => Math.max(1, Math.min(EXCHANGE_UI.max, Math.floor(Number(qty.value) || 0)));
      const refresh = () => {
        const n = readQty();
        sub.textContent = toGem
          ? `${(n * exBuyRate).toLocaleString()} 🪙 → ${n} 💎 · 최대 ${maxQty}`
          : `${n} 💎 → ${(n * exSellRate).toLocaleString()} 🪙 · 최대 ${maxQty}`;
        btn.textContent = toGem ? `${(n * exBuyRate).toLocaleString()} 🪙` : `${n} 💎`;
        btn.disabled = n > maxQty;
        maxBtn.disabled = maxQty < 1;
      };
      qty.addEventListener('input', refresh);
      maxBtn.addEventListener('click', () => {
        qty.value = String(Math.max(1, maxQty));
        refresh();
      });
      btn.addEventListener('click', async () => {
        const n = readQty();
        btn.disabled = true;
        const res = await window.overlay.exchange(dir, n);
        addSystemMessage(
          res.ok
            ? toGem
              ? `💱 🪙 ${(n * exBuyRate).toLocaleString()} → 💎 ${n} 환전 완료! (잔액 💎 ${res.gems ?? '-'})`
              : `💱 💎 ${n} → 🪙 ${(n * exSellRate).toLocaleString()} 환전 완료! (잔액 🪙 ${res.coins ?? '-'})`
            : (res.error ?? '환전에 실패했어요.'),
        );
        void renderShop();
      });
      refresh();
      row.append(preview, name, qty, maxBtn, btn);
      shopList.appendChild(row);
    }

    // 🐾 펫 용품 — 먹이(🪙, foodPrice 효과 할인) / 경험치카드(💎)
    const petHead = document.createElement('div');
    petHead.className = 'shop-group';
    petHead.textContent = '🐾 펫 용품';
    shopList.appendChild(petHead);
    for (const kind of ['food', 'card'] as const) {
      const unit = kind === 'food' ? Math.max(1, Math.round(PET_SHOP_UI.food * (1 - (petFxShop.foodPrice ?? 0) / 100))) : PET_SHOP_UI.card;
      const balance = kind === 'food' ? wallet.coins : gems;
      const unitLabel = kind === 'food' ? '🪙' : '💎';
      const maxQty = Math.min(PET_SHOP_UI.max, Math.floor(balance / unit));
      const row = document.createElement('div');
      row.className = 'shop-item';
      const preview = document.createElement('div');
      preview.className = 'shop-preview';
      preview.textContent = kind === 'food' ? '🍖' : '📜';
      const name = document.createElement('span');
      name.className = 'shop-name';
      const label = document.createElement('div');
      label.textContent = kind === 'food' ? '펫 먹이 (포만도 100%)' : '펫 경험치카드 (레벨업)';
      const sub = document.createElement('small');
      name.append(label, sub);
      const qty = document.createElement('input');
      qty.type = 'number';
      qty.className = 'shop-qty';
      qty.min = '1';
      qty.max = String(Math.max(1, maxQty));
      qty.value = '1';
      const maxBtn = document.createElement('button');
      maxBtn.className = 'shop-btn shop-max';
      maxBtn.textContent = 'MAX';
      const btn = document.createElement('button');
      btn.className = 'shop-btn';
      const readQty = () => Math.max(1, Math.min(PET_SHOP_UI.max, Math.floor(Number(qty.value) || 0)));
      const refresh = () => {
        const n = readQty();
        sub.textContent = `개당 ${unit} ${unitLabel}${kind === 'food' && unit < PET_SHOP_UI.food ? ` (🐾 할인, 정가 ${PET_SHOP_UI.food})` : ''} · 최대 ${maxQty}`;
        btn.textContent = `${(n * unit).toLocaleString()} ${unitLabel}`;
        btn.disabled = n > maxQty;
        maxBtn.disabled = maxQty < 1;
      };
      qty.addEventListener('input', refresh);
      maxBtn.addEventListener('click', () => {
        qty.value = String(Math.max(1, maxQty));
        refresh();
      });
      btn.addEventListener('click', async () => {
        const n = readQty();
        btn.disabled = true;
        const res = (await window.overlay.buyPetItem(kind, n)) as { ok: boolean; error?: string };
        addSystemMessage(res.ok ? `🐾 ${kind === 'food' ? '펫 먹이' : '경험치카드'} ${n}개 구매!` : (res.error ?? '구매에 실패했어요.'));
        void renderShop();
      });
      refresh();
      row.append(preview, name, qty, maxBtn, btn);
      shopList.appendChild(row);
    }

    // 💎 액션 (젬 전용 — 골드로 구매 불가)
    const ownedActs = wallet.actions ?? [];
    const actHead = document.createElement('div');
    actHead.className = 'shop-group';
    actHead.textContent = '💎 액션 (구매해야 사용 가능)';
    shopList.appendChild(actHead);
    for (const item of ACTION_SHOP_UI) {
      const row = document.createElement('div');
      row.className = 'shop-item';
      const preview = document.createElement('div');
      preview.className = 'shop-preview';
      preview.textContent = '🎬';
      const name = document.createElement('span');
      name.className = 'shop-name';
      name.textContent = item.word;
      const btn = document.createElement('button');
      btn.className = 'shop-btn';
      if (ownedActs.includes(item.id)) {
        btn.textContent = '보유';
        btn.disabled = true;
      } else {
        btn.textContent = `${item.price} 💎`;
        btn.disabled = gems < item.price;
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const res = (await window.overlay.buyAction(item.id)) as { ok: boolean; error?: string };
          addSystemMessage(res.ok ? `💎 '${item.word}' 액션 구매!` : (res.error ?? '구매에 실패했어요.'));
          void renderShop();
        });
      }
      row.append(preview, name, btn);
      shopList.appendChild(row);
    }

    // 미보유 랜덤 파츠 뽑기 (결제 서버, 지급 로컬 — 눈/귀는 종족 세트에 포함이라 없음)
    const randHead = document.createElement('div');
    randHead.className = 'shop-group';
    randHead.textContent = '🎲 랜덤 뽑기 (미보유 파츠)';
    shopList.appendChild(randHead);
    for (const item of RANDOM_ITEMS) {
      const row = document.createElement('div');
      row.className = 'shop-item';
      const preview = document.createElement('div');
      preview.className = 'shop-preview';
      preview.textContent = item.emoji;
      const name = document.createElement('span');
      name.className = 'shop-name';
      name.textContent = item.name;
      const btn = document.createElement('button');
      btn.className = 'shop-btn';
      btn.textContent = `${item.price} 🪙`;
      btn.disabled = wallet.coins < item.price;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const res = (await window.overlay.buyRandom(item.id)) as {
          ok: boolean;
          error?: string;
          label?: string;
        };
        addSystemMessage(res.ok ? `🎲 '${res.label}' 획득!` : (res.error ?? '뽑기에 실패했어요.'));
        void renderShop();
      });
      row.append(preview, name, btn);
      shopList.appendChild(row);
    }

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
  const fishingDescEl = document.getElementById('fishing-desc')!;
  const fishingCardEl = document.querySelector('.mg-card[data-game="fishing"]')!;
  const digDescEl = document.getElementById('dig-desc')!;
  const digCardEl = document.querySelector('.mg-card[data-game="dig"]')!;
  const battleDescEl = document.getElementById('battle-desc')!;
  const battleCardEl = document.querySelector('.mg-card[data-game="battle"]')!;

  async function renderMinigame(): Promise<void> {
    const state = await window.overlay.getMinigameState();
    runnerCdEl.textContent =
      state.runnerRemainSec > 0
        ? `쿨타임 ${state.runnerRemainSec}초 남음`
        : '5분마다 1회 · ↑점프 ↓엎드리기';
    fishingDescEl.innerHTML = state.fishingActive
      ? '낚시 중 — 누르면 중지'
      : '쉬는 중 — 누르면 시작<br />쿨타임 없음 · 물고기 도감 수집';
    fishingCardEl.classList.toggle('active', state.fishingActive);
    digDescEl.innerHTML = state.diggingActive
      ? '땅파는 중 — 누르면 중지'
      : '쉬는 중 — 누르면 시작<br />쿨타임 없음 · 광물 도감 수집';
    digCardEl.classList.toggle('active', state.diggingActive);
    battleDescEl.innerHTML = state.battleActive
      ? '⚔️ 원정 중 — 누르면 귀환 (전리품 자동 수령)'
      : '쉬는 중 — 누르면 출발<br />앱을 꺼도 계속 · 💎 강화 · 층 돌파';
    battleCardEl.classList.toggle('active', state.battleActive);
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
      if (game === 'fishing' || game === 'dig') {
        // 토글 결과(시작/중지)는 overlay가 fishing-send/digging-send로 보고한 뒤에야 확정된다
        setTimeout(async () => {
          const st = await window.overlay.getMinigameState();
          if (game === 'fishing') {
            addSystemMessage(st.fishingActive ? '🎣 낚시를 시작했어요.' : '🎣 낚시를 중지했어요.');
          } else {
            addSystemMessage(st.diggingActive ? '⛏️ 땅파기를 시작했어요.' : '⛏️ 땅파기를 중지했어요.');
          }
          void renderMinigame(); // 카드 상태(⚪/🟢)와 하이라이트 갱신 — 패널은 열어둔다
        }, 250);
      } else if (game === 'battle') {
        const st = await window.overlay.getMinigameState();
        addSystemMessage(
          st.battleActive
            ? '⚔️ 원정을 떠났어요 — 캐릭터가 제자리에서 사냥을 시작해요. (☰ → ⚔️ 원정에서 전리품·강화)'
            : '🏠 원정에서 귀환했어요. 쌓인 전리품은 자동으로 받았어요.',
        );
        void renderMinigame();
      } else {
        addSystemMessage('🏃 달리기 시작! (↑점프 ↓엎드리기)');
        minigamePanel.classList.remove('open');
      }
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
    actionPopup.classList.remove('open');
    void buildEmojiPopup().then(() => emojiPopup.classList.toggle('open'));
  });
  document.addEventListener('click', (e) => {
    if (!emojiPopup.contains(e.target as Node) && e.target !== emojiBtn) {
      emojiPopup.classList.remove('open');
    }
  });

  // ---- 액션 버튼 팔레트 (💎 구매한 액션만 사용 가능) ----

  const actionBtn = document.getElementById('action-btn') as HTMLButtonElement;
  const actionPopup = document.getElementById('action-popup')!;
  const ACTION_GROUPS: { label: string; words: string[] }[] = [
    { label: '공격 — 무기에 맞는 공격 (활 장착 시 활쏘기)', words: ['공격'] },
    { label: '무기 모션', words: ['베기', '찌르기', '쏘기'] },
    { label: '방어/회피', words: ['막기', '구르기', '점프'] },
    { label: '기타 모션', words: ['죽은척', '엎드려', '전투준비'] },
  ];

  function actionUsable(command: string): boolean {
    if (command === 'attack') return ownedActions.includes('slash') || ownedActions.includes('shot');
    return ownedActions.includes(command);
  }

  function rebuildActionPopup(): void {
    actionPopup.innerHTML = '';
    for (const group of ACTION_GROUPS) {
      const head = document.createElement('div');
      head.className = 'action-group';
      head.textContent = group.label;
      actionPopup.appendChild(head);
      for (const word of group.words) {
        const command = CHAT_COMMANDS[word];
        if (!command) continue;
        const usable = actionUsable(command);
        const price = ACTION_SHOP_UI.find((a) => a.id === command)?.price ?? 0;
        const btn = document.createElement('button');
        if (usable) {
          btn.textContent = word;
          btn.title = `/${word}`;
          btn.addEventListener('click', () => {
            actionPopup.classList.remove('open');
            window.overlay.sendAction(command);
          });
        } else {
          const lockedLabel = `🔒 ${word} · ${price} 💎`;
          btn.classList.add('locked');
          btn.textContent = lockedLabel;
          btn.title = '눌러서 구매';
          let confirming = false;
          btn.addEventListener('click', async () => {
            if (!confirming) {
              confirming = true;
              btn.textContent = `${price} 💎로 구매?`;
              setTimeout(() => {
                if (confirming) {
                  confirming = false;
                  btn.textContent = lockedLabel;
                }
              }, 3000);
              return;
            }
            confirming = false;
            btn.disabled = true;
            const res = (await window.overlay.buyAction(command)) as { ok: boolean; error?: string };
            addSystemMessage(res.ok ? `💎 '${word}' 액션 구매!` : (res.error ?? '구매에 실패했어요.'));
            rebuildActionPopup();
          });
        }
        actionPopup.appendChild(btn);
      }
    }
  }
  rebuildActionPopup();

  window.overlay.on('self:wallet', (data) => {
    const w = data as { actions?: string[] };
    ownedActions = w.actions ?? [];
    rebuildActionPopup();
  });
  void window.overlay.getWallet().then((data) => {
    const w = data as { gems?: number; actions?: string[] };
    ownedActions = w.actions ?? [];
    updateGems(w.gems ?? 0);
    rebuildActionPopup();
  });

  actionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPopup.classList.remove('open');
    actionPopup.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!actionPopup.contains(e.target as Node) && e.target !== actionBtn) {
      actionPopup.classList.remove('open');
    }
  });

  // ---- 일일퀘스트 패널 ----

  const dailyPanel = document.getElementById('daily-panel')!;
  const dailyClose = document.getElementById('daily-close') as HTMLButtonElement;
  const dailyStreakEl = document.getElementById('daily-streak')!;
  const dailyList = document.getElementById('daily-list')!;
  dailyClose.addEventListener('click', () => dailyPanel.classList.remove('open'));

  interface DailyView {
    date: string;
    streak: number;
    quests: { id: string; name: string; goal: number; reward: number; count: number; claimed: boolean }[];
    allBonusClaimed: boolean;
    news?: string;
  }
  let dailyState: DailyView | null = null;

  function renderDaily(): void {
    if (!dailyState) {
      dailyList.innerHTML = '<div style="padding:12px;color:var(--text-dim)">서버 연결 후 표시됩니다.</div>';
      return;
    }
    dailyStreakEl.textContent = `· 연속 출석 ${dailyState.streak}일차`;
    dailyList.innerHTML = '';

    // 출석 보상 (접속 시 자동 지급 — 완료 상태로 표시)
    {
      const streak = dailyState.streak;
      const attendCoin = Math.min(3 + Math.max(0, streak - 1), 10);
      const weekly = streak > 0 && streak % 7 === 0;
      const row = document.createElement('div');
      row.className = 'dq-row done';
      const title = document.createElement('div');
      title.className = 'dq-title';
      const nameEl = document.createElement('span');
      nameEl.textContent = `📅 출석 ${streak}일차`;
      const rewardEl = document.createElement('span');
      rewardEl.className = 'dq-reward';
      rewardEl.textContent = `+${attendCoin} 🪙${weekly ? ' +5 💎' : ''}`;
      title.append(nameEl, rewardEl);
      const bar = document.createElement('div');
      bar.className = 'dq-bar';
      const fill = document.createElement('div');
      fill.className = 'dq-fill';
      fill.style.width = '100%';
      bar.appendChild(fill);
      const count = document.createElement('div');
      count.className = 'dq-count';
      count.textContent = '지급 완료 · 내일도 접속하면 연속 출석!';
      row.append(title, bar, count);
      dailyList.appendChild(row);
    }

    for (const q of dailyState.quests) {
      const row = document.createElement('div');
      row.className = 'dq-row' + (q.claimed ? ' done' : '');
      const title = document.createElement('div');
      title.className = 'dq-title';
      const nameEl = document.createElement('span');
      nameEl.textContent = q.name;
      const rewardEl = document.createElement('span');
      rewardEl.className = 'dq-reward';
      rewardEl.textContent = `+${q.reward} 💎`;
      title.append(nameEl, rewardEl);
      const bar = document.createElement('div');
      bar.className = 'dq-bar';
      const fill = document.createElement('div');
      fill.className = 'dq-fill';
      fill.style.width = `${Math.min(100, (q.count / q.goal) * 100)}%`;
      bar.appendChild(fill);
      const count = document.createElement('div');
      count.className = 'dq-count';
      count.textContent = `${q.count} / ${q.goal}`;
      row.append(title, bar, count);
      dailyList.appendChild(row);
    }
    const bonus = document.createElement('div');
    bonus.id = 'daily-bonus';
    bonus.textContent = dailyState.allBonusClaimed
      ? '🎉 오늘 퀘스트 전부 완료! 보너스 지급됨'
      : '오늘 퀘스트 전부 완료 시 보너스 +5 💎';
    dailyList.appendChild(bonus);
  }

  window.overlay.on('self:daily', (data) => {
    const st = data as DailyView;
    dailyState = st;
    if (st.news && !POPOUT) addSystemMessage(st.news);
    if (dailyPanel.classList.contains('open')) renderDaily();
  });
  void window.overlay.getDailyState().then((data) => {
    if (data) dailyState = data as DailyView;
  });

  // ---- 도전과제 패널 ----

  const achPanel = document.getElementById('ach-panel')!;
  const achClose = document.getElementById('ach-close') as HTMLButtonElement;
  const achCountEl = document.getElementById('ach-count')!;
  const achList = document.getElementById('ach-list')!;
  const achTitleSelect = document.getElementById('ach-title-select') as HTMLSelectElement;
  achClose.addEventListener('click', () => achPanel.classList.remove('open'));

  async function renderAch(): Promise<void> {
    const state = await window.overlay.getAchState();
    if (!state) {
      achCountEl.textContent = '';
      achList.innerHTML = '<div style="padding:12px;color:var(--text-dim)">서버 연결 후 표시됩니다.</div>';
      return;
    }
    const unlocked = new Set(state.ach);
    achCountEl.textContent = `${ACH_DEFS.filter((d) => unlocked.has(d.id)).length} / ${ACH_DEFS.length}`;

    // 칭호 선택 (달성한 업적의 칭호만)
    achTitleSelect.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '칭호 없음';
    achTitleSelect.appendChild(none);
    for (const d of ACH_DEFS) {
      if (!d.title || !unlocked.has(d.id)) continue;
      const opt = document.createElement('option');
      opt.value = d.title;
      opt.textContent = `「${d.title}」 — ${d.name}`;
      achTitleSelect.appendChild(opt);
    }
    achTitleSelect.value = state.title ?? '';

    achList.innerHTML = '';
    for (const cat of [...new Set(ACH_DEFS.map((d) => d.cat))]) {
      const defs = ACH_DEFS.filter((d) => d.cat === cat);
      const head = document.createElement('div');
      head.className = 'ach-cat';
      head.textContent = `${cat} (${defs.filter((d) => unlocked.has(d.id)).length}/${defs.length})`;
      achList.appendChild(head);
      for (const d of defs) {
        const done = unlocked.has(d.id);
        const hiddenLocked = d.hidden === true && !done;
        const row = document.createElement('div');
        row.className = 'ach-row' + (done ? ' done' : hiddenLocked ? ' locked' : '');
        const nameRow = document.createElement('div');
        nameRow.className = 'ach-name';
        const nameEl = document.createElement('span');
        nameEl.textContent = hiddenLocked ? '???' : `${done ? '✅ ' : ''}${d.name}`;
        nameRow.appendChild(nameEl);
        if (d.title && !hiddenLocked) {
          const chip = document.createElement('span');
          chip.className = 'ach-title-chip';
          chip.textContent = `「${d.title}」`;
          nameRow.appendChild(chip);
        }
        const descRow = document.createElement('div');
        descRow.className = 'ach-desc';
        const descEl = document.createElement('span');
        descEl.textContent = hiddenLocked ? '비밀 도전과제 — 달성하면 공개!' : d.desc;
        const rewardEl = document.createElement('span');
        rewardEl.className = 'dq-reward';
        rewardEl.textContent = `+${d.gems} 💎`;
        descRow.append(descEl, rewardEl);
        row.append(nameRow, descRow);
        if (!done && !hiddenLocked && d.stat && d.goal) {
          const cur = Math.min(state.metrics[d.stat] ?? 0, d.goal);
          const bar = document.createElement('div');
          bar.className = 'dq-bar';
          const fill = document.createElement('div');
          fill.className = 'dq-fill';
          fill.style.width = `${Math.min(100, (cur / d.goal) * 100)}%`;
          bar.appendChild(fill);
          const count = document.createElement('div');
          count.className = 'dq-count';
          count.textContent = `${cur} / ${d.goal}`;
          row.append(bar, count);
        }
        achList.appendChild(row);
      }
    }
  }

  achTitleSelect.addEventListener('change', () => {
    void (async () => {
      const value = achTitleSelect.value;
      const res = (await window.overlay.setTitle(value)) as { ok: boolean; error?: string };
      if (!res.ok) {
        addSystemMessage(res.error ?? '칭호 변경에 실패했어요.');
        void renderAch();
        return;
      }
      addSystemMessage(value ? `🎖️ 칭호 「${value}」 착용!` : '🎖️ 칭호를 해제했어요.');
    })();
  });

  window.overlay.on('self:achievement', (data) => {
    const list = data as { id: string; name: string; gems: number; title?: string }[];
    if (!Array.isArray(list) || list.length === 0) return;
    if (!POPOUT) {
      if (list.length <= 2) {
        for (const a of list) {
          addSystemMessage(
            `🎖️ 도전과제 달성: ${a.name} (+${a.gems} 💎)${a.title ? ` · 칭호 「${a.title}」 획득!` : ''}`,
          );
        }
      } else {
        const total = list.reduce((s, a) => s + a.gems, 0);
        addSystemMessage(`🎖️ 도전과제 ${list.length}개 달성! (+${total} 💎) — ☰ → 🎖️ 도전과제에서 확인하세요`);
      }
    }
    if (achPanel.classList.contains('open')) void renderAch();
  });

  window.overlay.on('net:ach-news', (data) => {
    const d = data as { id: string; nickname: string; tag: string; name: string; title: string };
    if (d.id === chatSelfId) return; // 본인은 달성 메시지로 충분
    addSystemMessage(`🏆 ${d.nickname}#${d.tag}님이 '${d.name}' 달성! 칭호 「${d.title}」 획득!`);
  });

  window.overlay.on('net:dig-news', (data) => {
    const d = data as { id: string; nickname: string; tag: string; name: string };
    if (d.id === chatSelfId) return; // 본인은 발굴 말풍선으로 충분
    addSystemMessage(`💎 ${d.nickname}#${d.tag}님이 땅에서 ${d.name}을(를) 발굴했어요!`);
  });

  // ---- 광물도감 패널 ----

  const mdexPanel = document.getElementById('mineraldex-panel')!;
  const mdexClose = document.getElementById('mineraldex-close') as HTMLButtonElement;
  const mdexCountEl = document.getElementById('mdex-count')!;
  const mdexTabs = document.getElementById('mdex-tabs')!;
  const mdexGrid = document.getElementById('mdex-grid')!;
  mdexClose.addEventListener('click', () => mdexPanel.classList.remove('open'));
  let mdexCat = 'all';

  async function renderMineraldex(): Promise<void> {
    const w = (await window.overlay.getWallet()) as { minerals?: string[] };
    const owned = new Set(w.minerals ?? []);
    mdexCountEl.textContent = `${MINERAL_DEFS.filter((m) => owned.has(m.id)).length} / ${MINERAL_DEFS.length}`;

    mdexTabs.innerHTML = '';
    for (const t of [{ cat: 'all', label: '전체', emoji: '🗂️' }, ...MINERAL_CATS]) {
      const catDefs = t.cat === 'all' ? MINERAL_DEFS : MINERAL_DEFS.filter((m) => m.cat === t.cat);
      const btn = document.createElement('button');
      btn.className = 'mdex-tab' + (mdexCat === t.cat ? ' active' : '');
      btn.textContent = `${t.emoji} ${t.label} ${catDefs.filter((m) => owned.has(m.id)).length}/${catDefs.length}`;
      btn.addEventListener('click', () => {
        mdexCat = t.cat;
        void renderMineraldex();
      });
      mdexTabs.appendChild(btn);
    }

    mdexGrid.innerHTML = '';
    for (const m of mdexCat === 'all' ? MINERAL_DEFS : MINERAL_DEFS.filter((x) => x.cat === mdexCat)) {
      const has = owned.has(m.id);
      const cell = document.createElement('div');
      cell.className = 'mdex-cell ' + (has ? 'owned' : 'locked');
      cell.title = has ? m.name : '???';
      const icon = document.createElement('canvas');
      icon.width = 64;
      icon.height = 64;
      void loadImageFromExtra(`minerals/${m.id}.png`).then((img) => {
        if (!img) return;
        const ictx = icon.getContext('2d')!;
        ictx.imageSmoothingEnabled = false;
        ictx.drawImage(img, 0, 0, 64, 64);
      });
      const nameEl = document.createElement('span');
      nameEl.className = 'mdex-name';
      nameEl.textContent = has ? m.name : '???';
      cell.append(icon, nameEl);
      mdexGrid.appendChild(cell);
    }
  }

  window.overlay.on('self:wallet', () => {
    if (mdexPanel.classList.contains('open')) void renderMineraldex();
  });

  // ---- 코인 랭킹 바 (헤더 아래 상시 표시 — ✕로 완전 숨김, /랭킹·메뉴로 재표시) ----

  const rankBar = document.getElementById('rank-bar')!;
  const rankHead = document.getElementById('rank-head') as HTMLButtonElement;
  const rankTop = document.getElementById('rank-top')!;
  const rankCloseBtn = document.getElementById('rank-close') as HTMLButtonElement;
  const rankList = document.getElementById('rank-list')!;
  let rankHidden = localStorage.getItem('rank-hidden') === '1';
  let rankOpen = localStorage.getItem('rank-open') === '1';
  let rankHasData = false;

  function syncRankOpen(): void {
    rankBar.hidden = rankHidden || !rankHasData;
    rankList.hidden = !rankOpen;
  }

  function renderRanking(raw: unknown): void {
    const data = raw as
      | { rows?: { name: string; coins: number }[]; me?: { rank: number; coins: number } }
      | null;
    const rows = Array.isArray(raw) ? (raw as { name: string; coins: number }[]) : (data?.rows ?? []);
    if (rows.length === 0) return;
    rankHasData = true;
    const me = Array.isArray(raw) ? undefined : data?.me;
    rankTop.textContent = me
      ? `1위 ${rows[0].name} · ${rows[0].coins} 🪙 — 나 ${me.rank}위`
      : `1위 ${rows[0].name} · ${rows[0].coins} 🪙`;
    const medals = ['🥇', '🥈', '🥉', '4위', '5위'];
    const items = rows.map((r, i) => {
      const row = document.createElement('div');
      row.className = 'rank-row';
      row.textContent = `${medals[i] ?? `${i + 1}위`} ${r.name} — ${r.coins} 🪙`;
      return row;
    });
    if (me) {
      const mine = document.createElement('div');
      mine.className = 'rank-row me';
      mine.textContent = `🙋 나 — ${me.rank}위 · ${me.coins} 🪙`;
      items.push(mine);
    }
    rankList.replaceChildren(...items);
    syncRankOpen();
  }

  function openRankBar(): void {
    rankHidden = false;
    rankOpen = true;
    localStorage.setItem('rank-hidden', '0');
    localStorage.setItem('rank-open', '1');
    syncRankOpen();
    if (!rankHasData) addSystemMessage('랭킹 정보가 아직 없어요. 서버 연결을 확인해 주세요.');
  }

  rankHead.addEventListener('click', () => {
    rankOpen = !rankOpen;
    localStorage.setItem('rank-open', rankOpen ? '1' : '0');
    syncRankOpen();
  });

  rankCloseBtn.addEventListener('click', () => {
    rankHidden = true;
    localStorage.setItem('rank-hidden', '1');
    syncRankOpen();
  });

  syncRankOpen();
  window.overlay.on('net:ranking', renderRanking);
  void window.overlay.getRankingCached().then((cached) => {
    if (cached) renderRanking(cached);
    else void window.overlay.getRanking().then(renderRanking);
  });

  // ---- 원정 (방치형 전투) 패널 — 판정·정산은 서버, 여기서는 상태 표시 + 연출 ----

  interface BattleStatsView {
    atk: number;
    hp: number;
    crit: number;
    luck: number;
    dps: number;
    capMs: number;
    bonus: { rodAtkPct: number; mineralHpPct: number; fishLuckPct: number; achPct: number };
  }
  interface BattleView {
    active: boolean;
    stage: number;
    effStage: number;
    maxStage: number;
    lv: Record<string, number>;
    costs: Record<string, number | null>;
    stats: BattleStatsView;
    tier: string;
    mob: { emoji: string; name: string; sprite?: string; hp: number; atk: number };
    guardian: {
      stage: number;
      emoji: string;
      name: string;
      sprite?: string;
      hp: number;
      atk: number;
      kind: string;
      reward: { coins: number; gems: number };
    } | null;
    killMs: number;
    coinPerKill: number;
    since: number;
    now: number;
    pending: { kills: number; coins: number; elapsedMs: number; capped: boolean };
    kills: number;
    challengeAt: number;
    top: { name: string; maxStage: number }[];
    coins: number;
    gems: number;
  }
  interface BattleClaimView {
    ok: boolean;
    error?: string;
    kills?: number;
    coins?: number;
    gems?: number;
    minerals?: { id: string; name: string; count: number; isNew: boolean }[];
    newMinerals?: number;
    elapsedMs?: number;
    capped?: boolean;
    state?: BattleView;
  }
  interface BattleChallengeView {
    ok: boolean;
    error?: string;
    win?: boolean;
    stage?: number;
    foe?: { emoji: string; name: string; sprite?: string; hp: number; atk: number };
    log?: [number, number, number, number][];
    reward?: { coins: number; gems: number; item?: { id: string; name: string } };
    settled?: { kills: number; coins: number; gems: number };
    state?: BattleView;
  }

  const battlePanel = document.getElementById('battle-panel')!;
  const battleClose = document.getElementById('battle-close') as HTMLButtonElement;
  const btHeadInfo = document.getElementById('battle-head-info')!;
  const btMeAvatar = document.getElementById('bt-me-avatar')!;
  const btMeName = document.getElementById('bt-me-name')!;
  const btMeHp = document.getElementById('bt-me-hp')!;
  const btMeHptext = document.getElementById('bt-me-hptext')!;
  const btFoeAvatar = document.getElementById('bt-foe-avatar')!;
  const btFoeName = document.getElementById('bt-foe-name')!;
  const btFoeHp = document.getElementById('bt-foe-hp')!;
  const btFoeHptext = document.getElementById('bt-foe-hptext')!;
  const btVs = document.getElementById('bt-vs')!;
  const btFloats = document.getElementById('bt-floats')!;
  const btBanner = document.getElementById('bt-banner')!;
  const btStagePrev = document.getElementById('bt-stage-prev') as HTMLButtonElement;
  const btStageNum = document.getElementById('bt-stage-num')!;
  const btStageTier = document.getElementById('bt-stage-tier')!;
  const btStageNext = document.getElementById('bt-stage-next') as HTMLButtonElement;
  const btChallenge = document.getElementById('bt-challenge') as HTMLButtonElement;
  const btRetreat = document.getElementById('bt-retreat')!;
  const btStats = document.getElementById('bt-stats')!;
  const btLoot = document.getElementById('bt-loot')!;
  const btLootTime = document.getElementById('bt-loot-time')!;
  const btLootFill = document.getElementById('bt-loot-fill')!;
  const btLootSummary = document.getElementById('bt-loot-summary')!;
  const btClaim = document.getElementById('bt-claim') as HTMLButtonElement;
  const btToggle = document.getElementById('bt-toggle') as HTMLButtonElement;
  const btResult = document.getElementById('bt-result')!;
  const btGems = document.getElementById('bt-gems')!;
  const btUpgrades = document.getElementById('bt-upgrades')!;
  const btTop = document.getElementById('bt-top')!;
  battleClose.addEventListener('click', () => battlePanel.classList.remove('open'));

  let battleState: BattleView | null = null;
  let battleClockOffset = 0; // 서버 now − 내 now (가방 진행 표시용)
  let battleTimer = 0;
  let battleBusy = false; // 요청/연출 중 — 버튼 잠금
  let battleShownKills = 0; // idle 연출: 마지막으로 표시한 처치 수
  let battleMyKey = '';

  const BT_UPGRADES: { key: string; icon: string; name: string; desc: (s: BattleView) => string }[] = [
    { key: 'atk', icon: '⚔️', name: '공격력', desc: (s) => `Lv당 ×1.10 · 지금 ${s.stats.atk}` },
    { key: 'hp', icon: '❤️', name: '체력', desc: (s) => `Lv당 ×1.08 · 지금 ${s.stats.hp}` },
    { key: 'crit', icon: '💥', name: '치명타', desc: (s) => `Lv당 +1.5%p (피해 150%) · 지금 ${s.stats.crit}%` },
    { key: 'luck', icon: '🍀', name: '행운', desc: (s) => `Lv당 드랍률 +5% · 지금 +${s.stats.luck}%` },
    { key: 'time', icon: '⏳', name: '원정 시간', desc: (s) => `가방 상한 +2시간 · 지금 ${s.stats.capMs / 3600000}시간` },
  ];

  const fmtNum = (n: number) => n.toLocaleString('ko-KR');
  function fmtDur(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}시간 ${m}분`;
    if (m > 0) return `${m}분 ${s % 60}초`;
    return `${s}초`;
  }
  const battleServerNow = () => Date.now() + battleClockOffset;

  function btFloat(text: string, cls: string, side: 'me' | 'foe'): void {
    const el = document.createElement('div');
    el.className = `bt-float ${cls}`;
    el.textContent = text;
    el.style.left = side === 'foe' ? `${58 + Math.random() * 22}%` : `${12 + Math.random() * 22}%`;
    el.style.top = `${18 + Math.random() * 24}%`;
    btFloats.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }
  function btPulse(el: HTMLElement, cls: string): void {
    el.classList.remove(cls);
    void el.offsetWidth; // 애니메이션 재시작
    el.classList.add(cls);
  }
  function btShowBanner(text: string, color: string): void {
    btBanner.textContent = text;
    btBanner.style.color = color;
    btPulse(btBanner, 'show');
  }
  function btSetHp(fill: HTMLElement, textEl: HTMLElement, cur: number, max: number): void {
    fill.style.width = `${Math.max(0, Math.min(100, (cur / Math.max(1, max)) * 100))}%`;
    textEl.textContent = `${fmtNum(Math.max(0, Math.round(cur)))} / ${fmtNum(max)}`;
  }

  /** 현재 시각 기준 가방 진행 추정 (서버 since/killMs/capMs 기반 — 정산은 서버) */
  function btEstimate(st: BattleView): { elapsed: number; kills: number; coins: number; capped: boolean } {
    if (!st.active) return { elapsed: 0, kills: 0, coins: 0, capped: false };
    const raw = Math.max(0, battleServerNow() - st.since);
    const capped = raw >= st.stats.capMs;
    const elapsed = Math.min(raw, st.stats.capMs);
    const kills = Math.floor(elapsed / st.killMs);
    return { elapsed, kills, coins: Math.floor(kills * st.coinPerKill), capped };
  }

  function paintBattle(): void {
    const st = battleState;
    if (!st) {
      btHeadInfo.textContent = '';
      btResult.innerHTML = '서버 연결 후 표시됩니다.';
      return;
    }
    btHeadInfo.textContent = `· 최고 ${st.maxStage}층 돌파`;
    btGems.textContent = `💎 ${st.gems}`;
    // 전장
    setFoeSprite(st.mob.sprite, st.mob.emoji);
    btFoeAvatar.classList.remove('dead');
    btFoeName.textContent = `${st.mob.name} (${st.effStage}층)`;
    btMeName.textContent = battleMyKey.split('#')[0] || '나';
    btSetHp(btMeHp, btMeHptext, st.stats.hp, st.stats.hp);
    // 층 이동
    btStageNum.textContent = `${st.stage}층`;
    btStageTier.textContent = st.tier;
    const topStage = Math.min(100, st.maxStage + 1);
    btStagePrev.disabled = battleBusy || st.stage <= 1;
    btStageNext.disabled = battleBusy || st.stage >= topStage;
    if (st.guardian) {
      const g = st.guardian;
      const label = g.kind === 'big' ? '👑 대보스' : g.kind === 'boss' ? '🔥 보스' : '🛡️ 수문장';
      btChallenge.textContent = `${label} 도전 (${g.stage}층)`;
      btChallenge.title = `${g.emoji} ${g.name} · HP ${fmtNum(g.hp)} · 공격 ${g.atk}/초 · 첫 처치 +${g.reward.coins}🪙${g.reward.gems ? ` +${g.reward.gems}💎` : ''}`;
      btChallenge.disabled = battleBusy;
    } else {
      btChallenge.textContent = '🏆 정복 완료';
      btChallenge.title = '모든 층을 정복했어요!';
      btChallenge.disabled = true;
    }
    if (st.effStage < st.stage) {
      btRetreat.hidden = false;
      btRetreat.textContent = `⚠️ ${st.stage}층 몬스터를 버티지 못해 ${st.effStage}층에서 사냥 중이에요 — 체력을 강화하거나 층을 낮춰 주세요.`;
    } else {
      btRetreat.hidden = true;
    }
    // 능력치
    const b = st.stats.bonus;
    const tip = (parts: string[]) => parts.filter(Boolean).join(' · ');
    btStats.innerHTML = '';
    for (const [k, v, bonus, title] of [
      ['⚔️ 공격', String(st.stats.atk), b.rodAtkPct + b.achPct ? `+${Math.round(b.rodAtkPct + b.achPct)}%` : '', tip([`Lv ${st.lv.atk}`, b.rodAtkPct ? `낚싯대 +${b.rodAtkPct}%` : '', b.achPct ? `도전과제 +${b.achPct}%` : ''])],
      ['❤️ 체력', String(st.stats.hp), b.mineralHpPct + b.achPct ? `+${Math.round(b.mineralHpPct + b.achPct)}%` : '', tip([`Lv ${st.lv.hp}`, b.mineralHpPct ? `광물도감 +${b.mineralHpPct}%` : '', b.achPct ? `도전과제 +${b.achPct}%` : ''])],
      ['💥 치명', `${st.stats.crit}%`, '', `Lv ${st.lv.crit} · 치명타 피해 150%`],
      ['🍀 행운', `+${st.stats.luck}%`, b.fishLuckPct ? `낚시 +${b.fishLuckPct}%` : '', tip([`Lv ${st.lv.luck}`, b.fishLuckPct ? `낚시도감 +${b.fishLuckPct}%` : '', '드랍률 보너스'])],
    ] as [string, string, string, string][]) {
      const cell = document.createElement('div');
      cell.className = 'bt-stat';
      cell.title = title;
      cell.innerHTML = `<div class="v"></div><div class="k"></div><div class="b"></div>`;
      (cell.children[0] as HTMLElement).textContent = v;
      (cell.children[1] as HTMLElement).textContent = k;
      (cell.children[2] as HTMLElement).textContent = bonus || ' ';
      btStats.appendChild(cell);
    }
    // 강화
    btUpgrades.innerHTML = '';
    for (const def of BT_UPGRADES) {
      const cost = st.costs[def.key];
      const row = document.createElement('div');
      row.className = 'bt-up';
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = def.icon;
      const info = document.createElement('div');
      info.className = 'info';
      const nameEl = document.createElement('b');
      nameEl.textContent = `${def.name} Lv ${st.lv[def.key] ?? 0}`;
      const small = document.createElement('small');
      small.textContent = def.desc(st);
      info.append(nameEl, small);
      const btn = document.createElement('button');
      if (cost == null) {
        btn.textContent = 'MAX';
        btn.disabled = true;
      } else {
        btn.textContent = `강화 ${cost} 💎`;
        btn.disabled = battleBusy || st.gems < cost;
        btn.addEventListener('click', () => void battleUpgrade(def.key));
      }
      row.append(icon, info, btn);
      btUpgrades.appendChild(row);
    }
    // 랭킹
    btTop.innerHTML = '';
    if (st.top.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bt-top-row';
      empty.textContent = '아직 수문장을 처치한 사람이 없어요 — 첫 정복자가 되어 보세요!';
      btTop.appendChild(empty);
    }
    st.top.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'bt-top-row' + (r.name === battleMyKey ? ' me' : '');
      const left = document.createElement('span');
      left.textContent = `${['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} ${r.name}`;
      const right = document.createElement('span');
      right.textContent = `${r.maxStage}층`;
      row.append(left, right);
      btTop.appendChild(row);
    });
    btClaim.disabled = battleBusy || !st.active;
    btClaim.hidden = !st.active;
    btToggle.disabled = battleBusy;
    btToggle.textContent = st.active ? '🏠 귀환' : '⚔️ 원정 출발';
    btToggle.title = st.active ? '귀환하면 쌓인 전리품을 받고 캐릭터가 다시 돌아다녀요' : '출발하면 캐릭터가 제자리에서 사냥을 시작해요 (앱을 꺼도 계속)';
    btToggle.classList.toggle('start', !st.active);
    battleShownKills = btEstimate(st).kills;
    tickBattle();
  }

  /** 200ms 틱 — 가방 진행/예상 전리품 갱신 + 방치 사냥 연출 (처치 경계마다 타격) */
  function tickBattle(): void {
    const st = battleState;
    if (!st) return;
    const est = btEstimate(st);
    btLootTime.textContent = `${fmtDur(est.elapsed)} / ${st.stats.capMs / 3600000}시간`;
    btLootFill.style.width = `${Math.min(100, (est.elapsed / st.stats.capMs) * 100)}%`;
    btLoot.classList.toggle('full', est.capped);
    if (!st.active) {
      btLootSummary.textContent = '🏠 쉬는 중 — 출발하면 가방이 차기 시작해요. (앱을 꺼도 귀환 전까지 계속 사냥)';
      if (!battleBusy) btSetHp(btFoeHp, btFoeHptext, st.mob.hp, st.mob.hp);
      return;
    }
    btLootSummary.textContent = est.capped
      ? `👾 ${fmtNum(est.kills)}마리 · 🪙 약 ${fmtNum(est.coins)} · 가방이 가득 찼어요! 수령해 주세요`
      : `👾 ${fmtNum(est.kills)}마리 · 🪙 약 ${fmtNum(est.coins)} · ${(60000 / st.killMs).toFixed(1)}마리/분 (드랍은 수령 시 공개)`;
    if (battleBusy) return;
    // 방치 연출: 몬스터 체력이 처치 주기에 맞춰 줄고, 경계에서 쓰러짐
    const phase = est.capped ? 1 : (est.elapsed % st.killMs) / st.killMs;
    btSetHp(btFoeHp, btFoeHptext, st.mob.hp * (1 - phase), st.mob.hp);
    if (est.kills > battleShownKills && !est.capped) {
      battleShownKills = est.kills;
      btPulse(btVs, 'swing');
      btPulse(btFoeAvatar, 'hit');
      btFloat(`-${fmtNum(st.mob.hp)}`, Math.random() * 100 < st.stats.crit ? 'crit' : '', 'foe');
      if (st.coinPerKill >= 1 || Math.random() < st.coinPerKill) btFloat(`+🪙`, 'loot', 'foe');
    }
  }

  // 몬스터 스프라이트 (assets/extras/monsters/<id>.png 32x32 → 4배) — 없으면 이모지 폴백
  const btFoeCanvas = document.createElement('canvas');
  btFoeCanvas.width = 32;
  btFoeCanvas.height = 32;
  let btFoeSpriteId = '';
  function setFoeSprite(sprite: string | undefined, emoji: string): void {
    if (!sprite) {
      btFoeSpriteId = '';
      btFoeAvatar.textContent = emoji;
      return;
    }
    if (btFoeSpriteId === sprite && btFoeCanvas.parentElement === btFoeAvatar) return;
    btFoeSpriteId = sprite;
    btFoeAvatar.textContent = emoji; // 로딩 중/실패 폴백
    void loadImageFromExtra(`monsters/${sprite}.png`).then((img) => {
      if (!img || btFoeSpriteId !== sprite) return;
      const ctx = btFoeCanvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 32, 32);
      ctx.drawImage(img, 0, 0);
      btFoeAvatar.textContent = '';
      btFoeAvatar.appendChild(btFoeCanvas);
    });
  }

  // 내 캐릭터 전신 도트 (PartComposer 합성 프레임) — 공격 모션을 계속 반복
  // 64px 셀 안에서 캐릭터(+무기 휘두름)가 차지하는 영역만 잘라 CSS로 3배 확대 (실측 본체 x25~47·y37~55, 무기 여유 포함)
  const BT_CROP = { x: 12, y: 16, w: 48, h: 42 };
  const btMeCanvas = document.createElement('canvas');
  btMeCanvas.width = BT_CROP.w;
  btMeCanvas.height = BT_CROP.h;
  const btMeCtx = btMeCanvas.getContext('2d')!;
  btMeCtx.imageSmoothingEnabled = false;
  let battleMeFrames: ComposedFrames | null = null;
  let battleAnimTimer = 0;

  /** 무기에 맞는 공격 모션 — 활은 쏘기, 그 외 베기 (없으면 찌르기) */
  function battleAttackAnim(frames: ComposedFrames, appearance: Appearance): HTMLCanvasElement[] {
    const weapon = appearance.weapon?.name ?? '';
    const prefer = /bow/i.test(weapon) ? 'shot' : 'slash';
    return frames.anims[prefer]?.length ? frames.anims[prefer] : frames.anims.slash?.length ? frames.anims.slash : frames.anims.jab ?? [];
  }

  function startBattleMeAnim(appearance: Appearance): void {
    window.clearTimeout(battleAnimTimer);
    const frames = battleMeFrames;
    if (!frames) return;
    const attack = battleAttackAnim(frames, appearance);
    // 공격 4프레임(120ms) → 숨 고르기 idle 2프레임(220ms) → 반복
    const seq: { frame: HTMLCanvasElement; ms: number }[] = [
      ...attack.map((frame) => ({ frame, ms: 120 })),
      ...frames.idle.map((frame) => ({ frame, ms: 220 })),
    ];
    if (seq.length === 0) return;
    let i = 0;
    const step = () => {
      const cur = seq[i % seq.length];
      btMeCtx.clearRect(0, 0, BT_CROP.w, BT_CROP.h);
      btMeCtx.drawImage(cur.frame, BT_CROP.x, BT_CROP.y, BT_CROP.w, BT_CROP.h, 0, 0, BT_CROP.w, BT_CROP.h);
      i++;
      battleAnimTimer = window.setTimeout(step, cur.ms);
    };
    step();
  }

  async function loadBattleMeAvatar(appearance: Appearance): Promise<void> {
    const frames = await chatComposer.compose(appearance);
    if (!frames) return; // 합성 실패 시 이모지 유지
    battleMeFrames = frames;
    if (btMeCanvas.parentElement !== btMeAvatar) {
      btMeAvatar.textContent = '';
      btMeAvatar.appendChild(btMeCanvas);
    }
    startBattleMeAnim(appearance);
  }

  async function openBattlePanel(): Promise<void> {
    if (!battleMyKey) {
      const me = (await window.overlay.getSelf()) as { nickname: string; tag: string; appearance: Appearance };
      battleMyKey = `${me.nickname}#${me.tag}`;
      void loadBattleMeAvatar(me.appearance);
    }
    await refreshBattle();
    window.clearInterval(battleTimer);
    battleTimer = window.setInterval(tickBattle, 200);
  }

  async function refreshBattle(): Promise<void> {
    const st = (await window.overlay.battleState()) as BattleView | null;
    if (st) {
      battleClockOffset = st.now - Date.now();
      battleState = st;
    }
    paintBattle();
  }

  function applyBattleState(st: BattleView | undefined): void {
    if (!st) return;
    battleClockOffset = st.now - Date.now();
    battleState = st;
    paintBattle();
  }

  function claimSummaryHtml(res: BattleClaimView, prefix: string): string {
    const parts = [
      `${prefix}<b>${fmtDur(res.elapsedMs ?? 0)}</b> 동안 👾 <b>${fmtNum(res.kills ?? 0)}</b>마리 → +<b>${fmtNum(res.coins ?? 0)}</b> 🪙`,
    ];
    if (res.gems) parts.push(`+<b>${res.gems}</b> 💎`);
    if (res.minerals && res.minerals.length > 0) {
      const total = res.minerals.reduce((s, m) => s + m.count, 0);
      const fresh = res.minerals.filter((m) => m.isNew).map((m) => m.name);
      parts.push(
        `⛏️ 광물 <b>${total}</b>개${fresh.length ? ` (도감 신규 ${fresh.length}: ${fresh.slice(0, 4).join(', ')}${fresh.length > 4 ? ' …' : ''})` : ''}`,
      );
    }
    if (res.capped) parts.push('🎒 가방이 가득 찬 채였어요');
    return parts.join(' · ');
  }

  async function battleClaim(): Promise<void> {
    if (battleBusy) return;
    battleBusy = true;
    btClaim.disabled = true;
    const res = (await window.overlay.battleClaim()) as BattleClaimView;
    battleBusy = false;
    if (!res.ok) {
      btResult.textContent = res.error ?? '수령에 실패했어요.';
      btClaim.disabled = false;
      return;
    }
    btResult.innerHTML = claimSummaryHtml(res, '🎒 ');
    btShowBanner(`+${fmtNum(res.coins ?? 0)} 🪙`, '#ffd66e');
    btFloat(`+${fmtNum(res.coins ?? 0)} 🪙`, 'loot', 'me');
    if (res.gems) setTimeout(() => btFloat(`+${res.gems} 💎`, 'loot', 'me'), 250);
    applyBattleState(res.state);
  }

  async function battleToggle(): Promise<void> {
    if (battleBusy || !battleState) return;
    const next = !battleState.active;
    battleBusy = true;
    paintBattle();
    const res = (await window.overlay.battleActive(next)) as BattleClaimView;
    battleBusy = false;
    if (!res.ok) {
      btResult.textContent = res.error ?? '원정 상태를 바꾸지 못했어요.';
      paintBattle();
      return;
    }
    if (next) {
      btResult.innerHTML = `⚔️ <b>${res.state?.stage ?? battleState.stage}층</b>으로 원정 출발! 캐릭터가 제자리에서 사냥을 시작했어요.`;
      btShowBanner('⚔️ 출발!', '#ff9a9a');
    } else {
      btResult.innerHTML = '🏠 귀환했어요. 캐릭터가 다시 돌아다녀요.' + (res.kills ? `<br />${claimSummaryHtml(res, '자동 수령: ')}` : '');
      if (res.coins) btFloat(`+${fmtNum(res.coins)} 🪙`, 'loot', 'me');
    }
    applyBattleState(res.state);
  }

  async function battleUpgrade(key: string): Promise<void> {
    if (battleBusy) return;
    battleBusy = true;
    paintBattle();
    const res = (await window.overlay.battleUpgrade(key)) as BattleClaimView;
    battleBusy = false;
    if (!res.ok) {
      btResult.textContent = res.error ?? '강화에 실패했어요.';
      paintBattle();
      return;
    }
    const def = BT_UPGRADES.find((d) => d.key === key)!;
    const lv = res.state?.lv[key] ?? 0;
    btResult.innerHTML =
      `${def.icon} <b>${def.name} Lv ${lv}</b> 강화 완료!` +
      (res.kills ? `<br />${claimSummaryHtml(res, '자동 수령: ')}` : '');
    btShowBanner(`${def.icon} Lv ${lv}`, '#8be06a');
    applyBattleState(res.state);
  }

  async function battleSetStage(stage: number): Promise<void> {
    if (battleBusy) return;
    battleBusy = true;
    paintBattle();
    const res = (await window.overlay.battleStage(stage)) as BattleClaimView;
    battleBusy = false;
    if (!res.ok) {
      btResult.textContent = res.error ?? '층을 옮기지 못했어요.';
      paintBattle();
      return;
    }
    if (res.kills) btResult.innerHTML = claimSummaryHtml(res, '자동 수령: ');
    applyBattleState(res.state);
  }

  async function battleChallenge(): Promise<void> {
    if (battleBusy || !battleState?.guardian) return;
    battleBusy = true;
    paintBattle();
    const res = (await window.overlay.battleChallenge()) as BattleChallengeView;
    if (!res.ok || !res.foe || !res.log) {
      battleBusy = false;
      btResult.textContent = res.error ?? '도전에 실패했어요.';
      paintBattle();
      return;
    }
    // 수문장전 연출 — 서버 로그를 틱 단위로 재생 (긴 전투는 빠르게)
    const foe = res.foe;
    const stage = res.stage ?? 0;
    const myMax = battleState.stats.hp;
    setFoeSprite(foe.sprite, foe.emoji);
    btFoeAvatar.classList.remove('dead');
    btFoeName.textContent = `${foe.name} (${stage}층 수문장)`;
    btSetHp(btFoeHp, btFoeHptext, foe.hp, foe.hp);
    btSetHp(btMeHp, btMeHptext, myMax, myMax);
    btResult.textContent = `${foe.emoji} ${foe.name}과(와) 전투 중…`;
    const stepMs = Math.max(70, Math.min(220, 6000 / res.log.length));
    for (const [me, foeHp, dmg, crit] of res.log) {
      btPulse(btVs, 'swing');
      btPulse(btFoeAvatar, 'hit');
      btFloat(`-${fmtNum(dmg)}${crit ? '!' : ''}`, crit ? 'crit' : '', 'foe');
      btSetHp(btFoeHp, btFoeHptext, foeHp, foe.hp);
      await new Promise((r) => setTimeout(r, stepMs * 0.5));
      if (foeHp > 0) {
        btFloat(`-${foe.atk}`, 'hurt', 'me');
        btSetHp(btMeHp, btMeHptext, me, myMax);
      }
      await new Promise((r) => setTimeout(r, stepMs * 0.5));
    }
    if (res.win) {
      btFoeAvatar.classList.add('dead');
      btShowBanner('🏆 승리!', '#ffd66e');
      const r = res.reward;
      btResult.innerHTML =
        `🏆 <b>${stage}층 수문장 ${foe.name}</b> 격파! +<b>${fmtNum(r?.coins ?? 0)}</b> 🪙` +
        (r?.gems ? ` +<b>${r.gems}</b> 💎` : '') +
        (r?.item ? ` · 🎁 상점 아이템 <b>${r.item.name}</b> 획득!` : '') +
        ` — ${stage + 1 <= 100 ? `${stage + 1}층이 열렸어요` : '모든 층 정복!'}` +
        (res.settled?.kills
          ? `<br />자동 수령: 👾 ${fmtNum(res.settled.kills)}마리 → +${fmtNum(res.settled.coins)} 🪙${res.settled.gems ? ` +${res.settled.gems} 💎` : ''}`
          : '');
    } else {
      btShowBanner('💀 패배…', '#ff7a7a');
      btResult.innerHTML = `💀 <b>${foe.name}</b>에게 패배했어요. 💎 강화로 공격력·체력을 올리거나 낚싯대/도감 보너스를 챙겨 다시 도전! (20초 후 재도전 가능)`;
    }
    await new Promise((r) => setTimeout(r, 1400));
    battleBusy = false;
    applyBattleState(res.state);
  }

  btClaim.addEventListener('click', () => void battleClaim());
  btToggle.addEventListener('click', () => void battleToggle());
  window.overlay.on('self:battle', () => {
    // 오버레이 '귀환하기' 버튼/미니게임 카드로 바뀐 상태 반영
    if (battlePanel.classList.contains('open') && !battleBusy) void refreshBattle();
  });
  btChallenge.addEventListener('click', () => void battleChallenge());
  btStagePrev.addEventListener('click', () => battleState && void battleSetStage(battleState.stage - 1));
  btStageNext.addEventListener('click', () => battleState && void battleSetStage(battleState.stage + 1));

  window.overlay.on('self:gems', (data) => {
    if (battleState) {
      battleState.gems = Number(data) || 0;
      if (!battleBusy && battlePanel.classList.contains('open')) paintBattle();
    }
  });
  window.overlay.on('self:appearance', (data) => {
    const d = data as { appearance?: Appearance } | undefined;
    if (d?.appearance && battleMeFrames) void loadBattleMeAvatar(d.appearance);
  });
  window.overlay.on('net:battle-news', (data) => {
    const d = data as { id: string; nickname: string; tag: string; text: string };
    if (d.id === chatSelfId) return; // 본인은 원정 패널 결과로 충분
    addSystemMessage(d.text);
  });

  // ---- 🐾 펫 (뽑기 / 내 펫 — 판정·보유·효과는 서버, 여기서는 연출과 표시) ----

  interface PetOwnedView {
    dup: number;
    lv: number;
    satiety: number;
    tick: number;
  }
  interface PetStateView {
    owned: Record<string, PetOwnedView>;
    equip: string[];
    slots: number;
    food: number;
    cards: number;
    autoFeed: { on: boolean; pct: number };
    pity4: number;
    pity5: number;
    total: number;
    fridayDiscount: boolean;
    fx: Record<string, number>;
    coins: number;
    gems: number;
    now: number;
  }
  interface PetPullView {
    star: 3 | 4 | 5;
    id?: string;
    item?: string;
    n?: number;
    isNew?: boolean;
    dup?: number;
    refund?: { gems: number; cards: number };
  }
  interface PetSheetView {
    cellW: number;
    cellH: number;
    idle: number;
    walk: number;
    float?: boolean;
    scale?: number;
    faceLeft?: boolean;
    walkLeft?: number;
    foot?: number;
  }
  interface PetUiView {
    food: string;
    card: string;
    scroll: string;
    fx: Record<string, string>;
    fxCell: number;
    fxCols: number;
    fxCount: number;
  }

  const petPanel = document.getElementById('pet-panel')!;
  const petClose = document.getElementById('pet-close') as HTMLButtonElement;
  const petHeadInfo = document.getElementById('pet-head-info')!;
  const petTabBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('#pet-tabs .pet-tab'));
  const petGachaView = document.getElementById('pet-gacha')!;
  const petMineView = document.getElementById('pet-mine')!;
  const pgPity5 = document.getElementById('pg-pity5')!;
  const pgPity5Fill = document.getElementById('pg-pity5-fill')!;
  const pgPity4 = document.getElementById('pg-pity4')!;
  const pgPity4Fill = document.getElementById('pg-pity4-fill')!;
  const pgBanner = document.getElementById('pg-banner')!;
  const pgRatesBtn = document.getElementById('pg-rates-btn') as HTMLButtonElement;
  const pgPull1 = document.getElementById('pg-pull1') as HTMLButtonElement;
  const pgPull10 = document.getElementById('pg-pull10') as HTMLButtonElement;
  const pgPull10Cost = document.getElementById('pg-pull10-cost')!;
  const pgFriday = document.getElementById('pg-friday')!;
  const pgFood = document.getElementById('pg-food')!;
  const pgCards = document.getElementById('pg-cards')!;
  const pgTotal = document.getElementById('pg-total')!;
  const pmSlots = document.getElementById('pm-slots')!;
  const pmFood = document.getElementById('pm-food')!;
  const pmCards = document.getElementById('pm-cards')!;
  const pmShop = document.getElementById('pm-shop') as HTMLButtonElement;
  const pmAuto = document.getElementById('pm-auto') as HTMLInputElement;
  const pmAutoPct = document.getElementById('pm-auto-pct') as HTMLSelectElement;
  const pmFilterBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('#pm-filter .pm-f'));
  const pmGrid = document.getElementById('pm-grid')!;
  const petFxEl = document.getElementById('pet-fx')!;
  const petFxConfirm = document.getElementById('pet-fx-confirm')!;
  const petFxConfirmText = document.getElementById('pet-fx-confirm-text')!;
  const petFxYes = document.getElementById('pet-fx-yes') as HTMLButtonElement;
  const petFxNo = document.getElementById('pet-fx-no') as HTMLButtonElement;
  const petFxScroll = document.getElementById('pet-fx-scroll')!;
  const petFxScrollCanvas = document.getElementById('pet-fx-scroll-canvas') as HTMLCanvasElement;
  const petFxEffect = document.getElementById('pet-fx-effect')!;
  const petFxEffectCanvas = document.getElementById('pet-fx-effect-canvas') as HTMLCanvasElement;
  const petFxResult = document.getElementById('pet-fx-result')!;
  const petFxCards = document.getElementById('pet-fx-cards')!;
  const petFxAgain = document.getElementById('pet-fx-again') as HTMLButtonElement;
  const petFxClose = document.getElementById('pet-fx-close') as HTMLButtonElement;
  const petDetail = document.getElementById('pet-detail')!;
  const pdSprite = document.getElementById('pd-sprite') as HTMLCanvasElement;
  const pdName = document.getElementById('pd-name')!;
  const pdSub = document.getElementById('pd-sub')!;
  const pdClose = document.getElementById('pd-close') as HTMLButtonElement;
  const pdFlavor = document.getElementById('pd-flavor')!;
  const pdStatus = document.getElementById('pd-status')!;
  const pdActions = document.getElementById('pd-actions')!;
  const pdEffects = document.getElementById('pd-effects')!;

  const petToastEl = document.getElementById('pet-toast')!;
  let petToastTimer = 0;
  /** 펫 패널 안 안내 (팝아웃에서도 보이도록 채팅 대신 패널 하단 토스트) */
  function petToast(text: string, ms = 3500): void {
    petToastEl.textContent = text;
    petToastEl.hidden = false;
    window.clearTimeout(petToastTimer);
    petToastTimer = window.setTimeout(() => (petToastEl.hidden = true), ms);
    if (!POPOUT) addSystemMessage(text);
  }

  const PET_STAR_COLOR: Record<number, string> = { 3: '#4fc3f7', 4: '#b388ff', 5: '#ffd54f' };
  const petDefById = new Map<string, PetDef>(PET_DEFS.map((d) => [d.id, d]));
  let petSt: PetStateView | null = null;
  let petExtras: { pets?: Record<string, PetSheetView>; petUi?: PetUiView } | null = null;
  let petTab: 'gacha' | 'mine' = 'gacha';
  let petFilter = 'all';
  let petBusy = false;
  let petDetailId: string | null = null;
  let petBannerTimer = 0;
  let petBannerIdx = 0;
  let petLastCount = 1;
  const petUiImgCache = new Map<string, Promise<HTMLImageElement | null>>();

  function petUiImage(rel: string): Promise<HTMLImageElement | null> {
    let cached = petUiImgCache.get(rel);
    if (!cached) {
      cached = loadImageFromExtra(rel);
      petUiImgCache.set(rel, cached);
    }
    return cached;
  }
  /** 펫 정지 프레임(0행 0번)을 size×size 캔버스에 정수 배율로 (실루엣 = 미보유) */
  function petSpriteCanvas(id: string, size = 48, silhouette = false): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    c.style.width = `${size}px`;
    c.style.height = `${size}px`;
    const def = petExtras?.pets?.[id];
    if (!def) return c;
    void loadImageFromExtra(`pets/${id}.png`).then((img) => {
      if (!img) return;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      const s = Math.max(1, Math.floor(size / Math.max(def.cellW, def.cellH)));
      const w = def.cellW * s;
      const h = def.cellH * s;
      ctx.drawImage(img, 0, 0, def.cellW, def.cellH, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
      if (silhouette) {
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = '#3d2f36';
        ctx.fillRect(0, 0, size, size);
      }
    });
    return c;
  }
  function petItemImg(kind: string, size = 40): HTMLImageElement {
    const img = document.createElement('img');
    img.width = size;
    img.height = size;
    img.alt = kind === 'food' ? '펫 먹이' : '경험치카드';
    const rel = kind === 'food' ? petExtras?.petUi?.food : petExtras?.petUi?.card;
    if (rel) void petUiImage(rel).then((src) => src && (img.src = src.src));
    return img;
  }
  const petSatietyClass = (s: number) => (s <= 30 ? 'crit' : s <= 70 ? 'low' : '');
  function petSatietyBar(satiety: number): HTMLElement {
    const bar = document.createElement('div');
    bar.className = `pm-sat ${petSatietyClass(satiety)}`;
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(0, Math.min(100, satiety))}%`;
    bar.appendChild(fill);
    bar.title = `포만도 ${Math.round(satiety)}%`;
    return bar;
  }

  async function openPetPanel(): Promise<void> {
    if (!petExtras) petExtras = (await window.overlay.getExtras()) as typeof petExtras;
    const st = (await window.overlay.petState()) as PetStateView | null;
    if (st) petSt = st;
    paintPet();
    startPetBanner();
  }
  function setPetTab(tab: 'gacha' | 'mine'): void {
    petTab = tab;
    for (const b of petTabBtns) b.classList.toggle('active', b.dataset.tab === tab);
    petGachaView.hidden = tab !== 'gacha';
    petMineView.hidden = tab !== 'mine';
    paintPet();
  }
  for (const b of petTabBtns) b.addEventListener('click', () => setPetTab(b.dataset.tab === 'mine' ? 'mine' : 'gacha'));
  petClose.addEventListener('click', () => petPanel.classList.remove('open'));

  function paintPet(): void {
    if (!petSt) return;
    petHeadInfo.textContent = `🪙 ${petSt.coins.toLocaleString()} · 💎 ${petSt.gems}`;
    updateCoins(petSt.coins);
    updateGems(petSt.gems);
    if (petTab === 'gacha') paintPetGacha();
    else paintPetMine();
  }

  // ---- 뽑기 탭 ----
  function paintPetGacha(): void {
    const st = petSt!;
    pgPity5.textContent = `${st.pity5}/${PET_GACHA_UI.hardPity5}`;
    pgPity5Fill.style.width = `${Math.min(100, (st.pity5 / PET_GACHA_UI.hardPity5) * 100)}%`;
    const left4 = 10 - st.pity4;
    pgPity4.textContent = `${left4}회 안에`;
    pgPity4Fill.style.width = `${Math.min(100, (st.pity4 / 10) * 100)}%`;
    const cost10 = st.fridayDiscount ? PET_GACHA_UI.fridayTen : PET_GACHA_UI.ten;
    pgPull10Cost.textContent = st.fridayDiscount ? `💎 ${cost10} (🎉 금요일 할인)` : `💎 ${cost10}`;
    pgFriday.hidden = !st.fridayDiscount;
    pgPull1.disabled = petBusy || st.gems < PET_GACHA_UI.single;
    pgPull10.disabled = petBusy || st.gems < cost10;
    pgFood.textContent = String(st.food);
    pgCards.textContent = String(st.cards);
    pgTotal.textContent = String(st.total);
  }
  function startPetBanner(): void {
    window.clearInterval(petBannerTimer);
    const fives = PET_DEFS.filter((d) => d.star === 5);
    const paintBanner = () => {
      if (!petPanel.classList.contains('open')) {
        window.clearInterval(petBannerTimer);
        return;
      }
      const def = fives[petBannerIdx % fives.length];
      petBannerIdx++;
      pgBanner.innerHTML = '';
      const spr = petSpriteCanvas(def.id, 64);
      spr.classList.add('pg-banner-spr');
      const info = document.createElement('div');
      info.className = 'pg-banner-info';
      const owned = petSt?.owned[def.id];
      info.innerHTML = `<b>★5 ${def.name}</b><small>${def.theme}</small><small>${owned ? `보유 · ${owned.dup}돌` : '미보유'}</small>`;
      const tag = document.createElement('span');
      tag.className = 'pg-banner-name';
      tag.textContent = `5성 ${petBannerIdx % fives.length || fives.length}/${fives.length}`;
      pgBanner.append(spr, info, tag);
    };
    paintBanner();
    petBannerTimer = window.setInterval(paintBanner, 2800);
  }
  pgRatesBtn.addEventListener('click', () => {
    const p4 = PET_GACHA_UI.pity4;
    petToast(
      `🐾 펫 뽑기 확률 — ⭐5 ${PET_GACHA_UI.rate5}% (70회차부터 +5%p/회, 최대 ${PET_GACHA_UI.hardPity5}회 안에 확정, 획득 시 0/${PET_GACHA_UI.hardPity5}) · ⭐4 ${PET_GACHA_UI.rate4}% (7뽑 ${p4[6]}% → 8뽑 ${p4[7]}% → 9뽑 ${p4[8]}% → 10뽑 ${p4[9]}%) · ⭐3 나머지(펫 먹이 ×1 60% / ×3 25% / 경험치카드 15%). 5성 7종·4성 40종은 등급 안에서 균등. 중복 = 돌파(+1, 최대 10돌), 만돌 이후 중복은 💎·카드로 환급.`,
      9000,
    );
  });

  function petShowFx(section: 'confirm' | 'scroll' | 'effect' | 'result' | null): void {
    petFxEl.hidden = section === null;
    petFxConfirm.hidden = section !== 'confirm';
    petFxScroll.hidden = section !== 'scroll';
    petFxEffect.hidden = section !== 'effect';
    petFxResult.hidden = section !== 'result';
  }
  let petConfirmResolve: ((ok: boolean) => void) | null = null;
  function petConfirmDialog(text: string): Promise<boolean> {
    petFxConfirmText.textContent = text;
    petShowFx('confirm');
    return new Promise((resolve) => {
      petConfirmResolve = resolve;
    });
  }
  petFxYes.addEventListener('click', () => petConfirmResolve?.(true));
  petFxNo.addEventListener('click', () => petConfirmResolve?.(false));

  /** 마법 두루마리 — 눌러서 확인하기 (클릭까지 대기) */
  async function petScrollStage(): Promise<void> {
    const scroll = petExtras?.petUi?.scroll;
    const ctx = petFxScrollCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 64, 64);
    if (scroll) {
      const img = await petUiImage(scroll);
      if (img) ctx.drawImage(img, 0, 0);
    }
    petShowFx('scroll');
    await new Promise<void>((resolve) => petFxScroll.addEventListener('click', () => resolve(), { once: true }));
  }
  /** 등급 이펙트 2초 루프 (3성 파랑 / 4성 보라 / 5성 노랑, 30프레임 15fps) */
  async function petEffectStage(star: 3 | 4 | 5): Promise<void> {
    const ui = petExtras?.petUi;
    petShowFx('effect');
    const ctx = petFxEffectCanvas.getContext('2d')!;
    const size = petFxEffectCanvas.width;
    ctx.clearRect(0, 0, size, size);
    const sheet = ui ? await petUiImage(ui.fx[String(star)]) : null;
    const DURATION = 2000;
    await new Promise<void>((resolve) => {
      const start = performance.now();
      const frame = (t: number) => {
        const el = t - start;
        ctx.clearRect(0, 0, size, size);
        if (sheet && ui) {
          const fi = Math.floor(el / (DURATION / ui.fxCount)) % ui.fxCount;
          const sx = (fi % ui.fxCols) * ui.fxCell;
          const sy = Math.floor(fi / ui.fxCols) * ui.fxCell;
          ctx.drawImage(sheet, sx, sy, ui.fxCell, ui.fxCell, 0, 0, size, size);
        } else {
          // 이펙트 시트가 없으면 등급 색 원으로 대체
          ctx.fillStyle = PET_STAR_COLOR[star];
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin(el / 120);
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        if (el < DURATION) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }
  function petPullName(r: PetPullView): string {
    if (r.star === 3) return r.item === 'food' ? `펫 먹이 ×${r.n ?? 1}` : `경험치카드 ×${r.n ?? 1}`;
    return `★${r.star} ${petDefById.get(r.id ?? '')?.name ?? r.id}`;
  }
  function petShowResults(results: PetPullView[]): void {
    petFxCards.innerHTML = '';
    petFxCards.classList.toggle('single', results.length === 1);
    results.forEach((r, i) => {
      const card = document.createElement('div');
      card.className = `pfx-card s${r.star}`;
      card.dataset.name = petPullName(r);
      card.style.animationDelay = `${i * 80}ms`;
      if (r.star === 3) card.appendChild(petItemImg(r.item ?? 'food', 40));
      else card.appendChild(petSpriteCanvas(r.id ?? '', 48));
      const name = document.createElement('span');
      name.className = 'pfx-name';
      name.textContent = r.star === 3 ? (r.item === 'food' ? '먹이' : '카드') : (petDefById.get(r.id ?? '')?.name ?? '');
      const badge = document.createElement('span');
      badge.className = 'pfx-badge';
      if (r.star === 3) {
        badge.textContent = `×${r.n ?? 1}`;
      } else if (r.refund) {
        badge.textContent = `환급 💎${r.refund.gems}`;
        badge.classList.add('dup');
      } else if (r.isNew) {
        badge.textContent = 'NEW!';
        badge.classList.add('new');
      } else {
        badge.textContent = `돌파 ${r.dup}돌`;
        badge.classList.add('dup');
      }
      card.append(name, badge);
      petFxCards.appendChild(card);
    });
    petShowFx('result');
  }
  async function petDoGacha(count: number): Promise<void> {
    if (petBusy || !petSt) return;
    const cost = count === 10 ? (petSt.fridayDiscount ? PET_GACHA_UI.fridayTen : PET_GACHA_UI.ten) : PET_GACHA_UI.single;
    if (petSt.gems < cost) {
      petToast(`젬이 부족해요. (${petSt.gems}/${cost} 💎)`);
      return;
    }
    const ok = await petConfirmDialog(`젬 ${cost}개를 소모하여 ${count}회 뽑기를 진행하시겠습니까?`);
    if (!ok) {
      petShowFx(null);
      return;
    }
    petBusy = true;
    petLastCount = count;
    paintPetGacha();
    const res = (await window.overlay.petGacha(count)) as {
      ok: boolean;
      error?: string;
      results?: PetPullView[];
      state?: PetStateView;
    };
    if (!res.ok || !res.results) {
      petBusy = false;
      petShowFx(null);
      petToast(res.error ?? '뽑기에 실패했어요.');
      paintPet();
      return;
    }
    if (res.state) petSt = res.state;
    await petScrollStage();
    const maxStar = Math.max(...res.results.map((r) => r.star)) as 3 | 4 | 5;
    await petEffectStage(maxStar);
    petShowResults(res.results);
    const news = res.results.filter((r) => r.star === 5 && r.isNew).map((r) => petDefById.get(r.id ?? '')?.name);
    if (news.length) petToast(`🐾 5성 펫 획득! ${news.join(', ')}`);
    petBusy = false;
    paintPet();
  }
  pgPull1.addEventListener('click', () => void petDoGacha(1));
  pgPull10.addEventListener('click', () => void petDoGacha(10));
  petFxAgain.addEventListener('click', () => {
    petShowFx(null);
    void petDoGacha(petLastCount);
  });
  petFxClose.addEventListener('click', () => petShowFx(null));

  // ---- 내 펫 탭 ----
  function petOwnedSorted(): PetDef[] {
    return [...PET_DEFS].sort((a, b) => b.star - a.star || a.name.localeCompare(b.name, 'ko'));
  }
  function paintPetMine(): void {
    const st = petSt!;
    pmSlots.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const slot = document.createElement('div');
      slot.className = 'pm-slot';
      if (i >= st.slots) {
        slot.classList.add('locked');
        const need = PET_SLOT_THRESHOLDS[i];
        slot.innerHTML = `<span>🔒</span><span>펫 ${need}종 수집 시 해금</span><span>(${Object.keys(st.owned).length}/${need})</span>`;
        pmSlots.appendChild(slot);
        continue;
      }
      const id = st.equip[i];
      if (id && st.owned[id]) {
        const def = petDefById.get(id)!;
        const o = st.owned[id];
        slot.classList.add('filled', `s${def.star}`);
        slot.append(petSpriteCanvas(id, 40));
        const name = document.createElement('span');
        name.className = 'pm-slot-name';
        name.textContent = `${def.name} ${o.dup}돌 Lv${o.lv}`;
        slot.append(name, petSatietyBar(o.satiety));
        const sat = document.createElement('span');
        sat.textContent = `포만도 ${Math.round(o.satiety)}%`;
        slot.append(sat);
        slot.addEventListener('click', () => openPetDetail(id));
      } else {
        slot.innerHTML = `<span class="pm-slot-plus">＋</span><span>슬롯 ${i + 1}</span><span>아래에서 펫 선택</span>`;
        slot.addEventListener('click', () => petToast('아래 목록에서 보유한 펫을 눌러 장착하세요.'));
      }
      pmSlots.appendChild(slot);
    }
    pmFood.textContent = String(st.food);
    pmCards.textContent = String(st.cards);
    pmAuto.checked = st.autoFeed.on;
    pmAutoPct.value = String(st.autoFeed.pct);
    for (const b of pmFilterBtns) b.classList.toggle('active', b.dataset.f === petFilter);
    pmGrid.innerHTML = '';
    for (const def of petOwnedSorted()) {
      const o = st.owned[def.id];
      if (petFilter === '5' && def.star !== 5) continue;
      if (petFilter === '4' && def.star !== 4) continue;
      if (petFilter === 'owned' && !o) continue;
      const card = document.createElement('div');
      card.className = `pm-card s${def.star}${o ? '' : ' unowned'}`;
      card.appendChild(petSpriteCanvas(def.id, 40, !o));
      const name = document.createElement('span');
      name.className = 'pm-name';
      name.textContent = o ? def.name : '???';
      card.appendChild(name);
      const dup = document.createElement('span');
      dup.className = 'pm-dup';
      dup.textContent = o ? `${'★'.repeat(Math.min(5, o.dup))}${o.dup > 5 ? `+${o.dup - 5}` : ''} Lv${o.lv}`.trim() || '명함' : `★${def.star}`;
      card.appendChild(dup);
      if (o && st.equip.includes(def.id)) {
        const eq = document.createElement('span');
        eq.className = 'pm-eq';
        eq.textContent = '🐾';
        eq.title = '장착 중';
        card.appendChild(eq);
        card.appendChild(petSatietyBar(o.satiety));
      }
      card.addEventListener('click', () => openPetDetail(def.id));
      pmGrid.appendChild(card);
    }
  }
  for (const b of pmFilterBtns)
    b.addEventListener('click', () => {
      petFilter = b.dataset.f ?? 'all';
      paintPetMine();
    });
  pmShop.addEventListener('click', () => window.overlay.togglePopout('shop'));
  const petAutofeedSend = () => {
    void window.overlay.petAutofeed({ on: pmAuto.checked, pct: Number(pmAutoPct.value) || 70 }).then((r) => {
      const res = r as { ok: boolean; error?: string; state?: PetStateView };
      if (res.ok && res.state) petSt = res.state;
      else if (!res.ok) petToast(res.error ?? '설정에 실패했어요.');
      paintPet();
    });
  };
  pmAuto.addEventListener('change', petAutofeedSend);
  pmAutoPct.addEventListener('change', petAutofeedSend);

  // ---- 펫 상세 (획득 & 돌파 효과 표시, 장착/먹이/레벨) ----
  const petRowKind = (n: number) => (n === 0 ? '명함' : n === 5 ? '특수Ⅱ' : n === 10 ? '특수Ⅲ' : n === 2 || n === 4 || n === 8 ? '소소' : '수치');
  function petEffectRows(def: PetDef, dup: number, owned: boolean): HTMLElement[] {
    const rows: HTMLElement[] = [];
    for (let n = 0; n <= PET_MAX_DUP; n++) {
      const cur = petEffectsAt(def, n);
      const prev = n > 0 ? petEffectsAt(def, n - 1) : {};
      const parts: string[] = [];
      for (const [k, v] of Object.entries(cur) as [PetFxKey, number][]) {
        if (prev[k] === undefined) parts.push(`<b>${petFxLabel(k, v)}</b>`);
        else if (prev[k] !== v) parts.push(`${petFxLabel(k, v)} <small>(${prev[k]}→${v})</small>`);
      }
      const row = document.createElement('div');
      row.className = `pd-fx ${owned && n <= dup ? 'on' : 'off'}${n === 0 || n === 5 || n === 10 ? ' special' : ''}`;
      row.innerHTML = `<b>${n}돌</b><i>${petRowKind(n)}</i><span>${parts.join(' · ')}</span>`;
      rows.push(row);
    }
    return rows;
  }
  function openPetDetail(id: string): void {
    const def = petDefById.get(id);
    if (!def || !petSt) return;
    petDetailId = id;
    const o = petSt.owned[id];
    const ctx = pdSprite.getContext('2d')!;
    ctx.clearRect(0, 0, pdSprite.width, pdSprite.height);
    const spr = petSpriteCanvas(id, 64, !o);
    setTimeout(() => ctx.drawImage(spr, 0, 0), 250); // 시트 로딩 후 복사
    pdName.textContent = `${'★'.repeat(def.star)} ${o ? def.name : '???'}`;
    pdName.style.color = PET_STAR_COLOR[def.star];
    pdSub.textContent = o ? `${def.theme} · ${o.dup}돌 · Lv${o.lv} · 포만도 ${Math.round(o.satiety)}%` : `${def.theme} · 미보유`;
    pdFlavor.textContent = o ? def.flavor : '아직 만나지 못한 펫이에요. 뽑기에서 획득하면 능력이 발현됩니다.';
    pdStatus.innerHTML = '';
    if (o) {
      const equipped = petSt.equip.includes(id);
      const satRow = document.createElement('div');
      satRow.className = 'pd-sat-row';
      satRow.append(petSatietyBar(o.satiety));
      const satText = document.createElement('span');
      const mult = o.satiety <= 30 ? '효과 −90%' : o.satiety <= 70 ? '효과 −30%' : '효과 100%';
      satText.textContent = `포만도 ${Math.round(o.satiety)}% (${mult}) · Lv${o.lv}: 1% 감소에 ${PET_SATIETY_MIN_PER_PCT[o.lv - 1]}분${equipped ? '' : ' · 미장착(휴식 중, 감소 없음)'}`;
      satRow.append(satText);
      pdStatus.append(satRow);
      const dupText = document.createElement('div');
      dupText.textContent = `돌파 ${o.dup}/${PET_MAX_DUP}${o.dup < PET_MAX_DUP ? ` · 같은 펫을 ${PET_MAX_DUP - o.dup}장 더 뽑으면 만돌` : ' · 만돌! 이후 중복은 💎·카드 환급'}`;
      pdStatus.append(dupText);
    }
    pdActions.innerHTML = '';
    if (o) {
      const equipped = petSt.equip.includes(id);
      const eqBtn = document.createElement('button');
      eqBtn.textContent = equipped ? '장착 해제' : '장착';
      eqBtn.className = equipped ? '' : 'primary';
      eqBtn.addEventListener('click', () => {
        const st = petSt!;
        let next: string[];
        if (equipped) next = st.equip.filter((x) => x !== id);
        else if (st.equip.length < st.slots) next = [...st.equip, id];
        else next = [id, ...st.equip.slice(1)]; // 슬롯이 가득 차면 1번 슬롯 교체
        void petAction(window.overlay.petEquip(next), equipped ? `'${def.name}' 장착 해제` : `🐾 '${def.name}' 장착!`);
      });
      const feedBtn = document.createElement('button');
      feedBtn.textContent = `🍖 먹이 주기 (${petSt.food}개)`;
      feedBtn.disabled = petSt.food < 1 || o.satiety >= 100;
      feedBtn.addEventListener('click', () => void petAction(window.overlay.petFeed(id), `🍖 '${def.name}' 포만도 100%!`));
      const need = o.lv < PET_MAX_LEVEL ? PET_LEVEL_CARDS[o.lv - 1] : 0;
      const lvBtn = document.createElement('button');
      lvBtn.textContent = o.lv >= PET_MAX_LEVEL ? 'Lv MAX' : `📜 레벨업 (${need}장 / 보유 ${petSt.cards})`;
      lvBtn.disabled = o.lv >= PET_MAX_LEVEL || petSt.cards < need;
      lvBtn.addEventListener('click', () => void petAction(window.overlay.petLevel(id), `📜 '${def.name}' Lv${o.lv + 1}!`));
      pdActions.append(eqBtn, feedBtn, lvBtn);
    }
    pdEffects.innerHTML = '';
    pdEffects.append(...petEffectRows(def, o?.dup ?? -1, Boolean(o)));
    petDetail.hidden = false;
  }
  async function petAction(p: Promise<unknown>, okMsg: string): Promise<void> {
    const res = (await p) as { ok: boolean; error?: string; state?: PetStateView };
    if (res.ok && res.state) {
      petSt = res.state;
      petToast(okMsg);
    } else if (!res.ok) petToast(res.error ?? '실패했어요.');
    paintPet();
    if (petDetailId && !petDetail.hidden) openPetDetail(petDetailId);
  }
  pdClose.addEventListener('click', () => {
    petDetail.hidden = true;
    petDetailId = null;
  });
  petDetail.addEventListener('click', (e) => {
    if (e.target === petDetail) {
      petDetail.hidden = true;
      petDetailId = null;
    }
  });
  // 자동 먹이 임계값 옵션
  for (let p = 10; p <= 90; p += 10) {
    const opt = document.createElement('option');
    opt.value = String(p);
    opt.textContent = `${p}% 이하`;
    pmAutoPct.appendChild(opt);
  }

  window.overlay.on('self:pet', (data) => {
    petSt = data as PetStateView;
    if (petPanel.classList.contains('open') && !petBusy) {
      paintPet();
      if (petDetailId && !petDetail.hidden) openPetDetail(petDetailId);
    }
  });
  window.overlay.on('net:pet-news', (data) => {
    const d = data as { id: string; text: string };
    if (d.id === chatSelfId) return; // 본인은 뽑기 결과로 충분
    addSystemMessage(d.text);
  });

  // ---- ☰ 메뉴 드롭다운 ----

  const menuBtn = document.getElementById('menu-btn') as HTMLButtonElement;
  const menuDropdown = document.getElementById('menu-dropdown')!;

  function closeAllPanels(): void {
    panel.classList.remove('open');
    petPanel.classList.remove('open');
    optionsPanel.classList.remove('open');
    pinnedPanel.classList.remove('open');
    slotPanel.classList.remove('open');
    shopPanel.classList.remove('open');
    minigamePanel.classList.remove('open');
    forgePanel.classList.remove('open');
    notePanel.classList.remove('open');
    stockPanel.classList.remove('open');
    tickerlogPanel.classList.remove('open');
    dailyPanel.classList.remove('open');
    achPanel.classList.remove('open');
    mdexPanel.classList.remove('open');
    battlePanel.classList.remove('open');
    window.clearInterval(stockTimerHandle);
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
      case 'daily':
        dailyPanel.classList.add('open');
        renderDaily();
        break;
      case 'ach':
        achPanel.classList.add('open');
        void renderAch();
        break;
      case 'mineraldex':
        mdexPanel.classList.add('open');
        void renderMineraldex();
        break;
      case 'fishdex':
        window.overlay.toggleFishdex();
        break;
      case 'slot':
        window.overlay.togglePopout('slot');
        break;
      case 'forge':
        window.overlay.togglePopout('forge');
        break;
      case 'battle':
        window.overlay.togglePopout('battle');
        break;
      case 'pet':
        window.overlay.togglePopout('pet');
        break;
      case 'note':
        window.overlay.togglePopout('note');
        break;
      case 'stock':
        window.overlay.togglePopout('stock');
        break;
      case 'tickerlog':
        tickerlogPanel.classList.add('open');
        void openTickerlogPanel();
        break;
      case 'shop':
        window.overlay.togglePopout('shop');
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
        openRankBar();
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

  // ---- 팝아웃 모드 초기화 — 대상 패널만 보이게 하고 렌더 ----
  if (POPOUT) {
    document.body.classList.add('popout');
    const target = document.getElementById(`${POPOUT}-panel`);
    if (target) {
      for (const el of Array.from(document.body.children)) {
        if (el !== target && el.tagName !== 'SCRIPT') (el as HTMLElement).style.display = 'none';
      }
      target.classList.add('open');
      switch (POPOUT) {
        case 'forge':
          void renderForge();
          break;
        case 'shop':
          void renderShop();
          break;
        case 'stock':
          void openStockPanel();
          break;
        case 'note':
          void populateNoteRecipients();
          break;
        case 'battle':
          void openBattlePanel();
          break;
        case 'pet':
          void openPetPanel();
          break;
      }
      // 패널 ✕(open 해제) → 창 닫기
      new MutationObserver(() => {
        if (!target.classList.contains('open')) window.overlay.closePopout(POPOUT);
      }).observe(target, { attributes: true, attributeFilter: ['class'] });
      // 내용 자연 높이 실측 → 창 높이 맞춤 (첫 실측이 와야 창이 표시됨)
      let lastFit = 0;
      const fitPopout = () => {
        target.style.position = 'static';
        target.style.height = 'auto';
        const natural = target.offsetHeight;
        target.style.position = '';
        target.style.height = '';
        if (natural > 0 && Math.abs(natural - lastFit) > 24) {
          lastFit = natural;
          window.overlay.resizePopout(POPOUT, natural + 2);
        }
      };
      fitPopout();
      setTimeout(fitPopout, 600); // 비동기 렌더(상점 목록 등) 반영분 1회 보정
    }
  } else {
    inputEl.focus();
  }
})();

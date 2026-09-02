import { contextBridge, ipcRenderer } from 'electron';

// 메인 → 렌더러 중계 이벤트 화이트리스트
const NET_CHANNELS = new Set([
  'net:status',
  'net:reset',
  'net:welcome',
  'net:player-joined',
  'net:player-moved',
  'net:player-left',
  'net:player-appearance',
  'net:player-pinned',
  'net:chat',
  'self:appearance',
  'self:inventory',
  'self:settings',
  'self:update',
  'self:update-hint',
  'self:unread',
  'self:coins',
  'self:wallet',
  'net:history',
  'net:player-read',
  'net:slot-win',
  'net:player-fishing',
  'net:enhance-news',
  'net:brag-news',
  'net:stocks',
  'net:ticker',
  'self:notes',
  'self:note',
  'self:minigame',
  'self:daily',
  'self:gems',
  'self:runner-key',
  'net:ranking',
  'self:achievement',
  'net:ach-news',
  'net:dig-news',
  'net:player-digging',
  'net:player-title',
  'net:battle-news',
  'net:player-battle',
  'self:battle',
]);

contextBridge.exposeInMainWorld('overlay', {
  setInteractive: (interactive: boolean) => ipcRenderer.send('set-interactive', interactive),
  setTrayIcon: (dataUrl: string) => ipcRenderer.send('set-tray-icon', dataUrl),
  getManifest: (): Promise<unknown> => ipcRenderer.invoke('get-manifest'),
  loadPart: (layer: string, name: string): Promise<string | null> =>
    ipcRenderer.invoke('load-part', layer, name),
  getSelf: (): Promise<unknown> => ipcRenderer.invoke('get-self'),
  submitProfile: (data: { nickname: string; tag: string }): Promise<unknown> =>
    ipcRenderer.invoke('profile-submit', data),
  cancelSetup: () => ipcRenderer.send('setup-cancel'),
  getInventory: (): Promise<unknown> => ipcRenderer.invoke('get-inventory'),
  getSettings: (): Promise<{
    opacity: number;
    scale: number;
    pinnedMsg: string;
    pinnedOn: boolean;
    serverUrl?: string;
  }> => ipcRenderer.invoke('get-settings'),
  setOpacity: (value: number) => ipcRenderer.send('set-opacity', value),
  setScale: (value: number) => ipcRenderer.send('set-scale', value),
  setChatColor: (value: string) => ipcRenderer.send('set-chat-color', value),
  setPinned: (data: { text: string; enabled: boolean }) => ipcRenderer.send('set-pinned', data),
  getDisplays: (): Promise<unknown[]> => ipcRenderer.invoke('get-displays'),
  setDisplay: (id: number) => ipcRenderer.send('set-display', id),
  getNetState: (): Promise<unknown> => ipcRenderer.invoke('net-state'),
  getChatHistory: (): Promise<unknown[]> => ipcRenderer.invoke('chat-history'),
  getUpdateState: (): Promise<unknown> => ipcRenderer.invoke('update-state'),
  installUpdate: () => ipcRenderer.send('install-update'),
  sendMove: (data: { x: number; dir: -1 | 1; walking: boolean }) => ipcRenderer.send('move', data),
  sendChat: (text: string) => ipcRenderer.send('chat-send', text),
  sendAction: (command: string) => ipcRenderer.send('action-send', command),
  markRead: (ts: number) => ipcRenderer.send('read-mark', ts),
  sendImage: (payload: {
    buffer: ArrayBuffer;
    mime: string;
    thumb: string;
    w: number;
    h: number;
  }): Promise<unknown> => ipcRenderer.invoke('send-image', payload),
  openImage: (url: string) => ipcRenderer.send('open-image', url),
  claimGift: (): Promise<unknown> => ipcRenderer.invoke('claim-gift'),
  getCoins: (): Promise<number> => ipcRenderer.invoke('get-coins'),
  playSlot: (): Promise<unknown> => ipcRenderer.invoke('slot-play'),
  getWallet: (): Promise<unknown> => ipcRenderer.invoke('get-wallet'),
  buyItem: (itemId: string): Promise<unknown> => ipcRenderer.invoke('shop-buy', itemId),
  getRanking: (): Promise<unknown[]> => ipcRenderer.invoke('ranking'),
  getRankingCached: (): Promise<unknown> => ipcRenderer.invoke('ranking-cached'),
  getDailyState: (): Promise<unknown> => ipcRenderer.invoke('daily-state'),
  buyAction: (actionId: string): Promise<unknown> => ipcRenderer.invoke('buy-action', actionId),
  togglePopout: (panel: string) => ipcRenderer.send('toggle-popout', panel),
  closePopout: (panel: string) => ipcRenderer.send('close-popout', panel),
  resizePopout: (panel: string, height: number) => ipcRenderer.send('resize-popout', panel, height),
  getExtras: (): Promise<unknown> => ipcRenderer.invoke('get-extras'),
  loadExtra: (relPath: string): Promise<string | null> => ipcRenderer.invoke('load-extra', relPath),
  getMinigameState: (): Promise<unknown> => ipcRenderer.invoke('minigame-state'),
  startMinigame: (game: string): Promise<unknown> => ipcRenderer.invoke('minigame-start', game),
  sendFishing: (data: { phase: string; fishId?: string; trophy?: boolean }) =>
    ipcRenderer.send('fishing-send', data),
  reportFish: (fishId: string, trophy?: boolean): Promise<unknown> =>
    ipcRenderer.invoke('fish-caught', fishId, trophy),
  sendDigging: (data: { phase: string; itemId?: string }) => ipcRenderer.send('digging-send', data),
  reportDig: (result: { kind: string; itemId?: string }): Promise<unknown> =>
    ipcRenderer.invoke('dig-report', result),
  getAchState: (): Promise<unknown> => ipcRenderer.invoke('ach-state'),
  battleState: (): Promise<unknown> => ipcRenderer.invoke('battle-state'),
  battleClaim: (): Promise<unknown> => ipcRenderer.invoke('battle-claim'),
  battleUpgrade: (key: string): Promise<unknown> => ipcRenderer.invoke('battle-upgrade', key),
  battleStage: (stage: number): Promise<unknown> => ipcRenderer.invoke('battle-stage', stage),
  battleChallenge: (): Promise<unknown> => ipcRenderer.invoke('battle-challenge'),
  battleActive: (active: boolean): Promise<unknown> => ipcRenderer.invoke('battle-active', active),
  setTitle: (title: string): Promise<unknown> => ipcRenderer.invoke('set-title', title),
  buyRandom: (itemId: string): Promise<unknown> => ipcRenderer.invoke('shop-buy-random', itemId),
  enhance: (): Promise<unknown> => ipcRenderer.invoke('enhance'),
  brag: (): Promise<unknown> => ipcRenderer.invoke('brag'),
  getNotes: (): Promise<unknown[]> => ipcRenderer.invoke('get-notes'),
  sendNote: (data: { to: string; image: string }): Promise<unknown> =>
    ipcRenderer.invoke('note-send', data),
  readNote: (noteId: string) => ipcRenderer.send('note-read', noteId),
  getStocks: (): Promise<unknown> => ipcRenderer.invoke('get-stocks'),
  stockBuy: (stockId: string, qty: number): Promise<unknown> =>
    ipcRenderer.invoke('stock-buy', stockId, qty),
  stockSell: (stockId: string, qty: number): Promise<unknown> =>
    ipcRenderer.invoke('stock-sell', stockId, qty),
  sendTickerAd: (text: string): Promise<unknown> => ipcRenderer.invoke('ticker-ad', text),
  getTickerLog: (): Promise<unknown[]> => ipcRenderer.invoke('ticker-log'),
  setTicker: (on: boolean) => ipcRenderer.send('set-ticker', on),
  endRunner: (seconds: number): Promise<unknown> => ipcRenderer.invoke('runner-end', seconds),
  sendReaction: (index: number) => ipcRenderer.send('reaction-send', index),
  equip: (payload: { slot: string; name: string | null; h?: number; s?: number; v?: number }) =>
    ipcRenderer.send('equip', payload),
  toggleChat: () => ipcRenderer.send('toggle-chat'),
  closeChat: () => ipcRenderer.send('close-chat'),
  toggleFishdex: () => ipcRenderer.send('toggle-fishdex'),
  closeFishdex: () => ipcRenderer.send('close-fishdex'),
  on: (channel: string, callback: (data: unknown) => void) => {
    if (NET_CHANNELS.has(channel)) {
      ipcRenderer.on(channel, (_e, data) => callback(data));
    }
  },
});

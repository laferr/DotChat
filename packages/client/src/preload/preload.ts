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
  'self:minigame',
  'self:runner-key',
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
  getExtras: (): Promise<unknown> => ipcRenderer.invoke('get-extras'),
  loadExtra: (relPath: string): Promise<string | null> => ipcRenderer.invoke('load-extra', relPath),
  getMinigameState: (): Promise<unknown> => ipcRenderer.invoke('minigame-state'),
  startMinigame: (game: string): Promise<unknown> => ipcRenderer.invoke('minigame-start', game),
  sendFishing: (data: { phase: string; fishId?: string }) => ipcRenderer.send('fishing-send', data),
  reportFish: (fishId: string): Promise<unknown> => ipcRenderer.invoke('fish-caught', fishId),
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

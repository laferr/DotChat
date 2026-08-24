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
  'net:chat',
  'self:appearance',
  'self:inventory',
  'self:settings',
]);

contextBridge.exposeInMainWorld('overlay', {
  setInteractive: (interactive: boolean) => ipcRenderer.send('set-interactive', interactive),
  setTrayIcon: (dataUrl: string) => ipcRenderer.send('set-tray-icon', dataUrl),
  loadSprites: (): Promise<{ name: string; dataUrl: string }[]> => ipcRenderer.invoke('load-sprites'),
  getSelf: (): Promise<{ nickname: string; tag: string; character: string; giftIntervalSec: number }> =>
    ipcRenderer.invoke('get-self'),
  submitProfile: (data: { nickname: string; tag: string }): Promise<unknown> =>
    ipcRenderer.invoke('profile-submit', data),
  cancelSetup: () => ipcRenderer.send('setup-cancel'),
  getInventory: (): Promise<{ owned: string[]; current: string }> => ipcRenderer.invoke('get-inventory'),
  getSettings: (): Promise<{ opacity: number; serverUrl?: string }> => ipcRenderer.invoke('get-settings'),
  setOpacity: (value: number) => ipcRenderer.send('set-opacity', value),
  claimGift: (): Promise<unknown> => ipcRenderer.invoke('claim-gift'),
  equip: (character: string) => ipcRenderer.send('equip', character),
  getNetState: (): Promise<unknown> => ipcRenderer.invoke('net-state'),
  getChatHistory: (): Promise<unknown[]> => ipcRenderer.invoke('chat-history'),
  sendMove: (data: { x: number; dir: -1 | 1; walking: boolean }) => ipcRenderer.send('move', data),
  sendChat: (text: string) => ipcRenderer.send('chat-send', text),
  sendImage: (payload: {
    buffer: ArrayBuffer;
    mime: string;
    thumb: string;
    w: number;
    h: number;
  }): Promise<unknown> => ipcRenderer.invoke('send-image', payload),
  openImage: (url: string) => ipcRenderer.send('open-image', url),
  toggleChat: () => ipcRenderer.send('toggle-chat'),
  closeChat: () => ipcRenderer.send('close-chat'),
  on: (channel: string, callback: (data: unknown) => void) => {
    if (NET_CHANNELS.has(channel)) {
      ipcRenderer.on(channel, (_e, data) => callback(data));
    }
  },
});

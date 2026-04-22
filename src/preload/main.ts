import { contextBridge, ipcRenderer, webFrame } from 'electron';

contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  onMaximizeChange: (cb: (isMax: boolean) => void) =>
    ipcRenderer.on('window:maximized', (_e, isMax: boolean) => cb(isMax)),
});

contextBridge.exposeInMainWorld('zoom', {
  get: () => webFrame.getZoomFactor(),
  set: (factor: number) => webFrame.setZoomFactor(factor),
});

contextBridge.exposeInMainWorld('links', {
  open: (url: string) => ipcRenderer.send('links:open', url),
});

contextBridge.exposeInMainWorld('favicon', {
  get: (url: string): Promise<string | null> => ipcRenderer.invoke('favicon:get', url),
});

contextBridge.exposeInMainWorld('appData', {
  reset: (): Promise<void> => ipcRenderer.invoke('app:reset-data'),
});

contextBridge.exposeInMainWorld('ldplayer', {
  find: (): Promise<Array<{ key: string; pid: number; title: string }>> =>
    ipcRenderer.invoke('ldplayer:find'),
  pick: (): Promise<string | null> => ipcRenderer.invoke('ldplayer:pick'),
  stopTracking: (): Promise<void> => ipcRenderer.invoke('ldplayer:stop-tracking'),
  getTracked: (): Promise<{ key: string; title: string } | null> =>
    ipcRenderer.invoke('ldplayer:get-tracked'),
  onTrackedChange: (cb: (info: { key: string; title: string } | null) => void) =>
    ipcRenderer.on('ldplayer:tracked-change', (_e, info) => cb(info)),
});

contextBridge.exposeInMainWorld('craft', {
  getCatalog: (): Promise<string[]> => ipcRenderer.invoke('craft:get-catalog'),
  getInitialState: (): Promise<unknown> => ipcRenderer.invoke('craft:get-initial-state'),
  start: (config: unknown): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke('craft:start', config),
  stop: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('craft:stop'),
  onEvent: (cb: (e: unknown) => void) =>
    ipcRenderer.on('craft:event', (_e, ev) => cb(ev)),
});

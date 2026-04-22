import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('glow', {
  onState: (cb: (state: { ok: boolean; reason?: string }) => void) =>
    ipcRenderer.on('glow:state', (_e, state) => cb(state)),
});

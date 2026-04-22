import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('picker', {
  pick: (key: string) => ipcRenderer.send('ldplayer:picker-pick', key),
  cancel: () => ipcRenderer.send('ldplayer:picker-cancel'),
});

// Nexura DJ Studio — puente seguro entre la interfaz y el sistema
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('nexura', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('app:info'),
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openSample: () => ipcRenderer.invoke('dialog:openSample'),
  openLibraryFile: () => ipcRenderer.invoke('dialog:openLibraryFile'),
  readHead: (p, n) => ipcRenderer.invoke('fs:readHead', p, n),
  infoForPaths: (paths) => ipcRenderer.invoke('fs:infoForPaths', paths),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return null; } },
  readFile: (p) => ipcRenderer.invoke('fs:readFile', p),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),
  existsMany: (paths) => ipcRenderer.invoke('fs:existsMany', paths),
  openPlaylist: () => ipcRenderer.invoke('dialog:openPlaylist'),
  findFiles: (names) => ipcRenderer.invoke('dialog:findFiles', names),
  artGet: (id, p) => ipcRenderer.invoke('art:get', id, p),
  storeGet: (name) => ipcRenderer.invoke('store:get', name),
  storeSet: (name, data) => ipcRenderer.invoke('store:set', name, data),
  waveGet: (id) => ipcRenderer.invoke('wave:get', id),
  waveSet: (id, data) => ipcRenderer.invoke('wave:set', id, data),
  saveRecording: (data, name) => ipcRenderer.invoke('rec:save', data, name),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  sendFeedback: (payload) => ipcRenderer.invoke('feedback:email', payload),
  postFeedback: (url, payload) => ipcRenderer.invoke('feedback:post', url, payload),
  stems: {
    info: (dir) => ipcRenderer.invoke('stems:info', dir),
    status: (ids, dir) => ipcRenderer.invoke('stems:status', ids, dir),
    read: (id, dir) => ipcRenderer.invoke('stems:read', id, dir),
    remove: (id, dir) => ipcRenderer.invoke('stems:delete', id, dir),
    install: () => ipcRenderer.invoke('stems:install'),
    separate: (jobs, dir, model) => ipcRenderer.invoke('stems:separate', jobs, dir, model),
    cancel: () => ipcRenderer.invoke('stems:cancel'),
    onEvent: (fn) => { const h = (_e, ev) => fn(ev); ipcRenderer.on('stems:event', h); return () => ipcRenderer.removeListener('stems:event', h); }
  },
  spotify: {
    embed: (type, id) => ipcRenderer.invoke('spotify:embed', type, id),
    api: (url) => ipcRenderer.invoke('spotify:api', url),
    login: (clientId) => ipcRenderer.invoke('spotify:login', clientId),
    logout: () => ipcRenderer.invoke('spotify:logout'),
    status: () => ipcRenderer.invoke('spotify:status')
  },
  yt: {
    oembed: (id) => ipcRenderer.invoke('yt:oembed', id),
    api: (endpoint, params, apiKey) => ipcRenderer.invoke('yt:api', endpoint, params, apiKey),
    login: (clientId, clientSecret) => ipcRenderer.invoke('yt:login', clientId, clientSecret),
    logout: () => ipcRenderer.invoke('yt:logout'),
    status: () => ipcRenderer.invoke('yt:status')
  }
});

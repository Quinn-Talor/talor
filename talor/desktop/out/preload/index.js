"use strict";
const electron = require("electron");
const api = {
  invoke: (channel, ...args) => electron.ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => {
    const subscription = (_event, ...args) => callback(...args);
    electron.ipcRenderer.on(channel, subscription);
    return () => electron.ipcRenderer.removeListener(channel, subscription);
  },
  off: (channel, callback) => {
    electron.ipcRenderer.removeListener(channel, callback);
  }
};
if (process.contextIsolated) {
  try {
    electron.contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.api = api;
}

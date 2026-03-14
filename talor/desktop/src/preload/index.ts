import { contextBridge, ipcRenderer } from 'electron'
import type { Session, Provider, Message } from '../renderer/types'

const api = {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
  off: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback)
  },

  session: {
    getAll: (): Promise<Session[]> => ipcRenderer.invoke('session:getAll'),
    getById: (id: string): Promise<Session | null> => ipcRenderer.invoke('session:getById', id),
    create: (session: Session): Promise<Session> => ipcRenderer.invoke('session:create', session),
    update: (session: Session): Promise<Session> => ipcRenderer.invoke('session:update', session),
    delete: (id: string): Promise<{ success: boolean }> => ipcRenderer.invoke('session:delete', id),
    addMessage: (sessionId: string, message: Message): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('session:addMessage', sessionId, message)
  },

  provider: {
    getAll: (): Promise<Provider[]> => ipcRenderer.invoke('provider:getAll'),
    getById: (id: string): Promise<Provider | null> => ipcRenderer.invoke('provider:getById', id),
    upsert: (provider: Provider): Promise<Provider> => ipcRenderer.invoke('provider:upsert', provider)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.api = api
}

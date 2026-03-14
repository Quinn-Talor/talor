import type { Session, Provider, Message } from '../renderer/types'

export interface SessionAPI {
  getAll: () => Promise<Session[]>
  getById: (id: string) => Promise<Session | null>
  create: (session: Session) => Promise<Session>
  update: (session: Session) => Promise<Session>
  delete: (id: string) => Promise<{ success: boolean }>
  addMessage: (sessionId: string, message: Message) => Promise<{ success: boolean }>
}

export interface ProviderAPI {
  getAll: () => Promise<Provider[]>
  getById: (id: string) => Promise<Provider | null>
  upsert: (provider: Provider) => Promise<Provider>
}

export interface TalorAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  off: (channel: string, callback: (...args: unknown[]) => void) => void
  session: SessionAPI
  provider: ProviderAPI
}

declare global {
  interface Window {
    api: TalorAPI
  }
}

import { create } from 'zustand'
import type { Session, Message } from '../types'

interface SessionState {
  sessions: Session[]
  currentSessionId: string | null
  isLoading: boolean
  loadSessions: () => Promise<void>
  setCurrentSession: (id: string | null) => void
  createSession: (agentId: string, title?: string) => Promise<Session>
  deleteSession: (id: string) => Promise<void>
  addMessage: (sessionId: string, message: Message) => Promise<void>
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void
  getCurrentSession: () => Session | undefined
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: [],
  currentSessionId: null,
  isLoading: false,

  loadSessions: async () => {
    set({ isLoading: true })
    try {
      const sessions = await window.api.session.getAll()
      set({ sessions, isLoading: false })
    } catch (error) {
      console.error('Failed to load sessions:', error)
      set({ isLoading: false })
    }
  },

  setCurrentSession: (id) => set({ currentSessionId: id }),

  createSession: async (agentId, title = 'New Session') => {
    const now = Date.now()
    const session: Session = {
      id: `session_${now}`,
      title,
      agentId,
      messages: [],
      createdAt: now,
      updatedAt: now
    }
    await window.api.session.create(session)
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentSessionId: session.id
    }))
    return session
  },

  deleteSession: async (id) => {
    await window.api.session.delete(id)
    set((state) => ({
      sessions: state.sessions.filter(s => s.id !== id),
      currentSessionId: state.currentSessionId === id ? null : state.currentSessionId
    }))
  },

  addMessage: async (sessionId, message) => {
    await window.api.session.addMessage(sessionId, message)
    set((state) => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId
          ? { ...s, messages: [...s.messages, message], updatedAt: Date.now() }
          : s
      )
    }))
  },

  updateMessage: (sessionId, messageId, updates) => set((state) => ({
    sessions: state.sessions.map(s =>
      s.id === sessionId
        ? {
            ...s,
            messages: s.messages.map(m =>
              m.id === messageId ? { ...m, ...updates } : m
            ),
            updatedAt: Date.now()
          }
        : s
    )
  })),

  getCurrentSession: () => {
    const state = get()
    return state.sessions.find(s => s.id === state.currentSessionId)
  }
}))

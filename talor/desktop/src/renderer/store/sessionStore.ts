import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Session, Message } from '../types'

interface SessionState {
  sessions: Session[]
  currentSessionId: string | null
  setSessions: (sessions: Session[]) => void
  setCurrentSession: (id: string | null) => void
  addSession: (session: Session) => void
  addMessage: (sessionId: string, message: Message) => void
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void
  getCurrentSession: () => Session | undefined
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,
      setSessions: (sessions) => set({ sessions }),
      setCurrentSession: (id) => set({ currentSessionId: id }),
      addSession: (session) => set((state) => ({ 
        sessions: [...state.sessions, session],
        currentSessionId: session.id
      })),
      addMessage: (sessionId, message) => set((state) => ({
        sessions: state.sessions.map(s => 
          s.id === sessionId 
            ? { ...s, messages: [...s.messages, message], updatedAt: Date.now() }
            : s
        )
      })),
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
    }),
    {
      name: 'talor-sessions'
    }
  )
)

import { create } from 'zustand'
import type { Session } from '../types'

interface SessionState {
  sessions: Session[]
  currentSessionId: string | null
  setSessions: (sessions: Session[]) => void
  setCurrentSession: (id: string | null) => void
  addSession: (session: Session) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  currentSessionId: null,
  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (id) => set({ currentSessionId: id }),
  addSession: (session) => set((state) => ({ 
    sessions: [...state.sessions, session] 
  })),
}))

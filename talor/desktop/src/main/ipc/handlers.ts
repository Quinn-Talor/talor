import { ipcMain } from 'electron'
import { sessionRepository } from '../db/sessionRepository'
import { providerRepository } from '../db/providerRepository'
import type { Session, Provider } from '../../renderer/types'

export function registerIpcHandlers(): void {
  ipcMain.handle('session:getAll', () => {
    return sessionRepository.findAll()
  })

  ipcMain.handle('session:getById', (_event, id: string) => {
    return sessionRepository.findById(id)
  })

  ipcMain.handle('session:create', (_event, session: Session) => {
    sessionRepository.create(session)
    return session
  })

  ipcMain.handle('session:update', (_event, session: Session) => {
    sessionRepository.update(session)
    return session
  })

  ipcMain.handle('session:delete', (_event, id: string) => {
    sessionRepository.delete(id)
    return { success: true }
  })

  ipcMain.handle('session:addMessage', (_event, sessionId: string, message: any) => {
    sessionRepository.addMessage(sessionId, message)
    return { success: true }
  })

  ipcMain.handle('provider:getAll', () => {
    return providerRepository.findAll()
  })

  ipcMain.handle('provider:getById', (_event, id: string) => {
    return providerRepository.findById(id)
  })

  ipcMain.handle('provider:upsert', (_event, provider: Provider) => {
    providerRepository.upsert(provider)
    return provider
  })
}

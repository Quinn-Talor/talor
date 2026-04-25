import { ipcMain } from 'electron'
import { sessionRepo, ChatSession, ChatMessage } from '../repos/session-repo'
import { ConfigStore } from '../store/config-store'
import { getProviderModels } from '../services/provider-fetcher'
import { checkModelAvailability } from '../services/model-availability'
import log from 'electron-log'

export function registerSessionHandlers(): void {
  ipcMain.handle('session:list', (): ChatSession[] => {
    return sessionRepo.list()
  })

  ipcMain.handle('session:create', async (_, params: { provider_id: string; model_id?: string }): Promise<ChatSession> => {
    let modelId = params.model_id

    if (!modelId) {
      const providers = ConfigStore.getInstance().get('providers') as Record<string, { id: string; base_url: string; type: string }>
      const provider = providers?.[params.provider_id]
      if (provider) {
        const models = await getProviderModels(provider as Parameters<typeof getProviderModels>[0])
        modelId = models[0]?.id ?? undefined
        log.info('[session:create] fetched model:', modelId, 'from provider:', params.provider_id)
      }
    }

    return sessionRepo.create({ title: '新会话', provider_id: params.provider_id, model_id: modelId })
  })

  ipcMain.handle('session:get', (_, id: string): ChatSession | null => {
    return sessionRepo.getById(id)
  })

  ipcMain.handle('session:rename', (_, params: { session_id: string; title: string }): ChatSession | null => {
    return sessionRepo.rename(params.session_id, params.title)
  })

  ipcMain.handle('session:updateModel', (_, params: { session_id: string; model_id: string }): ChatSession | null => {
    return sessionRepo.updateModel(params.session_id, params.model_id)
  })

  ipcMain.handle('session:updateWorkspace', (_, params: { session_id: string; workspace: string }): ChatSession | null => {
    return sessionRepo.updateWorkspace(params.session_id, params.workspace)
  })

  ipcMain.handle('session:checkModelAvailability', async (_, params: { session_id: string }): Promise<{ available: boolean; model_id?: string }> => {
    const session = sessionRepo.getById(params.session_id)
    if (!session?.model_id) return { available: true }

    const providers = ConfigStore.getInstance().get('providers') as Record<string, { id: string; models: { id: string }[] }>
    const provider = providers?.[session.provider_id]
    if (!provider) return { available: false, model_id: session.model_id }

    const models = (provider.models ?? []) as { id: string }[]
    const result = checkModelAvailability(session.model_id, models as Parameters<typeof checkModelAvailability>[1])
    log.info('[session:checkModelAvailability] session:', params.session_id, 'model:', session.model_id, 'available:', result.available)
    return { available: result.available, model_id: session.model_id }
  })

  ipcMain.handle('session:delete', (_, sessionId: string): void => {
    sessionRepo.delete(sessionId)
  })

  ipcMain.handle('session:getMessages', (_, sessionId: string): ChatMessage[] => {
    return messageRepo.listBySession(sessionId)
  })

  ipcMain.handle('session:touch', (_, sessionId: string): void => {
    sessionRepo.touch(sessionId)
  })

  log.info('[SessionHandlers] Registered')
}

import { messageRepo } from '../repos/session-repo'

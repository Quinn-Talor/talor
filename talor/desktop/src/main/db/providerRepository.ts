import { getDatabase } from './database'
import type { Provider } from '../../renderer/types'

export const providerRepository = {
  findAll(): Provider[] {
    const db = getDatabase()
    const providers = db.prepare('SELECT * FROM providers').all() as any[]
    return providers.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type,
      baseUrl: p.base_url,
      apiKey: p.api_key,
      models: p.models ? JSON.parse(p.models) : [],
      isConfigured: Boolean(p.is_configured)
    }))
  },

  findById(id: string): Provider | null {
    const db = getDatabase()
    const p = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any
    if (!p) return null
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      baseUrl: p.base_url,
      apiKey: p.api_key,
      models: p.models ? JSON.parse(p.models) : [],
      isConfigured: Boolean(p.is_configured)
    }
  },

  upsert(provider: Provider): void {
    const db = getDatabase()
    db.prepare(`
      INSERT OR REPLACE INTO providers (id, name, type, base_url, api_key, models, is_configured)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      provider.id,
      provider.name,
      provider.type,
      provider.baseUrl || null,
      provider.apiKey || null,
      JSON.stringify(provider.models),
      provider.isConfigured ? 1 : 0
    )
  }
}

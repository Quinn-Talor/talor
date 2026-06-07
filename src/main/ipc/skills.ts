// src/main/ipc/skills.ts — 入口层:Skill IPC handlers
//
// 供 AgentEditPage 下拉选择 skill 时列出平台已装的所有 skill。
//
// 允许依赖:agent/agent-manager
// 禁止依赖:业务决策

import { ipcMain } from 'electron'
import log from 'electron-log'
import type { AgentManager } from '../agent/agent-manager'

export interface PlatformSkillInfo {
  name: string
  description: string
}

export function registerSkillHandlers(agentManager: AgentManager): void {
  /**
   * 列出平台 ~/.talor/skills/ 下所有已装 skill,供 AgentEditPage 多选下拉用。
   * 返回 name + description (来自 SKILL.md frontmatter)。
   */
  ipcMain.handle('skills:list-platform', (): PlatformSkillInfo[] => {
    const registry = agentManager.getPlatformSkillRegistry()
    if (!registry) {
      log.warn('[skills:list-platform] platform skill registry not initialized')
      return []
    }
    return registry.listDescriptions()
  })
}

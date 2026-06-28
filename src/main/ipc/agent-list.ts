// src/main/ipc/agent-list.ts — 纯函数: 合并"用户池(磁盘)+ feature(内存)"为 agent 列表视图
//
// agents:list 取数逻辑抽出为纯函数,便于单测。user agent 可编辑(有 dirPath,readonly=false);
// feature agent 只读(内存注册无 dirPath,readonly=true)。用户 fork(同 id)优先 → 过滤重复,
// 与 AgentManager.init 的 fork-override 注册顺序保持一致。
//
// 允许依赖: shared 类型
// 禁止依赖: electron / 业务

import type { AgentEntry, AgentProfile } from '@shared/types/agent'

export interface AgentListItem {
  id: string
  name: string
  description: string
  status: 'disabled' | 'ready' | 'dependency_missing' | 'running'
  lastUsedAt?: string
  dirPath: string | null
  /** true = 内置 Feature agent(内存注册,只读,不可编辑/删除)。 */
  readonly: boolean
}

/**
 * 合并用户池 agent(磁盘 loader entry)与 feature agent(内存 profile)。
 * feature agent 排在前(官方内置);用户在用户池放同 id 副本(fork)时该 feature 版被过滤,
 * 只留可编辑的用户版 —— 与运行时 fork-override 一致。
 */
export function buildAgentList(
  userEntries: AgentEntry[],
  featureProfiles: AgentProfile[],
): AgentListItem[] {
  const userAgents: AgentListItem[] = userEntries.map((e) => ({
    id: e.profile.id,
    name: e.profile.name,
    description: e.profile.description,
    status: e.status,
    lastUsedAt: e.lastUsedAt,
    dirPath: e.dirPath,
    readonly: false,
  }))
  const userIds = new Set(userAgents.map((a) => a.id))
  const featureAgents: AgentListItem[] = featureProfiles
    .filter((p) => !userIds.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      status: 'ready',
      lastUsedAt: undefined,
      dirPath: null,
      readonly: true,
    }))
  return [...featureAgents, ...userAgents]
}

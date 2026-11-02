// src/main/runtime/children.ts — 业务层：运行树投影（根运行 → 本会话，子孙运行 → 子会话）
//
// 订阅时带 children: true，父订阅者会收到全部子孙运行的事件，按 run.runId 分派：根运行交给 P1-B 的
// createProjection；子运行在它的 run_started 时建一个子会话（沿用旧路径子会话的 sessions 行：
// parent_session_id、parent_message_id、status running → completed | aborted），任务正文写成 user 行，
// 之后的事件交给一个回调全空的 createProjection 落到子会话；run_ended 时写终态与本运行自己的用量。
// 子孙运行不触发任何渲染端回调（与旧路径子 loop 一致）；子会话出错只记日志，不影响父会话。
//
// 允许依赖: agent-engine（类型）、chat/types（类型）、repos/session-repo、runtime/projection、
//          runtime/models、@shared/types、electron-log、uuid
// 禁止依赖: ipc/*、db/*

import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import type { BlobRef, NormalizedUsage, RunEvent, RunResult, RunUsage } from 'agent-engine'
import type { AgentProfile } from '@shared/types/agent'
import type { ChatCallbacks } from '../chat/types'
import { messageRepo, sessionRepo } from '../repos/session-repo'
import { parseModelRef } from './models'
import { addSessionUsage, createProjection, usageRemainder, type Projection } from './projection'

const TITLE_TASK_CHARS = 40

const SILENT: ChatCallbacks = {
  onTextDelta: () => undefined,
  onToolCall: () => undefined,
  onToolResult: () => undefined,
  onMessagePersisted: () => undefined,
  onDone: () => undefined,
}

/** 子会话标题，与旧路径 makeTitle 同格式。 */
export function childTitleOf(name: string, task: string): string {
  const head = task.slice(0, TITLE_TASK_CHARS)
  return `${name}: ${head}${task.length > TITLE_TASK_CHARS ? '...' : ''}`
}

export function childSessionStatusOf(status: RunResult['status']): 'completed' | 'aborted' {
  return status === 'failed' || status === 'aborted' ? 'aborted' : 'completed'
}

/** 本运行自己的用量：总量减子运行。 */
export function ownUsageOf(usage: RunUsage): {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
} {
  const own = (total: number, children: number) => Math.max(0, total - children)
  return {
    inputTokens: own(usage.input, usage.children.input),
    outputTokens: own(usage.output, usage.children.output),
    cacheReadTokens: own(usage.cacheRead, usage.children.cacheRead),
    cacheWriteTokens: own(usage.cacheWrite, usage.children.cacheWrite),
  }
}

/** 本运行自己的用量（引擎用量形状），供补余数。 */
export function ownNormalizedUsage(usage: RunUsage): NormalizedUsage {
  const own = ownUsageOf(usage)
  return {
    input: own.inputTokens,
    output: own.outputTokens,
    cacheRead: own.cacheReadTokens,
    cacheWrite: own.cacheWriteTokens,
  }
}

const textOf = (blob: string | Uint8Array) =>
  typeof blob === 'string' ? blob : Buffer.from(blob).toString('utf8')

interface ChildEntry {
  opened: Promise<void>
  chain: Promise<void>
  sessionId?: string
  projection?: Projection
}

export function createRunTreeProjection(opts: {
  sessionId: string
  /** 根运行 id（本轮 messageId）。 */
  messageId: string
  agentId: string
  callbacks: ChatCallbacks
  getBlob(ref: BlobRef): Promise<string | Uint8Array>
  profileOf(engineAgentId: string): AgentProfile | undefined
}): Projection {
  const { sessionId, messageId, getBlob } = opts
  const root = createProjection({
    sessionId,
    messageId,
    agentId: opts.agentId,
    callbacks: opts.callbacks,
    getBlob,
  })
  const sessionOfRun = new Map<string, string>([[messageId, sessionId]])
  const children = new Map<string, ChildEntry>()

  async function taskTextOf(e: Extract<RunEvent, { t: 'run_started' }>): Promise<string> {
    if (e.task.content) {
      try {
        const body = JSON.parse(textOf(await getBlob(e.task.content))) as {
          input?: Array<{ parts?: Array<{ type: string; text?: string }> }>
        }
        const texts = (body.input ?? []).flatMap((m) =>
          (m.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text ?? ''),
        )
        if (texts.length > 0) return texts.join('\n')
      } catch (error) {
        log.warn('[children] 读不到任务正文，改用 goal', error)
      }
    }
    return e.task.goal ?? ''
  }

  async function openChild(
    entry: ChildEntry,
    e: Extract<RunEvent, { t: 'run_started' }>,
    runId: string,
  ): Promise<void> {
    await children.get(e.parentRunId ?? '')?.opened
    const parentSessionId = sessionOfRun.get(e.parentRunId ?? '')
    if (!parentSessionId) {
      log.warn(`[children] 找不到父运行 ${e.parentRunId ?? '(无)'} 的会话，丢弃运行 ${runId}`)
      return
    }
    try {
      const parent = sessionRepo.getById(parentSessionId)
      const profile = opts.profileOf(e.agent.id)
      const agentId = profile?.id ?? e.agent.id
      const name = profile?.name ?? agentId
      const ref = parseModelRef(e.model)
      const task = await taskTextOf(e)
      const workspace = e.task.scope?.workspace ?? parent?.workspace
      const modelId = ref?.modelId ?? parent?.model_id
      const child = sessionRepo.create({
        title: childTitleOf(name, task),
        provider_id: ref?.providerId ?? parent?.provider_id ?? '',
        ...(modelId ? { model_id: modelId } : {}),
        ...(workspace ? { workspace } : {}),
        agent_id: agentId,
        parent_session_id: parentSessionId,
        ...(e.parentRunId ? { parent_message_id: e.parentRunId } : {}),
        status: 'running',
      })
      messageRepo.create({
        id: uuidv4(),
        session_id: child.id,
        role: 'user',
        content: task,
        agent_id: agentId,
        trace_id: runId,
      })
      sessionOfRun.set(runId, child.id)
      entry.sessionId = child.id
      entry.projection = createProjection({
        sessionId: child.id,
        messageId: runId,
        agentId,
        callbacks: SILENT,
        getBlob,
      })
      log.info(
        `[children] child session=${child.id} run=${runId} parent=${parentSessionId} agent=${agentId}`,
      )
    } catch (error) {
      log.error(`[children] 建立运行 ${runId} 的子会话出错`, error)
    }
  }

  async function closeChild(entry: ChildEntry, result: RunResult): Promise<void> {
    if (!entry.sessionId || !entry.projection) return
    await entry.projection.idle()
    sessionRepo.updateStatus(entry.sessionId, childSessionStatusOf(result.status))
    // 子投影已逐步记下用量，这里只补余数
    addSessionUsage(
      entry.sessionId,
      usageRemainder(ownNormalizedUsage(result.usage), entry.projection.recordedUsage()),
    )
    log.info(`[children] child end session=${entry.sessionId} status=${result.status}`)
  }

  const guard = (entry: ChildEntry, what: string, step: () => Promise<void> | void) => {
    entry.chain = entry.chain
      .then(step)
      .catch((error: unknown) =>
        log.error(`[children] 子会话 ${entry.sessionId} 处理 ${what} 出错`, error),
      )
  }

  return {
    subscriber: {
      onEvent(e, run) {
        if (run.runId === messageId) return root.subscriber.onEvent?.(e, run)
        const entry = children.get(run.runId)
        if (!entry) {
          if (e.t !== 'run_started') {
            log.warn(`[children] 运行 ${run.runId} 没有 run_started，丢弃 ${e.t}`)
            return
          }
          const created: ChildEntry = { opened: Promise.resolve(), chain: Promise.resolve() }
          created.opened = openChild(created, e, run.runId)
          created.chain = created.opened
          children.set(run.runId, created)
          return created.chain
        }
        guard(entry, e.t, () => entry.projection?.subscriber.onEvent?.(e, run))
        if (e.t === 'run_ended') guard(entry, e.t, () => closeChild(entry, e.result))
        return entry.chain
      },
      onNotice(n, run) {
        if (run.runId === messageId) root.subscriber.onNotice?.(n, run)
      },
    },
    async idle() {
      await root.idle()
      for (;;) {
        const seen = children.size
        await Promise.all([...children.values()].map((c) => c.chain))
        if (children.size === seen) return
      }
    },
    persistError: () => root.persistError(),
    recordedUsage: () => root.recordedUsage(),
  }
}

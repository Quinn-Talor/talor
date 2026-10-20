// src/main/observe/trace-invariants.ts —— 业务层: Turn trace 完整性校验
//
// 用不变量证明 trace 没有漏记(集成测试与排查时调用,只读不写):
//   I1  每个落库的 tool-call 都有同 tool_call_id 的 TOOL observation,反之亦然
//       (SDK_TOOL_MISSING_RESULT 占位的调用除外——它从未真正执行)
//   I3  trace 期间写入这些 session 的消息都带 trace_id
//   I4  observation 全部已结束;父节点存在于本 trace;子节点时间落在父节点区间内(EVENT 除外)
//
// 允许依赖: ../repos/*, electron-log
// 禁止依赖: ipc/*

import log from 'electron-log'
import { traceRepo } from '../repos/trace-repo'
import { messageRepo, type ChatMessage } from '../repos/session-repo'

export interface TraceInvariantViolation {
  code:
    | 'I0_TRACE_MISSING'
    | 'I1_TOOL_CALL_UNMATCHED'
    | 'I3_MESSAGE_WITHOUT_TRACE'
    | 'I4_OPEN_OBSERVATION'
    | 'I4_PARENT_MISSING'
    | 'I4_CHILD_OUTSIDE_PARENT'
  detail: string
}

const MISSING_RESULT_CODE = 'SDK_TOOL_MISSING_RESULT'

function parseParts(m: ChatMessage): Array<Record<string, unknown>> {
  try {
    const v: unknown = JSON.parse(m.content)
    return Array.isArray(v)
      ? v.filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
      : []
  } catch (err) {
    // messageRepo 总是写 JSON;解析失败说明数据异常,记 warn 后按"无工具调用"处理
    log.warn('[TraceInvariants] message content is not JSON:', m.id, err)
    return []
  }
}

function toolCallIdsFromMessages(messages: ChatMessage[]): Set<string> {
  const called = new Set<string>()
  const excused = new Set<string>()
  for (const m of messages) {
    for (const part of parseParts(m)) {
      if (typeof part.toolCallId !== 'string') continue
      if (m.role === 'assistant' && part.type === 'tool-call') called.add(part.toolCallId)
      if (
        m.role === 'tool' &&
        part.type === 'tool-result' &&
        JSON.stringify(part.output ?? null).includes(MISSING_RESULT_CODE)
      ) {
        excused.add(part.toolCallId)
      }
    }
  }
  for (const id of excused) called.delete(id)
  return called
}

export function verifyTraceInvariants(
  traceId: string,
  sessionIds: string[],
): TraceInvariantViolation[] {
  const trace = traceRepo.getById(traceId)
  if (trace === null) return [{ code: 'I0_TRACE_MISSING', detail: traceId }]
  const violations: TraceInvariantViolation[] = []
  const observations = traceRepo.listObservations(traceId)

  // I1
  const called = toolCallIdsFromMessages(messageRepo.listByTrace(traceId))
  const observed = new Set<string>()
  for (const o of observations) {
    if (o.type === 'TOOL' && typeof o.metadata.tool_call_id === 'string') {
      observed.add(o.metadata.tool_call_id)
    }
  }
  for (const id of called) {
    if (!observed.has(id)) violations.push({ code: 'I1_TOOL_CALL_UNMATCHED', detail: id })
  }
  for (const id of observed) {
    if (!called.has(id)) violations.push({ code: 'I1_TOOL_CALL_UNMATCHED', detail: id })
  }

  // I3
  for (const sessionId of sessionIds) {
    for (const m of messageRepo.listBySession(sessionId)) {
      if (m.created_at >= trace.timestamp && m.trace_id === undefined) {
        violations.push({ code: 'I3_MESSAGE_WITHOUT_TRACE', detail: m.id })
      }
    }
  }

  // I4
  const byId = new Map(observations.map((o) => [o.id, o]))
  for (const o of observations) {
    if (o.end_time === null) violations.push({ code: 'I4_OPEN_OBSERVATION', detail: o.id })
    if (o.parent_observation_id === null) continue
    const parent = byId.get(o.parent_observation_id)
    if (!parent) {
      violations.push({ code: 'I4_PARENT_MISSING', detail: o.id })
      continue
    }
    if (o.type === 'EVENT') continue
    const startsEarly = o.start_time < parent.start_time
    const endsLate = o.end_time !== null && parent.end_time !== null && o.end_time > parent.end_time
    if (startsEarly || endsLate) {
      violations.push({ code: 'I4_CHILD_OUTSIDE_PARENT', detail: o.id })
    }
  }
  return violations
}

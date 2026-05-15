// src/main/loop/reflect/tool-outputs.ts —— 业务层: 从 session history 抽取最近 tool result
//
// 用于 quote-correction / 未来其他需要原始 tool 数据的 reflector。
// 从后往前扫 session messages, 取 role='tool' 的 content 中 tool_result block 的 output。
// 跟 forced-summary.ts 内部的 collectRecentToolOutputs 同源逻辑, 抽出来给跨模块复用。
//
// 允许依赖: ../../repos/session-repo
// 禁止依赖: ipc/*

import { messageRepo } from '../../repos/session-repo'

export function collectRecentToolOutputs(sessionId: string, k: number): string[] {
  const all = messageRepo.listBySession(sessionId)
  const outputs: string[] = []
  for (let i = all.length - 1; i >= 0 && outputs.length < k; i--) {
    if (all[i].role !== 'tool') continue
    try {
      const blocks = JSON.parse(all[i].content) as Array<{ type: string; output?: string }>
      for (const b of blocks) {
        if (b.type === 'tool_result' && typeof b.output === 'string' && b.output.length > 0) {
          outputs.push(b.output)
          if (outputs.length >= k) break
        }
      }
    } catch {
      // 非 blocks 格式的旧消息, 跳过
    }
  }
  return outputs
}

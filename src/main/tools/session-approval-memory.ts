// src/main/tools/session-approval-memory.ts —— 业务层: Session 级批准记忆
//
// L3 Risk Gate 的辅助状态: 用户在 confirmTool UI 上勾"Remember for session" 时,
// 记下 pattern key, 下次同 patternKey 自动通过。
//
// V1 设计:
//   - 进程内存,不持久化 (重启 = 重新批准)
//   - session 删除时 clear (sessionRepo.delete 联动)
//   - patternKey 是 LLM 通过 pending_confirm.pattern 字段生成的字符串,
//     代码侧做简单字符串相等匹配,不做模式匹配/通配/正则
//
// 允许依赖: 无
// 禁止依赖: ipc/*

export class SessionApprovalMemory {
  private approved = new Map<string, Set<string>>()

  /**
   * 记一个 patternKey 已被用户批准。重复 approve 同 key 不会出错(幂等)。
   */
  approve(sessionId: string, patternKey: string): void {
    let set = this.approved.get(sessionId)
    if (!set) {
      set = new Set<string>()
      this.approved.set(sessionId, set)
    }
    set.add(patternKey)
  }

  /**
   * 查询 patternKey 是否已批准。
   * Empty/falsy patternKey → 永远返 false (不允许空 key 命中)。
   */
  isApproved(sessionId: string, patternKey: string): boolean {
    if (!patternKey) return false
    return this.approved.get(sessionId)?.has(patternKey) ?? false
  }

  /** Session 删除时清理。 */
  clear(sessionId: string): void {
    this.approved.delete(sessionId)
  }

  /** 测试 / 调试用: 列出某 session 已批准的所有 pattern。 */
  listApproved(sessionId: string): string[] {
    return Array.from(this.approved.get(sessionId) ?? [])
  }
}

/** 单例 (与其他业务层一致)。 */
export const sessionApprovalMemory = new SessionApprovalMemory()

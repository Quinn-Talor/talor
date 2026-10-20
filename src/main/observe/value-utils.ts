// src/main/observe/value-utils.ts —— 基础设施: 观测代码共用的值判定小工具
//
// trace-recorder 与 LLM 观测中间件都要处理 unknown 形状的 payload / 异常,集中在此避免各写一份。
//
// 允许依赖: 无
// 禁止依赖: src/main 下任何模块

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

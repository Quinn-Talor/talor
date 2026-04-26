// src/main/ipc/error-codes.ts —— 入口层：IPC 协议错误码
//
// 职责：把底层异常对象映射为前端可识别的枚举 code，供 UI 做差异化提示。
// 纯字符串 / 类型匹配，不做业务判断。
//
// 允许依赖：（无外部依赖）
// 禁止依赖：业务层代码

/**
 * 向前端暴露的错误枚举。新增码时保持稳定命名，前端按字面量匹配做文案/重试策略。
 */
export type ChatErrorCode =
  | 'LLM_CONNECTION_FAILED'   // 网络不通（fetch / ECONNREFUSED / ENOTFOUND）
  | 'AUTH_FAILED'             // 401 / 403 / API key 无效
  | 'RATE_LIMITED'            // 429 / rate limit / too many requests
  | 'LLM_ERROR'               // 兜底：未分类的 LLM 错误
  | 'LLM_TIMEOUT'             // AbortError / TimeoutError（含流超时和用户中止）
  | 'FILE_TOO_LARGE'          // 附件大小超限（50MB）
  | 'UNSUPPORTED_FILE_TYPE'   // 附件 mime 不在白名单
  | 'FILE_NOT_FOUND'          // 附件路径不存在
  | 'NETWORK_OFFLINE'         // 预留：离线检测（当前未使用）
  | 'PROVIDER_NO_VISION'      // provider 不支持视觉但用户上传了图片

/**
 * 把任意异常对象映射为 ChatErrorCode。
 *
 * 匹配优先级（从上到下，首次命中即返回）：
 *   1. AbortError / TimeoutError  → LLM_TIMEOUT
 *   2. 网络关键词（fetch / ECONNREFUSED / ENOTFOUND）→ LLM_CONNECTION_FAILED
 *   3. 限流关键词（429 / rate limit / too many requests）→ RATE_LIMITED
 *   4. 鉴权关键词（401 / 403 / API key）→ AUTH_FAILED
 *   5. 预定义业务错误消息原样透传（FILE_TOO_LARGE / UNSUPPORTED_FILE_TYPE /
 *      FILE_NOT_FOUND / PROVIDER_NO_VISION）——业务层抛 Error(code) 时直接命中
 *   6. 其余 → LLM_ERROR
 *
 * 注：AbortError 无论来自用户停止还是 120s 流超时，都归入 LLM_TIMEOUT。
 * 调用方若需区分，需在上游捕获时携带 signal 来源信息。
 */
export function classifyLlmError(error: unknown): ChatErrorCode {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'LLM_TIMEOUT'
  }
  const msg = error instanceof Error ? error.message : String(error)
  if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    return 'LLM_CONNECTION_FAILED'
  }
  if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
    return 'RATE_LIMITED'
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('API key')) {
    return 'AUTH_FAILED'
  }
  if (msg === 'FILE_TOO_LARGE') return 'FILE_TOO_LARGE'
  if (msg === 'UNSUPPORTED_FILE_TYPE') return 'UNSUPPORTED_FILE_TYPE'
  if (msg === 'FILE_NOT_FOUND') return 'FILE_NOT_FOUND'
  if (msg === 'PROVIDER_NO_VISION') return 'PROVIDER_NO_VISION'
  return 'LLM_ERROR'
}

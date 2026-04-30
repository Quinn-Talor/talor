// src/main/tools/schema-check.ts — 工具层: 轻量 JSON Schema 子集校验
//
// 覆盖 type / enum / pattern / minLength / maxLength / minimum / maximum,
// 对 parameters.properties 里**所有声明的字段**生效(不只是 required)。
// 旧的 validateRequiredFields 仅检查 required 字段类型,可选字段传错类型会 silent fail——
// 这里把口子堵住。
//
// 复杂嵌套(array of object / nested object 的深度校验)不在此范围,留给 tool.validate 处理。
// 这里只兜最常见、最容易被模型猜错的情况:MCP 工具的 enum 和基础类型。
//
// 返回值约定:
//   - 无错误 → null
//   - 有错误 → 诊断消息字符串(调用方 registry 会直接作为 output 返回)
//     消息以 "Invalid value for " / "Invalid type for " / `"xxx" on "yyy" ` 开头,
//     与 stream-utils.ERROR_OUTPUT_PATTERNS 对齐,保证 isError 能命中。

export interface SchemaProp {
  type?: string
  enum?: unknown[]
  pattern?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
}

export interface SchemaParams {
  type?: string
  required?: string[]
  properties?: Record<string, SchemaProp>
}

export function checkSchema(
  toolName: string,
  params: SchemaParams,
  input: unknown,
): string | null {
  if (!params.properties) return null
  const obj = (input && typeof input === 'object') ? (input as Record<string, unknown>) : {}

  for (const [field, spec] of Object.entries(params.properties)) {
    const val = obj[field]
    // 缺失字段由 validateRequiredFields 先处理;这里只检查已提供的值。
    if (val === undefined || val === null) continue

    // ── type ─────────────────────────────────────────────────────────
    if (spec.type === 'array') {
      if (!Array.isArray(val)) {
        return `Invalid type for "${field}" on tool "${toolName}": expected array, got ${typeof val}.`
      }
    } else if (spec.type === 'integer') {
      if (typeof val !== 'number' || !Number.isInteger(val)) {
        return `Invalid type for "${field}" on tool "${toolName}": expected integer, got ${typeof val === 'number' ? 'non-integer number' : typeof val}.`
      }
    } else if (spec.type && typeof val !== spec.type) {
      return `Invalid type for "${field}" on tool "${toolName}": expected ${spec.type}, got ${typeof val}. Value: ${safeJson(val).slice(0, 100)}`
    }

    // ── enum ─────────────────────────────────────────────────────────
    if (spec.enum && spec.enum.length > 0 && !spec.enum.includes(val)) {
      const allowed = spec.enum.map(e => JSON.stringify(e)).join(', ')
      return `Invalid value for "${field}" on tool "${toolName}": ${safeJson(val).slice(0, 50)} is not in enum [${allowed}].`
    }

    // ── string constraints ──────────────────────────────────────────
    if (typeof val === 'string') {
      if (spec.minLength !== undefined && val.length < spec.minLength) {
        return `"${field}" on "${toolName}" too short: ${val.length} < min ${spec.minLength}.`
      }
      if (spec.maxLength !== undefined && val.length > spec.maxLength) {
        return `"${field}" on "${toolName}" too long: ${val.length} > max ${spec.maxLength}.`
      }
      if (spec.pattern) {
        try {
          if (!new RegExp(spec.pattern).test(val)) {
            return `"${field}" on "${toolName}" does not match pattern /${spec.pattern}/.`
          }
        } catch {
          // schema 里写了非法 regex,跳过以免误伤。
        }
      }
    }

    // ── number constraints ──────────────────────────────────────────
    if (typeof val === 'number') {
      if (spec.minimum !== undefined && val < spec.minimum) {
        return `"${field}" on "${toolName}" too small: ${val} < min ${spec.minimum}.`
      }
      if (spec.maximum !== undefined && val > spec.maximum) {
        return `"${field}" on "${toolName}" too large: ${val} > max ${spec.maximum}.`
      }
    }
  }
  return null
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

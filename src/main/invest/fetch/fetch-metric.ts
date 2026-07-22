// src/main/invest/fetch/fetch-metric.ts —— 业务层: 单权威机构源取数(有序试通道→抽值→sanity→盖 provenance)
//
// 金融 MCP 优先(未装休眠)→ 东财 datacenter(镜像交易所/巨潮官方定期报/行情)。取第一个成功即用(非交叉)。
// value 程序化抽字段、as_of 从报告期派生 —— 不经 LLM。取不到/越界 → 信封(不编造)。
//
// 允许依赖: zod / shared/types / ../../tools/types / ./registry
// 禁止依赖: ipc/* / mcp/* / electron(fetchJson/callMcp 由外部注入,realFetchJson 用全局 fetch)
import { z } from 'zod'
import type { FactObservation } from '../../../shared/types/invest'
import type { ToolDefinition, ToolErrorEnvelope } from '../../tools/types'
import { getMetricSource, type Channel, type SanityRange } from './registry'

export type FetchJson = (url: string, headers?: Record<string, string>) => Promise<unknown>
export type CallMcp = (tool: string, args: Record<string, unknown>) => Promise<unknown>
export interface FetchDeps {
  fetchJson?: FetchJson
  callMcp?: CallMcp
  clock?: () => Date
}
export interface FetchMetricArgs {
  code: string
  metric_key: string
}

function envelope(code: string, message: string): ToolErrorEnvelope {
  return { __talor_error: true, code, message }
}
function isSane(sanity: SanityRange | undefined, v: number): boolean {
  if (!sanity) return true
  if (sanity.min != null && v < sanity.min) return false
  if (sanity.max != null && v > sanity.max) return false
  return true
}
function normCode(code: string): string {
  return code.replace(/\.(sh|sz|bj)$/i, '').trim()
}
/** code → 东财 secid 前缀 / SECUCODE 后缀。6*=沪 / 0*3*=深 / 8*4*=北(secid [待核实])。 */
function exchangeOf(code: string): { secidPrefix: '0' | '1'; suffix: 'SH' | 'SZ' | 'BJ' } | null {
  const c = normCode(code)
  if (/^6/.test(c)) return { secidPrefix: '1', suffix: 'SH' }
  if (/^[03]/.test(c)) return { secidPrefix: '0', suffix: 'SZ' }
  if (/^[84]/.test(c)) return { secidPrefix: '0', suffix: 'BJ' }
  return null
}
/** "2026-03-31 00:00:00" → "2026-03";无法解析原样返回。 */
function normAsOf(raw: unknown): string {
  const s = String(raw ?? '')
  const m = s.match(/^(\d{4})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}` : s
}
function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => {
    if (o == null || typeof o !== 'object') return undefined
    return (o as Record<string, unknown>)[k]
  }, obj)
}

/** 调一个通道 → {value,asOf,field} | null(跳过:mcp 未注入 / 网络失败 / 空 / 非有限数)。 */
async function callChannel(
  ch: Channel,
  code: string,
  deps: FetchDeps,
): Promise<{ value: number; asOf: string; field?: string } | null> {
  const clock = deps.clock ?? ((): Date => new Date())
  const ex = exchangeOf(code)
  try {
    if (ch.kind === 'mcp') {
      if (!deps.callMcp) return null // 未装 → 跳过(回落 json)
      const resp = await deps.callMcp(ch.tool, { code })
      const value = Number(getPath(resp, ch.valueField))
      if (!Number.isFinite(value)) return null
      const asOf = ch.asOfField
        ? normAsOf(getPath(resp, ch.asOfField))
        : clock().toISOString().slice(0, 10)
      return { value, asOf, field: ch.valueField }
    }
    if (!deps.fetchJson) return null
    if (ch.vendor === 'eastmoney-quote') {
      if (!ex) return null
      const secid = `${ex.secidPrefix}.${normCode(code)}`
      // push2 拒绝单字段请求(fields=f43 → 空);须 ≥2 字段,故附带 f58(名称)伴随字段。
      const resp = await deps.fetchJson(
        `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=${ch.valueField},f58`,
      )
      const raw = Number(getPath(resp, `data.${ch.valueField}`))
      if (!Number.isFinite(raw)) return null
      return {
        value: raw * ch.scale,
        asOf: clock().toISOString().slice(0, 10),
        field: ch.valueField,
      }
    }
    // eastmoney-report
    if (!ex) return null
    const secucode = `${normCode(code)}.${ex.suffix}`
    const cols = ['SECUCODE', ch.asOfField, ch.valueField].join(',')
    const filter = encodeURIComponent(`(SECUCODE="${secucode}")`)
    const resp = await deps.fetchJson(
      `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${ch.reportName}` +
        `&columns=${cols}&filter=${filter}&sortColumns=REPORT_DATE&sortTypes=-1&pageSize=1`,
    )
    const rows = getPath(resp, 'result.data')
    if (!Array.isArray(rows) || rows.length === 0) return null
    const row = rows[0] as Record<string, unknown>
    const value = Number(row[ch.valueField])
    if (!Number.isFinite(value)) return null
    return { value, asOf: normAsOf(row[ch.asOfField]), field: ch.valueField }
  } catch {
    return null // 网络/解析失败 → 跳过
  }
}

/** 取数核心:有序试通道(MCP 优先)→ 第一个成功 → sanity → 盖 provenance;失败→信封。 */
export async function fetchMetric(
  args: FetchMetricArgs,
  deps: FetchDeps,
): Promise<FactObservation | ToolErrorEnvelope> {
  const clock = deps.clock ?? ((): Date => new Date())
  const source = getMetricSource(args.metric_key)
  if (!source) {
    return envelope(
      'METRIC_UNAVAILABLE',
      `metric_key「${args.metric_key}」无取数映射(行业特殊/软信息走检索 + manual)`,
    )
  }
  let hit: { value: number; asOf: string; field?: string; ch: Channel } | null = null
  let sawValue = false
  for (const ch of source.channels) {
    const r = await callChannel(ch, args.code, deps)
    if (r) {
      sawValue = true
      if (isSane(source.sanity, r.value)) {
        hit = { ...r, ch }
        break
      }
    }
  }
  if (!hit) {
    if (sawValue) {
      return envelope(
        'METRIC_VALUE_INSANE',
        `metric_key「${args.metric_key}」取到值越 sanity 界(疑取错字段/源故障),已剔除`,
      )
    }
    return envelope(
      'METRIC_UNAVAILABLE',
      `metric_key「${args.metric_key}」全通道不可达或空(${args.code})`,
    )
  }
  const ch = hit.ch
  const channel = ch.kind === 'mcp' ? `mcp:${ch.tool}` : 'json:eastmoney'
  const official = ch.official_source
  return {
    value: hit.value,
    as_of: hit.asOf,
    source: official,
    tier: ch.tier,
    provenance: {
      method: 'fetch',
      channel,
      official_source: official,
      params: { code: args.code, metric_key: args.metric_key },
      field: hit.field,
      retrieved_at: clock().toISOString(),
    },
  }
}

/** 真 fetchJson(全局 fetch;默认注入,测试 mock)。非 200 抛错 → 上层跳过该通道。 */
export async function realFetchJson(
  url: string,
  headers?: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const FetchMetricZ = z.object({
  code: z.string().describe('股票代码(如 002594 / 600519)'),
  metric_key: z
    .string()
    .describe('指标 key(rev_yoy/eps/bvps/roe/gross_margin/price;行业特殊/软信息走检索)'),
})

/** fetch_metric 工具:薄包 fetchMetric。返回观测供 PM 组装 Fact 后 add_facts;取不到返信封。 */
export function createFetchMetricTool(deps: FetchDeps): ToolDefinition {
  return {
    name: 'fetch_metric',
    description:
      '从权威机构源取一个指标的当期值(金融 MCP 优先;无 MCP 则东财 datacenter 镜像官方定期报/行情)。' +
      '程序化抽字段值 + 报告期(非记忆),盖 provenance;返回观测 {value,as_of,source,tier,provenance},' +
      '你据此组装 Fact(补 level/label/unit/role)后 add_facts。取不到返 METRIC_UNAVAILABLE(勿编造)。',
    zodSchema: FetchMetricZ,
    parameters: z.toJSONSchema(FetchMetricZ) as Record<string, unknown>,
    async execute(input) {
      return { output: await fetchMetric(input as FetchMetricArgs, deps) }
    },
  }
}

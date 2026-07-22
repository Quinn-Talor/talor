// src/main/invest/fetch/registry.ts —— 业务层: 取数映射(metric_key → 有序多通道 + sanity)
//
// 通道顺序 = 回落优先级(MCP 先,东财 json 次);fetch_metric 取第一个成功即用(非交叉)。
// 字段实证:fact-keys.md §六 + live 探测(2026-07-22 002594)。mcp 通道未装休眠,字段名 [待核实]。
//
// 允许依赖: shared/types    禁止依赖: ipc/* / mcp/* / electron
import type { Cadence } from '../../../shared/types/invest'

export interface SanityRange {
  min?: number
  max?: number
}
/** 金融 MCP 通道(未装休眠;valueField 为占位,tushare 装机后按其 schema 校准)。 */
export interface McpChannel {
  kind: 'mcp'
  tool: string
  valueField: string
  asOfField?: string
  tier: 'T1'
  official_source: string // 终极官方来源(须过 addFacts 白名单)
}
/** 东财主要财务指标(datacenter RPT_F10;镜像交易所/巨潮定期报告)。 */
export interface JsonReportChannel {
  kind: 'json'
  vendor: 'eastmoney-report'
  reportName: string
  valueField: string
  asOfField: string
  tier: 'T2'
  official_source: string
}
/** 东财实时行情(push2;f43÷100=price)。 */
export interface JsonQuoteChannel {
  kind: 'json'
  vendor: 'eastmoney-quote'
  valueField: string
  scale: number
  tier: 'T2'
  official_source: string
}
export type Channel = McpChannel | JsonReportChannel | JsonQuoteChannel
export interface MetricSource {
  cadence: Cadence
  sanity?: SanityRange
  channels: Channel[]
}

const REPORT = 'RPT_F10_FINANCE_MAINFINADATA'

/** 主要财务指标 metric:MCP(休眠)优先 → 东财 RPT_F10。valueField=东财字段(实证)。 */
function reportMetric(
  eastmoneyField: string,
  sanity: SanityRange,
  cadence: Cadence = 'quarterly',
): MetricSource {
  return {
    cadence,
    sanity,
    channels: [
      // [待核实:tushare 装机后按其 schema 校准 valueField/asOfField]
      {
        kind: 'mcp',
        tool: 'financial.report',
        valueField: eastmoneyField,
        asOfField: 'end_date',
        tier: 'T1',
        official_source: '定期报告',
      },
      {
        kind: 'json',
        vendor: 'eastmoney-report',
        reportName: REPORT,
        valueField: eastmoneyField,
        asOfField: 'REPORT_DATE',
        tier: 'T2',
        official_source: '定期报告',
      },
    ],
  }
}

// 通用核心财务骨架(东财字段实证于 fact-keys §六)+ 实时价(push2 f43)。
const REGISTRY: Record<string, MetricSource> = {
  rev_yoy: reportMetric('TOTALOPERATEREVETZ', { min: -100, max: 2000 }),
  eps: reportMetric('EPSJB', { min: -1000, max: 1000 }),
  bvps: reportMetric('BPS', { min: -1000, max: 100000 }),
  roe: reportMetric('ROEJQ', { min: -200, max: 200 }),
  gross_margin: reportMetric('XSMLL', { min: -100, max: 100 }),
  price: {
    cadence: 'daily',
    sanity: { min: 0 },
    channels: [
      {
        kind: 'mcp',
        tool: 'financial.quote',
        valueField: 'price',
        tier: 'T1',
        official_source: '交易所行情',
      },
      {
        kind: 'json',
        vendor: 'eastmoney-quote',
        valueField: 'f43',
        scale: 0.01,
        tier: 'T2',
        official_source: '交易所行情',
      },
    ],
  },
}

/** metric_key → 取数源;未映射(行业特殊/软信息)返 null(agent 走检索 + manual)。 */
export function getMetricSource(key: string): MetricSource | null {
  return REGISTRY[key] ?? null
}

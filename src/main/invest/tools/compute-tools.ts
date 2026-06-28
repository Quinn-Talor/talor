// src/main/invest/tools/compute-tools.ts —— 业务层: 14 个 compute_* builtin 工具(薄包 invest_lib)
//
// 把 invest_lib 纯函数逐个暴露成 ToolDefinition,供投研 agent 拿到 MCP 数据后调用。
// 计算逻辑(阈值/公式)在 invest_lib(代码)里,LLM 只传数据值。mvp-design §8.2。
// per-agent 注入(ToolRegistry.agentTools),不进全局 builtin(范式 createSearchTool)。
//
// 允许依赖: ../compute/* / zod / ../../tools/types
// 禁止依赖: ipc/* / repos/* / mcp/*

import { z } from 'zod'
import type { ToolDefinition } from '../../tools/types'
import {
  computeRedFlags,
  computePercentile,
  reverseDcf,
  computeTrend,
  checkFalsification,
  crossCheck,
  computeValuation,
  computeIndustryScore,
  computeMacroClock,
  computeDupont,
  computeProjection,
  computeDecision,
  computeTurnover,
  computeGate,
} from '../compute'

function jsonSchema(s: z.ZodTypeAny): Record<string, unknown> {
  return z.toJSONSchema(s) as Record<string, unknown>
}

const RedFlagsInput = z.object({
  ocf: z.number(),
  net_income: z.number(),
  deducted_ni_history: z.array(z.number()),
  rev_yoy: z.number(),
  ar_yoy: z.number(),
  inv_yoy: z.number(),
  goodwill: z.number(),
  equity: z.number(),
  interest_debt: z.number(),
  total_assets: z.number(),
  cash: z.number(),
  audit_nonstandard: z.boolean(),
})

const PercentileInput = z.object({
  series: z.array(z.number()).describe('历史序列(可含 NaN,自动忽略)'),
  current: z.number().describe('当前值'),
})

const ReverseDcfInputZ = z.object({
  price: z.number(),
  eps: z.number(),
  exitPe: z.number(),
  horizonYears: z.number(),
  discount: z.number(),
  reasonableMaxGrowth: z.number().optional(),
})

const TrendInput = z.object({
  series: z.array(z.number()).describe('时间序列(老→新, 末值=current)'),
  windows: z.array(z.number()).describe('回溯步数, 如 [5,10,30,60] 或 [1,4]'),
})

const FalsificationInput = z.object({
  rule: z.object({
    metric: z.string(),
    op: z.enum(['<', '>', '<=', '>=', '==']),
    value: z.number(),
    persistence: z.number(),
  }),
  series: z.array(z.number()).describe('该 metric 时间序列(新→旧)'),
})

const CrossCheckInput = z.object({
  values: z.array(z.object({ value: z.number(), source: z.string() })),
  tolerance: z.number().describe('相对偏差阈, 如 0.05'),
})

const ValuationInputZ = z.object({
  method: z
    .enum(['pe', 'dcf', 'pb-roe', 'ddm', 'nav'])
    .describe(
      "配业务选模型:'pe' 成长/拐点(eps×pe) / 'dcf' 现金流清晰(终值法) / " +
        "'pb-roe' 重资产·金融(合理PB=(ROE−g)/(r−g)×bvps,或直接 bvps×pb) / " +
        "'ddm' 高分红(戈登 D₁/(r−g)) / 'nav' 资源·控股·地产(navps×(1+premium))",
    ),
  scenarios: z
    .array(
      z.object({
        label: z.string().describe('情景名:悲观/中性/乐观'),
        prob: z.number().describe('概率 0~1'),
        // pe / dcf
        eps: z.number().optional().describe('每股收益(pe + dcf 法用)'),
        pe: z.number().optional().describe('目标 PE(pe 法)'),
        g: z.number().optional().describe('增速/永续增长(dcf/pb-roe/ddm 法)'),
        exitPe: z.number().optional().describe('退出 PE(dcf 法)'),
        horizonYears: z.number().optional().describe('显式期年数(dcf 法)'),
        discount: z.number().optional().describe('折现率/股权成本 r(dcf/pb-roe/ddm 法)'),
        // pb-roe
        bvps: z.number().optional().describe('每股净资产(pb-roe 法)'),
        roe: z.number().optional().describe('可持续 ROE 小数,如 0.18(pb-roe 法)'),
        pb: z.number().optional().describe('目标 PB,给定则跳过 ROE 折算(pb-roe 法)'),
        // ddm
        dps: z.number().optional().describe('当期每股分红(ddm 法)'),
        // nav
        navps: z.number().optional().describe('每股重估净资产(nav 法)'),
        premium: z.number().optional().describe('溢价(+)/折价(−)小数,如 -0.2 = 八折(nav 法)'),
      }),
    )
    .describe('三情景输入(每情景的估值入参 + 概率;按 method 取对应字段)'),
})

const DupontInputZ = z.object({
  net_income: z.number().describe('净利润'),
  revenue: z.number().describe('营业收入'),
  total_assets: z.number().describe('总资产(可用期初期末均值)'),
  equity: z.number().describe('归母净资产'),
})

const ProjectionInputZ = z.object({
  base_revenue: z.number().describe('基期营收'),
  industry_growth_pct: z.number().describe('行业年增速 %(如 15 表示 +15%)'),
  share_delta_pct: z.number().describe('公司份额年变化 %(正=抢份额, 负=丢份额)'),
  net_margin_pct: z.number().describe('净利率 %(如 12 表示 12%)'),
  shares: z.number().describe('总股本(与 base_revenue 同口径)'),
  horizon_years: z.number().optional().describe('预测年数, 默认 1'),
})

const GateInputZ = z.object({
  regime: z.object({
    systemic: z.enum(['normal', 'warning', 'extreme']),
    direction: z.enum(['改善', '持平', '恶化']),
  }),
  riskBounds: z.object({
    marginOfSafety: z.object({ required: z.number(), current: z.number() }),
    veto: z.array(z.object({ rule: z.string(), status: z.enum(['clear', 'triggered']) })),
  }),
})

const TurnoverInputZ = z.object({
  opening: z.number().describe('期初余额(存货/应收)'),
  closing: z.number().describe('期末余额'),
  base: z.number().describe('基数:存货用营业成本、应收用营业收入'),
  days: z.number().optional().describe('天数:年=365(默认)、季=90'),
})

const DecisionInputZ = z.object({
  quality: z
    .enum(['good', 'fair', 'poor'])
    .describe('质地:good=过资格赛+宽护城河 / fair=一般 / poor=没护城河或有瑕疵'),
  valuation_state: z
    .enum(['cheap', 'fair', 'expensive'])
    .describe('估值:由安全边际/反向DCF 给(cheap=有安全边际)'),
  max_loss_pct: z.number().describe('最大可承受亏损 %(到止损位的跌幅, 如 20)'),
  risk_per_trade_pct: z.number().optional().describe('单笔风险预算 %, 默认 2'),
  position_cap_pct: z.number().optional().describe('单标的仓位上限 %, 默认 10'),
})

const IndustryScoreInputZ = z.object({
  demand: z
    .object({ penetration_pct: z.number().optional(), growth_pct: z.number().optional() })
    .optional()
    .describe('需求/空间:渗透率%、行业增速%'),
  supply: z
    .object({
      capacity_util_pct: z.number().optional(),
      capex_phase: z.enum(['clearing', 'restrained', 'expanding', 'overcapacity']).optional(),
    })
    .optional()
    .describe('供给:产能利用率%、资本开支阶段(出清/克制/扩张/过剩)'),
  price_inventory: z
    .object({
      price_trend: z.enum(['up', 'flat', 'down']).optional(),
      inventory: z.enum(['active_restock', 'passive_buildup', 'destock', 'neutral']).optional(),
    })
    .optional()
    .describe('价格/库存:提价/价格战、主动补库/被动累库'),
  structure: z
    .object({
      concentration_trend: z.enum(['rising', 'flat', 'fragmenting']).optional(),
      leader_share_trend: z.enum(['up', 'flat', 'down']).optional(),
    })
    .optional()
    .describe('格局:集中度趋势、龙头份额趋势'),
  policy: z
    .object({ stance: z.enum(['support', 'neutral', 'suppress']).optional() })
    .optional()
    .describe('政策:扶持/中性/集采打压'),
  valuation: z
    .object({ pe_pb_percentile: z.number().optional() })
    .optional()
    .describe('估值:行业 PE/PB 历史分位 0~100'),
})

const MacroClockInputZ = z.object({
  growth: z
    .object({
      pmi: z.number().optional(),
      pmi_trend: z.enum(['up', 'down', 'flat']).optional(),
      gdp_yoy: z.number().optional(),
    })
    .optional()
    .describe('经济增长:PMI(50荣枯线)、GDP'),
  inflation: z
    .object({
      cpi_yoy: z.number().optional(),
      ppi_yoy: z.number().optional(),
      ppi_trend: z.enum(['up', 'down', 'flat']).optional(),
    })
    .optional()
    .describe('通胀:CPI、PPI(PPI 触底回升领先盈利)'),
  liquidity: z
    .object({
      tsf_trend: z.enum(['up', 'down', 'flat']).optional(),
      m2_yoy: z.number().optional(),
      rate: z.enum(['cut', 'hike', 'flat']).optional(),
    })
    .optional()
    .describe('流动性:社融(A股最关键前瞻)、M2、政策利率'),
  policy: z
    .object({ stance: z.enum(['stable_growth', 'neutral', 'risk_control']).optional() })
    .optional()
    .describe('政策:稳增长/中性/防风险'),
  external: z
    .object({
      fed: z.enum(['easing', 'tightening', 'neutral']).optional(),
      northbound: z.enum(['inflow', 'outflow', 'flat']).optional(),
      cny: z.enum(['strong', 'weak', 'flat']).optional(),
    })
    .optional()
    .describe('外部:美联储、北向资金、人民币汇率'),
})

function tool<S extends z.ZodTypeAny>(
  name: string,
  description: string,
  zodSchema: S,
  run: (input: z.infer<S>) => unknown,
): ToolDefinition {
  return {
    name,
    description,
    zodSchema,
    parameters: jsonSchema(zodSchema),
    async execute(input: unknown) {
      return { output: run(input as z.infer<S>) }
    },
  }
}

/** 工厂:返回 14 个 compute_* 工具。无外部依赖,纯计算。 */
export function createComputeTools(): ToolDefinition[] {
  return [
    tool(
      'compute_red_flags',
      '财务排雷:输入归一化财务字段,输出 8 红灯(hit/value/note)。缺失数据→hit=null(不误判)。建卡财务区必调。',
      RedFlagsInput,
      (i) => computeRedFlags(i),
    ),
    tool(
      'compute_percentile',
      '历史分位:序列中 ≤current 的占比(0~1,理杏仁口径)。空序列/NaN→null。用于 PE/PB/股息分位。',
      PercentileInput,
      (i) => computePercentile(i.series, i.current),
    ),
    tool(
      'reverse_dcf',
      '逆向DCF现实性检验:反推当前价隐含的 N 年 EPS 年复合增速 + 是否合理。eps≤0→null。',
      ReverseDcfInputZ,
      (i) => reverseDcf(i),
    ),
    tool(
      'compute_trend',
      '多窗口趋势:每窗口 change/change_pct/direction + 动能 momentum(accelerating/decelerating/reversing/flat)。',
      TrendInput,
      (i) => computeTrend(i.series, i.windows),
    ),
    tool(
      'check_falsification',
      '硬证伪比对:连续 persistence 期满足 op/value 即 triggered(阈破信号)。支点 broken/holding 由 agent 裁定。',
      FalsificationInput,
      (i) => checkFalsification(i.rule, i.series),
    ),
    tool(
      'cross_check',
      '多源可靠性:多源同字段取中位数,相对偏差>tolerance 标存疑。单源→consistent=null。',
      CrossCheckInput,
      (i) => crossCheck(i.values, i.tolerance),
    ),
    tool(
      'compute_macro_clock',
      '宏观美林时钟定位:增长×通胀 → 4 象限(复苏/过热/滞胀/衰退)+ 权益态度(重配/标配/回避)+ 利好资产 + suggested_systemic(供 regime/总仓位联动)。' +
        '流动性/政策/外部做态度微调。宏观季度粗调、驱动总仓位/股债大类,不 micro-gate 个股。缺增长或通胀则定位不出象限。',
      MacroClockInputZ,
      (i) => computeMacroClock(i),
    ),
    tool(
      'compute_industry_score',
      '行业景气 6 维评分(行业层的"8红灯"):需求/供给/价格库存/格局/政策/估值,按好坏信号规则确定性给每维 good/bad/neutral + 汇总景气 up/flat/down。' +
        '数值维(渗透率/增速/产能利用率/估值分位)给数,定性维(资本开支阶段/价格趋势/库存/集中度/政策取向)给枚举。只评提供了输入的维度。',
      IndustryScoreInputZ,
      (i) => computeIndustryScore(i),
    ),
    tool(
      'compute_valuation',
      '正向三情景估值(配业务选模型):pe/dcf/pb-roe/ddm/nav,输出每情景内在价值 + 概率加权期望。' +
        '赚什么钱决定用哪个模型(成长用 PE、现金流清晰用 DCF、重资产金融用 PB-ROE、高分红用 DDM、资源控股用 NAV)。' +
        '与 reverse_dcf 互补(它给市场隐含、本工具给我方价值)。任一情景缺数据/经济上无意义(r≤g)→该情景 null 且期望 null。' +
        '所有参数立足点由你溯源到事实/假设(用 compute_projection 把 EPS 测算出来),数值组合由本工具算。',
      ValuationInputZ,
      (i) => computeValuation(i),
    ),
    tool(
      'compute_projection',
      '自下而上 EPS 测算:营收=基期×(1+行业增速)×(1+份额变化);净利=营收×净利率;EPS=净利/股本。' +
        '多年复合 + eps_cagr。让估值 EPS 闭环到「行业增速/份额/净利率」可验证驱动,而非拍一个 EPS。股本≤0/缺数据→null。',
      ProjectionInputZ,
      (i) => computeProjection(i),
    ),
    tool(
      'compute_dupont',
      '杜邦 ROE 拆解:ROE = 净利率 × 总资产周转率 × 权益乘数,并标主驱动(margin/turnover/leverage)。' +
        '看赚钱质量(高利率 vs 高周转 vs 高杠杆)。分母≤0/缺数据→对应比率 null。支撑命门的 ROE 立足点。',
      DupontInputZ,
      (i) => computeDupont(i),
    ),
    tool(
      'compute_decision',
      '决策硬门(散户纪律外骨骼):质地×估值四象限→好公司好价格(买)/好公司贵(等)/价值陷阱(弃)/远离(弃);' +
        '仓位由最大亏损反推(仓位=风险预算÷止损跌幅,受上限约束)。质地差便宜也不买(避价值陷阱)。max_loss≤0→仓位 null。',
      DecisionInputZ,
      (i) => computeDecision(i),
    ),
    tool(
      'compute_turnover',
      '周转天数:期初期末均值÷基数×天数(存货基数=营业成本、应收基数=营收)。' +
        '周转放缓(天数↑)是先行预警(存货↑+周转↓=滞销;应收↑+DSO↑=收款恶化)。基数≤0/缺数据→null。',
      TurnoverInputZ,
      (i) => computeTurnover(i),
    ),
    tool(
      'compute_gate',
      '系统风险闸(决策硬门,确定性):一票否决/系统性极端→否决;安全边际不足/风向恶化→节流;系统预警→警告;否则通行。' +
        '产出 {state,reason} 填进复查 checkpoint.gate;gate=否决拒建/加、节流拒加。gate 由本工具算,LLM 不自填。',
      GateInputZ,
      (i) => computeGate(i),
    ),
  ]
}

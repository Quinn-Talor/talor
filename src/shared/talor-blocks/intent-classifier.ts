// src/shared/talor-blocks/intent-classifier.ts —— v3.7: 推断 LLM 文本意图
//
// 目标: 当模型没有 emit talor block 也没有 legacy marker 时, UI 仍能用类型化
// 卡片渲染消息(done / need_input / blocked)。
//
// 设计要点:
//   - 多信号加权打分,阈值过滤(避免低置信度强行分类)
//   - 完全纯函数,无副作用,可在 main + renderer 共享
//   - 仅 UI 渲染辅助,不影响 react-loop 控制流(v3.7 第 8 原则:不强制纠正 LLM)
//
// 调用方约定:
//   - 仅当 `parseTalorBlocks(text).blocks` 为空时调用本函数
//   - 模型 emit 显式 block 时,UI 永远优先按 block 渲染(显式 > 推断)

export interface IntentInference {
  /** 推断的意图类型;null 表示置信度低,不应渲染类型化卡片 */
  type: 'done' | 'need_input' | 'blocked' | null
  /** 加权分(供 UI 显示 "low/medium/high confidence" 徽章) */
  confidence: number
  /** 命中的具体信号名(调试 + UI tooltip 用) */
  signals: string[]
}

/**
 * 信号库 — 每条信号是 (regex, weight, name)。
 *
 * 权重设计:
 *   - 强信号(决定性): 1.5 ~ 2
 *   - 中信号(支持性): 1
 *   - 反信号(否定性): -1 ~ -2
 *
 * 阈值 THRESHOLD=1.5 — 单个强信号即可命中(避免必须多信号叠加才触发),
 * 但纯反信号也会把分压回 null。
 */
const SIGNALS: Record<
  'done' | 'need_input' | 'blocked',
  Array<{ re: RegExp; weight: number; name: string }>
> = {
  done: [
    // 完成动作的中英文关键词
    {
      re: /(?:已(?:完成|成功|搞定|插入|更新|删除|创建|发送|上传|下载|保存)|completed?|finished|all set|ready to|done\b)/i,
      weight: 2,
      name: 'completion-verb',
    },
    // 总结性结尾 / 报告口吻
    {
      re: /(?:以下是|总结|here'?s the|in summary|to summarize)/i,
      weight: 1,
      name: 'summary-phrase',
    },
    // 含问号 → 不可能是 done (强反信号)
    { re: /[?？]/, weight: -1.5, name: '-question-mark' },
  ],
  need_input: [
    // 问号 (最强信号)
    { re: /[?？]/, weight: 2, name: 'question-mark' },
    // 列举选项 "X / Y / Z" — 强信号 (典型让用户选)
    {
      re: /\S+\s+\/\s+\S+\s+\/\s+\S+/,
      weight: 1.5,
      name: 'slash-list',
    },
    // 直接请求语 (中英文)
    {
      re: /(?:请(?:告诉|告知|确认|选|提供|输入)|等(?:你|您)|let me know|tell me|which (?:one|do|would)|please confirm|please provide)/i,
      weight: 1.5,
      name: 'request-phrase',
    },
    // 第二人称密集出现 (中文)
    { re: /[你您]/, weight: 0.3, name: 'second-person-cn' },
  ],
  blocked: [
    // 缺资源 / 失败关键词
    {
      re: /(?:找不到|不存在|缺(?:少|失)|无法|cannot|unable to|failed to|missing|not found|denied|refused)/i,
      weight: 2,
      name: 'failure-keyword',
    },
    // 典型错误码 / 技术错误词
    {
      re: /(?:\berror\b|\bexception\b|timeout|ENOENT|ECONN|HTTP \d{3})/i,
      weight: 1,
      name: 'error-token',
    },
    // 句末问号 → 更可能 need_input,反向扣分
    { re: /[?？]\s*$/, weight: -1, name: '-trailing-question' },
  ],
}

/** 单个意图类型的得分计算(返回 score + 命中信号名)。 */
function scoreIntent(
  text: string,
  type: keyof typeof SIGNALS,
): { score: number; signals: string[] } {
  let score = 0
  const signals: string[] = []
  for (const { re, weight, name } of SIGNALS[type]) {
    if (re.test(text)) {
      score += weight
      signals.push(name)
    }
  }
  return { score, signals }
}

/**
 * 阈值: 最高分须 >= 此值才认定意图;否则返 null。
 *
 * 调高 → 假阳性少 / 假阴性多(更多 message 走普通 bubble);
 * 调低 → 假阳性多 / 假阴性少(更多 message 强行打卡片样式)。
 *
 * 1.5 = 单个强信号(2) 抵消一个反信号(-0.5) 的临界。
 */
const THRESHOLD = 1.5

/**
 * 推断 assistant message 文本表达的意图。
 *
 * 算法: 三类意图各算一份分,取最高分;若 >= THRESHOLD 则返回该类型,否则 null。
 * 同分情况下优先级: need_input > done > blocked (与产品语义对齐:
 * "可能是问问题" 比 "可能 done" 更稳妥;"可能 blocked" 误判代价最大,优先级最低)。
 */
export function inferIntent(text: string): IntentInference {
  if (!text || !text.trim()) {
    return { type: null, confidence: 0, signals: [] }
  }

  const scoreDone = scoreIntent(text, 'done')
  const scoreNeedInput = scoreIntent(text, 'need_input')
  const scoreBlocked = scoreIntent(text, 'blocked')

  const maxScore = Math.max(scoreDone.score, scoreNeedInput.score, scoreBlocked.score)
  if (maxScore < THRESHOLD) {
    return { type: null, confidence: 0, signals: [] }
  }

  // 优先级: need_input > done > blocked (同分时)
  if (scoreNeedInput.score === maxScore) {
    return { type: 'need_input', confidence: maxScore, signals: scoreNeedInput.signals }
  }
  if (scoreDone.score === maxScore) {
    return { type: 'done', confidence: maxScore, signals: scoreDone.signals }
  }
  return { type: 'blocked', confidence: maxScore, signals: scoreBlocked.signals }
}

/** 测试用: 暴露内部常量供边界 case 验证。 */
export const __TEST__ = { SIGNALS, THRESHOLD, scoreIntent }

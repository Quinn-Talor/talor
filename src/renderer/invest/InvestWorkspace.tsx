// src/renderer/invest/InvestWorkspace.tsx —— 投研工作台(平台顶级 surface,B-ii 专属视觉)
//
// 与 chat/settings 视觉解耦:自带"研究台"深色底 + 三区布局(池子 | 活论文 | 分析过程)。
// U1: 壳 + 三区骨架 + 空态 + 返回入口。U2 起接真数据(cards:list / 案卷 / 对话)。
// 视觉走自包含 bespoke tokens(挂在根 style),不依赖 index.css 主题 —— 与 stockCardUI
// 现有"局部 palette"取向一致,保证深色台面在明/暗主题下都稳定。

import type { CSSProperties } from 'react'

/** 研究台 bespoke 调色板(自包含,不受平台明暗主题影响)。 */
const DESK: CSSProperties = {
  // @ts-expect-error CSS custom properties
  '--desk-bg': '#0f1216',
  '--desk-panel': '#161b22',
  '--desk-line': '#242c37',
  '--desk-ink': '#e6edf3',
  '--desk-mute': '#8b98a9',
  '--desk-subtle': '#5b6675',
  '--desk-accent': '#4a9eff',
}

interface InvestWorkspaceProps {
  onBack: () => void
}

export function InvestWorkspace({ onBack }: InvestWorkspaceProps) {
  return (
    <div
      className="flex flex-col h-full w-full"
      style={{ ...DESK, background: 'var(--desk-bg)', color: 'var(--desk-ink)' }}
    >
      {/* 顶栏:身份 + 返回 */}
      <header
        className="flex items-center justify-between px-5 h-[52px] shrink-0"
        style={{ borderBottom: '1px solid var(--desk-line)' }}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tracking-[0.02em]">投研工作台</span>
          <span className="text-[11px]" style={{ color: 'var(--desk-subtle)' }}>
            Research Desk
          </span>
        </div>
        <button
          onClick={onBack}
          className="text-[12px] px-2.5 py-1 rounded-md transition-colors"
          style={{ color: 'var(--desk-mute)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--desk-panel)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          ← 返回对话
        </button>
      </header>

      {/* 三区:池子 | 活论文 | 分析过程 */}
      <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: '260px 1fr 380px' }}>
        <Zone title="池子" hint="候选与在研标的" side>
          <Empty>暂无标的 —— 建卡后在此归池</Empty>
        </Zone>
        <Zone title="活论文" hint="时光机 · 传导链 · 事实">
          <Empty>选一个标的，展开它的活论文</Empty>
        </Zone>
        <Zone title="分析过程" hint="报 · 问 · 拨 · 挑" side last>
          <Empty>与研究 agent 的对话过程将出现在这里</Empty>
        </Zone>
      </div>
    </div>
  )
}

function Zone(props: {
  title: string
  hint: string
  side?: boolean
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className="flex flex-col min-h-0"
      style={{
        background: props.side ? 'var(--desk-panel)' : 'var(--desk-bg)',
        borderRight: props.last ? 'none' : '1px solid var(--desk-line)',
      }}
    >
      <div className="px-4 pt-3.5 pb-2 shrink-0">
        <div className="text-[13px] font-semibold">{props.title}</div>
        <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--desk-subtle)' }}>
          {props.hint}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-4 pb-4">{props.children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="h-full flex items-center justify-center text-center text-[12px] leading-relaxed px-3"
      style={{ color: 'var(--desk-subtle)' }}
    >
      {children}
    </div>
  )
}

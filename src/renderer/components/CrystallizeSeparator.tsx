// CrystallizeSeparator — purple banner between S1 messages and the crystallize
// workbench panel. Toggle collapse/expand only — closing is handled by the
// entry button in the chat header (consistent state indicator there).
//
// Spec §B.9.2 visual (revised by user feedback):
//   🔮 Agent Workbench (based on N messages) [─ collapse]

interface CrystallizeSeparatorProps {
  collapsed: boolean
  basedOnMessageCount: number
  onToggleCollapse: () => void
}

export function CrystallizeSeparator({
  collapsed,
  basedOnMessageCount,
  onToggleCollapse,
}: CrystallizeSeparatorProps) {
  return (
    <div
      className="flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-white"
      style={{ background: '#8b5cf6' }}
      data-testid="crystallize-separator"
    >
      <span className="text-base">🔮</span>
      <span className="text-[13px] font-semibold">Agent Workbench</span>
      <span className="text-[11px] opacity-80">(based on {basedOnMessageCount} messages)</span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] hover:bg-white/15 transition-colors"
        aria-label={collapsed ? 'Expand workbench' : 'Collapse workbench'}
      >
        {collapsed ? '+ 展开' : '− 折起'}
      </button>
    </div>
  )
}

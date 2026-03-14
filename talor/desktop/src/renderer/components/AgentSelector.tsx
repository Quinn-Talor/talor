import { useAgentStore } from '../store/agentStore'

export function AgentSelector() {
  const { agents, currentAgentId, setCurrentAgent } = useAgentStore()

  return (
    <div className="flex items-center gap-2 p-2 border-b bg-white">
      <span className="text-sm text-gray-500">Agent:</span>
      <select
        value={currentAgentId || ''}
        onChange={(e) => setCurrentAgent(e.target.value)}
        className="flex-1 px-3 py-1 border rounded text-sm bg-white"
      >
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
      {currentAgentId && (
        <span className="text-xs px-2 py-1 bg-gray-100 rounded">
          {agents.find(a => a.id === currentAgentId)?.kind}
        </span>
      )}
    </div>
  )
}

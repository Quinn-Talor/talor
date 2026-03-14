import { useAgentStore } from '../store/agentStore'

export function AgentList() {
  const { agents, currentAgentId, setCurrentAgent } = useAgentStore()

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Agent Management</h2>
      <div className="space-y-3">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className={`p-4 border rounded-lg cursor-pointer ${
              currentAgentId === agent.id 
                ? 'border-blue-500 bg-blue-50' 
                : 'border-gray-200 hover:border-gray-300'
            }`}
            onClick={() => setCurrentAgent(agent.id)}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{agent.name}</div>
                <div className="text-sm text-gray-500">{agent.description}</div>
              </div>
              <span className="text-xs px-2 py-1 bg-gray-100 rounded">
                {agent.kind}
              </span>
            </div>
            {agent.capabilities && (
              <div className="mt-2 flex flex-wrap gap-1">
                {agent.capabilities.map((cap) => (
                  <span key={cap} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                    {cap}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

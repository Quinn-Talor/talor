import type { Message } from '../types'

interface MessageItemProps {
  message: Message
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[70%] rounded-lg p-3 ${
          isUser 
            ? 'bg-blue-500 text-white' 
            : isTool
              ? 'bg-gray-200 text-gray-800'
              : 'bg-white border'
        }`}
      >
        <div className="text-xs font-semibold mb-1 opacity-70">
          {isUser ? 'User' : isTool ? 'Tool' : 'Assistant'}
        </div>
        <div className="whitespace-pre-wrap">{message.content}</div>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 pt-2 border-t border-opacity-20">
            <div className="text-xs font-semibold">Tool Calls:</div>
            {message.toolCalls.map((call) => (
              <div key={call.id} className="text-xs mt-1">
                <span className="font-mono">{call.name}</span>
                <span className={`ml-2 px-1 rounded ${
                  call.status === 'success' ? 'bg-green-100' :
                  call.status === 'error' ? 'bg-red-100' :
                  call.status === 'running' ? 'bg-yellow-100' : 'bg-gray-100'
                }`}>
                  {call.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

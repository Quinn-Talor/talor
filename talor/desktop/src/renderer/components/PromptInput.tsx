import { useState, KeyboardEvent } from 'react'

interface PromptInputProps {
  onSend: (message: string) => void
}

export function PromptInput({ onSend }: PromptInputProps) {
  const [value, setValue] = useState('')

  const handleSend = () => {
    if (value.trim()) {
      onSend(value.trim())
      setValue('')
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t p-4 flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        onClick={handleSend}
        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
      >
        Send
      </button>
    </div>
  )
}

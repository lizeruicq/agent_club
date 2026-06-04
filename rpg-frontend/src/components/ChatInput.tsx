import { useState, KeyboardEvent } from 'react'

interface ChatInputProps {
  onSend: (text: string) => void
  onStop?: () => void
  disabled?: boolean
  isProcessing?: boolean
  placeholder?: string
}

export function ChatInput({ onSend, onStop, disabled, isProcessing, placeholder }: ChatInputProps) {
  const [text, setText] = useState('')

  const handleSend = () => {
    if (isProcessing) {
      onStop?.()
      return
    }
    if (text.trim() && !disabled) {
      onSend(text.trim())
      setText('')
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="chat-input-container">
      <input
        type="text"
        className="chat-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || '输入消息...'}
        disabled={disabled || isProcessing}
        maxLength={2000}
      />
      <button
        className={`send-button ${isProcessing ? 'stop-button' : ''}`}
        onClick={handleSend}
        disabled={!isProcessing && (disabled || !text.trim())}
      >
        {isProcessing ? '⏹ 中止' : '⚔️ 发送'}
      </button>
    </div>
  )
}

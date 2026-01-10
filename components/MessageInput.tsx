import React, { useState, forwardRef, useRef, useEffect, useImperativeHandle } from 'react';
import FontSizeControl from './FontSizeControl';

interface MessageInputProps {
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  chatFontSize: string;
  onFontSizeChange: (size: string) => void;
  fontSizes: string[];
  defaultFontSize: string;
  maxMessageLength?: number; // 0 or undefined = unlimited
}

const MessageInput = forwardRef<HTMLTextAreaElement, MessageInputProps>(
  ({ onSendMessage, isLoading, chatFontSize, onFontSizeChange, fontSizes, defaultFontSize, maxMessageLength = 0 }, ref) => {
    const [message, setMessage] = useState('');
    const hasLimit = maxMessageLength > 0;
    const isOverLimit = hasLimit && message.length > maxMessageLength;
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Expose the textarea ref to the parent component
    useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement, []);

    // Auto-resize textarea based on content
    const adjustTextareaHeight = () => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = 'auto'; // Reset height to recalculate
        const newHeight = Math.min(textarea.scrollHeight, 200); // Max height of 200px (~8 lines)
        textarea.style.height = `${newHeight}px`;
      }
    };

    useEffect(() => {
      adjustTextareaHeight();
    }, [message]);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (message.trim() && !isLoading) {
        onSendMessage(message.trim());
        setMessage('');
      }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
      e.preventDefault();
      alert('Sorry, cut-and-paste are disabled while using this simulation.');
    };

    return (
      <div className="p-4 bg-white border-t border-gray-200">
        <form onSubmit={handleSubmit} className="flex items-end space-x-4">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              onPaste={handlePaste}
              placeholder="Type your response..."
              disabled={isLoading}
              rows={2}
              className={`w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none disabled:bg-gray-100 transition overflow-y-auto ${chatFontSize} ${isOverLimit ? 'border-red-500 focus:ring-red-500' : 'border-gray-300'}`}
              style={{ minHeight: '52px', maxHeight: '200px' }}
            />
            {hasLimit && (
              <div className={`absolute bottom-1 right-2 text-xs ${isOverLimit ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                {message.length}/{maxMessageLength}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={isLoading || !message.trim() || isOverLimit}
            className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
          <FontSizeControl
            currentSize={chatFontSize}
            onSizeChange={onFontSizeChange}
            sizes={fontSizes}
            defaultSize={defaultFontSize}
          />
        </form>
      </div>
    );
  }
);

export default MessageInput;

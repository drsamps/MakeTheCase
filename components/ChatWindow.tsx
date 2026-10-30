import React, { useRef, useEffect } from 'react';
import { Message, MessageRole } from '../types';

interface PositionOption {
  position_id: number;
  position_name: string;
  position: string;
}

interface ChatWindowProps {
  messages: Message[];
  isLoading: boolean;
  chatFontSize: string;
  /** The AI's avatar: its initials, and the hover text (the activity's copy, avatar_tooltip). */
  protagonistInitials?: string;
  avatarTitle?: string;
  // Position selection props (for in-chat position selection)
  awaitingPositionSelection?: boolean;
  positionOptions?: PositionOption[];
  onPositionSelect?: (position: PositionOption) => void;
  /** The question above the position buttons (the activity's copy, position_prompt; may contain **bold**). */
  positionPrompt: string;
  /** An instruction bar shown above the first message, full width, scrolling with the chat (ActivityIntro). */
  intro?: React.ReactNode;
}

const renderMessageContent = (content: string) => {
  const parts = content.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};

const ChatWindow: React.FC<ChatWindowProps> = ({
  messages,
  isLoading,
  chatFontSize,
  protagonistInitials = '?',
  avatarTitle,
  awaitingPositionSelection = false,
  positionOptions = [],
  onPositionSelect,
  positionPrompt,
  intro
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // The opening message the view was last scrolled to the top for (see below).
  const introShownFor = useRef<Message | undefined | null>(null);

  useEffect(() => {
    // With an intro bar, start at the top so it is read before the first message: once per
    // chat. If the student's first message is later taken back (rejected as too long), the chat
    // is back to one message but the error and position buttons are at the bottom.
    if (intro && messages.length <= 1 && !isLoading && introShownFor.current !== messages[0]) {
      introShownFor.current = messages[0];
      containerRef.current?.scrollTo({ top: 0 });
      return;
    }
    scrollToBottom();
  }, [messages, isLoading]);

  const handleCopyPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    alert('Sorry, cut-and-paste are disabled while using this simulation.');
  };


  // The intro sits outside the padded wrapper so it spans the chat edge to edge. first:rounded-t-xl
  // clips it to the chat panel's rounded corners when nothing (error, timer, counter) is above.
  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto first:rounded-t-xl"
      onCopy={handleCopyPaste}
      onCut={handleCopyPaste}
    >
      {intro}
      <div className="p-6 space-y-6">
      {messages.map((msg, index) => (
        <React.Fragment key={index}>
          <div
            className={`flex items-end gap-3 ${
              msg.role === MessageRole.USER ? 'justify-end' : 'justify-start'
            }`}
          >
            {msg.role === MessageRole.MODEL && (
              <div
                className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                title={avatarTitle}
              >
                {protagonistInitials}
              </div>
            )}
            <div
              className={`max-w-md lg:max-w-lg p-4 rounded-2xl shadow-md ${
                msg.role === MessageRole.USER
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-white text-gray-800 rounded-bl-none'
              }`}
            >
              <p className={chatFontSize} style={{ whiteSpace: 'pre-wrap' }}>{renderMessageContent(msg.content)}</p>
            </div>
          </div>
          {/* Position selection buttons - shown after first protagonist message */}
          {index === 0 && msg.role === MessageRole.MODEL && awaitingPositionSelection && positionOptions.length > 0 && (
            <div className="flex justify-start pl-[52px]">
              <div className="max-w-md lg:max-w-lg">
                <p className="text-sm text-gray-600 mb-2">{renderMessageContent(positionPrompt)}</p>
                <div className="flex flex-col gap-2">
                  {positionOptions.map((pos) => (
                    <button
                      key={pos.position_id}
                      onClick={() => onPositionSelect?.(pos)}
                      className="w-full px-4 py-3 text-left text-sm font-medium text-blue-900 bg-white border-2 border-blue-300 rounded-lg shadow-sm cursor-pointer transition-all duration-150 hover:bg-blue-50 hover:border-blue-500 hover:shadow-md active:translate-y-px active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                      aria-label={`Select position: ${pos.position}`}
                    >
                      {pos.position}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </React.Fragment>
      ))}
      {isLoading && (
        <div className="flex items-end gap-3 justify-start">
          <div 
            className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
            title={avatarTitle}
          >
            {protagonistInitials}
          </div>
          <div className="max-w-xs p-4 rounded-2xl shadow-md bg-white text-gray-800 rounded-bl-none">
            <div className="flex items-center justify-center space-x-1">
              <span className="text-sm text-gray-500">Typing</span>
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
            </div>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default ChatWindow;

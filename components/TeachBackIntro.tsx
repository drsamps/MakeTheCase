import React from 'react';
import { TeachBackIntroFacts, teachBackIntroText } from '../teachBack';

// **bold** spans only, like the chat bubbles (ChatWindow#renderMessageContent).
const renderBold = (text: string) =>
  text.split(/(\*\*.*?\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );

/**
 * The instruction panel above a teach-back chat: what the activity is, who the student is
 * teaching, the topic and the length. Page UI only: never a chat turn, never sent to the model,
 * not in the transcript. Copy is in teachBack.ts#teachBackIntroText.
 */
const TeachBackIntro: React.FC<{ facts: TeachBackIntroFacts }> = ({ facts }) => {
  const text = teachBackIntroText(facts);
  return (
    <div
      role="note"
      aria-label="Activity instructions"
      className="mx-auto max-w-2xl rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-4 text-sm leading-relaxed text-indigo-950 shadow-sm"
    >
      <p className="text-base font-semibold">{text.heading}</p>
      <p className="mt-2">{text.teachLine}</p>
      <p className="mt-1 rounded-lg bg-white/70 px-3 py-2 font-semibold">{renderBold(text.topic)}</p>
      {text.body.map((line, i) => (
        <p key={i} className="mt-2">{renderBold(line)}</p>
      ))}
    </div>
  );
};

export default TeachBackIntro;

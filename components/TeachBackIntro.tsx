import React from 'react';
import { TeachBackIntroFacts, teachBackIntroText } from '../teachBack';

// **bold** spans only, like the chat bubbles (ChatWindow#renderMessageContent).
const renderBold = (text: string) =>
  text.split(/(\*\*.*?\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );

/**
 * The instruction bar above a teach-back chat: what the activity is, who the student is
 * teaching, the topic and the length. Page UI only: never a chat turn, never sent to the model,
 * not in the transcript. Copy is in teachBack.ts#teachBackIntroText.
 *
 * Deliberately unlike a chat bubble: it spans the chat frame edge to edge (ChatWindow renders it
 * outside its padded message list), with no shadow and its own colour.
 */
const TeachBackIntro: React.FC<{ facts: TeachBackIntroFacts }> = ({ facts }) => {
  const text = teachBackIntroText(facts);
  return (
    <div
      role="note"
      aria-label="Activity instructions"
      className="border-b-2 border-amber-300 bg-amber-50 px-6 py-5 text-sm leading-relaxed text-gray-900"
    >
      <div className="mx-auto max-w-3xl">
        <p className="text-base font-semibold">{text.heading}</p>
        <p className="mt-3">{text.teachLine}</p>
        <p className="mt-1 rounded-md border border-amber-300 bg-white px-3 py-2 font-semibold">{renderBold(text.topic)}</p>
        <p className="mt-2">{renderBold(text.about)}</p>
        <p className="mt-4 text-xs font-bold uppercase tracking-wide text-amber-800">Instructions</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {text.instructions.map((line, i) => (
            <li key={i}>{renderBold(line)}</li>
          ))}
        </ul>
        <p className="mt-3 font-semibold">Good luck!</p>
      </div>
    </div>
  );
};

export default TeachBackIntro;

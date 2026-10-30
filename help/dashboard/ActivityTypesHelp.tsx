import React from 'react';

const ActivityTypesHelp: React.FC = () => (
  <>
    <h4>What an activity type is</h4>
    <p>
      A type is the rules of an activity: who the AI plays, what it is told, how the chat is graded and what the
      student reads. A case then fills in the reading and scenarios. Instructors choose a type on the case form.
    </p>

    <h4>Kinds of type</h4>
    <ul>
      <li><strong>Built-in</strong> (Case chat, Teach-back): in the code, locked.</li>
      <li><strong>System</strong> (Debate, Apply, Liken to Me, Pitch, Role Play, Defend): seeded, locked.</li>
      <li><strong>Custom</strong>: yours. Clone any type to start one.</li>
    </ul>

    <h4>Making a type</h4>
    <ol>
      <li><strong>Clone</strong> the closest type.</li>
      <li><strong>Edit</strong> the wording. <code>{'{slots}'}</code> are filled in when the prompt is built. A slot not allowed in a field is refused when you save, so AI-only text can never reach a student.</li>
      <li><strong>Preview</strong> the exact prompts, on sample text or a real case. No AI call is made.</li>
      <li><strong>Test chat</strong> as a student, and try the grading. This uses real AI and is billed to your budget. Nothing is recorded as a student chat.</li>
      <li><strong>Publish</strong>, then <strong>Enable</strong>. Only then can a case use it.</li>
    </ol>

    <h4>Versions</h4>
    <p>
      Every chat records the version it started on and is graded on it, so publishing changes nothing for a chat
      already running. <strong>History</strong> lets you compare versions and restore an old one into the draft.
    </p>

    <h4>Traits</h4>
    <p>
      Traits are what the platform does for the type: where the AI&apos;s character comes from, whether there are
      positions, what the AI may see, signals. They can change in the JSON tab until the first publish, and are then
      fixed, because chats already ran on them. To change one, clone the type.
    </p>

    <h4>Designing an activity</h4>
    <p>
      Before cloning a type, it is worth reading <strong>Designing StudyChat activities</strong> on <strong>Home → Help</strong>: it covers what
      each existing type is for, the five choices that define a type, and what to settle before you
      start. The full reference is listed there too.
    </p>

    <div className="help-callout">
      <strong>Tip:</strong> You cannot break grading from here. The grader&apos;s task list and output format are fixed by the platform. You edit its framing, default criteria and a few words.
    </div>
  </>
);

export default ActivityTypesHelp;

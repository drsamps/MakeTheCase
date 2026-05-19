import React from 'react';

const PersonasHelp: React.FC = () => (
  <>
    <h4>Built-in vs custom</h4>
    <p>
      <strong>Built-in</strong> personas (Moderate, Strict, etc.) are shared platform defaults.
      They are read-only for instructors. Use <strong>Clone</strong> to copy one into your library
      as a custom persona you can edit.
    </p>

    <h4>Custom personas</h4>
    <p>
      Personas you create or clone are <strong>Custom</strong>. You can edit, delete, and share them
      using visibility (Private, Team, or Public if you have publish permission).
    </p>

    <h4>Using personas in chats</h4>
    <p>
      After cloning or creating a persona, open <strong>Assignments → Chat Options</strong> for a
      section case. Under <strong>Allowed Personas</strong>, include your persona (or leave
      &quot;All enabled personas&quot; checked). Set <strong>Default Persona</strong> if you want
      it pre-selected for students.
    </p>

    <div className="help-callout">
      <strong>Tip:</strong> If Allowed Personas is blank or set to all enabled, students can choose
      any enabled persona including your clones.
    </div>
  </>
);

export default PersonasHelp;

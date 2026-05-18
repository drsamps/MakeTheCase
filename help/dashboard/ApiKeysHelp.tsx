import React from 'react';

const ApiKeysHelp: React.FC = () => (
  <>
    <h4>Why per-instructor keys?</h4>
    <p>
      MakeTheCase calls Google, OpenAI, Anthropic, and OpenRouter on your
      behalf to run student chats and evaluations. Each instructor brings
      their own API keys so usage stays attributable and within your
      institution's billing.
    </p>

    <h4>How keys are stored</h4>
    <ul>
      <li>Keys are encrypted at rest with AES-256-GCM before being written to the database.</li>
      <li>Only the encrypted form is ever loaded; plaintext is held in memory only at call time.</li>
      <li>The UI shows the last 4 characters as a hint so you can confirm which key is active.</li>
    </ul>

    <h4>Validation</h4>
    <p>
      When you save a key the server makes a minimal test call to verify the
      key works before storing it. An invalid key is refused with an error.
    </p>

    <h4>Rotation</h4>
    <p>
      To rotate, paste the new key into the same row and save. The new key
      is validated, then overwrites the old. There is no plaintext history.
    </p>

    <h4>Using the system key</h4>
    <p>
      Administrators may grant <strong>Use system key</strong> on your account
      for one or more providers. When granted, your sections fall back to the
      platform's keys instead of requiring your own.
    </p>

    <div className="help-callout">
      <strong>Heads up:</strong> If a student tries to chat in a section whose
      model needs a provider you haven't configured, the chat is blocked with
      a friendly "section isn't ready yet" message. Set up every provider
      your section's chat and super models require.
    </div>
  </>
);

export default ApiKeysHelp;

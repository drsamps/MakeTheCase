/**
 * Help content for the Chat Options tab in the Instructor Dashboard.
 *
 * This file can be edited to update the help text shown when clicking
 * the (i) icon next to the "Chat Options" heading.
 *
 * Supported HTML elements (styled via admin.css):
 * - <h4> - Section headers
 * - <p> - Paragraphs
 * - <ul>, <ol>, <li> - Lists
 * - <strong> - Bold text
 * - <code> - Inline code
 * - <div className="help-callout"> - Highlighted tip box
 */

import React from 'react';

const ChatOptionsHelp: React.FC = () => (
  <>
    <h4>Overview</h4>
    <p>
      Configure how students interact with case chats, including hints,
      personas, and display options.
    </p>

    <h4>Default Settings Hierarchy</h4>
    <p>Chat options follow a cascading default system:</p>
    <ol>
      <li><strong>Global Default</strong> - Base settings for all sections</li>
      <li><strong>Section Default</strong> - Override for a specific section</li>
      <li><strong>Assignment Custom</strong> - Override for a specific case assignment</li>
    </ol>
    <p>Lower levels inherit from higher levels unless customized.</p>

    <h4>Managing Defaults</h4>
    <ul>
      <li>
        Select <strong>"Default for all sections"</strong> in the section
        dropdown to edit global defaults
      </li>
      <li>
        Select a section, then <strong>"Default for this section"</strong> to
        edit section-specific defaults
      </li>
    </ul>

    <h4>Using vs. Customizing</h4>
    <p>When viewing a specific case assignment:</p>
    <ul>
      <li>
        <strong>Checkbox checked</strong> - Using inherited defaults (read-only view)
      </li>
      <li>
        <strong>Checkbox unchecked</strong> - Custom settings for this assignment only
      </li>
    </ul>

    <h4>Chat Option Settings</h4>
    <ul>
      <li><strong>Hints Allowed</strong> - Maximum hints a student can request (0 = disabled)</li>
      <li><strong>Free Hints</strong> - Hints without score penalty</li>
      <li><strong>Show Case Content</strong> - Display case in left panel during chat</li>
      <li><strong>Run Evaluation</strong> - Run AI evaluation after chat completes</li>
      <li><strong>Default Persona</strong> - Pre-selected chatbot personality</li>
      <li><strong>Chatbot Personality</strong> - Additional AI instructions</li>
    </ul>

    <div className="help-callout">
      <strong>Tip:</strong> Use "Bulk Actions" to copy settings to multiple
      assignments at once, or save current settings as defaults.
    </div>
  </>
);

export default ChatOptionsHelp;

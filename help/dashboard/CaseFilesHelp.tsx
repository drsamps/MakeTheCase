import React from 'react';

const CaseFilesHelp: React.FC = () => (
  <>
    <h4>The text is what the AI reads</h4>
    <p>
      Every case file is turned into text, and that text (not the original PDF or page) is what goes into the chat
      prompt. Open <strong>Text</strong> on any row to read or edit it, and use <strong>Preview</strong> to see headings,
      lists and tables formatted.
    </p>

    <h4>Add from web page</h4>
    <ul>
      <li><strong>Fetch</strong> reads the page and shows its main text for review. Nothing is saved until you click <strong>Save as case file</strong>.</li>
      <li>Web pages are kept as text plus their address. <strong>Visit ↗</strong> opens the live page; the page itself is not stored, so it may change or disappear later.</li>
      <li>PDF and Word links keep the original file too, so it can be downloaded.</li>
      <li>Pages behind a paywall or login, or built by JavaScript, often can't be fetched or come back nearly empty. Open the page in your browser, copy the text, and use <strong>Paste text instead</strong>.</li>
    </ul>

    <h4>Edits, revert and re-fetch</h4>
    <ul>
      <li>Rows whose text was edited by hand show an <strong>edited</strong> tag.</li>
      <li><strong>Revert to extracted text</strong> puts back the text as first extracted or fetched.</li>
      <li><strong>Re-fetch from page</strong> and <strong>Re-extract from file</strong> replace the text, including your edits. You are asked first when there are edits to lose.</li>
    </ul>

    <h4>Downloads</h4>
    <p>
      <strong>Download</strong> gives the original file when one is stored, or the text when it isn't (web pages and
      pasted text). <strong>Download text</strong> in the Text window always gives the saved text.
    </p>

    <div className="help-callout">
      <strong>Copyright:</strong> most published articles are copyrighted. Check <strong>Proprietary content</strong> when
      it applies; the file then stays out of the chat prompt until someone confirms you have the right to use it with AI.
    </div>
  </>
);

export default CaseFilesHelp;

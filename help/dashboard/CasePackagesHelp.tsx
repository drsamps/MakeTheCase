import React from 'react';

const CasePackagesHelp: React.FC = () => (
  <>
    <h4>What a package is</h4>
    <p>
      A package is one file (ending <code>.mtc.zip</code>) that holds one or more cases, so a case made on one
      MakeTheCase server can be used on another. Each case in it carries:
    </p>
    <ul>
      <li>the <strong>text</strong> students and the AI read, and any AI outlines</li>
      <li>every <strong>scenario</strong> and its <strong>positions</strong></li>
      <li>its <strong>activity type</strong> (case chat or teach-back)</li>
      <li>one set of <strong>settings</strong>: chat options, rubric, personas, and which scenarios are offered</li>
    </ul>
    <p>
      It never carries students, chats, grades, sections, dates, AI models or who owns the case.
    </p>

    <h4>Downloading</h4>
    <ul>
      <li><strong>Download</strong> on a row packages that case. Tick several rows and use <strong>Download selected</strong> to put them in one file.</li>
      <li><strong>Settings to include</strong> picks where the settings come from: the case&apos;s saved defaults, a course&apos;s settings for it, or a section&apos;s own.</li>
      <li><strong>Include original files</strong> adds the PDF or Word files. Leave it off to share only the text.</li>
      <li>Documents marked <strong>proprietary</strong> are left out unless you tick the box for them. An AI outline of one still travels, and stands in for it.</li>
    </ul>
    <div className="help-callout">
      <strong>Share with instructors only.</strong> A package holds the teaching note, the argument notes and the
      rubric, which students never see inside MakeTheCase.
    </div>

    <h4>Installing</h4>
    <ul>
      <li><strong>Install from file</strong> reads the package and shows what it would add. Nothing is installed until you click <strong>Install</strong>.</li>
      <li>Installed cases are <strong>private to you</strong> and are not assigned anywhere. Their settings are saved as the case&apos;s default settings and are used when you add the case to a course or section.</li>
      <li>Nothing you already have is replaced. If a persona or rubric criterion with the same id exists here and differs, the package&apos;s is added under a new id, or you can choose to use the one already here.</li>
      <li>A case that is already here is left alone. Tick <strong>Install this one too</strong> to get a separate copy.</li>
      <li>A proprietary document that was included must be confirmed again in Case Files before the AI uses it.</li>
    </ul>

    <h4>If a package will not install</h4>
    <p>
      A package made on a newer MakeTheCase can use something this server does not have, such as a new activity
      type. The message names what is missing. Ask your administrator to update this server, then install it again.
    </p>

    <h4>Copy</h4>
    <p>
      <strong>Copy</strong> makes a second case on this server from the same documents, scenarios and default
      settings. Use it to run a different activity on the same reading: copy the case, then change the copy&apos;s
      activity type under <strong>Edit</strong>.
    </p>

    <div className="help-callout">
      <strong>Read before you install a stranger&apos;s package.</strong> Persona instructions, scenario instructions
      and rubric prompts are sent to the AI as written. The install screen lists all of them under
      &quot;Read the AI instructions in this package&quot;.
    </div>
  </>
);

export default CasePackagesHelp;

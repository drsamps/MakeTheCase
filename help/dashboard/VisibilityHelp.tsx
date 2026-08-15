import React from 'react';

const VisibilityHelp: React.FC = () => (
  <>
    <h4>Visibility levels</h4>
    <ul>
      <li><strong>Private</strong> &mdash; only you (and admins) can see this resource. Use this for drafts and section-specific material.</li>
      <li><strong>Team</strong> &mdash; visible to members of the team(s) you select. Choose one or more teams in the picker.</li>
      <li><strong>Public</strong> &mdash; visible to every signed-in instructor and admin on this platform. Requires the <strong>Can publish</strong> permission, granted by an admin. This does <strong>not</strong> publish anything to the open internet.</li>
    </ul>

    <h4>What "visible" includes</h4>
    <p>
      Visibility applies to the whole resource, not just the part you were looking
      at when you set it. For a <strong>Case Writer project</strong> that means
      anyone who can see the project can read its <strong>source material</strong>
      &mdash; the full text of every uploaded, pasted, or fetched reference &mdash;
      along with the Learning Brief, Blueprint, Student Case, and Teaching Note.
      The <em>original</em> uploaded file (the PDF or Word document itself) is the
      exception: only you and co-editors can download that.
    </p>

    <div className="help-callout">
      <strong>Before sharing:</strong> check your source material for licensed or
      copyrighted documents you may not be free to redistribute, and for anything
      you uploaded only as a private working note.
    </div>

    <h4>System defaults</h4>
    <p>
      Built-in personas, rubrics, and criteria carry a "System" label and are
      read-only. Use the <strong>Clone</strong> action to create your own copy
      that you can edit and share.
    </p>

    <h4>Changing visibility</h4>
    <p>
      Only the resource owner can change visibility. Co-editors on a
      team-shared item with edit access can save the item while keeping its
      existing visibility, but cannot toggle visibility themselves.
    </p>

    <div className="help-callout">
      <strong>Permission check:</strong> If you don't see the <strong>Public</strong>
      option, ask your administrator to grant <strong>Can publish</strong> on
      your account.
    </div>
  </>
);

export default VisibilityHelp;

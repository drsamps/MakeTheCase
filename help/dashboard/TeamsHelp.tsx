import React from 'react';

const TeamsHelp: React.FC = () => (
  <>
    <h4>What are Teams?</h4>
    <p>
      A Team is a private group of instructors that lets you share Cases,
      Rubrics, Personas, and Case Writer projects with colleagues without
      making them visible to every instructor on the platform.
    </p>

    <h4>Roles</h4>
    <ul>
      <li><strong>Owner</strong> &mdash; can rename the team, invite or remove members, and delete the team.</li>
      <li><strong>Editor</strong> &mdash; can co-edit team-shared resources where the share was created with edit access.</li>
      <li><strong>Viewer</strong> &mdash; can view team-shared resources but not edit.</li>
    </ul>

    <h4>Invitations</h4>
    <p>
      Adding someone to a team is a two-step process. You send an invitation;
      shared resources only become visible to that instructor after they
      accept. Owners can revoke pending invites at any time.
    </p>

    <h4>Sharing a resource with a team</h4>
    <p>
      In the Visibility selector on a Case, Rubric, or Persona editor, pick
      <strong>Team</strong> and choose one or more teams. Members will see the
      resource immediately. Switch back to <strong>Private</strong> to revoke.
    </p>

    <div className="help-callout">
      <strong>Tip:</strong> You can be a member of any number of teams. Each
      team's roster is independent.
    </div>
  </>
);

export default TeamsHelp;

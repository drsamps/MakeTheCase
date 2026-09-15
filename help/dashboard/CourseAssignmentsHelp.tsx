import React from 'react';

const CourseAssignmentsHelp: React.FC = () => (
  <>
    <h4>Overview</h4>
    <p>
      <strong>By course</strong> sets up a case once for every section of a course. Pick a course, and each case on it
      shows its settings and a row for every section in the semester chosen at the top of the screen.
    </p>

    <h4>Finding a case</h4>
    <ul>
      <li>Click a case's title (or the arrow) to show or hide its settings and sections. The line under the title summarizes it: how many sections have it, how many are active, and when it first opens.</li>
      <li><strong>Sort</strong> by <strong>Opening date</strong> (the semester's schedule; cases without dates last), <strong>Title</strong>, or <strong>Custom</strong> - an order the course owner arranges with the ▲▼ arrows, kept for every semester.</li>
    </ul>

    <h4>Settings are shared</h4>
    <ul>
      <li><strong>Main</strong> - the course's settings for a case (Rubric, Options, Scenarios and Positions). Saving changes every section that follows Main, in every semester.</li>
      <li><strong>Semester copy</strong> - a copy of Main for some sections of one semester (e.g. an evening section). Editing it changes only those sections.</li>
      <li><strong>Customized</strong> - a section with its own settings. Editing a section's settings in <strong>By section</strong> makes it Customized; <strong>Who follows what</strong> switches it back.</li>
    </ul>

    <h4>Dates and Active stay per section</h4>
    <ul>
      <li><strong>Schedule all…</strong> sets opening and closing dates on several sections at once, with an optional offset in minutes for sections that meet later.</li>
      <li><strong>Edit dates</strong> changes one section.</li>
      <li>Students only see a case while it is <strong>Active</strong>. Use <strong>Activate on all</strong> once the case is ready.</li>
    </ul>

    <h4>Who can change what</h4>
    <p>
      The course owner and admins manage the course's cases and settings. Section instructors can schedule and activate cases
      on their own sections, and customize them in <strong>By section</strong>.
    </p>

    <div className="help-callout">
      <strong>Tip:</strong> <strong>By course</strong> and <strong>By section</strong> are two views of the same assignments.
      Click a section ID to open it in By section; click a section's "Follows: …" label there to come back.
    </div>
  </>
);

export default CourseAssignmentsHelp;

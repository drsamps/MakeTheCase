import React from 'react';

const ResultsHelp: React.FC = () => (
  <>
    <h4>Overview</h4>
    <p>
      The Results screen provides comprehensive analytics and reports for student
      performance across all case chats. Filter by sections and cases, view summary
      statistics, and access detailed student-level information.
    </p>

    <h4>Filtering</h4>
    <ul>
      <li><strong>Course Sections</strong> - Select one or more sections, or choose "ALL Sections" to view data across all sections.</li>
      <li><strong>Cases</strong> - Select one or more cases, or choose "ALL Cases" to view data across all cases.</li>
    </ul>

    <h4>Display Options</h4>
    <ul>
      <li><strong>Show summary statistics</strong> - Displays overall metrics, score distribution chart, and performance breakdowns by section/case when multiple are selected.</li>
      <li><strong>Show student details</strong> - Displays a table of individual student results with customizable columns.</li>
    </ul>

    <h4>Summary Statistics</h4>
    <p>When enabled, shows:</p>
    <ul>
      <li><strong>Completions</strong> - Total completed evaluations and student count</li>
      <li><strong>Average Score</strong> - Mean score out of the rubric's total points (for example <code>11.4/15</code>). When the selection spans cases whose rubrics have different totals, raw points are not comparable, so the average is shown as a percentage of each student's own rubric total instead (for example <code>72%</code>, marked &quot;mixed rubrics&quot;). The same rule applies to the per-section, per-case and per-model breakdown tables.</li>
      <li><strong>Average Hints</strong> - Mean hints requested per chat</li>
      <li><strong>Completion Rate</strong> - Percentage of students who completed</li>
      <li><strong>Score Distribution</strong> - Histogram of raw scores, running from 0 to the largest rubric total in the selection</li>
    </ul>
    <p>When multiple sections or cases are selected, additional breakdown tables show performance by each section and case.</p>

    <h4>Student Details</h4>
    <p>The student table shows individual results with these features:</p>
    <ul>
      <li><strong>Columns</strong> - Use the Columns picker to show or hide optional columns. Your choice is remembered the next time you open this screen.</li>
      <li><strong>Sorting</strong> - Click any column header to sort by that column</li>
      <li><strong>Pagination</strong> - Above the table, choose how many records to display (10, 20, 50, 100, 250, or All)</li>
      <li><strong>Export CSV</strong> - Exports <strong>every record matching your filters</strong>, not just the page on screen. Use the arrow beside the button to export only the rows currently showing instead. Either way the file contains the columns you have turned on. A single export is capped at 5,000 records; if your filters match more, narrow them and export in batches.</li>
    </ul>

    <h4>Identifying students in the export</h4>
    <p>Three optional columns carry a student identifier. Turn them on from the Columns picker:</p>
    <ul>
      <li><strong>Net ID</strong> - The campus net id on its own, for example <code>abc234</code>. The <code>cas:</code> prefix stored internally is removed, so this column can be pasted straight into a gradebook. Blank for a student who registered with an email and password rather than through campus sign-in.</li>
      <li><strong>Email</strong> - The address a self-registered student signs in with. May be blank for a campus sign-in student who never supplied one.</li>
      <li><strong>Student ID</strong> - The raw database key, kept verbatim: <code>cas:abc234</code> for a campus sign-in student, a long UUID otherwise. Use this only when you need to match a record exactly.</li>
    </ul>
    <p>
      <strong>Section ID</strong> (for example <code>f26-gscm410-1</code>) is shown by default in place of the
      much longer full section title. The title is still available as the <strong>Section</strong> column.
    </p>

    <h4>Status values</h4>
    <p>The Status column reports where the chat itself stopped, which explains why a row has no score:</p>
    <ul>
      <li><strong>Started</strong> - Chat opened but no messages exchanged yet</li>
      <li><strong>In Progress</strong> - Student is working through the case</li>
      <li><strong>Completed</strong> - Finished and evaluated; this is the only status that carries a score</li>
      <li><strong>Abandoned</strong> - Left idle for more than 60 minutes, then closed automatically. This is the most common reason for an unscored row.</li>
      <li><strong>Canceled</strong> - The student canceled the chat</li>
      <li><strong>Ended by Instructor</strong> - An instructor killed the chat from the Monitor screen</li>
    </ul>

    <h4>Actions</h4>
    <p>For each student row:</p>
    <ul>
      <li><strong>View Transcript</strong> - Open the full chat conversation</li>
      <li><strong>View Evaluation</strong> - See the AI-generated evaluation and score breakdown</li>
      <li><strong>Allow Re-chat</strong> - Toggle to allow/disallow a student to retry the case chat</li>
    </ul>

    <div className="help-callout">
      <strong>Tip:</strong> In Courses → Sections, use the chevron (→) or &quot;View Results&quot; on a section to open Results filtered for that section.
    </div>
  </>
);

export default ResultsHelp;

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
      <li><strong>Average Score</strong> - Mean score out of 15 points</li>
      <li><strong>Average Hints</strong> - Mean hints requested per chat</li>
      <li><strong>Completion Rate</strong> - Percentage of students who completed</li>
      <li><strong>Score Distribution</strong> - Histogram showing the distribution of scores (0-15)</li>
    </ul>
    <p>When multiple sections or cases are selected, additional breakdown tables show performance by each section and case.</p>

    <h4>Student Details</h4>
    <p>The student table shows individual results with these features:</p>
    <ul>
      <li><strong>Column Toggles</strong> - Click +/- buttons to show or hide optional columns (Status, Position, Persona, Score, Hints, Helpful, Time)</li>
      <li><strong>Sorting</strong> - Click any column header to sort by that column</li>
      <li><strong>Pagination</strong> - Choose how many records to display (10, 20, 50, 100)</li>
      <li><strong>Export CSV</strong> - Download the current view as a CSV file</li>
    </ul>

    <h4>Actions</h4>
    <p>For each student row:</p>
    <ul>
      <li><strong>View Transcript</strong> - Open the full chat conversation</li>
      <li><strong>View Evaluation</strong> - See the AI-generated evaluation and score breakdown</li>
      <li><strong>Allow Re-chat</strong> - Toggle to allow/disallow a student to retry the case chat</li>
    </ul>

    <div className="help-callout">
      <strong>Tip:</strong> Click on a section in the Courses - Sections list to jump directly to Results filtered for that section.
    </div>
  </>
);

export default ResultsHelp;

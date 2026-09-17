import React from 'react';

const IssueAnalyticsHelp: React.FC = () => (
  <>
    <h4>What it does</h4>
    <p>
      An AI reads the completed chat transcripts for one case and lists the themes students
      raised, how many students raised each one, which position each theme pushed them toward,
      and short <strong>verbatim</strong> quotes you can use to start a class discussion.
    </p>

    <h4>Three kinds of theme</h4>
    <ul>
      <li><strong>Topics</strong> — things students brought up on their own.</li>
      <li><strong>Arguments</strong> — reasoning students gave for or against a course of action.</li>
      <li><strong>Friction</strong> — where students got stuck, pushed back, or were confused.</li>
    </ul>

    <h4>Reading the numbers</h4>
    <p>
      “19 students · 41% of 47 analyzed (of 52 completed)” means 19 of the 47 transcripts that
      could be analyzed raised the theme. The other 5 completed chats had no saved transcript or
      almost no student text; the run lists why.
    </p>
    <p>
      The coloured bar shows which of the scenario’s positions the point leaned toward. If the
      scenario defines no positions, it shows for / against / mixed relative to the question
      students answered. Each student counts once per theme.
    </p>

    <h4>One case and one scenario at a time</h4>
    <p>
      Positions belong to a scenario, so a run covers a single scenario. You can include any
      number of your sections.
    </p>

    <h4>Cost</h4>
    <ul>
      <li>
        <strong>Estimate new analysis</strong> shows how many transcripts will be read, what it
        should cost, and whose weekly AI budget pays. Nothing is spent until you press
        <strong> Start analysis</strong>.
      </li>
      <li>
        Each transcript is read once per model. Running again later only pays for new or changed
        transcripts.
      </li>
      <li>
        If the weekly budget runs out part-way, the run stops and keeps what it finished.
        <strong> Resume</strong> continues from there.
      </li>
    </ul>

    <h4>Analyzing a sample</h4>
    <p>
      With a large class, choose <strong>Sample of</strong> a number under
      <strong> Transcripts to analyze</strong> to read only that many transcripts. Time and cost
      shrink in proportion: 40 of 144 is about a quarter of each. The estimate shows what
      analyzing all of them would cost, for comparison.
    </p>
    <ul>
      <li>
        Each section contributes its share of the sample, so every section is represented.
        Only transcripts that can be analyzed are drawn, so a sample of 40 reads 40.
      </li>
      <li>
        The same settings draw the same transcripts every time, so running a sample again costs
        nothing. Raising the size keeps the earlier transcripts and only pays for the new ones —
        unless more students have finished in the meantime, since new transcripts join the pool
        and can change which ones are drawn.
        <strong> Draw a different sample</strong> picks a new set.
      </li>
      <li>
        Percentages then describe the sample, so they are approximate. The run shows a margin
        (for example ±13 points for 40 of 138), and small differences between themes or between
        semesters may just be chance. Themes raised by only a few students may not appear at all.
      </li>
    </ul>

    <h4>Editing the themes</h4>
    <ul>
      <li>Untick a theme to leave it out of Present, Markdown, CSV and the printed handout.</li>
      <li><strong>Rename</strong> or <strong>Merge into…</strong> another theme. Merging moves its students and quotes.</li>
      <li>
        <strong>Add a theme the AI missed</strong>. The transcripts are then checked for it, one AI
        call each. You see the cost first.
      </li>
    </ul>

    <h4>Student names</h4>
    <p>
      Quotes are anonymous by default (“Student 4”), and names inside quotes are hidden.
      <strong> Show names</strong> reveals them. The CSV follows the same switch; with names off it
      has no names or student ids at all. Check before projecting or sharing.
    </p>

    <div className="help-callout">
      <strong>Tip:</strong> A ⚠ next to a saved analysis means some transcripts changed after it
      ran (for example, one was anonymized). Run it again to refresh; unchanged transcripts cost
      nothing.
    </div>
  </>
);

export default IssueAnalyticsHelp;

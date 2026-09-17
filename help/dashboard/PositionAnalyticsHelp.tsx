import React from 'react';

const PositionAnalyticsHelp: React.FC = () => (
  <>
    <h4>Why one case at a time?</h4>
    <p>
      Positions are defined per <strong>scenario</strong>, not per case. Two cases might both
      offer "Yes" and "No", but they are answering completely different questions, so adding
      their counts together produces a number that means nothing. Position Analytics therefore
      shows one case at a time.
    </p>
    <p>
      A case can also hold more than one scenario, each with its own protagonist, question and
      position set. When it does, you must pick a scenario too — otherwise the chart axes would
      mix positions from different questions.
    </p>

    <h4>What you can safely compare</h4>
    <ul>
      <li>
        <strong>Across sections</strong> — pick a case and scenario, then use the
        <code>By Section</code> tab. Every row shares the same positions, so the full
        distribution is comparable.
      </li>
      <li>
        <strong>Across cases</strong> — the <code>By Case</code> tab shows only the measures
        that survive being case-agnostic: number of chats, position-change rate, and average
        scores. It never merges positions.
      </li>
    </ul>

    <h4>Reading the non-data states</h4>
    <p>A blank row is not the same as a row of zeros. Rows are labeled:</p>
    <ul>
      <li><strong>Tracking off</strong> — position tracking is disabled for that section's copy of the assignment, so no positions were ever recorded. These rows are excluded from averages.</li>
      <li><strong>Scenario not offered</strong> — that section runs a different scenario of this case.</li>
      <li><strong>No chats yet</strong> — tracking is on and the scenario is offered, but nobody has finished.</li>
      <li><strong>&mdash;</strong> in the change-rate column — the assignment does not track position <em>change</em>, which is different from "nobody changed".</li>
    </ul>

    <div className="help-callout">
      <strong>Mixed tracking:</strong> if you select sections where some track positions and some
      don't, a banner appears letting you include or exclude the untracked ones. Excluding them is
      usually what you want, since including them inflates the denominator with students who were
      never asked for a position.
    </div>

    <h4>Status filter</h4>
    <p>
      Results are drawn from completed chats. Ticking <strong>Include incomplete chats</strong>
      adds in-progress, abandoned, canceled and killed chats to the position counts. Score panels
      stay on completed chats regardless, because an incomplete chat has no evaluation and would
      drag every average down without changing the score totals.
    </p>

    <h4>About this scenario</h4>
    <p>
      Chart axes use the short position <em>name</em> (for example <code>as_is</code>). Expand
      <strong>About this scenario</strong> under the filters to see the full wording each student
      actually saw, along with the question they were asked and each position's arguments.
    </p>
  </>
);

export default PositionAnalyticsHelp;

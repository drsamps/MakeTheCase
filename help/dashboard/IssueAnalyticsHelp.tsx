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

    <h4>Presenting in class</h4>
    <p>
      <strong>Present</strong> opens a full-screen deck of the themes you have ticked. It starts on
      a <strong>Summary of Student Issues</strong> page listing every Topic, Argument and Friction
      with how many students raised it — click one to jump straight to its slide, and use
      <strong> Summary</strong> (or <code>S</code>) on any slide to come back.
    </p>
    <ul>
      <li>
        Each slide opens with its quotes hidden, so you can pose the issue first.
        <strong> Show quotes</strong> (<code>Q</code>) reveals three.
      </li>
      <li>
        <strong>Other student quotes</strong> (<code>R</code>) brings up a different three. The
        three come from three different students whenever the theme has that many, and the deck works through the whole
        class before anyone is quoted twice, so you are not hearing from the same few people on
        every slide. The same slide keeps the same quotes until you ask for others, so you can
        page back and forth safely.
      </li>
      <li>
        Use <strong>− A +</strong> to size the text for the room and the width buttons to set how
        wide the slide runs. Keyboard: <code>+</code> / <code>−</code> and <code>[</code> /
        <code>]</code>.
      </li>
      <li>
        <strong>☾ Dark</strong> (<code>D</code>) switches to light text on a dark slide, which many
        projectors and darkened rooms show more clearly. Size, width and dark mode are all remembered
        for next time.
      </li>
    </ul>

    <h4>Student names</h4>
    <p>
      Students are shown as “Student 4” by default. <strong>Show names</strong> reveals who they
      are; in Present the name then becomes a link under each quote, so it only reaches the
      projector when you click it. The CSV follows the same switch; with names off it has no names
      or student ids at all.
    </p>
    <p>
      Names that students typed <em>inside</em> their answers — usually a classmate’s — are replaced
      with <code>[name]</code> at all times, whether Show names is on or off, everywhere quotes
      appear. The case protagonist’s name is left alone. This is a best-effort filter built from the names of every student enrolled in the analysed sections:
      it will miss an unusual spelling or someone outside the class, and it can occasionally
      redact an ordinary word that is also a student’s name. Read a slide before you project it if
      that matters.
    </p>

    <div className="help-callout">
      <strong>Tip:</strong> A ⚠ next to a saved analysis means some transcripts changed after it
      ran (for example, one was anonymized). Run it again to refresh; unchanged transcripts cost
      nothing.
    </div>
  </>
);

export default IssueAnalyticsHelp;

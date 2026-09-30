import React from 'react';

const TeachBackHelp: React.FC = () => (
  <>
    <h4>What Teach-Back Is</h4>
    <p>
      Every assignment runs one of two activities, chosen by <strong>Activity Mode</strong> at the top
      of Chat Options.
    </p>
    <ul>
      <li><strong>Case chat</strong> - the student argues a position with the case protagonist, who
        knows the case and pushes back.</li>
      <li><strong>Teach-back</strong> - the roles reverse. The AI plays someone who does <em>not</em>
        understand the reading, and the student has to make them understand it.</li>
    </ul>

    <h4>Setting One Up</h4>
    <ol>
      <li><strong>Create your audiences.</strong> Eight starters (a plain beginner, your
        grandmother, a classmate who skipped the reading, a sceptical colleague and more) come
        from one command - <code>npm run seed-audiences</code> - or you can add your own under
        Setup &rarr; Personas by ticking &quot;Teach-back audience&quot;. Both are listed in
        <code>docs/teach-back-setup.md</code>.</li>
      <li><strong>Upload the reading</strong> as the case document. Leave the teaching note and the
        arguments empty - teach-back does not use them.</li>
      <li><strong>Write the Chat Question</strong> as the thing to be explained, not a decision to be
        made: &quot;why safety stock rises with demand variability&quot;, not &quot;should we raise
        safety stock&quot;.</li>
      <li><strong>Write a teach-back rubric.</strong> This is the step that matters most. The default
        rubric was written for case chat.</li>
      <li><strong>Assign it</strong>, set Activity Mode to Teach-back, and tick your audiences under
        Allowed Audiences.</li>
    </ol>

    <h4>Choosing the Audience</h4>
    <p>
      An audience varies <em>who the listener is and how they react</em> - never what they know, and
      never how strictly the work is marked. Write the instructions that way. Students may be offered
      several and pick one. <strong>Sam, a curious beginner</strong> is the neutral default; reach for
      your grandmother or the sceptical colleague once a class is comfortable with the format.
    </p>
    <p>
      To tell the two kinds apart, look at the <strong>Activity</strong> column in
      Setup &rarr; Personas: <em>Teach-back</em> or <em>Case chat</em>. It follows the persona id -
      anything beginning <code>audience-</code> is a teach-back audience - so it always matches what
      students are actually offered.
    </p>
    <div className="help-callout">
      <strong>Why letting students choose is fair:</strong> the AI that listens and the AI that marks
      are two separate calls, and the marker is never told which audience was chosen. A warm, thankful
      audience cannot raise a score, and a sceptical one cannot lower it.
    </div>

    <h4>Hints</h4>
    <p>
      The audience does not know the reading, so it cannot hint about the content. Asking for a hint
      makes it rephrase <em>its own</em> question more simply and point at the phrase that confused it.
      That is exactly what a student who cannot tell what is being asked needs. One or two hints is a
      good setting for a class new to the activity; the usual score penalty still applies.
    </p>

    <h4>Minimum Words</h4>
    <p>
      Teach-back adds a floor on the <em>opening</em> explanation (default 15 words). A short opening is
      refused before any AI call, so nothing is charged and no chat is used up. Later replies have no
      floor - &quot;exactly, and that is the trap&quot; is a real contribution.
    </p>

    <h4>What the Student Sees at the End</h4>
    <p>
      The usual score and summary, plus a <strong>coverage strip</strong> showing which rubric criteria
      they got across and which they did not, with a quote from their own words where the marker found
      one.
    </p>

    <div className="help-callout">
      <strong>Teach-back is a practice activity.</strong> The audience has read the same document the
      student has, because MakeTheCase shows the student and the AI the same case text. It is asked not
      to fill in gaps, and it mostly will not - but that is a request, not a guarantee. Use teach-back
      for learning and low-stakes credit rather than for a heavily weighted grade.
    </div>
  </>
);

export default TeachBackHelp;

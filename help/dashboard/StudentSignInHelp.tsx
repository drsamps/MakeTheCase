import React from 'react';

const StudentSignInHelp: React.FC = () => (
  <>
    <h4>Students without a BYU NetID</h4>
    <p>
      Most students sign in with BYU NetID. A student who has no NetID signs in with an email and password
      instead. The form for that is hidden, so other students never see it:
    </p>
    <ul>
      <li><strong>On a computer</strong>: hold Ctrl (Cmd on a Mac) and click <strong>Click to login with BYU NetID</strong>.</li>
      <li><strong>On a phone or tablet</strong>: press and hold that button for about a second.</li>
    </ul>

    <h4>Giving a student an account</h4>
    <ul>
      <li>Click <strong>Add Student</strong>, leave <strong>Student ID</strong> blank, and enter the name, email, a password and the section.</li>
      <li>Send the student their email, password and the sign-in tip above.</li>
      <li>Forgotten password: use <strong>Reset Password</strong> on the student's row.</li>
    </ul>

    <h4>Students creating their own account</h4>
    <p>
      An admin can turn on <code>allow_student_self_register</code> (Admin → Settings → Other). The hidden form then
      shows a <strong>Create account</strong> tab. Students can only join a section that has an
      <strong> enrollment key</strong>, and only by typing it, so a section without a key can never be joined this way.
      BYU email addresses are refused there; BYU students use NetID.
    </p>

    <h4>Trying it yourself</h4>
    <ul>
      <li><strong>Student view ▾</strong> (dashboard header) opens the student page as your own preview student.
        <strong> Start as a new student</strong> clears it, so you see the first-time screens: section, enrollment key, first chat.</li>
      <li>Student view chats show in Monitor with a <strong>Student view</strong> badge and are left out of Results,
        Positions, Issue Analytics and student counts.</li>
      <li>To test <strong>Create account</strong>, use a private/incognito window and an address like
        <code>yourname+test1@gmail.com</code> (each +word is a new account). Delete test accounts here afterwards.</li>
    </ul>
  </>
);

export default StudentSignInHelp;

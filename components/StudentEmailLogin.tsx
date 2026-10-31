import React, { useEffect, useState } from 'react';
import { api } from '../services/apiClient';
import PasswordInput from './ui/PasswordInput';

interface PublicSection {
  section_id: string;
  section_title: string;
  year_term?: string;
  accept_new_students?: boolean | number;
  requires_enrollment_key?: boolean;
}

interface Props {
  /** Called after a successful sign-in or account creation (the student token is stored). */
  onSignedIn: () => void;
  onBack: () => void;
}

const inputClass =
  'w-full px-4 py-2 text-gray-900 bg-gray-100 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500';

/**
 * Email/password sign-in for students without a BYU NetID. Hidden behind Ctrl/Cmd-click or a
 * long press on the NetID button. "Create account" shows only when the admin setting
 * allow_student_self_register is on, and lists only sections that have an enrollment key.
 */
const StudentEmailLogin: React.FC<Props> = ({ onSignedIn, onBack }) => {
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [signupEnabled, setSignupEnabled] = useState(false);
  const [sections, setSections] = useState<PublicSection[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [enrollmentKey, setEnrollmentKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.auth.studentSignupEnabled().then((on) => {
      if (cancelled || !on) return;
      setSignupEnabled(true);
      api.get<PublicSection[]>('/sections/public').then(({ data }) => {
        if (cancelled || !data) return;
        setSections(data.filter((s) => Boolean(s.accept_new_students) && s.requires_enrollment_key));
      });
    });
    return () => { cancelled = true; };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = mode === 'signin'
      ? await api.auth.studentSignInWithPassword({ email, password })
      : await api.auth.studentRegister({
          first_name: firstName, last_name: lastName, email, password,
          section_id: sectionId, enrollment_key: enrollmentKey,
        });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSignedIn();
  };

  const tab = (m: 'signin' | 'register', label: string) => (
    <button
      type="button"
      onClick={() => { setMode(m); setError(null); }}
      className={`flex-1 py-2 text-sm font-medium border-b-2 bg-transparent ${
        mode === m ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {signupEnabled && (
        <div className="flex border-b border-gray-200">
          {tab('signin', 'Sign in')}
          {tab('register', 'Create account')}
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        {mode === 'register' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="se-first" className="block text-sm font-medium text-gray-700">First name</label>
              <input id="se-first" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                className={`${inputClass} mt-1`} autoComplete="given-name" required />
            </div>
            <div>
              <label htmlFor="se-last" className="block text-sm font-medium text-gray-700">Last name</label>
              <input id="se-last" value={lastName} onChange={(e) => setLastName(e.target.value)}
                className={`${inputClass} mt-1`} autoComplete="family-name" required />
            </div>
          </div>
        )}
        <div>
          <label htmlFor="se-email" className="block text-sm font-medium text-gray-700">Email address</label>
          <input id="se-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} mt-1`} autoComplete="email" placeholder="you@example.com" required />
        </div>
        <div>
          <label htmlFor="se-password" className="block text-sm font-medium text-gray-700">Password</label>
          <PasswordInput id="se-password" value={password} onChange={(e) => setPassword(e.target.value)}
            wrapperClassName="mt-1" className={inputClass}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined} required />
          {mode === 'register' && <p className="mt-1 text-xs text-gray-500">At least 8 characters.</p>}
        </div>
        {mode === 'register' && (
          <>
            <div>
              <label htmlFor="se-section" className="block text-sm font-medium text-gray-700">Your course section</label>
              <select id="se-section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}
                className={`${inputClass} mt-1`} required>
                <option value="" disabled>Select your course section...</option>
                {sections.map((s) => (
                  <option key={s.section_id} value={s.section_id}>
                    {s.section_title}{s.year_term ? ` (${s.year_term})` : ''}
                  </option>
                ))}
              </select>
              {sections.length === 0 && (
                <p className="mt-1 text-xs text-gray-500">No sections are open for new accounts. Ask your instructor to add you.</p>
              )}
            </div>
            <div>
              <label htmlFor="se-key" className="block text-sm font-medium text-gray-700">Enrollment key</label>
              <input id="se-key" value={enrollmentKey} onChange={(e) => setEnrollmentKey(e.target.value)}
                className={`${inputClass} mt-1`} autoComplete="off" required />
              <p className="mt-1 text-xs text-gray-500">Your instructor gives you this key.</p>
            </div>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400"
        >
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        {mode === 'signin' && (
          <p className="text-xs text-gray-500 text-center">Forgot your password? Ask your instructor to reset it.</p>
        )}
      </form>
      <div className="text-center">
        <button type="button" onClick={onBack}
          className="text-sm text-blue-600 hover:underline bg-transparent border-none p-0 cursor-pointer">
          Back to BYU NetID sign-in
        </button>
      </div>
    </div>
  );
};

export default StudentEmailLogin;

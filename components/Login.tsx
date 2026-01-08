import React, { useState } from 'react';
import { api } from '../services/apiClient';

interface LoginProps {
  onLoginSuccess: () => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const { error: signInError } = await api.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
    } else {
      onLoginSuccess();
    }
    setIsLoading(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="w-full max-w-sm p-8 space-y-6 bg-white rounded-2xl shadow-xl">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Instructor Dashboard</h1>
          <p className="mt-2 text-gray-600">Sign in with BYU NetID</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-6">
          <div className="text-center">
            <button
              type="button"
              onClick={() => api.auth.beginCasLogin('admin')}
              className="w-full px-4 py-2 font-semibold text-blue-700 bg-blue-100 rounded-lg hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Click to login with BYU NetID
            </button>
          </div>
          <div className="text-center text-sm text-gray-500">or sign in with email/password</div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 mt-1 text-gray-900 bg-gray-100 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
              placeholder="you@example.com"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 mt-1 text-gray-900 bg-gray-100 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400"
          >
            {isLoading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
        <div className="text-center">
          <button
            onClick={() => window.location.hash = ''}
            className="text-sm text-blue-600 hover:underline bg-transparent border-none p-0 cursor-pointer"
          >
            to Chatbot
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
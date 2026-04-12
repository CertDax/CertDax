import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import api from '../services/api';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [validating, setValidating] = useState(true);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setValidating(false);
      return;
    }
    api.post('/auth/verify-reset-token', { token })
      .then(() => setValidating(false))
      .catch((err) => {
        const detail = err?.response?.data?.detail || 'Reset link is invalid or expired.';
        setTokenError(detail);
        setValidating(false);
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setSuccess(true);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setError(axiosErr.response?.data?.detail || 'An error occurred');
      } else {
        setError('An error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">CertDax</h1>
          <p className="text-slate-400 mt-2">Reset password</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          {validating ? (
            <div className="text-center">
              <p className="text-slate-500">Validating token...</p>
            </div>
          ) : !token || tokenError ? (
            <div className="text-center">
              <p className="text-red-600 mb-4">{tokenError || 'Invalid reset link. No token found.'}</p>
              <Link
                to="/login"
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
              >
                Back to login
              </Link>
            </div>
          ) : success ? (
            <div className="text-center">
              <div className="bg-emerald-50 text-emerald-700 px-4 py-3 rounded-lg text-sm mb-4">
                Your password has been changed successfully.
              </div>
              <Link
                to="/login"
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
              >
                Go to login
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-slate-900 mb-6">
                Set new password
              </h2>

              {error && (
                <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    New password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    required
                    minLength={8}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Confirm password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    required
                    minLength={8}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-emerald-500 text-white py-2.5 rounded-lg hover:bg-emerald-600 transition-colors font-medium disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Save password'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  to="/login"
                  className="text-sm text-slate-500 hover:text-slate-700"
                >
                  Back to login
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

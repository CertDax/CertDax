import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, LogIn } from 'lucide-react';
import api from '../services/api';

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [isRegister, setIsRegister] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMessage, setForgotMessage] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [oidcConfig, setOidcConfig] = useState<{ enabled: boolean; display_name: string; provider_name: string } | null>(null);

  useEffect(() => {
    // Handle OIDC callback token
    const token = searchParams.get('token');
    if (token) {
      localStorage.setItem('token', token);
      navigate('/', { replace: true });
      return;
    }

    api.get('/setup/status').then(({ data }) => {
      if (data.needs_setup) {
        navigate('/setup', { replace: true });
        return;
      }
      setNeedsSetup(false);
    }).catch(() => {}).finally(() => setCheckingSetup(false));

    api.get('/oidc/config').then(({ data }) => {
      if (data?.enabled) setOidcConfig(data);
    }).catch(() => {});
  }, [searchParams, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isRegister ? '/auth/register' : '/auth/login';
      const body = isRegister
        ? { username, email, password }
        : { username, password };

      const { data } = await api.post(endpoint, body);
      localStorage.setItem('token', data.access_token);
      navigate('/');
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

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    setForgotMessage('');
    try {
      const { data } = await api.post('/auth/forgot-password', { email: forgotEmail });
      setForgotMessage(data.detail);
    } catch {
      setForgotMessage('An error occurred. Please try again later.');
    } finally {
      setForgotLoading(false);
    }
  };

  if (checkingSetup) return null;

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">CertDax</h1>
          <p className="text-slate-400 mt-2">SSL Certificate Dashboard</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          {showForgot ? (
            <>
              <h2 className="text-xl font-semibold text-slate-900 mb-6">
                Forgot password
              </h2>
              <p className="text-sm text-slate-500 mb-4">
                Enter your email address and we'll send you a link to reset your password.
              </p>

              {forgotMessage && (
                <div className="bg-emerald-50 text-emerald-700 px-4 py-3 rounded-lg text-sm mb-4">
                  {forgotMessage}
                </div>
              )}

              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Email address
                  </label>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full bg-emerald-500 text-white py-2.5 rounded-lg hover:bg-emerald-600 transition-colors font-medium disabled:opacity-50"
                >
                  {forgotLoading ? 'Sending...' : 'Send reset link'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <button
                  onClick={() => { setShowForgot(false); setForgotMessage(''); }}
                  className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  Back to login
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-slate-900 mb-6">
                {isRegister ? 'Create account' : 'Login'}
              </h2>

              {error && (
                <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {isRegister ? 'Username' : 'Email or username'}
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    required
                  />
                </div>

                {isRegister && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      required
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-emerald-500 text-white py-2.5 rounded-lg hover:bg-emerald-600 transition-colors font-medium disabled:opacity-50"
                >
                  {loading
                    ? 'Loading...'
                    : isRegister
                    ? 'Create account'
                    : 'Login'}
                </button>
              </form>

              {oidcConfig && !isRegister && (
                <div className="mt-4">
                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-200" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-white px-2 text-slate-400">or</span>
                    </div>
                  </div>
                  <a
                    href="/api/oidc/login"
                    className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white py-2.5 rounded-lg hover:bg-slate-700 transition-colors font-medium"
                  >
                    <LogIn className="w-4 h-4" />
                    Login with {oidcConfig.display_name}
                  </a>
                </div>
              )}

              <div className="mt-6 text-center space-y-2">
                {!isRegister && (
                  <button
                    onClick={() => setShowForgot(true)}
                    className="text-sm text-slate-500 hover:text-slate-700 block w-full"
                  >
                    Forgot password?
                  </button>
                )}
                {needsSetup && (
                  <button
                    onClick={() => {
                      setIsRegister(!isRegister);
                      setError('');
                    }}
                    className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
                  >
                    {isRegister
                      ? 'Already have an account? Log in'
                      : 'First time? Create an admin account'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

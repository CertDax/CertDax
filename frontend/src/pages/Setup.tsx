import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, User, Mail, ChevronRight, ChevronLeft, Check, Rocket } from 'lucide-react';
import api from '../services/api';

type Step = 'welcome' | 'admin' | 'smtp' | 'complete';

export default function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('welcome');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Admin fields
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  // SMTP fields
  const [configureSmtp, setConfigureSmtp] = useState(false);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpTls, setSmtpTls] = useState(true);
  const [smtpFromEmail, setSmtpFromEmail] = useState('');
  const [smtpFromName, setSmtpFromName] = useState('CertDax');

  // Certificate settings
  const [defaultCas, setDefaultCas] = useState(true);
  const [acmeEmail, setAcmeEmail] = useState('');

  const steps: Step[] = ['welcome', 'admin', 'smtp', 'complete'];
  const stepIndex = steps.indexOf(step);

  const handleComplete = async () => {
    setError('');
    setLoading(true);

    try {
      const body: Record<string, unknown> = {
        admin: { username, email, password },
      };

      if (configureSmtp && smtpHost) {
        body.smtp = {
          host: smtpHost,
          port: smtpPort,
          username: smtpUsername || null,
          password: smtpPassword || null,
          use_tls: smtpTls,
          from_email: smtpFromEmail,
          from_name: smtpFromName || null,
        };
      }

      body.default_cas_enabled = defaultCas;
      if (acmeEmail) body.acme_contact_email = acmeEmail;

      const { data } = await api.post('/setup/complete', body);
      localStorage.setItem('token', data.access_token);
      setStep('complete');
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

  const canProceedAdmin = username.length >= 3 && email.includes('@') && password.length >= 6 && password === passwordConfirm;
  const canProceedSmtp = !configureSmtp || (smtpHost !== '' && smtpFromEmail !== '');

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">CertDax</h1>
          <p className="text-slate-400 mt-2">Setup Wizard</p>
        </div>

        {/* Progress bar */}
        {step !== 'complete' && (
          <div className="flex items-center justify-center gap-2 mb-8">
            {['Welcome', 'Account', 'Email', 'Done'].map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  i < stepIndex ? 'bg-emerald-500 text-white' :
                  i === stepIndex ? 'bg-emerald-500 text-white' :
                  'bg-slate-700 text-slate-400'
                }`}>
                  {i < stepIndex ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`text-xs hidden sm:block ${i <= stepIndex ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {label}
                </span>
                {i < 3 && <div className={`w-8 h-0.5 ${i < stepIndex ? 'bg-emerald-500' : 'bg-slate-700'}`} />}
              </div>
            ))}
          </div>
        )}

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {error && (
            <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
              {error}
            </div>
          )}

          {/* Step: Welcome */}
          {step === 'welcome' && (
            <div className="text-center">
              <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Rocket className="w-10 h-10 text-emerald-500" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-3">
                Welcome to CertDax
              </h2>
              <p className="text-slate-500 mb-6">
                Thank you for installing CertDax! This wizard will help you set up everything
                so you can start managing your SSL certificates right away.
              </p>
              <div className="bg-slate-50 rounded-lg p-4 text-left text-sm text-slate-600 space-y-2">
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-emerald-500 shrink-0" />
                  <span>Create an administrator account</span>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-emerald-500 shrink-0" />
                  <span>Optionally configure your email server</span>
                </div>
              </div>
              <button
                onClick={() => setStep('admin')}
                className="mt-8 w-full flex items-center justify-center gap-2 bg-emerald-500 text-white py-3 rounded-lg hover:bg-emerald-600 transition-colors font-medium"
              >
                Get started
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Step: Admin Account */}
          {step === 'admin' && (
            <>
              <h2 className="text-xl font-semibold text-slate-900 mb-1">
                Administrator Account
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                Create the first account. This will automatically become an administrator.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                  />
                  {username.length > 0 && username.length < 3 && (
                    <p className="text-xs text-red-500 mt-1">At least 3 characters</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Email address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@example.com"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Confirm password
                  </label>
                  <input
                    type="password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                  />
                  {passwordConfirm.length > 0 && password !== passwordConfirm && (
                    <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                  )}
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  onClick={() => setStep('welcome')}
                  className="flex items-center justify-center gap-1 px-4 py-2.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors font-medium"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  onClick={() => { setError(''); setStep('smtp'); }}
                  disabled={!canProceedAdmin}
                  className="flex-1 flex items-center justify-center gap-2 bg-emerald-500 text-white py-2.5 rounded-lg hover:bg-emerald-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

          {/* Step: SMTP */}
          {step === 'smtp' && (
            <>
              <h2 className="text-xl font-semibold text-slate-900 mb-1">
                Email Server
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                Configure an SMTP server to receive email notifications.
                You can also set this up later.
              </p>

              <div className="mb-6">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className={`relative w-11 h-6 rounded-full transition-colors ${configureSmtp ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${configureSmtp ? 'translate-x-5' : ''}`} />
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={configureSmtp}
                      onChange={(e) => setConfigureSmtp(e.target.checked)}
                    />
                  </div>
                  <span className="text-sm font-medium text-slate-700">
                    Configure email server now
                  </span>
                </label>
              </div>

              {configureSmtp && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        SMTP Host
                      </label>
                      <input
                        type="text"
                        value={smtpHost}
                        onChange={(e) => setSmtpHost(e.target.value)}
                        placeholder="smtp.example.com"
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Port
                      </label>
                      <input
                        type="number"
                        value={smtpPort}
                        onChange={(e) => setSmtpPort(Number(e.target.value))}
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Username
                      </label>
                      <input
                        type="text"
                        value={smtpUsername}
                        onChange={(e) => setSmtpUsername(e.target.value)}
                        placeholder="optional"
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Password
                      </label>
                      <input
                        type="password"
                        value={smtpPassword}
                        onChange={(e) => setSmtpPassword(e.target.value)}
                        placeholder="optional"
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Sender email
                      </label>
                      <input
                        type="email"
                        value={smtpFromEmail}
                        onChange={(e) => setSmtpFromEmail(e.target.value)}
                        placeholder="noreply@example.com"
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Sender name
                      </label>
                      <input
                        type="text"
                        value={smtpFromName}
                        onChange={(e) => setSmtpFromName(e.target.value)}
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <div className={`relative w-11 h-6 rounded-full transition-colors ${smtpTls ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${smtpTls ? 'translate-x-5' : ''}`} />
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={smtpTls}
                        onChange={(e) => setSmtpTls(e.target.checked)}
                      />
                    </div>
                    <span className="text-sm font-medium text-slate-700">Use TLS</span>
                  </label>
                </div>
              )}

              {/* Certificate Settings */}
              <div className="mt-8 pt-6 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Certificate Authorities</h3>

                <label className="flex items-center gap-3 cursor-pointer mb-4">
                  <div className={`relative w-11 h-6 rounded-full transition-colors ${defaultCas ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${defaultCas ? 'translate-x-5' : ''}`} />
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={defaultCas}
                      onChange={(e) => setDefaultCas(e.target.checked)}
                    />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-slate-700">Enable Let's Encrypt CAs</span>
                    <p className="text-xs text-slate-400">Include built-in Let's Encrypt (staging &amp; production) for all groups</p>
                  </div>
                </label>

                {defaultCas && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      ACME contact email
                    </label>
                    <input
                      type="email"
                      value={acmeEmail}
                      onChange={(e) => setAcmeEmail(e.target.value)}
                      placeholder="admin@example.com"
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    />
                    <p className="text-xs text-slate-400 mt-1">Used by Let's Encrypt for expiry warnings and account recovery</p>
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  onClick={() => setStep('admin')}
                  className="flex items-center justify-center gap-1 px-4 py-2.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors font-medium"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  onClick={handleComplete}
                  disabled={!canProceedSmtp || loading}
                  className="flex-1 flex items-center justify-center gap-2 bg-emerald-500 text-white py-2.5 rounded-lg hover:bg-emerald-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Working...' : 'Complete installation'}
                  {!loading && <Check className="w-4 h-4" />}
                </button>
              </div>
            </>
          )}

          {/* Step: Complete */}
          {step === 'complete' && (
            <div className="text-center">
              <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Check className="w-10 h-10 text-emerald-500" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-3">
                Installation complete!
              </h2>
              <p className="text-slate-500 mb-8">
                Your CertDax is ready to use. You have been automatically logged in as administrator.
              </p>
              <button
                onClick={() => navigate('/')}
                className="w-full flex items-center justify-center gap-2 bg-emerald-500 text-white py-3 rounded-lg hover:bg-emerald-600 transition-colors font-medium"
              >
                Go to dashboard
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

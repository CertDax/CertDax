import { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon,
  Mail,
  Server,
  Save,
  Send,
  ShieldCheck,
  Loader2,
  CheckCircle,
  AlertCircle,
  KeyRound,
  Globe,
  Users,
  ShieldHalf,
} from 'lucide-react';
import api from '../services/api';

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const [host, setHost] = useState('');
  const [port, setPort] = useState(587);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hasExistingPassword, setHasExistingPassword] = useState(false);
  const [useTls, setUseTls] = useState(true);
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [enabled, setEnabled] = useState(false);

  const [testEmail, setTestEmail] = useState('');
  const [showTestForm, setShowTestForm] = useState(false);

  // OIDC state
  const [oidcLoading, setOidcLoading] = useState(true);
  const [oidcSaving, setOidcSaving] = useState(false);
  const [oidcTesting, setOidcTesting] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [providerName, setProviderName] = useState('oidc');
  const [displayName, setDisplayName] = useState('SSO');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [hasExistingClientSecret, setHasExistingClientSecret] = useState(false);
  const [issuerUrl, setIssuerUrl] = useState('');
  const [scopes, setScopes] = useState('openid profile email');
  const [autoCreateUsers, setAutoCreateUsers] = useState(true);
  const [defaultGroupId, setDefaultGroupId] = useState<number | null>(null);
  const [adminGroup, setAdminGroup] = useState('');
  const [groupClaim, setGroupClaim] = useState('groups');
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);

  // App settings state
  const [appSettingsLoading, setAppSettingsLoading] = useState(true);
  const [appSettingsSaving, setAppSettingsSaving] = useState(false);
  const [defaultCasEnabled, setDefaultCasEnabled] = useState(true);
  const [appTimezone, setAppTimezone] = useState('UTC');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [timezones, setTimezones] = useState<string[]>([]);
  const [tzFilter, setTzFilter] = useState('');

  useEffect(() => {
    api
      .get('/settings')
      .then(({ data }) => {
        if (data) {
          setHost(data.host);
          setPort(data.port);
          setUsername(data.username || '');
          setHasExistingPassword(data.has_password);
          setUseTls(data.use_tls);
          setFromEmail(data.from_email);
          setFromName(data.from_name || '');
          setEnabled(data.enabled);
        }
      })
      .finally(() => setLoading(false));

    api
      .get('/settings/oidc')
      .then(({ data }) => {
        if (data) {
          setOidcEnabled(data.enabled);
          setProviderName(data.provider_name);
          setDisplayName(data.display_name);
          setClientId(data.client_id);
          setHasExistingClientSecret(data.has_client_secret);
          setIssuerUrl(data.issuer_url);
          setScopes(data.scopes);
          setAutoCreateUsers(data.auto_create_users);
          setDefaultGroupId(data.default_group_id);
          setAdminGroup(data.admin_group || '');
          setGroupClaim(data.group_claim);
        }
      })
      .finally(() => setOidcLoading(false));

    api.get('/users/groups').then(({ data }) => setGroups(data)).catch(() => {});

    api
      .get('/settings/app')
      .then(({ data }) => {
        if (data) {
          setDefaultCasEnabled(data.default_cas_enabled);
          setAppTimezone(data.timezone || 'UTC');
          setApiBaseUrl(data.api_base_url || '');
        }
      })
      .finally(() => setAppSettingsLoading(false));

    api.get('/settings/timezones').then(({ data }) => setTimezones(data)).catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const body: Record<string, unknown> = {
        host,
        port,
        username: username || null,
        use_tls: useTls,
        from_email: fromEmail,
        from_name: fromName || null,
        enabled,
      };
      if (password) {
        body.password = password;
      }

      const { data } = await api.put('/settings', body);
      setHasExistingPassword(data.has_password);
      setPassword('');
      setSuccess('SMTP settings saved');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setError(axiosErr.response?.data?.detail || 'Error saving');
      } else {
        setError('Error saving');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testEmail) return;
    setError('');
    setSuccess('');
    setTesting(true);

    try {
      await api.post('/settings/test', { recipient: testEmail });
      setSuccess(`Test email sent to ${testEmail}`);
      setShowTestForm(false);
      setTestEmail('');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setError(axiosErr.response?.data?.detail || 'Test failed');
      } else {
        setError('Test failed');
      }
    } finally {
      setTesting(false);
    }
  };

  const handleOidcSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setOidcSaving(true);

    try {
      const body: Record<string, unknown> = {
        enabled: oidcEnabled,
        provider_name: providerName,
        display_name: displayName,
        client_id: clientId,
        issuer_url: issuerUrl,
        scopes,
        auto_create_users: autoCreateUsers,
        default_group_id: defaultGroupId,
        admin_group: adminGroup || null,
        group_claim: groupClaim,
      };
      if (clientSecret) {
        body.client_secret = clientSecret;
      }

      const { data } = await api.put('/settings/oidc', body);
      setHasExistingClientSecret(data.has_client_secret);
      setClientSecret('');
      setSuccess('OIDC settings saved');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setError(axiosErr.response?.data?.detail || 'Error saving OIDC');
      } else {
        setError('Error saving OIDC');
      }
    } finally {
      setOidcSaving(false);
    }
  };

  const handleAppSettingsSave = async () => {
    setError('');
    setSuccess('');
    setAppSettingsSaving(true);
    try {
      await api.put('/settings/app', { default_cas_enabled: defaultCasEnabled, timezone: appTimezone, api_base_url: apiBaseUrl });
      setSuccess('Application settings saved');
    } catch {
      setError('Error saving application settings');
    } finally {
      setAppSettingsSaving(false);
    }
  };

  const handleOidcTest = async () => {
    setError('');
    setSuccess('');
    setOidcTesting(true);

    try {
      const { data } = await api.post('/settings/oidc/test');
      setSuccess(`OIDC discovery successful — Issuer: ${data.issuer}`);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setError(axiosErr.response?.data?.detail || 'OIDC test failed');
      } else {
        setError('OIDC test failed');
      }
    } finally {
      setOidcTesting(false);
    }
  };

  if (loading || oidcLoading || appSettingsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
          <SettingsIcon className="w-7 h-7 text-slate-500" />
          Settings
        </h1>
        <p className="text-slate-500 mt-1">Manage system settings</p>
      </div>

      {success && (
        <div className="mb-6 flex items-center gap-2 bg-emerald-50 text-emerald-700 px-4 py-3 rounded-lg text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}
      {error && (
        <div className="mb-6 flex items-center gap-2 bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSave}>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Mail className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Email notifications (SMTP)</h2>
                <p className="text-sm text-slate-500">
                  Set up an SMTP server to notify group members by email
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              <span className="ml-2 text-sm font-medium text-slate-700">
                {enabled ? 'Active' : 'Inactive'}
              </span>
            </label>
          </div>

          <div className="space-y-6">
            {/* Server settings */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Server className="w-4 h-4" />
                Server settings
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    SMTP Host
                  </label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="e.g. smtp.gmail.com"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Port
                  </label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(parseInt(e.target.value) || 587)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. noreply@example.com"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm"
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
                    placeholder={hasExistingPassword ? '••••••••  (unchanged)' : 'Password'}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 mt-4">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useTls}
                    onChange={(e) => setUseTls(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
                <div>
                  <span className="text-sm font-medium text-slate-700">Use STARTTLS</span>
                  <p className="text-xs text-slate-400">Recommended for port 587</p>
                </div>
              </div>
            </div>

            {/* Sender settings */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Sender settings
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Sender email
                  </label>
                  <input
                    type="email"
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                    placeholder="e.g. noreply@example.com"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Sender name
                  </label>
                  <input
                    type="text"
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                    placeholder="CertDax"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Info box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-900">How do notifications work?</p>
                  <p className="text-sm text-blue-700 mt-1">
                    When a certificate is requested, issued, renewed, revoked, or when an error occurs,
                    all users in the same group will be notified by email.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            {!showTestForm ? (
              <button
                type="button"
                onClick={() => setShowTestForm(true)}
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium"
              >
                <Send className="w-4 h-4" />
                Send test email
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="test@example.com"
                  className="px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm w-64"
                />
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing || !testEmail}
                  className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium disabled:opacity-50"
                >
                  {testing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Send
                </button>
                <button
                  type="button"
                  onClick={() => { setShowTestForm(false); setTestEmail(''); }}
                  className="px-3 py-2.5 text-slate-400 hover:text-slate-600 text-sm"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save settings
          </button>
        </div>
      </form>

      {/* OIDC / SSO Settings */}
      <form onSubmit={handleOidcSave} className="mt-8">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-rose-100 rounded-lg flex items-center justify-center">
                <KeyRound className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Single Sign-On (OIDC / OAuth2)</h2>
                <p className="text-sm text-slate-500">
                  Configure SSO via Authentik, Keycloak, Microsoft Entra or another OIDC provider
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={oidcEnabled}
                onChange={(e) => setOidcEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-rose-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-500"></div>
              <span className="ml-2 text-sm font-medium text-slate-700">
                {oidcEnabled ? 'Active' : 'Inactive'}
              </span>
            </label>
          </div>

          <div className="space-y-6">
            {/* Provider settings */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Provider settings
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Provider type
                  </label>
                  <select
                    value={providerName}
                    onChange={(e) => {
                      setProviderName(e.target.value);
                      if (e.target.value === 'authentik') {
                        setDisplayName('Authentik');
                        setGroupClaim('groups');
                      } else if (e.target.value === 'keycloak') {
                        setDisplayName('Keycloak');
                        setGroupClaim('groups');
                      } else if (e.target.value === 'entra') {
                        setDisplayName('Microsoft');
                        setGroupClaim('groups');
                        setScopes('openid profile email');
                      }
                    }}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none text-sm"
                  >
                    <option value="authentik">Authentik</option>
                    <option value="keycloak">Keycloak</option>
                    <option value="entra">Microsoft Entra</option>
                    <option value="oidc">Other (OIDC)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Login button text
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Authentik, Microsoft"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none text-sm"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Issuer URL
                </label>
                <input
                  type="url"
                  value={issuerUrl}
                  onChange={(e) => setIssuerUrl(e.target.value)}
                  placeholder={
                    providerName === 'authentik'
                      ? 'https://auth.example.com/application/o/certdax'
                      : providerName === 'keycloak'
                      ? 'https://keycloak.example.com/realms/myrealm'
                      : providerName === 'entra'
                      ? 'https://login.microsoftonline.com/{tenant-id}/v2.0'
                      : 'https://idp.example.com'
                  }
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none text-sm"
                  required
                />
                <p className="text-xs text-slate-400 mt-1">
                  The base URL of your OIDC provider (discovery endpoint: /.well-known/openid-configuration)
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Client ID
                  </label>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Client Secret
                  </label>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={hasExistingClientSecret ? '••••••••  (unchanged)' : 'Client secret'}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none text-sm"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Scopes
                </label>
                <input
                  type="text"
                  value={scopes}
                  onChange={(e) => setScopes(e.target.value)}
                  placeholder="openid profile email"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none text-sm"
                />
              </div>
            </div>

            {/* User provisioning */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4" />
                User management
              </h3>

              <div className="flex items-center gap-3 mb-4">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoCreateUsers}
                    onChange={(e) => setAutoCreateUsers(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-rose-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-500"></div>
                </label>
                <div>
                  <span className="text-sm font-medium text-slate-700">Auto-create users</span>
                  <p className="text-xs text-slate-400">Automatically create an account on first SSO login</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Default group
                  </label>
                  <select
                    value={defaultGroupId ?? ''}
                    onChange={(e) => setDefaultGroupId(e.target.value ? Number(e.target.value) : null)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none text-sm"
                  >
                    <option value="">First group (default)</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">
                    Group where new SSO users will be placed
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Admin group (IdP)
                  </label>
                  <input
                    type="text"
                    value={adminGroup}
                    onChange={(e) => setAdminGroup(e.target.value)}
                    placeholder="e.g. certdax-admins"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none text-sm"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Users in this IdP group will automatically become administrators
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Group claim
                </label>
                <input
                  type="text"
                  value={groupClaim}
                  onChange={(e) => setGroupClaim(e.target.value)}
                  placeholder="groups"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Name of the claim in the OIDC token that contains the groups (usually "groups")
                </p>
              </div>
            </div>

            {/* Info box */}
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-rose-900">Redirect URI for your IdP</p>
                  <code className="text-sm text-rose-700 bg-rose-100 px-2 py-0.5 rounded mt-1 inline-block break-all">
                    {window.location.origin}/api/oidc/callback
                  </code>
                  <p className="text-sm text-rose-700 mt-2">
                    Add this URL as a redirect URI in your identity provider configuration.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleOidcTest}
            disabled={oidcTesting || !issuerUrl}
            className="flex items-center gap-2 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {oidcTesting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Globe className="w-4 h-4" />
            )}
            Test discovery
          </button>

          <button
            type="submit"
            disabled={oidcSaving}
            className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 disabled:bg-rose-300 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {oidcSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save OIDC settings
          </button>
        </div>
      </form>

      {/* Application Settings */}
      <div className="mt-8">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
              <ShieldHalf className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Application Settings</h2>
              <p className="text-sm text-slate-500">General application configuration</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="mb-2">
                <span className="text-sm font-medium text-slate-700">API Base URL</span>
                <p className="text-xs text-slate-400 mt-0.5">
                  Public URL used in agent install scripts. Leave empty to auto-detect from request headers.
                </p>
              </div>
              <input
                type="url"
                placeholder="https://certdax.example.com"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300"
              />
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
              <div>
                <span className="text-sm font-medium text-slate-700">Default Certificate Authorities</span>
                <p className="text-xs text-slate-400 mt-0.5">
                  Include built-in Let's Encrypt (staging &amp; production) CAs for all groups
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={defaultCasEnabled}
                  onChange={(e) => setDefaultCasEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                <span className="ml-2 text-sm font-medium text-slate-700">
                  {defaultCasEnabled ? 'On' : 'Off'}
                </span>
              </label>
            </div>

            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="mb-2">
                <span className="text-sm font-medium text-slate-700">Timezone</span>
                <p className="text-xs text-slate-400 mt-0.5">
                  Timezone used for timestamps in email notifications and certificates
                </p>
              </div>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search timezone..."
                  value={tzFilter}
                  onChange={(e) => setTzFilter(e.target.value)}
                  className="w-full mb-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
                <select
                  value={appTimezone}
                  onChange={(e) => { setAppTimezone(e.target.value); setTzFilter(''); }}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  size={5}
                >
                  {timezones
                    .filter((tz) => tz.toLowerCase().includes(tzFilter.toLowerCase()))
                    .map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">Current: <strong>{appTimezone}</strong></p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleAppSettingsSave}
            disabled={appSettingsSaving}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {appSettingsSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save application settings
          </button>
        </div>
      </div>
    </div>
  );
}

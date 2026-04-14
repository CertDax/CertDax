import { useEffect, useState } from 'react';
import { Plus, Server, Globe, Trash2, Mail, Check } from 'lucide-react';
import api from '../services/api';
import type { CertificateAuthority, DnsProvider } from '../types';

export default function Providers() {
  const [cas, setCas] = useState<CertificateAuthority[]>([]);
  const [dnsProviders, setDnsProviders] = useState<DnsProvider[]>([]);
  const [showDnsForm, setShowDnsForm] = useState(false);
  const [showCaForm, setShowCaForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingCaId, setEditingCaId] = useState<number | null>(null);
  const [editEmail, setEditEmail] = useState('');

  // DNS form state
  const [dnsName, setDnsName] = useState('');
  const [dnsType, setDnsType] = useState('cloudflare');
  const [cfApiToken, setCfApiToken] = useState('');
  const [transipLogin, setTransipLogin] = useState('');
  const [transipPrivateKey, setTransipPrivateKey] = useState('');
  const [hetznerApiToken, setHetznerApiToken] = useState('');
  const [doApiToken, setDoApiToken] = useState('');
  const [vultrApiKey, setVultrApiKey] = useState('');
  const [ovhEndpoint, setOvhEndpoint] = useState('ovh-eu');
  const [ovhAppKey, setOvhAppKey] = useState('');
  const [ovhAppSecret, setOvhAppSecret] = useState('');
  const [ovhConsumerKey, setOvhConsumerKey] = useState('');
  const [r53AccessKey, setR53AccessKey] = useState('');
  const [r53SecretKey, setR53SecretKey] = useState('');
  const [gcpProjectId, setGcpProjectId] = useState('');
  const [gcpServiceAccount, setGcpServiceAccount] = useState('');

  // CA form state
  const [caName, setCaName] = useState('');
  const [caUrl, setCaUrl] = useState('');
  const [caStaging, setCaStaging] = useState(false);
  const [caEmail, setCaEmail] = useState('');
  const [caEabKid, setCaEabKid] = useState('');
  const [caEabHmacKey, setCaEabHmacKey] = useState('');

  const fetchData = () => {
    Promise.all([api.get('/providers/cas'), api.get('/providers/dns')]).then(
      ([casRes, dnsRes]) => {
        setCas(casRes.data);
        setDnsProviders(dnsRes.data);
        setLoading(false);
      }
    );
  };

  useEffect(() => {
    fetchData();
  }, []);

  const resetDnsForm = () => {
    setDnsName('');
    setCfApiToken('');
    setTransipLogin('');
    setTransipPrivateKey('');
    setHetznerApiToken('');
    setDoApiToken('');
    setVultrApiKey('');
    setOvhEndpoint('ovh-eu');
    setOvhAppKey('');
    setOvhAppSecret('');
    setOvhConsumerKey('');
    setR53AccessKey('');
    setR53SecretKey('');
    setGcpProjectId('');
    setGcpServiceAccount('');
  };

  const handleAddDns = async (e: React.FormEvent) => {
    e.preventDefault();
    let credentials: Record<string, string> = {};
    if (dnsType === 'cloudflare') {
      if (!cfApiToken.trim()) { alert('API Token is required'); return; }
      credentials = { api_token: cfApiToken.trim() };
    } else if (dnsType === 'transip') {
      if (!transipLogin.trim() || !transipPrivateKey.trim()) { alert('Login and Private Key are required'); return; }
      credentials = { login: transipLogin.trim(), private_key: transipPrivateKey.trim() };
    } else if (dnsType === 'hetzner') {
      if (!hetznerApiToken.trim()) { alert('API Token is required'); return; }
      credentials = { api_token: hetznerApiToken.trim() };
    } else if (dnsType === 'digitalocean') {
      if (!doApiToken.trim()) { alert('API Token is required'); return; }
      credentials = { api_token: doApiToken.trim() };
    } else if (dnsType === 'vultr') {
      if (!vultrApiKey.trim()) { alert('API Key is required'); return; }
      credentials = { api_key: vultrApiKey.trim() };
    } else if (dnsType === 'ovh') {
      if (!ovhAppKey.trim() || !ovhAppSecret.trim() || !ovhConsumerKey.trim()) { alert('All OVH fields are required'); return; }
      credentials = { endpoint: ovhEndpoint, application_key: ovhAppKey.trim(), application_secret: ovhAppSecret.trim(), consumer_key: ovhConsumerKey.trim() };
    } else if (dnsType === 'route53') {
      if (!r53AccessKey.trim() || !r53SecretKey.trim()) { alert('Access Key and Secret Key are required'); return; }
      credentials = { access_key_id: r53AccessKey.trim(), secret_access_key: r53SecretKey.trim() };
    } else if (dnsType === 'gcloud') {
      if (!gcpProjectId.trim() || !gcpServiceAccount.trim()) { alert('Project ID and Service Account JSON are required'); return; }
      credentials = { project_id: gcpProjectId.trim(), service_account_json: gcpServiceAccount.trim() };
    }

    await api.post('/providers/dns', {
      name: dnsName,
      provider_type: dnsType,
      credentials,
    });
    setShowDnsForm(false);
    resetDnsForm();
    fetchData();
  };

  const handleAddCa = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/providers/cas', {
      name: caName,
      directory_url: caUrl,
      is_staging: caStaging,
      contact_email: caEmail || null,
      eab_kid: caEabKid || null,
      eab_hmac_key: caEabHmacKey || null,
    });
    setShowCaForm(false);
    setCaName('');
    setCaUrl('');
    setCaEmail('');
    setCaEabKid('');
    setCaEabHmacKey('');
    fetchData();
  };

  const handleSetEmail = async (ca: CertificateAuthority) => {
    if (!editEmail.trim()) return;
    await api.put(`/providers/cas/${ca.id}`, {
      name: ca.name,
      directory_url: ca.directory_url,
      is_staging: ca.is_staging,
      contact_email: editEmail.trim(),
    });
    setEditingCaId(null);
    setEditEmail('');
    fetchData();
  };

  const handleDeleteDns = async (id: number) => {
    if (!confirm('Are you sure?')) return;
    await api.delete(`/providers/dns/${id}`);
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Providers</h1>
      <p className="text-slate-500 mb-8">
        Manage Certificate Authorities and DNS providers
      </p>

      {/* Certificate Authorities */}
      <div className="mb-10">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Server className="w-5 h-5" />
            Certificate Authorities
          </h2>
          <button
            onClick={() => setShowCaForm(!showCaForm)}
            className="flex items-center gap-2 bg-blue-500 text-white px-3 py-2 rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>

        {showCaForm && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-4">
            <form onSubmit={handleAddCa} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={caName}
                    onChange={(e) => setCaName(e.target.value)}
                    placeholder="ZeroSSL"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    ACME Directory URL
                  </label>
                  <input
                    type="url"
                    value={caUrl}
                    onChange={(e) => setCaUrl(e.target.value)}
                    placeholder="https://acme.example.com/directory"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Contact email
                  </label>
                  <input
                    type="email"
                    value={caEmail}
                    onChange={(e) => setCaEmail(e.target.value)}
                    placeholder="admin@example.com"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={caStaging}
                      onChange={(e) => setCaStaging(e.target.checked)}
                      className="rounded text-blue-500 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-slate-700">
                      Staging environment
                    </span>
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    EAB KID <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={caEabKid}
                    onChange={(e) => setCaEabKid(e.target.value)}
                    placeholder="External Account Binding Key ID"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    EAB HMAC Key <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="password"
                    value={caEabHmacKey}
                    onChange={(e) => setCaEabHmacKey(e.target.value)}
                    placeholder="Base64url-encoded HMAC key"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCaForm(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium"
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                  ID
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                  Name
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                  URL
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                  Type
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                  EAB
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                  Account
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                  Contact email
                </th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase px-6 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {cas.map((ca) => (
                <tr key={ca.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4 text-sm text-slate-400 font-mono">
                    {ca.id}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    {ca.name}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500 max-w-xs truncate">
                    {ca.directory_url}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {ca.is_staging ? (
                      <span className="text-amber-600 bg-amber-50 px-2 py-1 rounded text-xs font-medium">
                        Staging
                      </span>
                    ) : (
                      <span className="text-emerald-600 bg-emerald-50 px-2 py-1 rounded text-xs font-medium">
                        Production
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {ca.has_eab ? (
                      <span className="text-blue-600 bg-blue-50 px-2 py-1 rounded text-xs font-medium">
                        Configured
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {ca.has_account ? (
                      <span className="text-emerald-600">Registered</span>
                    ) : (
                      <span className="text-slate-400">Not yet</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {editingCaId === ca.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleSetEmail(ca);
                        }}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          placeholder="admin@yourdomain.com"
                          className="px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm w-56"
                          autoFocus
                          required
                        />
                        <button
                          type="submit"
                          className="p-1.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600"
                          title="Save"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCaId(null);
                            setEditEmail('');
                          }}
                          className="text-xs text-slate-500 hover:text-slate-700"
                        >
                        Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2">
                        {ca.contact_email ? (
                          <span className="text-slate-700">{ca.contact_email}</span>
                        ) : (
                          <span className="text-slate-400 italic">Not set</span>
                        )}
                        <button
                          onClick={() => {
                            setEditingCaId(ca.id);
                            setEditEmail(ca.contact_email || '');
                          }}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium ml-2"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          {ca.contact_email ? 'Change' : 'Set'}
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {/* reserved for future delete action */}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* DNS Providers */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Globe className="w-5 h-5" />
            DNS Providers
          </h2>
          <button
            onClick={() => setShowDnsForm(!showDnsForm)}
            className="flex items-center gap-2 bg-emerald-500 text-white px-3 py-2 rounded-lg hover:bg-emerald-600 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>

        {showDnsForm && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-4">
            <form onSubmit={handleAddDns} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={dnsName}
                    onChange={(e) => setDnsName(e.target.value)}
                    placeholder="My Cloudflare account"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Type
                  </label>
                  <select
                    value={dnsType}
                    onChange={(e) => setDnsType(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
                  >
                    <option value="cloudflare">Cloudflare</option>
                    <option value="hetzner">Hetzner</option>
                    <option value="digitalocean">DigitalOcean</option>
                    <option value="vultr">Vultr</option>
                    <option value="ovh">OVH</option>
                    <option value="route53">AWS Route53</option>
                    <option value="gcloud">Google Cloud DNS</option>
                    <option value="transip">TransIP</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>
              </div>
              {dnsType === 'cloudflare' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">API Token</label>
                  <input type="password" value={cfApiToken} onChange={(e) => setCfApiToken(e.target.value)}
                    placeholder="Paste your Cloudflare API token here"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm" required />
                </div>
              )}
              {dnsType === 'hetzner' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">API Token</label>
                  <input type="password" value={hetznerApiToken} onChange={(e) => setHetznerApiToken(e.target.value)}
                    placeholder="Hetzner DNS API token"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm" required />
                </div>
              )}
              {dnsType === 'digitalocean' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">API Token</label>
                  <input type="password" value={doApiToken} onChange={(e) => setDoApiToken(e.target.value)}
                    placeholder="DigitalOcean Personal Access Token"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm" required />
                </div>
              )}
              {dnsType === 'vultr' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">API Key</label>
                  <input type="password" value={vultrApiKey} onChange={(e) => setVultrApiKey(e.target.value)}
                    placeholder="Vultr API key"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm" required />
                </div>
              )}
              {dnsType === 'ovh' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Endpoint</label>
                    <select value={ovhEndpoint} onChange={(e) => setOvhEndpoint(e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white text-sm">
                      <option value="ovh-eu">OVH Europe</option>
                      <option value="ovh-ca">OVH Canada</option>
                      <option value="ovh-us">OVH US</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Application Key</label>
                      <input type="text" value={ovhAppKey} onChange={(e) => setOvhAppKey(e.target.value)}
                        placeholder="Application Key"
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Application Secret</label>
                      <input type="password" value={ovhAppSecret} onChange={(e) => setOvhAppSecret(e.target.value)}
                        placeholder="Application Secret"
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Consumer Key</label>
                      <input type="password" value={ovhConsumerKey} onChange={(e) => setOvhConsumerKey(e.target.value)}
                        placeholder="Consumer Key"
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm" required />
                    </div>
                  </div>
                </>
              )}
              {dnsType === 'route53' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Access Key ID</label>
                    <input type="text" value={r53AccessKey} onChange={(e) => setR53AccessKey(e.target.value)}
                      placeholder="AKIAIOSFODNN7EXAMPLE"
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Secret Access Key</label>
                    <input type="password" value={r53SecretKey} onChange={(e) => setR53SecretKey(e.target.value)}
                      placeholder="Secret Access Key"
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm" required />
                  </div>
                </div>
              )}
              {dnsType === 'gcloud' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Project ID</label>
                    <input type="text" value={gcpProjectId} onChange={(e) => setGcpProjectId(e.target.value)}
                      placeholder="my-gcp-project"
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Service Account JSON</label>
                    <textarea value={gcpServiceAccount} onChange={(e) => setGcpServiceAccount(e.target.value)}
                      placeholder='Paste the full contents of your service account JSON file here'
                      rows={4}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-sm" required />
                  </div>
                </>
              )}
              {dnsType === 'transip' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Login</label>
                    <input type="text" value={transipLogin} onChange={(e) => setTransipLogin(e.target.value)}
                      placeholder="Your TransIP username"
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Private Key</label>
                    <textarea value={transipPrivateKey} onChange={(e) => setTransipPrivateKey(e.target.value)}
                      placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
                      rows={4}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-sm" required />
                  </div>
                </>
              )}
              {dnsType === 'manual' && (
                <p className="text-sm text-slate-500 italic">
                  With manual management, DNS records are shown in the console. No credentials needed.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDnsForm(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 text-sm font-medium"
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                  ID
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                  Name
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                  Type
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                  Status
                </th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase px-6 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {dnsProviders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                    No DNS providers configured yet
                  </td>
                </tr>
              ) : (
                dnsProviders.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-sm text-slate-400 font-mono">
                      {p.id}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">
                      {p.name}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500 capitalize">
                      {p.provider_type}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {p.is_active ? (
                        <span className="text-emerald-600 bg-emerald-50 px-2 py-1 rounded text-xs font-medium">
                          Active
                        </span>
                      ) : (
                        <span className="text-slate-400">Inactive</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleDeleteDns(p.id)}
                        className="text-red-500 hover:text-red-700 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Key, Plus, Trash2, Copy, Check, Eye, EyeOff, BookOpen, Terminal, Loader2, AlertTriangle } from 'lucide-react';
import api from '../services/api';

interface ApiKeyItem {
  id: number;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
}

export default function ApiDashboard() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showCreatedKey, setShowCreatedKey] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'keys' | 'docs'>('keys');

  const fetchKeys = () => {
    api.get('/api-keys')
      .then(({ data }) => setKeys(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchKeys(); }, []);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const { data } = await api.post('/api-keys', { name: newKeyName.trim() });
      setCreatedKey(data.key);
      setShowCreatedKey(true);
      setNewKeyName('');
      fetchKeys();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setError(axiosErr.response?.data?.detail || 'Failed to create key');
      } else {
        setError('Failed to create key');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/api-keys/${id}`);
      setKeys((prev) => prev.filter((k) => k.id !== id));
      setDeleteConfirm(null);
    } catch {
      setError('Failed to delete key');
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const baseUrl = `${window.location.origin}/api`;

  const examples = [
    // ── Certificates ──
    {
      title: 'List certificates',
      method: 'GET',
      path: '/certificates',
      description: 'List all ACME certificates in your group.',
      curl: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  ${baseUrl}/certificates | jq`,
    },
    {
      title: 'Get certificate details',
      method: 'GET',
      path: '/certificates/{id}',
      description: 'Retrieve full certificate details including PEM data. Replace {id} with the certificate ID.',
      curl: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  ${baseUrl}/certificates/1 | jq`,
    },
    {
      title: 'Request a new certificate',
      method: 'POST',
      path: '/certificates/request',
      description: 'Request a new ACME certificate via DNS-01 or HTTP-01 challenge. The domains array should contain the primary domain and any SANs.',
      curl: `curl -s -X POST \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "domains": ["example.com", "www.example.com"],
    "ca_id": 1,
    "challenge_type": "dns-01",
    "dns_provider_id": 1,
    "auto_renew": true
  }' \\
  ${baseUrl}/certificates/request | jq`,
    },
    {
      title: 'Renew a certificate',
      method: 'POST',
      path: '/certificates/{id}/renew',
      description: 'Trigger an immediate renewal for an existing certificate.',
      curl: `curl -s -X POST \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  ${baseUrl}/certificates/1/renew | jq`,
    },
    {
      title: 'Download certificate',
      method: 'GET',
      path: '/certificates/{id}/download/{type}',
      description: 'Download a certificate file. Type can be: cert, key, chain, fullchain, or combined.',
      curl: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  -o certificate.pem \\
  ${baseUrl}/certificates/1/download/fullchain`,
    },
    {
      title: 'Delete a certificate',
      method: 'DELETE',
      path: '/certificates/{id}',
      description: 'Permanently delete a certificate and its private key.',
      curl: `curl -s -X DELETE \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  ${baseUrl}/certificates/1 | jq`,
    },
    {
      title: 'Dashboard statistics',
      method: 'GET',
      path: '/certificates/stats',
      description: 'Get an overview of your certificate inventory: total, active, expiring soon, and expired counts.',
      curl: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  ${baseUrl}/certificates/stats | jq`,
    },
    // ── Self-Signed ──
    {
      title: 'List self-signed certificates',
      method: 'GET',
      path: '/self-signed',
      description: 'List all self-signed certificates in your group.',
      curl: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  ${baseUrl}/self-signed | jq`,
    },
    {
      title: 'Create self-signed certificate',
      method: 'POST',
      path: '/self-signed',
      description: 'Generate a new self-signed certificate. key_type must be "rsa" or "ec" (lowercase). For RSA, key_size can be 2048 or 4096. For EC, use 256 or 384.',
      curl: `curl -s -X POST \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "common_name": "internal.local",
    "san_domains": ["app.internal.local"],
    "organization": "My Company",
    "key_type": "rsa",
    "key_size": 4096,
    "validity_days": 365
  }' \\
  ${baseUrl}/self-signed | jq`,
    },
    // ── Agents ──
    {
      title: 'List agents',
      method: 'GET',
      path: '/agents',
      description: 'List all deployment agents registered in your group.',
      curl: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  ${baseUrl}/agents | jq`,
    },
    {
      title: 'Create a new agent',
      method: 'POST',
      path: '/agents',
      description: 'Register a new deployment agent. Returns the agent token and install script URL. Save the token — it is only shown once.',
      curl: `curl -s -X POST \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "web-server-01",
    "hostname": "10.0.0.5",
    "deploy_path": "/etc/ssl/certs",
    "reload_command": "systemctl reload nginx"
  }' \\
  ${baseUrl}/agents | jq`,
    },
    {
      title: 'Get agent install script',
      method: 'GET',
      path: '/agents/{id}/install-script',
      description: 'Download the install script for an agent. Pipe directly to sh to install and register the agent on the target host.',
      curl: `curl -fsSL \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  ${baseUrl}/agents/1/install-script | sudo sh`,
    },
    // ── Deployments ──
    {
      title: 'List deployments',
      method: 'GET',
      path: '/deployments',
      description: 'List all certificate-to-agent deployments.',
      curl: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  ${baseUrl}/deployments | jq`,
    },
    {
      title: 'Deploy certificate to agent',
      method: 'POST',
      path: '/deployments',
      description: 'Assign a certificate to an agent for automatic deployment. deploy_format can be "crt", "pem", or "pfx".',
      curl: `curl -s -X POST \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "certificate_id": 1,
    "target_id": 1,
    "deploy_format": "pem"
  }' \\
  ${baseUrl}/deployments | jq`,
    },
    // ── Providers ──
    {
      title: 'List Certificate Authorities',
      method: 'GET',
      path: '/providers/cas',
      description: 'List all Certificate Authorities available to your group.',
      curl: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  ${baseUrl}/providers/cas | jq`,
    },
    {
      title: 'List DNS providers',
      method: 'GET',
      path: '/providers/dns',
      description: 'List all DNS providers configured for your group.',
      curl: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  ${baseUrl}/providers/dns | jq`,
    },
  ];

  const methodColor = (method: string) => {
    switch (method) {
      case 'GET': return 'bg-blue-100 text-blue-700';
      case 'POST': return 'bg-emerald-100 text-emerald-700';
      case 'PUT': return 'bg-amber-100 text-amber-700';
      case 'DELETE': return 'bg-red-100 text-red-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-violet-100 rounded-lg flex items-center justify-center">
          <Key className="w-5 h-5 text-violet-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">API</h1>
          <p className="text-sm text-slate-500">
            Manage API keys and integrate CertDax into your workflows
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('keys')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'keys'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Key className="w-4 h-4" />
          API Keys
        </button>
        <button
          onClick={() => setActiveTab('docs')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'docs'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          Documentation
        </button>
      </div>

      {/* ─── API Keys Tab ─── */}
      {activeTab === 'keys' && (
        <div className="space-y-6">
          {/* Create new key */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-1">Create API Key</h2>
            <p className="text-sm text-slate-500 mb-4">
              API keys allow you to authenticate with the CertDax API from scripts, CI/CD pipelines, or tools like Ansible.
            </p>

            {error && (
              <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
                {error}
              </div>
            )}

            {createdKey && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-amber-800 mb-2">
                      Copy your API key now — it won't be shown again
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-white border border-amber-200 rounded px-3 py-2 text-sm font-mono text-slate-900 break-all">
                        {showCreatedKey ? createdKey : '••••••••••••••••••••••••••••••••'}
                      </code>
                      <button
                        onClick={() => setShowCreatedKey(!showCreatedKey)}
                        className="p-2 text-slate-500 hover:text-slate-700 transition-colors"
                        title={showCreatedKey ? 'Hide' : 'Show'}
                      >
                        {showCreatedKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => copyToClipboard(createdKey, 'new-key')}
                        className="p-2 text-slate-500 hover:text-slate-700 transition-colors"
                        title="Copy"
                      >
                        {copied === 'new-key' ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Key name (e.g. Ansible, CI/CD, Monitoring)"
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                maxLength={100}
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newKeyName.trim()}
                className="flex items-center gap-2 bg-violet-500 hover:bg-violet-600 disabled:bg-violet-300 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create
              </button>
            </div>
          </div>

          {/* Existing keys */}
          <div className="bg-white rounded-xl border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-900">Your API Keys</h2>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : keys.length === 0 ? (
              <div className="text-center py-12">
                <Key className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No API keys yet</p>
                <p className="text-xs text-slate-400">Create your first key above to get started</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {keys.map((k) => (
                  <div key={k.id} className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center shrink-0">
                        <Key className="w-4 h-4 text-slate-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{k.name}</p>
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <code className="bg-slate-50 px-1.5 py-0.5 rounded">{k.key_prefix}…</code>
                          <span>Created {formatDate(k.created_at)}</span>
                          {k.last_used_at && (
                            <span>Last used {formatDate(k.last_used_at)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div>
                      {deleteConfirm === k.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">Delete?</span>
                          <button
                            onClick={() => handleDelete(k.id)}
                            className="px-3 py-1.5 bg-red-500 text-white text-xs font-medium rounded-lg hover:bg-red-600 transition-colors"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(k.id)}
                          className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                          title="Delete key"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Documentation Tab ─── */}
      {activeTab === 'docs' && (
        <div className="space-y-6">
          {/* Quick start */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-1">Quick Start</h2>
            <p className="text-sm text-slate-500 mb-4">
              Authenticate by passing your API key as a Bearer token in the <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">Authorization</code> header.
            </p>
            <div className="bg-slate-900 rounded-lg p-4 relative group">
              <button
                onClick={() => copyToClipboard(`curl -s -H "Authorization: Bearer YOUR_API_KEY" ${baseUrl}/certificates | jq`, 'quickstart')}
                className="absolute top-3 right-3 p-1.5 rounded-md bg-slate-800 text-slate-400 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                title="Copy"
              >
                {copied === 'quickstart' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <pre className="text-sm font-mono text-emerald-400 whitespace-pre-wrap">
{`curl -s \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  ${baseUrl}/certificates | jq`}
              </pre>
            </div>
            <p className="text-xs text-slate-400 mt-3">
              Replace <code className="bg-slate-100 px-1 py-0.5 rounded">YOUR_API_KEY</code> with an actual API key from the API Keys tab.
              All endpoints return JSON. Your API key has the same permissions as your user account.
            </p>
          </div>

          {/* Base URL */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-1">Base URL</h2>
            <div className="flex items-center gap-3 mt-3">
              <code className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-mono text-slate-700">
                {baseUrl}
              </code>
              <button
                onClick={() => copyToClipboard(baseUrl, 'baseurl')}
                className="p-2.5 text-slate-500 hover:text-slate-700 transition-colors"
                title="Copy"
              >
                {copied === 'baseurl' ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* API Reference */}
          <div className="bg-white rounded-xl border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-900">API Reference</h2>
              <p className="text-sm text-slate-500">Common endpoints with copy-paste examples</p>
            </div>
            <div className="divide-y divide-slate-100">
              {examples.map((ex, i) => (
                <div key={i} className="px-6 py-5">
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className={`px-2 py-0.5 text-xs font-bold rounded ${methodColor(ex.method)}`}>
                      {ex.method}
                    </span>
                    <code className="text-sm font-mono text-slate-700">{ex.path}</code>
                  </div>
                  <p className="text-sm text-slate-900 font-medium mb-1">{ex.title}</p>
                  <p className="text-sm text-slate-500 mb-3">{ex.description}</p>
                  <div className="bg-slate-900 rounded-lg p-4 relative group">
                    <button
                      onClick={() => copyToClipboard(ex.curl, `ex-${i}`)}
                      className="absolute top-3 right-3 p-1.5 rounded-md bg-slate-800 text-slate-400 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                      title="Copy"
                    >
                      {copied === `ex-${i}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <div className="flex items-start gap-2">
                      <Terminal className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                      <pre className="text-sm font-mono text-emerald-400 whitespace-pre-wrap break-all">
                        {ex.curl}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

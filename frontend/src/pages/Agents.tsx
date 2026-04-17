import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  Plus,
  Monitor,
  Wifi,
  WifiOff,
  Terminal,
  Copy,
  Check,
  Eye,
  EyeOff,
  X,
  ChevronRight,
  BookOpen,
  Server,
  Download,
  Settings,
  Play,
} from 'lucide-react';
import api from '../services/api';
import type { DeploymentTarget } from '../types';
import StatusBadge from '../components/StatusBadge';

export default function Agents() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<DeploymentTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState<{
    id: number;
    name: string;
    token: string;
  } | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState('');
  const [showSetup, setShowSetup] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [deployPath, setDeployPath] = useState('/etc/ssl/certs');
  const [reloadCommand, setReloadCommand] = useState('');
  const [preDeployScript, setPreDeployScript] = useState('');
  const [postDeployScript, setPostDeployScript] = useState('');

  const fetchAgents = async () => {
    const { data } = await api.get('/agents');
    setAgents(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data } = await api.post('/agents', {
      name,
      hostname,
      deploy_path: deployPath,
      reload_command: reloadCommand || null,
      pre_deploy_script: preDeployScript || null,
      post_deploy_script: postDeployScript || null,
    });
    setShowAddForm(false);
    setShowInstallModal({
      id: data.id,
      name: data.name,
      token: data.agent_token,
    });
    setName('');
    setHostname('');
    setDeployPath('/etc/ssl/certs');
    setReloadCommand('');
    setPreDeployScript('');
    setPostDeployScript('');
    fetchAgents();
  };

  const copyToClipboard = (text: string, key: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  const getCurlCommand = () => {
    if (!showInstallModal) return '';
    const baseUrl = window.location.origin;
    return `curl -fsSL -H "Authorization: Bearer ${showInstallModal.token}" ${baseUrl}/api/agents/${showInstallModal.id}/install-script | sudo sh`;
  };

  const onlineCount = agents.filter((a) => a.status === 'online').length;
  const offlineCount = agents.filter((a) => a.status === 'offline').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl font-bold text-slate-900">Agents</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowSetup(!showSetup)}
            className="flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
          >
            <BookOpen className="w-4 h-4" />
            Installation guide
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 bg-emerald-500 text-white px-4 py-2 rounded-lg hover:bg-emerald-600 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Add agent
          </button>
        </div>
      </div>
      <p className="text-slate-500 mb-6">
        Manage your deploy agents and assign certificates
      </p>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Monitor className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{agents.length}</p>
              <p className="text-sm text-slate-500">Total agents</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
              <Wifi className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-600">{onlineCount}</p>
              <p className="text-sm text-slate-500">Online</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
              <WifiOff className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{offlineCount}</p>
              <p className="text-sm text-slate-500">Offline</p>
            </div>
          </div>
        </div>
      </div>

      {/* Setup Guide */}
      {showSetup && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Agent installation guide</h2>
                  <p className="text-blue-100 text-sm">Install the CertDax agent on your servers</p>
                </div>
              </div>
              <button
                onClick={() => setShowSetup(false)}
                className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="p-6">
            {/* Steps */}
            <div className="space-y-8">
              {/* Step 1 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-sm">
                  1
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-slate-900 mb-2 flex items-center gap-2">
                    <Plus className="w-4 h-4 text-blue-500" />
                    Register agent
                  </h3>
                  <p className="text-sm text-slate-600 mb-3">
                    Click <strong>"Add agent"</strong> above and fill in your server details.
                    After creation you'll receive an <strong>agent token</strong> and <strong>installation command</strong>.
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-xs text-amber-800">
                      <strong>Note:</strong> The token is only shown once.
                      Save it securely or use the curl command directly.
                    </p>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-sm">
                  2
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-slate-900 mb-2 flex items-center gap-2">
                    <Download className="w-4 h-4 text-blue-500" />
                    Install agent via curl
                  </h3>
                  <p className="text-sm text-slate-600 mb-3">
                    After creation you'll get a one-line installation command. Run it on the target server:
                  </p>
                  <div className="bg-slate-900 rounded-lg p-4 mb-3">
                    <pre className="text-sm text-emerald-400 font-mono whitespace-pre-wrap break-all">
{`curl -fsSL -H "Authorization: Bearer <TOKEN>" \\
  ${window.location.origin}/api/agents/<ID>/install-script | sudo sh`}
                    </pre>
                  </div>
                  <p className="text-xs text-slate-500">
                    This script automatically downloads the correct binary for your architecture (amd64, arm64, arm, 386),
                    creates the configuration and installs a systemd service.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-sm">
                  3
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-slate-900 mb-2 flex items-center gap-2">
                    <Settings className="w-4 h-4 text-blue-500" />
                    Manual installation (optional)
                  </h3>
                  <p className="text-sm text-slate-600 mb-3">
                    If the curl command is not available, you can install the agent manually:
                  </p>

                  <div className="space-y-3">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                      <p className="text-sm font-medium text-slate-700 mb-2">1. Download the binary</p>
                      <p className="text-xs text-slate-500 mb-3">
                        Choose the binary for your server's architecture:
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                        {(['amd64', 'arm64', 'arm', '386'] as const).map((arch) => (
                          <button
                            key={arch}
                            onClick={async () => {
                              try {
                                const resp = await api.get(`/agents/install/binary/${arch}`, { responseType: 'blob' });
                                const url = URL.createObjectURL(resp.data);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `certdax-agent-linux-${arch}`;
                                a.click();
                                URL.revokeObjectURL(url);
                              } catch { /* ignore */ }
                            }}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {arch}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-slate-500 mb-2">
                        Then copy it to the target server:
                      </p>
                      <div className="bg-slate-900 rounded p-3">
                        <code className="text-xs text-emerald-400 font-mono">
                          sudo cp certdax-agent-linux-amd64 /usr/local/bin/certdax-agent<br />
                          sudo chmod +x /usr/local/bin/certdax-agent
                        </code>
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                      <p className="text-sm font-medium text-slate-700 mb-2">2. Create configuration</p>
                      <div className="bg-slate-900 rounded p-3">
                        <pre className="text-xs text-emerald-400 font-mono">{`sudo mkdir -p /etc/certdax
sudo cat > /etc/certdax/config.yaml << 'EOF'
api_url: ${window.location.origin}/api
token: <YOUR_AGENT_TOKEN>
deploy_path: /etc/ssl/certs
poll_interval: 60
EOF`}</pre>
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                      <p className="text-sm font-medium text-slate-700 mb-2">3. Create systemd service</p>
                      <div className="bg-slate-900 rounded p-3">
                        <pre className="text-xs text-emerald-400 font-mono">{`sudo cat > /etc/systemd/system/certdax-agent.service << 'EOF'
[Unit]
Description=CertDax Agent
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/certdax-agent
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now certdax-agent`}</pre>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-sm">
                  4
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-slate-900 mb-2 flex items-center gap-2">
                    <Play className="w-4 h-4 text-blue-500" />
                    Assign certificates
                  </h3>
                  <p className="text-sm text-slate-600 mb-3">
                    Once the agent is online (you'll see it appear here with status <strong>"online"</strong>),
                    click <strong>"Manage"</strong> to assign certificates to the agent.
                    The agent automatically retrieves the certificates and deploys them to the configured path.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                      <Server className="w-6 h-6 text-emerald-600 mx-auto mb-1" />
                      <p className="text-xs font-medium text-emerald-800">Nginx / Apache</p>
                      <p className="text-xs text-emerald-600">/etc/ssl/certs</p>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                      <Server className="w-6 h-6 text-blue-600 mx-auto mb-1" />
                      <p className="text-xs font-medium text-blue-800">Postfix / Dovecot</p>
                      <p className="text-xs text-blue-600">/etc/ssl/mail</p>
                    </div>
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-center">
                      <Server className="w-6 h-6 text-purple-600 mx-auto mb-1" />
                      <p className="text-xs font-medium text-purple-800">Custom application</p>
                      <p className="text-xs text-purple-600">/opt/app/certs</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Supported architectures */}
            <div className="mt-8 pt-6 border-t border-slate-200">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Supported architectures</h3>
              <div className="flex flex-wrap gap-2">
                {['linux/amd64', 'linux/arm64', 'linux/arm', 'linux/386'].map((arch) => (
                  <span key={arch} className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-mono font-medium text-slate-700">
                    {arch}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h3 className="font-semibold text-slate-900 mb-4">Register new agent</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Webserver 01"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Hostname
                </label>
                <input
                  type="text"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="web01.example.com"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Deploy path
                </label>
                <input
                  type="text"
                  value={deployPath}
                  onChange={(e) => setDeployPath(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Reload command
                </label>
                <input
                  type="text"
                  value={reloadCommand}
                  onChange={(e) => setReloadCommand(e.target.value)}
                  placeholder="systemctl reload nginx"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Pre-deploy script <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={preDeployScript}
                  onChange={(e) => setPreDeployScript(e.target.value)}
                  placeholder={"#!/bin/bash\n# Executed before deployment"}
                  rows={4}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Post-deploy script <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={postDeployScript}
                  onChange={(e) => setPostDeployScript(e.target.value)}
                  placeholder={"#!/bin/bash\n# Executed after deployment"}
                  rows={4}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 text-sm font-medium"
              >
                Create agent
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Agent list */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-clip">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                Agent
              </th>
              <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                Status
              </th>
              <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                System
              </th>
              <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                IP Address
              </th>
              <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                Last seen
              </th>
              <th className="text-right text-xs font-medium text-slate-500 uppercase px-6 py-3">
                
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {agents.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                  <Monitor className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                  <p className="font-medium">No agents yet</p>
                  <p className="text-sm mt-1">
                    Add an agent to automatically deploy certificates
                  </p>
                </td>
              </tr>
            ) : (
              agents.map((agent) => (
                <tr
                  key={agent.id}
                  className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => navigate(`/agents/${agent.id}`)}
                >
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{agent.name}</p>
                      <p className="text-xs text-slate-500">{agent.hostname}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={agent.status} />
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {agent.agent_os && agent.agent_arch
                      ? `${agent.agent_os}/${agent.agent_arch}`
                      : '-'}
                    {agent.agent_version && (
                      <span className="ml-1 text-xs text-slate-400">
                        {agent.agent_version}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500 font-mono">
                    {agent.agent_ip || '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {agent.last_seen
                      ? format(new Date(agent.last_seen), 'd MMM yyyy HH:mm')
                      : 'Never'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      to={`/agents/${agent.id}`}
                      className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-700 font-medium"
                    >
                      Manage
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Install modal */}
      {showInstallModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Install agent: {showInstallModal.name}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  Run this command on the target server
                </p>
              </div>
              <button
                onClick={() => {
                  setShowInstallModal(null);
                  setShowToken(false);
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* curl command */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  <Terminal className="w-4 h-4 inline mr-1" />
                  Installation command
                </label>
                <div className="bg-slate-900 rounded-lg p-4 relative group">
                  <pre className="text-sm text-emerald-400 font-mono whitespace-pre-wrap break-all">
                    {getCurlCommand()}
                  </pre>
                  <button
                    onClick={() => copyToClipboard(getCurlCommand(), 'curl')}
                    className="absolute top-2 right-2 p-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
                  >
                    {copied === 'curl' ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Token */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Agent Token
                </label>
                <p className="text-xs text-amber-600 mb-2">
                  This token is only shown once. A new token will be generated with a new installation command.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-slate-100 border border-slate-200 px-4 py-2 rounded-lg text-sm font-mono text-slate-900 overflow-x-auto">
                    {showToken
                      ? showInstallModal.token
                      : '••••••••••••••••••••••••••••••••'}
                  </code>
                  <button
                    onClick={() => setShowToken(!showToken)}
                    className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg"
                  >
                    {showToken ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() =>
                      copyToClipboard(showInstallModal.token, 'token')
                    }
                    className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg"
                  >
                    {copied === 'token' ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Manual install */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-blue-800 mb-2">
                  Manual installation
                </h4>
                <p className="text-xs text-blue-700">
                  If the curl command doesn't work, you can manually copy the binary
                  to <code className="bg-blue-100 px-1 rounded">/usr/local/bin/certdax-agent</code> and
                  configure <code className="bg-blue-100 px-1 rounded">/etc/certdax/config.yaml</code> with
                  the API URL and token.
                </p>
              </div>
            </div>

            <div className="p-6 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => {
                  setShowInstallModal(null);
                  setShowToken(false);
                }}
                className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

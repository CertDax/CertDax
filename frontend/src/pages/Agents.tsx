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
  ShieldCheck,
} from 'lucide-react';
import api from '../services/api';
import type { DeploymentTarget } from '../types';
import StatusBadge from '../components/StatusBadge';

interface SelfSignedCA {
  id: number;
  common_name: string;
  expires_at: string | null;
}

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
  const [installShell, setInstallShell] = useState<'bash' | 'powershell'>('bash');

  // Windows agent state
  const [osType, setOsType] = useState<'linux' | 'windows'>('linux');
  const [windowsCaId, setWindowsCaId] = useState<number | ''>('');
  const [availableCAs, setAvailableCAs] = useState<SelfSignedCA[]>([]);
  const [loadingCAs, setLoadingCAs] = useState(false);

  // Install modal Windows state
  const [modalCaId, setModalCaId] = useState<number | ''>('');
  const [downloadingBinary, setDownloadingBinary] = useState(false);
  const [downloadingScript, setDownloadingScript] = useState(false);
  const [downloadingInstaller, setDownloadingInstaller] = useState(false);

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

  const fetchCAs = async () => {
    setLoadingCAs(true);
    try {
      const { data } = await api.get('/self-signed');
      setAvailableCAs((data as SelfSignedCA[]).filter((c: any) => c.is_ca === true));
    } finally {
      setLoadingCAs(false);
    }
  };

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch CAs when Windows OS is selected in either form or modal
  useEffect(() => {
    if (osType === 'windows') {
      if (availableCAs.length === 0) fetchCAs();
    }
  }, [osType]);

  useEffect(() => {
    if (showInstallModal && availableCAs.length === 0) {
      fetchCAs();
    }
  }, [showInstallModal]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data } = await api.post('/agents', {
      name,
      hostname,
      os_type: osType,
      deploy_path: osType === 'windows' ? 'C:\\ProgramData\\CertDax\\certs' : deployPath,
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
    // Pre-select the CA chosen during creation
    if (osType === 'windows' && windowsCaId) setModalCaId(windowsCaId);
    setName('');
    setHostname('');
    setOsType('linux');
    setDeployPath('/etc/ssl/certs');
    setWindowsCaId('');
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
    if (installShell === 'powershell') {
      return `$headers = @{ Authorization = "Bearer ${showInstallModal.token}" }\nInvoke-WebRequest -Uri "${baseUrl}/api/agents/${showInstallModal.id}/install-script" -Headers $headers -OutFile certdax-install.sh\n# Copy to target server and run: sudo sh certdax-install.sh`;
    }
    return `curl -fsSL -H "Authorization: Bearer ${showInstallModal.token}" ${baseUrl}/api/agents/${showInstallModal.id}/install-script | sudo sh`;
  };

  const downloadWindowsBinary = async () => {
    if (!showInstallModal || !modalCaId) return;
    setDownloadingBinary(true);
    try {
      const resp = await api.get(
        `/agents/${showInstallModal.id}/install/windows-binary?ca_id=${modalCaId}`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `certdax-agent-${showInstallModal.name.replace(/\s+/g, '_')}.exe`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingBinary(false);
    }
  };

  const downloadCACert = async () => {
    if (!showInstallModal || !modalCaId) return;
    try {
      const resp = await api.get(
        `/agents/${showInstallModal.id}/install/ca-cert?ca_id=${modalCaId}`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `certdax-ca-${showInstallModal.name.replace(/\s+/g, '_')}.crt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  const downloadWindowsScript = async () => {
    if (!showInstallModal || !modalCaId) return;
    setDownloadingScript(true);
    try {
      const resp = await api.get(
        `/agents/${showInstallModal.id}/install/windows-script?ca_id=${modalCaId}`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `install-certdax-agent-${showInstallModal.name.replace(/\s+/g, '_')}.ps1`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingScript(false);
    }
  };

  const downloadWindowsInstaller = async () => {
    if (!showInstallModal || !modalCaId) return;
    setDownloadingInstaller(true);
    try {
      const resp = await api.get(
        `/agents/${showInstallModal.id}/install/windows-installer?ca_id=${modalCaId}`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `certdax-agent-${showInstallModal.name.replace(/\s+/g, '_')}-setup.exe`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingInstaller(false);
    }
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
            {/* OS selection */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Target OS
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setOsType('linux'); setDeployPath('/etc/ssl/certs'); }}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${osType === 'linux' ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
                >
                  <Server className="w-4 h-4" />
                  Linux
                </button>
                <button
                  type="button"
                  onClick={() => { setOsType('windows'); setDeployPath('C:\\ProgramData\\CertDax\\certs'); if (availableCAs.length === 0) fetchCAs(); }}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${osType === 'windows' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
                >
                  <Monitor className="w-4 h-4" />
                  Windows
                </button>
              </div>
            </div>

            {/* Windows: CA selection */}
            {osType === 'windows' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-2 mb-3">
                  <ShieldCheck className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-blue-800">Code-signing CA required</p>
                    <p className="text-xs text-blue-600 mt-0.5">
                      Select a CA to sign the Windows agent binary. Install this CA as a Trusted Root
                      on the target machine to suppress SmartScreen warnings.
                    </p>
                  </div>
                </div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Signing CA
                </label>
                {loadingCAs ? (
                  <p className="text-sm text-slate-500">Loading CAs…</p>
                ) : availableCAs.length === 0 ? (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    No CA certificates found. Create a self-signed CA first under <strong>Self-Signed Certificates</strong>.
                  </p>
                ) : (
                  <select
                    value={windowsCaId}
                    onChange={(e) => setWindowsCaId(e.target.value === '' ? '' : Number(e.target.value))}
                    required={osType === 'windows'}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                  >
                    <option value="">Select a CA…</option>
                    {availableCAs.map((ca) => (
                      <option key={ca.id} value={ca.id}>{ca.common_name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

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
            {osType === 'linux' && (
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
            )}
            {osType === 'linux' && (
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
            )}
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
                disabled={osType === 'windows' && (availableCAs.length === 0 || windowsCaId === '')}
                className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
                OS
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
                <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
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
                  <td className="px-6 py-4">
                    {agent.os_type === 'windows' ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-medium">
                        {/* Windows logo */}
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
                          <path d="M0 3.449 9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
                        </svg>
                        Windows
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 text-slate-700 rounded-md text-xs font-medium">
                        {/* Linux / Tux logo */}
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
                          <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489.117.779.567 1.563 1.182 2.114.267.237.537.463.812.683-1.148 1.7-1.955 3.955-1.612 6.034.232 1.377.91 2.576 2.053 3.278 1.161.71 2.495.83 3.875.556 1.68-.338 3.437-1.41 4.968-2.897 1.532-1.488 2.864-3.386 3.684-5.523.819-2.137 1.082-4.547.568-6.827-.52-2.292-1.797-4.432-3.688-5.796-.94-.667-2.001-1.078-3.03-1.101zm1.032 1.714c.774.05 1.515.358 2.307.926 1.679 1.19 2.817 3.097 3.289 5.14.457 2.014.196 4.176-.534 6.115-.73 1.94-1.964 3.693-3.378 5.064-1.414 1.37-3.028 2.314-4.495 2.616-1.122.226-2.196.116-3.092-.43-.905-.552-1.447-1.519-1.624-2.618-.285-1.696.306-3.655 1.279-5.199.256-.408.52-.793.793-1.154-.028-.026-.055-.052-.082-.08-.476-.478-.899-.976-1.218-1.498-.32-.52-.55-1.057-.59-1.598-.04-.54.088-1.083.366-1.569.279-.485.716-.904 1.285-1.207.57-.303 1.27-.483 2.075-.483.8 0 1.594.19 2.32.555.726.364 1.374.902 1.855 1.573.48.67.778 1.465.806 2.302.028.836-.203 1.71-.68 2.479-.477.77-1.189 1.429-2.062 1.85-.87.42-1.879.604-2.9.484-.023-.003-.046-.006-.07-.01.09.278.226.543.41.789.183.245.407.472.671.68.264.207.568.394.906.55.338.155.71.28 1.108.358.398.079.824.108 1.265.08.44-.028.896-.112 1.355-.265.46-.153.923-.377 1.372-.68.45-.302.884-.676 1.29-1.123.405-.447.78-.97 1.1-1.57.32-.6.584-1.277.773-2.024.19-.747.302-1.563.302-2.427 0-.863-.112-1.744-.355-2.6-.243-.855-.621-1.683-1.14-2.43-.52-.748-1.186-1.415-1.99-1.929-.804-.514-1.748-.877-2.806-.952zm-3.29 5.63c.19 0 .351.038.476.106.125.069.213.164.264.278.05.114.062.242.033.37-.029.128-.1.254-.208.362-.108.108-.255.2-.434.262-.18.062-.39.093-.617.093-.228 0-.427-.03-.594-.09-.167-.06-.3-.147-.39-.254-.091-.107-.138-.229-.138-.354 0-.172.086-.338.254-.47.168-.132.41-.21.697-.21z"/>
                        </svg>
                        Linux
                      </span>
                    )}
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
      {showInstallModal && (() => {
        const agentRecord = agents.find(a => a.id === showInstallModal.id);
        const isWindows = agentRecord?.os_type === 'windows';
        return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Install agent: {showInstallModal.name}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {isWindows ? 'Windows agent installer' : 'Run this command on the target server'}
                </p>
              </div>
              <button
                onClick={() => { setShowInstallModal(null); setShowToken(false); setModalCaId(''); }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {isWindows ? (
                <>
                  {/* Windows installation flow */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-2">
                      <Monitor className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-blue-800">Windows Agent</p>
                        <p className="text-xs text-blue-600 mt-0.5">
                          The installer will download a signed binary, install the CA cert into
                          Trusted Root Certification Authorities, and register the agent as a Windows service.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* CA selector */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">
                      <ShieldCheck className="w-4 h-4 inline mr-1" />
                      Signing CA
                    </label>
                    <p className="text-xs text-slate-500 mb-2">
                      Select the CA that will sign the agent binary. This CA must be installed as a
                      Trusted Root on the target machine (the installer does this automatically).
                    </p>
                    {loadingCAs ? (
                      <p className="text-sm text-slate-500">Loading CAs…</p>
                    ) : availableCAs.length === 0 ? (
                      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                        No CA certificates found. Create a self-signed CA under <strong>Self-Signed Certificates</strong>.
                      </p>
                    ) : (
                      <select
                        value={modalCaId}
                        onChange={(e) => setModalCaId(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                      >
                        <option value="">Select a CA…</option>
                        {availableCAs.map((ca) => (
                          <option key={ca.id} value={ca.id}>{ca.common_name}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Primary: NSIS Windows Installer */}
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-2">Install</p>
                    <div className="border-2 border-emerald-200 bg-emerald-50 rounded-xl p-5">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="p-2 bg-emerald-100 rounded-lg flex-shrink-0">
                          <Download className="w-5 h-5 text-emerald-700" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-emerald-900">Windows Installer (.exe)</p>
                          <p className="text-xs text-emerald-700 mt-0.5">
                            A standard Windows setup wizard. Installs the CA cert, the signed agent binary,
                            writes the config, and registers the Windows service — all in one click.
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={downloadWindowsInstaller}
                        disabled={!modalCaId || downloadingInstaller}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        {downloadingInstaller ? 'Building installer…' : 'Download setup.exe'}
                      </button>
                      {!modalCaId && (
                        <p className="text-xs text-emerald-700 mt-2 text-center">Select a signing CA above to enable download</p>
                      )}
                      {modalCaId && (
                        <p className="text-xs text-slate-500 mt-2 text-center">
                          Run as administrator — wizard will guide through the install
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Secondary: alternatives */}
                  <details className="group">
                    <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700 select-none list-none flex items-center gap-1">
                      <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
                      Advanced / scripted install options
                    </summary>
                    <div className="mt-3 space-y-2">
                      {/* PowerShell script */}
                      <div className="border border-slate-200 rounded-lg p-4">
                        <p className="text-xs font-semibold text-slate-700 mb-1">PowerShell unattended installer</p>
                        <p className="text-xs text-slate-500 mb-2">
                          Same steps as the wizard but runs silently — useful for automation and RMM tools.
                        </p>
                        <button
                          onClick={downloadWindowsScript}
                          disabled={!modalCaId || downloadingScript}
                          className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {downloadingScript ? 'Generating…' : 'Download installer.ps1'}
                        </button>
                        {modalCaId && (
                          <p className="text-xs text-slate-400 mt-2">
                            Run: <code className="bg-slate-100 px-1 rounded">powershell -ExecutionPolicy Bypass -File installer.ps1</code>
                          </p>
                        )}
                      </div>

                      {/* Individual files */}
                      <div className="border border-slate-200 rounded-lg p-4">
                        <p className="text-xs font-semibold text-slate-700 mb-2">Individual files</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={downloadWindowsBinary}
                            disabled={!modalCaId || downloadingBinary}
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {downloadingBinary ? 'Signing…' : 'certdax-agent.exe (signed)'}
                          </button>
                          <button
                            onClick={downloadCACert}
                            disabled={!modalCaId}
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            CA Certificate (.crt)
                          </button>
                        </div>
                      </div>
                    </div>
                  </details>

                  {/* Windows cert deployment info */}
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-slate-700 mb-2">Certificate deployment on Windows</h4>
                    <ul className="space-y-1.5 text-xs text-slate-600">
                      <li className="flex items-start gap-2">
                        <span className="text-emerald-500 mt-0.5">▸</span>
                        <span><strong>Root CAs</strong> are installed into <code className="bg-slate-100 px-1 rounded">Cert:\LocalMachine\Root</code> (Trusted Root Certification Authorities)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-emerald-500 mt-0.5">▸</span>
                        <span><strong>Self-signed certificates</strong> are installed into <code className="bg-slate-100 px-1 rounded">Cert:\LocalMachine\My</code> (Personal)</span>
                      </li>
                    </ul>
                  </div>
                </>
              ) : (
                <>
                  {/* Linux installation flow */}
                  {/* curl command */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-semibold text-slate-700">
                        <Terminal className="w-4 h-4 inline mr-1" />
                        Installation command
                      </label>
                      <div className="flex rounded-md overflow-hidden border border-slate-300 text-xs">
                        <button
                          onClick={() => setInstallShell('bash')}
                          className={`px-2.5 py-0.5 font-medium transition-colors ${installShell === 'bash' ? 'bg-blue-100 text-blue-800' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                          Bash
                        </button>
                        <button
                          onClick={() => setInstallShell('powershell')}
                          className={`px-2.5 py-0.5 font-medium transition-colors border-l border-slate-300 ${installShell === 'powershell' ? 'bg-blue-100 text-blue-800' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                          PowerShell
                        </button>
                      </div>
                    </div>
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
                        onClick={() => copyToClipboard(showInstallModal.token, 'token')}
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
                </>
              )}
            </div>

            <div className="p-6 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => { setShowInstallModal(null); setShowToken(false); setModalCaId(''); }}
                className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}

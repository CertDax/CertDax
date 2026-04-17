import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Plus,
  Trash2,
  RefreshCw,
  Terminal,
  Copy,
  Check,
  Eye,
  EyeOff,
  ShieldCheck,
  FileLock2,
  X,
  Wifi,
  WifiOff,
  Pencil,
  FolderTree,
  Download,
  Monitor,
  ChevronRight,
  ScrollText,
} from 'lucide-react';
import api from '../services/api';
import type { AgentDetail, Certificate, SelfSignedCertificate } from '../types';
import StatusBadge from '../components/StatusBadge';

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [selfSignedCerts, setSelfSignedCerts] = useState<SelfSignedCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [selectedCertId, setSelectedCertId] = useState<string>('');
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [deployFormat, setDeployFormat] = useState('crt');

  // Install modal
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  // Windows installer state
  interface SelfSignedCA { id: number; common_name: string }
  const [availableCAs, setAvailableCAs] = useState<SelfSignedCA[]>([]);
  const [loadingCAs, setLoadingCAs] = useState(false);
  const [modalCaId, setModalCaId] = useState<number | ''>('');
  const [modalArch, setModalArch] = useState<'amd64' | 'arm64' | '386'>('amd64');
  const [downloadingInstaller, setDownloadingInstaller] = useState(false);
  const [downloadingScript, setDownloadingScript] = useState(false);

  // Edit settings
  const [editingSettings, setEditingSettings] = useState(false);
  const [editDeployPath, setEditDeployPath] = useState('');
  const [editReloadCommand, setEditReloadCommand] = useState('');
  const [editPreDeployScript, setEditPreDeployScript] = useState('');
  const [editPostDeployScript, setEditPostDeployScript] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  // Live logs modal
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState('');
  const logContainerRef = useRef<HTMLDivElement>(null);
  const prevLogCountRef = useRef(0);

  // Deleting state: keyed by "cert:ID" or "ss:ID" so we can match against
  // the backend's pending_removal_cert_ids / pending_removal_ss_ids lists.
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(new Set());
  // Ghost copies of certs being deleted — keeps the row visible even after
  // the backend removes the AgentCertificate record from assigned_certificates.
  const [ghostCerts, setGhostCerts] = useState<Map<string, import('../types').AgentCertificate>>(new Map());

  const fetchAgent = async () => {
    const { data } = await api.get(`/agents/${id}`);
    setAgent(data);
    setLoading(false);
  };

  const fetchCertificates = async () => {
    const [acmeRes, ssRes] = await Promise.all([
      api.get('/certificates'),
      api.get('/self-signed'),
    ]);
    setCertificates(acmeRes.data);
    setSelfSignedCerts(ssRes.data);
  };

  useEffect(() => {
    fetchAgent();
    fetchCertificates();
    const interval = setInterval(fetchAgent, 5000);
    return () => clearInterval(interval);
  }, [id]);

  // Auto-scroll log modal when new lines arrive
  useEffect(() => {
    const newCount = agent?.recent_logs?.length || 0;
    if (autoScroll && logContainerRef.current && newCount !== prevLogCountRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
    prevLogCountRef.current = newCount;
  }, [agent?.recent_logs, autoScroll]);

  // Clear deleting state only when the backend confirms the pending_removal
  // deployment is gone (i.e. the agent has actually processed and confirmed removal).
  // For certs that were never deployed, there's no pending_removal record, so
  // they clear as soon as the assignment disappears from assigned_certificates.
  useEffect(() => {
    if (!agent || deletingKeys.size === 0) return;
    const assignedCertIds = new Set(agent.assigned_certificates.map((ac) => ac.certificate_id).filter(Boolean));
    const assignedSsIds = new Set(agent.assigned_certificates.map((ac) => ac.self_signed_certificate_id).filter(Boolean));
    const pendingCertIds = new Set(agent.pending_removal_cert_ids ?? []);
    const pendingSsIds = new Set(agent.pending_removal_ss_ids ?? []);
    setDeletingKeys((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const key of next) {
        const [type, rawId] = key.split(':');
        const numId = Number(rawId);
        if (type === 'cert') {
          // Clear when: no longer assigned AND no longer pending_removal
          if (!assignedCertIds.has(numId) && !pendingCertIds.has(numId)) {
            next.delete(key); changed = true;
          }
        } else if (type === 'ss') {
          if (!assignedSsIds.has(numId) && !pendingSsIds.has(numId)) {
            next.delete(key); changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [agent?.assigned_certificates, agent?.pending_removal_cert_ids, agent?.pending_removal_ss_ids]);

  // Sync ghostCerts to deletingKeys — drop ghosts once their key is cleared
  useEffect(() => {
    if (ghostCerts.size === 0) return;
    setGhostCerts((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const key of [...next.keys()]) {
        if (!deletingKeys.has(key)) { next.delete(key); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [deletingKeys]);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCertId) return;
    const [type, idStr] = selectedCertId.split(':');
    const certId = Number(idStr);
    const body: Record<string, unknown> = {
      auto_deploy: autoDeploy,
      deploy_format: deployFormat,
    };
    if (type === 'ss') {
      body.self_signed_certificate_id = certId;
    } else {
      body.certificate_id = certId;
    }
    await api.post(`/agents/${id}/certificates`, body);
    setShowAssignForm(false);
    setSelectedCertId('');
    setAutoDeploy(true);
    setDeployFormat('crt');
    fetchAgent();
  };

  const handleUnassign = async (assignmentId: number) => {
    if (!confirm('Detach certificate from this agent?')) return;
    // Find the cert being removed so we can key by cert ID (not assignment ID,
    // which disappears from the backend immediately after DELETE).
    const ac = agent?.assigned_certificates.find((a) => a.id === assignmentId);
    const key = ac?.certificate_id
      ? `cert:${ac.certificate_id}`
      : ac?.self_signed_certificate_id
        ? `ss:${ac.self_signed_certificate_id}`
        : null;
    if (key && ac) {
      setDeletingKeys((prev) => new Set(prev).add(key));
      setGhostCerts((prev) => new Map(prev).set(key, ac));
    }
    try {
      await api.delete(`/agents/${id}/certificates/${assignmentId}`);
      // "Deleting" stays until the backend reports pending_removal is gone
      // (i.e. the agent has confirmed removal via the status callback).
    } catch (err) {
      alert('Error detaching certificate');
      if (key) {
        setDeletingKeys((prev) => { const next = new Set(prev); next.delete(key); return next; });
        setGhostCerts((prev) => { const next = new Map(prev); next.delete(key); return next; });
      }
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete agent? This cannot be undone.')) return;
    await api.delete(`/agents/${id}`);
    navigate('/agents');
  };

  const startEditSettings = () => {
    if (!agent) return;
    setEditDeployPath(agent.deploy_path);
    setEditReloadCommand(agent.reload_command || '');
    setEditPreDeployScript(agent.pre_deploy_script || '');
    setEditPostDeployScript(agent.post_deploy_script || '');
    setEditingSettings(true);
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await api.put(`/agents/${id}`, {
        deploy_path: editDeployPath,
        reload_command: editReloadCommand || null,
        pre_deploy_script: editPreDeployScript || null,
        post_deploy_script: editPostDeployScript || null,
      });
      await fetchAgent();
      setEditingSettings(false);
    } catch {
      alert('Error saving settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRegenerateToken = async () => {
    const { data } = await api.post(`/agents/${id}/regenerate-token`);
    setNewToken(data.agent_token);
    if (agent?.os_type === 'windows' && availableCAs.length === 0) {
      setLoadingCAs(true);
      try {
        const { data: caData } = await api.get('/self-signed');
        setAvailableCAs((caData as any[]).filter((c) => c.is_ca === true));
      } finally {
        setLoadingCAs(false);
      }
    }
    setShowInstallModal(true);
  };

  const downloadWindowsInstaller = async () => {
    if (!modalCaId) return;
    setDownloadingInstaller(true);
    try {
      const resp = await api.get(
        `/agents/${id}/install/windows-installer?ca_id=${modalCaId}&arch=${modalArch}`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `certdax-agent-${(agent?.name ?? id)?.toString().replace(/\s+/g, '_')}-setup.exe`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingInstaller(false);
    }
  };

  const downloadWindowsScript = async () => {
    if (!modalCaId) return;
    setDownloadingScript(true);
    try {
      const resp = await api.get(
        `/agents/${id}/install/windows-script?ca_id=${modalCaId}`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `install-certdax-agent-${(agent?.name ?? id)?.toString().replace(/\s+/g, '_')}.ps1`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingScript(false);
    }
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
    const baseUrl = window.location.origin;
    return `curl -fsSL -H "Authorization: Bearer ${newToken}" ${baseUrl}/api/agents/${id}/install-script | sudo sh`;
  };

  // Which certs are not yet assigned
  const assignedAcmeIds = new Set(
    agent?.assigned_certificates.filter((ac) => ac.certificate_id).map((ac) => ac.certificate_id) ?? []
  );
  const assignedSsIds = new Set(
    agent?.assigned_certificates.filter((ac) => ac.self_signed_certificate_id).map((ac) => ac.self_signed_certificate_id) ?? []
  );
  const availableAcmeCerts = certificates.filter((c) => !assignedAcmeIds.has(c.id));
  const availableSsCerts = selfSignedCerts.filter((c) => !assignedSsIds.has(c.id));

  if (loading || !agent) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start gap-3">
          <Link
            to="/agents"
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg mt-0.5 shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">{agent.name}</h1>
              <StatusBadge status={agent.status} />
              {agent.os_type === 'windows' ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-medium">
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
                    <path d="M0 3.449 9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
                  </svg>
                  Windows
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 text-slate-700 rounded-md text-xs font-medium">
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
                    <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489.117.779.567 1.563 1.182 2.114.267.237.537.463.812.683-1.148 1.7-1.955 3.955-1.612 6.034.232 1.377.91 2.576 2.053 3.278 1.161.71 2.495.83 3.875.556 1.68-.338 3.437-1.41 4.968-2.897 1.532-1.488 2.864-3.386 3.684-5.523.819-2.137 1.082-4.547.568-6.827-.52-2.292-1.797-4.432-3.688-5.796-.94-.667-2.001-1.078-3.03-1.101zm1.032 1.714c.774.05 1.515.358 2.307.926 1.679 1.19 2.817 3.097 3.289 5.14.457 2.014.196 4.176-.534 6.115-.73 1.94-1.964 3.693-3.378 5.064-1.414 1.37-3.028 2.314-4.495 2.616-1.122.226-2.196.116-3.092-.43-.905-.552-1.447-1.519-1.624-2.618-.285-1.696.306-3.655 1.279-5.199.256-.408.52-.793.793-1.154-.028-.026-.055-.052-.082-.08-.476-.478-.899-.976-1.218-1.498-.32-.52-.55-1.057-.59-1.598-.04-.54.088-1.083.366-1.569.279-.485.716-.904 1.285-1.207.57-.303 1.27-.483 2.075-.483.8 0 1.594.19 2.32.555.726.364 1.374.902 1.855 1.573.48.67.778 1.465.806 2.302.028.836-.203 1.71-.68 2.479-.477.77-1.189 1.429-2.062 1.85-.87.42-1.879.604-2.9.484-.023-.003-.046-.006-.07-.01.09.278.226.543.41.789.183.245.407.472.671.68.264.207.568.394.906.55.338.155.71.28 1.108.358.398.079.824.108 1.265.08.44-.028.896-.112 1.355-.265.46-.153.923-.377 1.372-.68.45-.302.884-.676 1.29-1.123.405-.447.78-.97 1.1-1.57.32-.6.584-1.277.773-2.024.19-.747.302-1.563.302-2.427 0-.863-.112-1.744-.355-2.6-.243-.855-.621-1.683-1.14-2.43-.52-.748-1.186-1.415-1.99-1.929-.804-.514-1.748-.877-2.806-.952zm-3.29 5.63c.19 0 .351.038.476.106.125.069.213.164.264.278.05.114.062.242.033.37-.029.128-.1.254-.208.362-.108.108-.255.2-.434.262-.18.062-.39.093-.617.093-.228 0-.427-.03-.594-.09-.167-.06-.3-.147-.39-.254-.091-.107-.138-.229-.138-.354 0-.172.086-.338.254-.47.168-.132.41-.21.697-.21z"/>
                  </svg>
                  Linux
                </span>
              )}
            </div>
            <p className="text-slate-500 text-sm">{agent.hostname}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3 ml-11">
          <button
            onClick={() => setShowLogsModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 text-sm font-medium"
          >
            <ScrollText className="w-4 h-4" />
            Live Logs
            {(agent.recent_logs?.length || 0) > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">
                {agent.recent_logs.length > 99 ? '99+' : agent.recent_logs.length}
              </span>
            )}
          </button>
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 text-red-500 border border-red-200 rounded-lg hover:bg-red-50 text-sm font-medium"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <p className="text-xs text-slate-500 uppercase font-medium mb-1">Status</p>
          <div className="flex items-center gap-2">
            {agent.status === 'online' ? (
              <Wifi className="w-5 h-5 text-emerald-500" />
            ) : (
              <WifiOff className="w-5 h-5 text-red-500" />
            )}
            <span
              className={`font-semibold ${
                agent.status === 'online' ? 'text-emerald-600' : 'text-red-600'
              }`}
            >
              {agent.status === 'online' ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <p className="text-xs text-slate-500 uppercase font-medium mb-1">System</p>
          <p className="font-semibold text-slate-900">
            {agent.agent_os || 'Unknown'}
          </p>
          <p className="text-xs text-slate-500">
            {[agent.agent_arch, agent.agent_version ?? null]
              .filter(Boolean)
              .join(' · ') || 'Agent update needed'}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <p className="text-xs text-slate-500 uppercase font-medium mb-1">IP Address</p>
          <p className="font-semibold text-slate-900 font-mono text-sm break-all">
            {agent.agent_ip || '-'}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <p className="text-xs text-slate-500 uppercase font-medium mb-1">Last seen</p>
          <p className="font-semibold text-slate-900 text-sm">
            {agent.last_seen
              ? format(new Date(agent.last_seen), 'd MMM yyyy HH:mm')
              : 'Never'}
          </p>
        </div>
      </div>

      {/* Deployment stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <p className="text-xs text-slate-500 uppercase font-medium mb-1">
            Total deployments
          </p>
          <p className="text-2xl font-bold text-slate-900">{agent.deployment_count}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <p className="text-xs text-slate-500 uppercase font-medium mb-1">Successful</p>
          <p className="text-2xl font-bold text-emerald-600">{agent.deployed_count}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <p className="text-xs text-slate-500 uppercase font-medium mb-1">Failed</p>
          <p className="text-2xl font-bold text-red-600">{agent.failed_count}</p>
        </div>
      </div>

      {/* Agent group memberships */}
      {agent.agent_groups && agent.agent_groups.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
          <p className="text-xs text-slate-500 uppercase font-medium mb-2 flex items-center gap-1.5">
            <FolderTree className="w-3.5 h-3.5" />
            Agent Groups
          </p>
          <div className="flex flex-wrap gap-2">
            {agent.agent_groups.map((g) => (
              <Link
                key={g.id}
                to={`/agent-groups/${g.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 text-teal-700 rounded-lg text-sm font-medium hover:bg-teal-100 transition-colors"
              >
                <FolderTree className="w-3.5 h-3.5" />
                {g.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Install command section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Terminal className="w-5 h-5" />
            Agent installation
          </h2>
          <button
            onClick={handleRegenerateToken}
            className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <RefreshCw className="w-4 h-4" />
            Generate new installation command
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-3">
          Generate an installation command to install the agent on the target server. A new token will be generated.
        </p>
        {!editingSettings ? (
          <div className="bg-slate-100 rounded-lg p-4 text-sm text-slate-600 relative">
            <button
              onClick={startEditSettings}
              className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-blue-600 hover:bg-white rounded-lg transition-colors"
              title="Edit settings"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <p>Deploy path: <code className="bg-white px-2 py-0.5 rounded text-slate-900">{agent.deploy_path}</code></p>
            {agent.reload_command && (
              <p className="mt-1">{agent.os_type === 'windows' ? 'PowerShell command:' : 'Reload:'} <code className="bg-white px-2 py-0.5 rounded text-slate-900">{agent.reload_command}</code></p>
            )}
            {agent.pre_deploy_script && (
              <div className="mt-2">
                <p className="text-xs font-medium text-slate-500 mb-1">{agent.os_type === 'windows' ? 'Pre-deploy PowerShell script:' : 'Pre-deploy script:'}</p>
                <pre className="bg-white px-3 py-2 rounded text-xs text-slate-900 whitespace-pre-wrap font-mono">{agent.pre_deploy_script}</pre>
              </div>
            )}
            {agent.post_deploy_script && (
              <div className="mt-2">
                <p className="text-xs font-medium text-slate-500 mb-1">{agent.os_type === 'windows' ? 'Post-deploy PowerShell script:' : 'Post-deploy script:'}</p>
                <pre className="bg-white px-3 py-2 rounded text-xs text-slate-900 whitespace-pre-wrap font-mono">{agent.post_deploy_script}</pre>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Deploy path</label>
              <input
                type="text"
                value={editDeployPath}
                onChange={(e) => setEditDeployPath(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {agent.os_type === 'windows' ? 'PowerShell command after deployment' : 'Reload command'}
              </label>
              <input
                type="text"
                value={editReloadCommand}
                onChange={(e) => setEditReloadCommand(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder={agent.os_type === 'windows' ? 'e.g. Restart-Service -Name IIS' : 'e.g. systemctl reload nginx'}
              />
              {agent.os_type === 'windows' && (
                <p className="text-xs text-slate-400 mt-1">Runs via <code className="bg-slate-100 px-1 rounded">powershell.exe -Command</code> after each certificate deployment.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {agent.os_type === 'windows' ? 'Pre-deploy PowerShell script' : 'Pre-deploy script'}
              </label>
              <textarea
                value={editPreDeployScript}
                onChange={(e) => setEditPreDeployScript(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-sm"
                rows={4}
                placeholder={agent.os_type === 'windows' ? '# PowerShell script executed before deployment\nStop-Service -Name MyApp' : 'Bash script executed before deployment'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {agent.os_type === 'windows' ? 'Post-deploy PowerShell script' : 'Post-deploy script'}
              </label>
              <textarea
                value={editPostDeployScript}
                onChange={(e) => setEditPostDeployScript(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-sm"
                rows={4}
                placeholder={agent.os_type === 'windows' ? '# PowerShell script executed after deployment\nStart-Service -Name MyApp' : 'Bash script executed after deployment'}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingSettings(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={savingSettings || !editDeployPath}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium disabled:opacity-50"
              >
                {savingSettings ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Assigned certificates */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            Assigned certificates
          </h2>
          <div className="flex flex-wrap gap-2">
            <Link
              to={`/certificates/new?agent=${id}`}
              className="flex items-center gap-1.5 bg-emerald-500 text-white px-3 py-2 rounded-lg hover:bg-emerald-600 transition-colors text-xs sm:text-sm font-medium"
            >
              <ShieldCheck className="w-4 h-4" />
              New ACME certificate
            </Link>
            <Link
              to={`/self-signed?agent=${id}`}
              className="flex items-center gap-1.5 bg-amber-500 text-white px-3 py-2 rounded-lg hover:bg-amber-600 transition-colors text-xs sm:text-sm font-medium"
            >
              <FileLock2 className="w-4 h-4" />
              New self-signed certificate
            </Link>
            <button
              onClick={() => setShowAssignForm(!showAssignForm)}
              className="flex items-center gap-1.5 bg-blue-500 text-white px-3 py-2 rounded-lg hover:bg-blue-600 transition-colors text-xs sm:text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Assign certificate
            </button>
          </div>
        </div>

        {showAssignForm && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-4">
            <form onSubmit={handleAssign} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Certificate
                  </label>
                  <select
                    value={selectedCertId}
                    onChange={(e) => setSelectedCertId(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                    required
                  >
                    <option value="">Select certificate</option>
                    {availableAcmeCerts.length > 0 && (
                      <optgroup label="ACME Certificates">
                        {availableAcmeCerts.map((c) => (
                          <option key={`acme:${c.id}`} value={`acme:${c.id}`}>
                            {c.common_name} ({c.status})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {availableSsCerts.length > 0 && (
                      <optgroup label="Self-Signed Certificates">
                        {availableSsCerts.map((c) => (
                          <option key={`ss:${c.id}`} value={`ss:${c.id}`}>
                            {c.common_name} (self-signed)
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Format
                  </label>
                  <select
                    value={deployFormat}
                    onChange={(e) => setDeployFormat(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                  >
                    <option value="crt">CRT (separate files)</option>
                    <option value="pem">PEM (combined)</option>
                    <option value="pfx">PFX (PKCS#12)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoDeploy}
                    onChange={(e) => setAutoDeploy(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-700">
                    Auto-deploy on changes
                  </span>
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAssignForm(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium"
                >
                  Assign
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-clip">
          {agent.assigned_certificates.length === 0 ? (
            <div className="px-6 py-8 text-center text-slate-400">
              <ShieldCheck className="w-10 h-10 mx-auto mb-2 text-slate-300" />
              <p>No certificates assigned yet</p>
              <p className="text-sm mt-1">
                Assign certificates so they are automatically deployed to this server
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">Certificate</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">Expires</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">Auto-deploy</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">Format</th>
                  <th className="text-right text-xs font-medium text-slate-500 uppercase px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {/* ACME Certificates */}
                {(() => {
                  const assignedIds = new Set(agent.assigned_certificates.map((ac) => ac.id));
                  const acmeGhosts = [...ghostCerts.entries()]
                    .filter(([key, ac]) => key.startsWith('cert:') && !assignedIds.has(ac.id))
                    .map(([, ac]) => ac);
                  const acmeCerts = [
                    ...agent.assigned_certificates.filter((ac) => ac.certificate_type !== 'self-signed'),
                    ...acmeGhosts,
                  ].sort((a, b) => (a.certificate_name || '').localeCompare(b.certificate_name || ''));
                  if (acmeCerts.length === 0) return null;
                  return (
                    <>
                      <tr>
                        <td colSpan={6} className="px-0 py-0">
                          <div className="flex items-center gap-2 px-6 py-2 bg-emerald-50 border-b border-emerald-200">
                            <ShieldCheck className="w-4 h-4 text-emerald-600" />
                            <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                              ACME Certificates ({acmeCerts.length})
                            </span>
                          </div>
                        </td>
                      </tr>
                      {acmeCerts.map((ac) => (
                        <tr key={ac.id} className="hover:bg-slate-50">
                          <td className="px-6 py-4">
                            <Link to={`/certificates/${ac.certificate_id}`} className="text-sm font-medium text-blue-600 hover:text-blue-700">
                              {ac.certificate_name || 'Unknown'}
                            </Link>
                          </td>
                          <td className="px-6 py-4">
                            <StatusBadge status={
                              deletingKeys.has(`cert:${ac.certificate_id}`)
                                ? 'deleting'
                                : ac.deployment_status === 'deployed'
                                  ? (ac.certificate_status || 'valid')
                                  : (ac.deployment_status || 'pending')
                            } />
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-500">{ac.expires_at ? format(new Date(ac.expires_at), 'd MMM yyyy') : '-'}</td>
                          <td className="px-6 py-4 text-sm">{ac.auto_deploy ? <span className="text-emerald-600 font-medium">On</span> : <span className="text-slate-400">Off</span>}</td>
                          <td className="px-6 py-4 text-sm text-slate-500 uppercase">{ac.deploy_format || 'crt'}</td>
                          <td className="px-6 py-4 text-right"><button onClick={() => handleUnassign(ac.id)} disabled={deletingKeys.has(`cert:${ac.certificate_id}`)} className="text-red-500 hover:text-red-700 p-1 disabled:opacity-40 disabled:cursor-not-allowed"><Trash2 className="w-4 h-4" /></button></td>
                        </tr>
                      ))}
                    </>
                  );
                })()}

                {/* Self-Signed Certificates */}
                {(() => {
                  const assignedIds = new Set(agent.assigned_certificates.map((ac) => ac.id));
                  const ssGhosts = [...ghostCerts.entries()]
                    .filter(([key, ac]) => key.startsWith('ss:') && !assignedIds.has(ac.id))
                    .map(([, ac]) => ac);
                  const ssCerts = [
                    ...agent.assigned_certificates.filter((ac) => ac.certificate_type === 'self-signed'),
                    ...ssGhosts,
                  ].sort((a, b) => (a.certificate_name || '').localeCompare(b.certificate_name || ''));
                  if (ssCerts.length === 0) return null;
                  return (
                    <>
                      <tr>
                        <td colSpan={6} className="px-0 py-0">
                          <div className="flex items-center gap-2 px-6 py-2 bg-amber-50 border-b border-amber-200 border-t border-t-slate-200">
                            <FileLock2 className="w-4 h-4 text-amber-600" />
                            <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                              Self-Signed Certificates ({ssCerts.length})
                            </span>
                          </div>
                        </td>
                      </tr>
                      {ssCerts.map((ac) => (
                        <tr key={ac.id} className="hover:bg-slate-50">
                          <td className="px-6 py-4">
                            <Link to={`/self-signed/${ac.self_signed_certificate_id}`} className="text-sm font-medium text-blue-600 hover:text-blue-700">
                              {ac.certificate_name || 'Unknown'}
                            </Link>
                          </td>
                          <td className="px-6 py-4">
                            <StatusBadge status={
                              deletingKeys.has(`ss:${ac.self_signed_certificate_id}`)
                                ? 'deleting'
                                : ac.deployment_status === 'deployed'
                                  ? (ac.certificate_status || 'valid')
                                  : (ac.deployment_status || 'pending')
                            } />
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-500">{ac.expires_at ? format(new Date(ac.expires_at), 'd MMM yyyy') : '-'}</td>
                          <td className="px-6 py-4 text-sm">{ac.auto_deploy ? <span className="text-emerald-600 font-medium">On</span> : <span className="text-slate-400">Off</span>}</td>
                          <td className="px-6 py-4 text-sm text-slate-500 uppercase">{ac.deploy_format || 'crt'}</td>
                          <td className="px-6 py-4 text-right"><button onClick={() => handleUnassign(ac.id)} disabled={deletingKeys.has(`ss:${ac.self_signed_certificate_id}`)} className="text-red-500 hover:text-red-700 p-1 disabled:opacity-40 disabled:cursor-not-allowed"><Trash2 className="w-4 h-4" /></button></td>
                        </tr>
                      ))}
                    </>
                  );
                })()}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

      {/* Live Logs modal */}
      {showLogsModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[85vh]">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-shrink-0">
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <ScrollText className="w-4 h-4 text-emerald-400" />
                Live Logs — {agent.name}
                <span className="text-xs text-slate-500">
                  ({agent.recent_logs?.length || 0} lines)
                </span>
              </h2>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
                  />
                  Auto-scroll
                </label>
                <button
                  onClick={() => {
                    const text = (agent.recent_logs || []).join('\n');
                    copyToClipboard(text, 'logs');
                  }}
                  className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"
                >
                  {copied === 'logs' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy
                </button>
                <button
                  onClick={() => setShowLogsModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* Log output */}
            <div
              ref={logContainerRef}
              className="overflow-auto flex-1 p-4 font-mono text-xs leading-5"
            >
              {agent.recent_logs && agent.recent_logs.length > 0 ? (
                agent.recent_logs.map((line, i) => {
                  const isError = /\bERROR\b/i.test(line);
                  const isWarn = /\bWARN\b/i.test(line);
                  return (
                    <div
                      key={i}
                      className={isError ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-slate-300'}
                    >
                      {line}
                    </div>
                  );
                })
              ) : (
                <div className="text-slate-500 text-center py-12">
                  No logs available yet. Logs appear after the first heartbeat.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Install modal */}
      {showInstallModal && newToken && (() => {
        const isWindows = agent.os_type === 'windows';
        const closeModal = () => { setShowInstallModal(false); setNewToken(''); setShowToken(false); setModalCaId(''); setModalArch('amd64'); };
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Install agent: {agent.name}</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    {isWindows ? 'Windows agent installer' : `Run on ${agent.hostname}`}
                  </p>
                </div>
                <button onClick={closeModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {isWindows ? (
                  <>
                    {/* Windows info banner */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-start gap-2">
                        <Monitor className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-blue-700">
                          The installer will trust the CA cert, install the signed agent binary, write the config, and register it as a Windows service.
                        </p>
                      </div>
                    </div>

                    {/* CA selector */}
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1">
                        <ShieldCheck className="w-4 h-4 inline mr-1" />Signing CA
                      </label>
                      <p className="text-xs text-slate-500 mb-2">Select the CA used to sign the agent binary.</p>
                      {loadingCAs ? (
                        <p className="text-sm text-slate-500">Loading CAs…</p>
                      ) : availableCAs.length === 0 ? (
                        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                          No CA certificates found. Create one under <strong>Self-Signed Certificates</strong>.
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

                    {/* Architecture selector */}
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1">Architecture</label>
                      <p className="text-xs text-slate-500 mb-2">
                        The PowerShell one-liner auto-detects this. Only needed for manual downloads below.
                      </p>
                      <div className="flex gap-2">
                        {(['amd64', 'arm64', '386'] as const).map((a) => (
                          <button
                            key={a}
                            onClick={() => setModalArch(a)}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                              modalArch === a
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400'
                            }`}
                          >
                            {a === 'amd64' ? 'x64 (AMD64)' : a === 'arm64' ? 'ARM64' : 'x86 (32-bit)'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Primary: PowerShell one-liner — no browser download = no SmartScreen */}
                    <div className="border-2 border-emerald-200 bg-emerald-50 rounded-xl p-5">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="p-2 bg-emerald-100 rounded-lg flex-shrink-0">
                          <Terminal className="w-5 h-5 text-emerald-700" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-emerald-900">
                            PowerShell one-liner{' '}
                            <span className="ml-1 text-xs font-normal bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded">Recommended</span>
                          </p>
                          <p className="text-xs text-emerald-700 mt-0.5">
                            Run in an elevated PowerShell session. Downloads without the browser — bypasses SmartScreen entirely.
                          </p>
                        </div>
                      </div>
                      {modalCaId ? (
                        <div className="bg-slate-900 rounded-lg p-3 relative">
                          <pre className="text-xs text-emerald-400 font-mono whitespace-pre-wrap break-all pr-8">{`iwr -useb "${window.location.origin}/api/agents/${id}/install/windows-script?ca_id=${modalCaId}&token=${localStorage.getItem('token') ?? ''}" | iex`}</pre>
                          <button
                            onClick={() => copyToClipboard(`iwr -useb "${window.location.origin}/api/agents/${id}/install/windows-script?ca_id=${modalCaId}&token=${localStorage.getItem('token') ?? ''}" | iex`, 'pscmd')}
                            className="absolute top-2 right-2 p-1.5 bg-slate-800 text-slate-300 rounded hover:bg-slate-700"
                          >
                            {copied === 'pscmd' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-emerald-700 text-center">Select a signing CA above to see the command</p>
                      )}
                    </div>

                    {/* Advanced options */}
                    <details className="group">
                      <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700 select-none list-none flex items-center gap-1">
                        <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
                        Advanced options
                      </summary>
                      <div className="mt-3 space-y-2">
                        {/* NSIS wizard */}
                        <div className="border border-slate-200 rounded-lg p-4">
                          <p className="text-xs font-semibold text-slate-700 mb-1">Windows Installer wizard (.exe)</p>
                          <p className="text-xs text-slate-500 mb-2">
                            Downloads via browser — SmartScreen may warn. Right-click → Properties → Unblock if needed.
                          </p>
                          <button
                            onClick={downloadWindowsInstaller}
                            disabled={!modalCaId || downloadingInstaller}
                            className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {downloadingInstaller ? 'Building installer…' : 'Download setup.exe'}
                          </button>
                        </div>

                        {/* PowerShell script download */}
                        <div className="border border-slate-200 rounded-lg p-4">
                          <p className="text-xs font-semibold text-slate-700 mb-1">PowerShell script only</p>
                          <button
                            onClick={downloadWindowsScript}
                            disabled={!modalCaId || downloadingScript}
                            className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {downloadingScript ? 'Generating…' : 'Download installer.ps1'}
                          </button>
                        </div>
                      </div>
                    </details>
                  </>
                ) : (
                  <>
                    {/* Linux install command */}
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        <Terminal className="w-4 h-4 inline mr-1" />
                        Installation command
                      </label>
                      <div className="bg-slate-900 rounded-lg p-4 relative">
                        <pre className="text-sm text-emerald-400 font-mono whitespace-pre-wrap break-all">
                          {getCurlCommand()}
                        </pre>
                        <button
                          onClick={() => copyToClipboard(getCurlCommand(), 'curl')}
                          className="absolute top-2 right-2 p-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700"
                        >
                          {copied === 'curl' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Token */}
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Agent Token</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-slate-100 border border-slate-200 px-4 py-2 rounded-lg text-sm font-mono text-slate-900 overflow-x-auto">
                          {showToken ? newToken : '••••••••••••••••••••••••••••••••'}
                        </code>
                        <button onClick={() => setShowToken(!showToken)} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
                          {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button onClick={() => copyToClipboard(newToken, 'token')} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
                          {copied === 'token' ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="p-6 border-t border-slate-200 flex justify-end">
                <button onClick={closeModal} className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 text-sm font-medium">
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

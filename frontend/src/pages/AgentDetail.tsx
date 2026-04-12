import { useEffect, useState } from 'react';
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
  const [copied, setCopied] = useState('');

  // Edit settings
  const [editingSettings, setEditingSettings] = useState(false);
  const [editDeployPath, setEditDeployPath] = useState('');
  const [editReloadCommand, setEditReloadCommand] = useState('');
  const [editPreDeployScript, setEditPreDeployScript] = useState('');
  const [editPostDeployScript, setEditPostDeployScript] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

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
    try {
      await api.delete(`/agents/${id}/certificates/${assignmentId}`);
    } catch (err) {
      alert('Error detaching certificate');
    }
    await fetchAgent();
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
    setShowInstallModal(true);
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
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Link
          to="/agents"
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{agent.name}</h1>
            <StatusBadge status={agent.status} />
          </div>
          <p className="text-slate-500 text-sm">{agent.hostname}</p>
        </div>
        <button
          onClick={handleDelete}
          className="px-4 py-2 text-red-500 border border-red-200 rounded-lg hover:bg-red-50 text-sm font-medium"
        >
          Delete
        </button>
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
          <p className="font-semibold text-slate-900 font-mono text-sm">
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
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
              <p className="mt-1">Reload: <code className="bg-white px-2 py-0.5 rounded text-slate-900">{agent.reload_command}</code></p>
            )}
            {agent.pre_deploy_script && (
              <div className="mt-2">
                <p className="text-xs font-medium text-slate-500 mb-1">Pre-deploy script:</p>
                <pre className="bg-white px-3 py-2 rounded text-xs text-slate-900 whitespace-pre-wrap font-mono">{agent.pre_deploy_script}</pre>
              </div>
            )}
            {agent.post_deploy_script && (
              <div className="mt-2">
                <p className="text-xs font-medium text-slate-500 mb-1">Post-deploy script:</p>
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Reload command</label>
              <input
                type="text"
                value={editReloadCommand}
                onChange={(e) => setEditReloadCommand(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="e.g. systemctl reload nginx"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Pre-deploy script</label>
              <textarea
                value={editPreDeployScript}
                onChange={(e) => setEditPreDeployScript(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-sm"
                rows={4}
                placeholder="Bash script executed before deployment"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Post-deploy script</label>
              <textarea
                value={editPostDeployScript}
                onChange={(e) => setEditPostDeployScript(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-sm"
                rows={4}
                placeholder="Bash script executed after deployment"
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

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden overflow-x-auto">
          {agent.assigned_certificates.length === 0 ? (
            <div className="px-6 py-8 text-center text-slate-400">
              <ShieldCheck className="w-10 h-10 mx-auto mb-2 text-slate-300" />
              <p>No certificates assigned yet</p>
              <p className="text-sm mt-1">
                Assign certificates so they are automatically deployed to this server
              </p>
            </div>
          ) : (
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
                  const acmeCerts = agent.assigned_certificates
                    .filter((ac) => ac.certificate_type !== 'self-signed')
                    .sort((a, b) => (a.certificate_name || '').localeCompare(b.certificate_name || ''));
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
                          <td className="px-6 py-4"><StatusBadge status={ac.certificate_status || 'unknown'} /></td>
                          <td className="px-6 py-4 text-sm text-slate-500">{ac.expires_at ? format(new Date(ac.expires_at), 'd MMM yyyy') : '-'}</td>
                          <td className="px-6 py-4 text-sm">{ac.auto_deploy ? <span className="text-emerald-600 font-medium">On</span> : <span className="text-slate-400">Off</span>}</td>
                          <td className="px-6 py-4 text-sm text-slate-500 uppercase">{ac.deploy_format || 'crt'}</td>
                          <td className="px-6 py-4 text-right"><button onClick={() => handleUnassign(ac.id)} className="text-red-500 hover:text-red-700 p-1"><Trash2 className="w-4 h-4" /></button></td>
                        </tr>
                      ))}
                    </>
                  );
                })()}

                {/* Self-Signed Certificates */}
                {(() => {
                  const ssCerts = agent.assigned_certificates
                    .filter((ac) => ac.certificate_type === 'self-signed')
                    .sort((a, b) => (a.certificate_name || '').localeCompare(b.certificate_name || ''));
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
                          <td className="px-6 py-4"><StatusBadge status={ac.certificate_status || 'unknown'} /></td>
                          <td className="px-6 py-4 text-sm text-slate-500">{ac.expires_at ? format(new Date(ac.expires_at), 'd MMM yyyy') : '-'}</td>
                          <td className="px-6 py-4 text-sm">{ac.auto_deploy ? <span className="text-emerald-600 font-medium">On</span> : <span className="text-slate-400">Off</span>}</td>
                          <td className="px-6 py-4 text-sm text-slate-500 uppercase">{ac.deploy_format || 'crt'}</td>
                          <td className="px-6 py-4 text-right"><button onClick={() => handleUnassign(ac.id)} className="text-red-500 hover:text-red-700 p-1"><Trash2 className="w-4 h-4" /></button></td>
                        </tr>
                      ))}
                    </>
                  );
                })()}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Install modal */}
      {showInstallModal && newToken && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Installation command
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  Run this command on {agent.hostname}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowInstallModal(false);
                  setNewToken('');
                  setShowToken(false);
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
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
                    {copied === 'curl' ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Agent Token
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-slate-100 border border-slate-200 px-4 py-2 rounded-lg text-sm font-mono text-slate-900 overflow-x-auto">
                    {showToken ? newToken : '••••••••••••••••••••••••••••••••'}
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
                    onClick={() => copyToClipboard(newToken, 'token')}
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
            </div>

            <div className="p-6 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => {
                  setShowInstallModal(false);
                  setNewToken('');
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

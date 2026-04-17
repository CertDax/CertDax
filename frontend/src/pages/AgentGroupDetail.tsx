import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Monitor,
  ShieldCheck,
  Wifi,
  WifiOff,
  Pencil,
  Check,
  X,
  FileLock2,
} from 'lucide-react';
import api from '../services/api';
import type {
  AgentGroupDetail,
  DeploymentTarget,
  Certificate,
  SelfSignedCertificate,
} from '../types';

export default function AgentGroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [group, setGroup] = useState<AgentGroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [allAgents, setAllAgents] = useState<DeploymentTarget[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [selfSignedCerts, setSelfSignedCerts] = useState<SelfSignedCertificate[]>([]);

  // Add member
  const [showAddMember, setShowAddMember] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('');

  // Assign certificate
  const [showAssignCert, setShowAssignCert] = useState(false);
  const [selectedCertId, setSelectedCertId] = useState('');
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [deployFormat, setDeployFormat] = useState('crt');

  // Edit
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const fetchGroup = async () => {
    const { data } = await api.get(`/agent-groups/${id}`);
    setGroup(data);
    setLoading(false);
  };

  const fetchAgents = async () => {
    const { data } = await api.get('/agents');
    setAllAgents(data);
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
    fetchGroup();
    fetchAgents();
    fetchCertificates();
  }, [id]);

  const handleDelete = async () => {
    if (!confirm('Delete agent group? The agents themselves will remain.')) return;
    await api.delete(`/agent-groups/${id}`);
    navigate('/agent-groups');
  };

  const handleAddMember = async () => {
    if (!selectedAgent) return;
    await api.post(`/agent-groups/${id}/members?target_id=${selectedAgent}`);
    setShowAddMember(false);
    setSelectedAgent('');
    fetchGroup();
  };

  const handleRemoveMember = async (targetId: number) => {
    if (!confirm('Remove agent from group?')) return;
    await api.delete(`/agent-groups/${id}/members/${targetId}`);
    fetchGroup();
  };

  const handleAssignCert = async () => {
    if (!selectedCertId) return;
    const [type, certId] = selectedCertId.split(':');
    const body: Record<string, unknown> = {
      auto_deploy: autoDeploy,
      deploy_format: deployFormat,
    };
    if (type === 'ss') {
      body.self_signed_certificate_id = Number(certId);
    } else {
      body.certificate_id = Number(certId);
    }
    await api.post(`/agent-groups/${id}/certificates`, body);
    setShowAssignCert(false);
    setSelectedCertId('');
    setAutoDeploy(true);
    setDeployFormat('crt');
    fetchGroup();
  };

  const startEdit = () => {
    if (!group) return;
    setEditName(group.name);
    setEditDescription(group.description || '');
    setEditing(true);
  };

  const handleSave = async () => {
    await api.put(`/agent-groups/${id}`, {
      name: editName,
      description: editDescription || null,
    });
    setEditing(false);
    fetchGroup();
  };

  // Available agents = those not already members
  const memberTargetIds = new Set(group?.members.map((m) => m.target_id) ?? []);
  const availableAgents = allAgents.filter((a) => !memberTargetIds.has(a.id));

  if (loading || !group) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Link
          to="/agent-groups"
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          {!editing ? (
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-slate-900">{group.name}</h1>
                <button
                  onClick={startEdit}
                  className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
              {group.description && (
                <p className="text-slate-500 text-sm">{group.description}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-2xl font-bold text-slate-900 border border-slate-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none min-w-0"
              />
              <input
                type="text"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Description"
                className="text-sm text-slate-500 border border-slate-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none min-w-0"
              />
              <button onClick={handleSave} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg">
                <Check className="w-5 h-5" />
              </button>
              <button onClick={() => setEditing(false)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
        <button
          onClick={handleDelete}
          className="px-4 py-2 text-red-500 border border-red-200 rounded-lg hover:bg-red-50 text-sm font-medium"
        >
          Delete
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <p className="text-xs text-slate-500 uppercase font-medium mb-1">Members</p>
          <p className="text-2xl font-bold text-slate-900">{group.members.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <p className="text-xs text-slate-500 uppercase font-medium mb-1">Online</p>
          <p className="text-2xl font-bold text-emerald-600">
            {group.members.filter((m) => m.target_status === 'online').length}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <p className="text-xs text-slate-500 uppercase font-medium mb-1">Offline</p>
          <p className="text-2xl font-bold text-red-600">
            {group.members.filter((m) => m.target_status !== 'online').length}
          </p>
        </div>
      </div>

      {/* Members */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Monitor className="w-5 h-5" />
            Group members
          </h2>
          <button
            onClick={() => setShowAddMember(!showAddMember)}
            className="flex items-center gap-2 bg-teal-500 text-white px-3 py-2 rounded-lg hover:bg-teal-600 text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Add agent
          </button>
        </div>

        {showAddMember && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-4">
            <div className="flex items-end gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">Agent</label>
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none bg-white"
                >
                  <option value="">Select agent</option>
                  {availableAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.hostname})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAddMember(false)}
                  className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddMember}
                  disabled={!selectedAgent}
                  className="px-4 py-2.5 bg-teal-500 text-white rounded-lg hover:bg-teal-600 text-sm font-medium disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-clip">
          {group.members.length === 0 ? (
            <div className="px-6 py-8 text-center text-slate-400">
              <Monitor className="w-10 h-10 mx-auto mb-2 text-slate-300" />
              <p>No agents in this group yet</p>
              <p className="text-sm mt-1">Add agents to deploy certificates to all members</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[500px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">Agent</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">Added</th>
                  <th className="text-right text-xs font-medium text-slate-500 uppercase px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {group.members.map((m) => (
                  <tr
                    key={m.id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => navigate(`/agents/${m.target_id}`)}
                  >
                    <td className="px-6 py-4">
                      <Link
                        to={`/agents/${m.target_id}`}
                        className="text-sm font-medium text-blue-600 hover:text-blue-700"
                      >
                        {m.target_name || 'Unknown'}
                      </Link>
                      <p className="text-xs text-slate-400">{m.target_hostname}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                        m.target_status === 'online' ? 'text-emerald-600' : 'text-red-500'
                      }`}>
                        {m.target_status === 'online' ? (
                          <Wifi className="w-3.5 h-3.5" />
                        ) : (
                          <WifiOff className="w-3.5 h-3.5" />
                        )}
                        {m.target_status === 'online' ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {format(new Date(m.created_at), 'd MMM yyyy')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveMember(m.target_id);
                        }}
                        className="text-red-500 hover:text-red-700 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

      {/* Assign certificate to entire group */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            Assign certificate to group
          </h2>
          <div className="flex items-center gap-2">
            <Link
              to={`/certificates/new?agent_group=${id}`}
              className="flex items-center gap-2 bg-blue-500 text-white px-3 py-2 rounded-lg hover:bg-blue-600 text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              New ACME certificate
            </Link>
            <Link
              to={`/self-signed?agent_group=${id}`}
              className="flex items-center gap-2 bg-amber-500 text-white px-3 py-2 rounded-lg hover:bg-amber-600 text-sm font-medium"
            >
              <FileLock2 className="w-4 h-4" />
              New self-signed certificate
            </Link>
            <button
              onClick={() => setShowAssignCert(!showAssignCert)}
              className="flex items-center gap-2 bg-emerald-500 text-white px-3 py-2 rounded-lg hover:bg-emerald-600 text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Assign certificate
            </button>
          </div>
        </div>

        {showAssignCert && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <p className="text-sm text-slate-500 mb-4">
              The certificate will be automatically assigned to all {group.members.length} agent(s) in this group.
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Certificate</label>
                  <select
                    value={selectedCertId}
                    onChange={(e) => setSelectedCertId(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
                  >
                    <option value="">Select certificate</option>
                    {certificates.filter((c) => !group.assigned_certificate_ids.includes(c.id)).length > 0 && (
                      <optgroup label="ACME Certificates">
                        {certificates.filter((c) => !group.assigned_certificate_ids.includes(c.id)).map((c) => (
                          <option key={`acme:${c.id}`} value={`acme:${c.id}`}>
                            {c.common_name} ({c.status})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {selfSignedCerts.filter((c) => !group.assigned_self_signed_ids.includes(c.id)).length > 0 && (
                      <optgroup label="Self-Signed Certificates">
                        {selfSignedCerts.filter((c) => !group.assigned_self_signed_ids.includes(c.id)).map((c) => (
                          <option key={`ss:${c.id}`} value={`ss:${c.id}`}>
                            {c.common_name} (self-signed)
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Format</label>
                  <select
                    value={deployFormat}
                    onChange={(e) => setDeployFormat(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
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
                    className="w-4 h-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                  />
                  <span className="text-sm text-slate-700">Auto-deploy on changes</span>
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowAssignCert(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssignCert}
                  disabled={!selectedCertId || group.members.length === 0}
                  className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 text-sm font-medium disabled:opacity-50"
                >
                  Assign to {group.members.length} agent(s)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

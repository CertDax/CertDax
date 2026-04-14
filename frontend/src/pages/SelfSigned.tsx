import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  FileLock2,
  Plus,
  Trash2,
  Search,
  ShieldCheck,
  ShieldAlert,
  Calendar,
  Key,
  Building2,
  X,
  Server,
  Tag,
  Minus,
  RefreshCw,
} from 'lucide-react';
import api from '../services/api';
import type { SelfSignedCertificate, AgentGroupInfo, DeploymentTarget, OidEntry } from '../types';

export default function SelfSigned() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const agentGroupParam = searchParams.get('agent_group');
  const agentParam = searchParams.get('agent');
  const caParam = searchParams.get('ca');
  const [certs, setCerts] = useState<SelfSignedCertificate[]>([]);
  const [agentTarget, setAgentTarget] = useState<DeploymentTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(!!agentGroupParam || !!agentParam || !!caParam);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState<{ id: number; name: string; agents: string[]; deployment_count: number } | null>(null);
  const [agentGroups, setAgentGroups] = useState<AgentGroupInfo[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(agentGroupParam || '');
  const [deployFormat, setDeployFormat] = useState('crt');
  const [customOids, setCustomOids] = useState<OidEntry[]>([]);
  const [showOids, setShowOids] = useState(false);
  const [availableCAs, setAvailableCAs] = useState<SelfSignedCertificate[]>([]);

  // Form state
  const [form, setForm] = useState({
    common_name: '',
    san_domains: '',
    organization: '',
    organizational_unit: '',
    country: 'NL',
    state: '',
    locality: '',
    key_type: 'rsa',
    key_size: 4096,
    validity_days: 365,
    is_ca: false,
    ca_id: caParam || '',
    auto_renew: false,
    renewal_threshold_days: '',
  });

  const fetchCerts = () => {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    api.get(`/self-signed${params}`).then((res) => {
      setCerts(res.data);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchCerts();
  }, [search]);

  useEffect(() => {
    api.get('/agent-groups').then((res) => setAgentGroups(res.data)).catch(() => {});
    api.get('/self-signed?is_ca=true').then((res) => setAvailableCAs(res.data)).catch(() => {});
    if (agentParam) {
      api.get(`/agents/${agentParam}`).then(({ data }) => setAgentTarget(data)).catch(() => {});
    }
  }, [agentParam]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const payload: any = {
        common_name: form.common_name.trim(),
        key_type: form.key_type,
        key_size: form.key_size,
        validity_days: form.validity_days,
        is_ca: form.is_ca,
        auto_renew: form.auto_renew,
      };
      if (form.ca_id) {
        payload.ca_id = parseInt(form.ca_id as string);
      }
      if (form.auto_renew && form.renewal_threshold_days) {
        payload.renewal_threshold_days = parseInt(form.renewal_threshold_days as string);
      }
      if (form.san_domains.trim()) {
        payload.san_domains = form.san_domains.split(',').map((d: string) => d.trim()).filter(Boolean);
      }
      if (form.organization.trim()) payload.organization = form.organization.trim();
      if (form.organizational_unit.trim()) payload.organizational_unit = form.organizational_unit.trim();
      if (form.country.trim()) payload.country = form.country.trim();
      if (form.state.trim()) payload.state = form.state.trim();
      if (form.locality.trim()) payload.locality = form.locality.trim();

      const validOids = customOids.filter((o) => o.oid.trim() && o.value.trim());
      if (validOids.length > 0) payload.custom_oids = validOids;

      const res = await api.post('/self-signed', payload);

      // If an agent group was selected, assign the new cert to the group
      if (selectedGroupId) {
        try {
          await api.post(`/agent-groups/${selectedGroupId}/certificates`, {
            self_signed_certificate_id: res.data.id,
            auto_deploy: true,
            deploy_format: deployFormat,
          });
        } catch {
          // Group assignment failed but cert was created, navigate anyway
        }
      }

      // If an agent was selected, assign the new cert to the agent
      if (agentTarget) {
        try {
          await api.post(`/agents/${agentTarget.id}/certificates`, {
            self_signed_certificate_id: res.data.id,
            auto_deploy: true,
            deploy_format: deployFormat,
          });
        } catch {
          // Agent assignment failed but cert was created, navigate anyway
        }
      }

      setShowForm(false);
      setSelectedGroupId('');
      setCustomOids([]);
      setShowOids(false);
      setForm({
        common_name: '',
        san_domains: '',
        organization: '',
        organizational_unit: '',
        country: 'NL',
        state: '',
        locality: '',
        key_type: 'rsa',
        key_size: 4096,
        validity_days: 365,
        is_ca: false,
        ca_id: '',
        auto_renew: false,
        renewal_threshold_days: '',
      });
      navigate(agentGroupParam ? `/agent-groups/${agentGroupParam}` : agentParam ? `/agents/${agentParam}` : `/self-signed/${res.data.id}`);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error creating certificate');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number, name: string, force = false) => {
    if (force) {
      if (!confirm(`This certificate will be detached from all agents and deployments. Continue?`)) return;
    }
    try {
      await api.delete(`/self-signed/${id}${force ? '?force=true' : ''}`);
      setDeleteError(null);
      fetchCerts();
    } catch (err: any) {
      if (err.response?.status === 409) {
        const detail = err.response.data.detail;
        setDeleteError({ id, name, agents: detail.agents, deployment_count: detail.deployment_count });
      }
    }
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  const isExpiringSoon = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    const d = new Date(expiresAt);
    const now = new Date();
    const diff = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diff > 0 && diff <= 30;
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
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <FileLock2 className="w-7 h-7 text-amber-500" />
            Self-Signed Certificaten
          </h1>
          <p className="text-slate-500 mt-1">Create and manage self-signed certificates</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors text-sm font-medium"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancel' : 'New certificate'}
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            New Self-Signed Certificate
          </h2>

          {agentTarget && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3 mb-4">
              <Server className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <p className="text-sm font-medium text-blue-900">
                Wordt automatisch gedeployed naar <span className="font-bold">{agentTarget.name}</span>
                <span className="text-blue-600 ml-1">({agentTarget.hostname})</span>
              </p>
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Common Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Common Name (CN) *
                </label>
                <input
                  type="text"
                  value={form.common_name}
                  onChange={(e) => setForm({ ...form, common_name: e.target.value })}
                  placeholder="e.g. myserver.local"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  required
                />
              </div>

              {/* SAN Domains */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Additional domains (SAN)
                </label>
                <input
                  type="text"
                  value={form.san_domains}
                  onChange={(e) => setForm({ ...form, san_domains: e.target.value })}
                  placeholder="e.g. *.local, 192.168.1.1"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                />
                <p className="text-xs text-slate-400 mt-1">Comma-separated. CN is added automatically.</p>
              </div>
            </div>

            {/* Organization fields */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Organization (O)
                </label>
                <input
                  type="text"
                  value={form.organization}
                  onChange={(e) => setForm({ ...form, organization: e.target.value })}
                  placeholder="e.g. MyCompany"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Department (OU)
                </label>
                <input
                  type="text"
                  value={form.organizational_unit}
                  onChange={(e) => setForm({ ...form, organizational_unit: e.target.value })}
                  placeholder="e.g. IT"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Country (C)
                </label>
                <input
                  type="text"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase().slice(0, 2) })}
                  placeholder="NL"
                  maxLength={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Province / State (ST)
                </label>
                <input
                  type="text"
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  City (L)
                </label>
                <input
                  type="text"
                  value={form.locality}
                  onChange={(e) => setForm({ ...form, locality: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                />
              </div>
            </div>

            {/* Crypto settings */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Key type
                </label>
                <select
                  value={form.key_type}
                  onChange={(e) => {
                    const kt = e.target.value;
                    setForm({
                      ...form,
                      key_type: kt,
                      key_size: kt === 'ec' ? 256 : 4096,
                    });
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                >
                  <option value="rsa">RSA</option>
                  <option value="ec">EC (Elliptic Curve)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Key size
                </label>
                <select
                  value={form.key_size}
                  onChange={(e) => setForm({ ...form, key_size: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                >
                  {form.key_type === 'rsa' ? (
                    <>
                      <option value={2048}>2048 bit</option>
                      <option value={4096}>4096 bit</option>
                    </>
                  ) : (
                    <>
                      <option value={256}>P-256 (256 bit)</option>
                      <option value={384}>P-384 (384 bit)</option>
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Validity (days)
                </label>
                <input
                  type="number"
                  value={form.validity_days}
                  onChange={(e) => setForm({ ...form, validity_days: parseInt(e.target.value) || 365 })}
                  min={1}
                  max={3650}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                />
              </div>
            </div>

            {/* Sign with CA */}
            {availableCAs.length > 0 && !form.is_ca && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Sign with CA (optional)
                </label>
                <select
                  value={form.ca_id}
                  onChange={(e) => setForm({ ...form, ca_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                >
                  <option value="">Self-signed (no CA)</option>
                  {availableCAs.map((ca) => (
                    <option key={ca.id} value={ca.id}>
                      {ca.common_name}{ca.organization ? ` — ${ca.organization}` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">Select a CA to sign this certificate, or leave empty for self-signed</p>
              </div>
            )}

            {/* CA toggle */}
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_ca}
                  onChange={(e) => setForm({ ...form, is_ca: e.target.checked, ca_id: e.target.checked ? '' : form.ca_id })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
              </label>
              <span className="text-sm font-medium text-slate-700">CA certificate</span>
              <span className="text-xs text-slate-400">(can sign other certificates)</span>
            </div>

            {/* Auto-Renew */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.auto_renew}
                    onChange={(e) => setForm({ ...form, auto_renew: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
                <RefreshCw className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-medium text-slate-700">Auto-renew</span>
                <span className="text-xs text-slate-400">(automatically renew before expiry)</span>
              </div>
              {form.auto_renew && (
                <div className="ml-12">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Renewal threshold (days before expiry)
                  </label>
                  <input
                    type="number"
                    value={form.renewal_threshold_days}
                    onChange={(e) => setForm({ ...form, renewal_threshold_days: e.target.value })}
                    placeholder="30"
                    min={1}
                    max={365}
                    className="w-48 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">Leave empty for system default (30 days)</p>
                </div>
              )}
            </div>

            {/* Custom OIDs */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-700 flex items-center gap-2">
                  <Tag className="w-4 h-4" />
                  Object Identifiers (OID)
                </label>
                <button
                  type="button"
                  onClick={() => setShowOids(!showOids)}
                  className="text-sm text-amber-600 hover:text-amber-700 font-medium"
                >
                  {showOids ? 'Hide' : 'Add OIDs'}
                </button>
              </div>
              {showOids && (
                <div className="space-y-3 p-4 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-500 mb-2">
                    Add OIDs for specific purposes, e.g. Extended Key Usage for Windows Server.
                    <br />
                    <span className="font-mono">1.3.6.1.5.5.7.3.1</span> = Server Authentication,{' '}
                    <span className="font-mono">1.3.6.1.5.5.7.3.2</span> = Client Authentication
                  </p>
                  {customOids.map((oid, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={oid.oid}
                        onChange={(e) => {
                          const updated = [...customOids];
                          updated[index] = { ...updated[index], oid: e.target.value };
                          setCustomOids(updated);
                        }}
                        placeholder="1.3.6.1.5.5.7.3.1"
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                      />
                      <input
                        type="text"
                        value={oid.value}
                        onChange={(e) => {
                          const updated = [...customOids];
                          updated[index] = { ...updated[index], value: e.target.value };
                          setCustomOids(updated);
                        }}
                        placeholder="Description / value"
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setCustomOids(customOids.filter((_, i) => i !== index))}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCustomOids([...customOids, { oid: '', value: '' }])}
                    className="flex items-center gap-1 text-sm text-amber-600 hover:text-amber-700 font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    Add OID
                  </button>
                </div>
              )}
            </div>

            {/* Agent Group assignment */}
            {agentGroups.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Assign to Agent Group
                </label>
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                >
                  <option value="">No group (assign manually)</option>
                  {agentGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.member_count} agent{g.member_count !== 1 ? 's' : ''})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">Certificate will be automatically deployed to all agents in the group</p>
              </div>
            )}

            {/* Deploy format */}
            {(selectedGroupId || agentTarget) && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Deploy format
                </label>
                <select
                  value={deployFormat}
                  onChange={(e) => setDeployFormat(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                >
                  <option value="crt">CRT (separate files)</option>
                  <option value="pem">PEM (combined)</option>
                  <option value="pfx">PFX (PKCS#12)</option>
                </select>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={creating}
                className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {creating ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                Create certificate
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by domain name..."
          className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
        />
      </div>

      {/* Certificates list */}
      {certs.length === 0 ? (
        <div className="text-center py-16">
          <FileLock2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500 mb-2">No self-signed certificates found</p>
          <p className="text-sm text-slate-400">Click "New certificate" to create one</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden overflow-x-auto">
          {deleteError && (
            <div className="bg-amber-50 border-b border-amber-200 p-6">
              <p className="font-medium text-amber-900 mb-2">
                "{deleteError.name}" is still in use
              </p>
              {deleteError.agents.length > 0 && (
                <p className="text-sm text-amber-800 mb-1">
                  Linked agents: <span className="font-medium">{deleteError.agents.join(', ')}</span>
                </p>
              )}
              {deleteError.deployment_count > 0 && (
                <p className="text-sm text-amber-800 mb-1">
                  Active deployments: <span className="font-medium">{deleteError.deployment_count}</span>
                </p>
              )}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => handleDelete(deleteError.id, deleteError.name, true)}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium"
                >
                  Delete anyway
                </button>
                <button
                  onClick={() => setDeleteError(null)}
                  className="px-4 py-2 text-slate-600 hover:bg-amber-100 rounded-lg text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">ID</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Certificate</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Created by</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Modified by</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Validity</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Expires</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {certs.map((cert) => {
                const expired = isExpired(cert.expires_at);
                const expiring = isExpiringSoon(cert.expires_at);

                return (
                  <tr
                    key={cert.id}
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => navigate(`/self-signed/${cert.id}`)}
                  >
                    <td className="px-6 py-4 text-sm text-slate-400 font-mono">
                      {cert.id}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${cert.is_ca ? 'bg-amber-200' : 'bg-amber-100'}`}>
                          {cert.is_ca ? (
                            <Building2 className="w-4 h-4 text-purple-600" />
                          ) : (
                            <FileLock2 className="w-4 h-4 text-amber-600" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{cert.common_name}</p>
                          {cert.organization && (
                            <p className="text-xs text-slate-400">{cert.organization}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-600">
                        {cert.created_by_username || '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-600">
                        {cert.modified_by_username || '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Key className="w-4 h-4 text-slate-400" />
                        <span className="text-sm text-slate-600">
                          {cert.key_type.toUpperCase()} {cert.key_size}
                          {cert.is_ca && (
                            <span className="ml-2 px-1.5 py-0.5 bg-amber-200 text-purple-700 rounded text-xs font-medium">
                              CA
                            </span>
                          )}
                          {cert.signed_by_ca_name && (
                            <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                              Signed by {cert.signed_by_ca_name}
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-600">{cert.validity_days} days</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {expired ? (
                          <ShieldAlert className="w-4 h-4 text-red-500" />
                        ) : expiring ? (
                          <ShieldAlert className="w-4 h-4 text-amber-500" />
                        ) : (
                          <Calendar className="w-4 h-4 text-slate-400" />
                        )}
                        <span className={`text-sm ${expired ? 'text-red-600 font-medium' : expiring ? 'text-amber-600 font-medium' : 'text-slate-600'}`}>
                          {cert.expires_at
                            ? format(new Date(cert.expires_at), 'd MMM yyyy')
                            : '-'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(cert.id, cert.common_name);
                        }}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Minus, ShieldCheck, Tag, FlaskConical, CheckCircle2, AlertTriangle, XCircle, Loader2, Server, Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import type { CertificateAuthority, DnsProvider, OidEntry, DryRunStep, DeploymentTarget, AgentGroupDetail } from '../types';
import { FolderTree } from 'lucide-react';

export default function RequestCertificate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const agentId = searchParams.get('agent');
  const agentGroupId = searchParams.get('agent_group');
  const [cas, setCas] = useState<CertificateAuthority[]>([]);
  const [agentTarget, setAgentTarget] = useState<DeploymentTarget | null>(null);
  const [agentGroup, setAgentGroup] = useState<AgentGroupDetail | null>(null);
  const [deployFormat, setDeployFormat] = useState('crt');
  const [dnsProviders, setDnsProviders] = useState<DnsProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [domains, setDomains] = useState(['']);
  const [caId, setCaId] = useState<number | ''>('');
  const [challengeType, setChallengeType] = useState('dns-01');
  const [dnsProviderId, setDnsProviderId] = useState<number | ''>('');
  const [autoRenew, setAutoRenew] = useState(true);
  const [renewalThresholdDays, setRenewalThresholdDays] = useState('');
  const [customOids, setCustomOids] = useState<OidEntry[]>([]);
  const [showOids, setShowOids] = useState(false);
  const [showSubject, setShowSubject] = useState(false);
  const [country, setCountry] = useState('');
  const [stateProvince, setStateProvince] = useState('');
  const [locality, setLocality] = useState('');
  const [organization, setOrganization] = useState('');
  const [organizationalUnit, setOrganizationalUnit] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunSteps, setDryRunSteps] = useState<DryRunStep[]>([]);
  const [dryRunDone, setDryRunDone] = useState<{ done: true; success: boolean } | null>(null);
  const stepsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([api.get('/providers/cas'), api.get('/providers/dns')]).then(
      ([casRes, dnsRes]) => {
        setCas(casRes.data);
        setDnsProviders(dnsRes.data);
        if (casRes.data.length > 0) setCaId(casRes.data[0].id);
        if (dnsRes.data.length > 0) setDnsProviderId(dnsRes.data[0].id);
      }
    );
    if (agentId) {
      api.get(`/agents/${agentId}`).then(({ data }) => setAgentTarget(data));
    }
    if (agentGroupId) {
      api.get(`/agent-groups/${agentGroupId}`).then(({ data }) => setAgentGroup(data));
    }
  }, [agentId, agentGroupId]);

  const addDomain = () => setDomains([...domains, '']);
  const removeDomain = (index: number) =>
    setDomains(domains.filter((_, i) => i !== index));
  const updateDomain = (index: number, value: string) => {
    const updated = [...domains];
    updated[index] = value;
    setDomains(updated);
  };

  const addOid = () => setCustomOids([...customOids, { oid: '', value: '' }]);
  const removeOid = (index: number) =>
    setCustomOids(customOids.filter((_, i) => i !== index));
  const updateOid = (index: number, field: keyof OidEntry, value: string) => {
    const updated = [...customOids];
    updated[index] = { ...updated[index], [field]: value };
    setCustomOids(updated);
  };

  // Detect if selected CA is Let's Encrypt (does not support subject fields or custom OIDs)
  const selectedCa = cas.find((ca) => ca.id === caId);
  const isLetsEncrypt = (() => {
    if (!selectedCa) return false;
    try {
      const hostname = new URL(selectedCa.directory_url).hostname;
      return hostname === 'letsencrypt.org' || hostname.endsWith('.letsencrypt.org');
    } catch {
      return false;
    }
  })();

  const buildPayload = () => {
    const validDomains = domains.filter((d) => d.trim());
    const validOids = customOids.filter((o) => o.oid.trim() && o.value.trim());
    return {
      domains: validDomains,
      ca_id: caId,
      challenge_type: challengeType,
      dns_provider_id: challengeType === 'dns-01' ? dnsProviderId || null : null,
      auto_renew: autoRenew,
      renewal_threshold_days: autoRenew && renewalThresholdDays ? parseInt(renewalThresholdDays) : null,
      custom_oids: validOids.length > 0 ? validOids : null,
      country: country.trim() || null,
      state: stateProvince.trim() || null,
      locality: locality.trim() || null,
      organization: organization.trim() || null,
      organizational_unit: organizationalUnit.trim() || null,
      ...(agentTarget ? { target_id: agentTarget.id, deploy_format: deployFormat } : {}),
    };
  };

  const handleDryRun = async () => {
    setError('');
    setDryRunSteps([]);
    setDryRunDone(null);
    const validDomains = domains.filter((d) => d.trim());
    if (validDomains.length === 0) {
      setError('Add at least one domain');
      return;
    }
    setDryRunLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/certificates/dry-run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(buildPayload()),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        setError(errData?.detail || `Dry-run failed (${response.status})`);
        setDryRunLoading(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setError('Streaming not supported');
        setDryRunLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.done !== undefined) {
                setDryRunDone(data);
              } else {
                setDryRunSteps((prev) => [...prev, data as DryRunStep]);
              }
            } catch {
              // ignore malformed JSON
            }
          }
        }
      }
    } catch (err) {
      setError('Dry-run connection failed');
    } finally {
      setDryRunLoading(false);
    }
  };

  // Auto-scroll to latest step
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [dryRunSteps]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const validDomains = domains.filter((d) => d.trim());
    if (validDomains.length === 0) {
      setError('Add at least one domain');
      return;
    }

    if (dryRun) {
      await handleDryRun();
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/certificates/request', buildPayload());
      if (agentGroup) {
        try {
          await api.post(`/agent-groups/${agentGroup.id}/certificates`, {
            certificate_id: data.id,
            auto_deploy: true,
            deploy_format: deployFormat,
          });
        } catch {
          // cert created, group assignment failed — still navigate
        }
      }
      navigate(agentGroup ? `/agent-groups/${agentGroup.id}` : `/certificates/${data.id}`);
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

  return (
    <div>
      <div className="flex items-center gap-4 mb-8">
        <Link
          to={agentGroup ? `/agent-groups/${agentGroup.id}` : agentTarget ? `/agents/${agentTarget.id}` : '/certificates'}
          className="p-2 rounded-lg hover:bg-slate-200 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Request new certificate
          </h1>
          <p className="text-slate-500 mt-1">
            Request an SSL/TLS certificate via ACME
          </p>
        </div>
      </div>

      {/* Agent Group deploy banner */}
      {agentGroup && (
        <div className="max-w-2xl mb-4">
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 flex items-center gap-3">
            <FolderTree className="w-5 h-5 text-violet-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-violet-900">
                Will be automatically deployed to all <span className="font-bold">{agentGroup.members.length} agent(s)</span> in group <span className="font-bold">{agentGroup.name}</span>
              </p>
              <p className="text-xs text-violet-600 mt-0.5">
                {agentGroup.members.map(m => m.target_name).join(', ')}
              </p>
            </div>
            <select
              value={deployFormat}
              onChange={(e) => setDeployFormat(e.target.value)}
              className="px-3 py-1.5 border border-violet-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
            >
              <option value="crt">CRT</option>
              <option value="pem">PEM</option>
              <option value="pfx">PFX</option>
            </select>
          </div>
        </div>
      )}

      {/* Agent deploy banner */}
      {agentTarget && (
        <div className="max-w-2xl mb-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
            <Server className="w-5 h-5 text-blue-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-900">
                Will be automatically deployed to <span className="font-bold">{agentTarget.name}</span>
                <span className="text-blue-600 ml-1">({agentTarget.hostname})</span>
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                Deploy path: {agentTarget.deploy_path}
              </p>
            </div>
            <select
              value={deployFormat}
              onChange={(e) => setDeployFormat(e.target.value)}
              className="px-3 py-1.5 border border-blue-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="crt">CRT</option>
              <option value="pem">PEM</option>
              <option value="pfx">PFX</option>
            </select>
          </div>
        </div>
      )}

      <div className="max-w-2xl">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
          {error && (
            <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Domains */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Domains
              </label>
              <div className="space-y-2">
                {domains.map((domain, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={domain}
                      onChange={(e) => updateDomain(index, e.target.value)}
                      placeholder={
                        index === 0 ? 'example.com' : '*.example.com'
                      }
                      className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    />
                    {domains.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeDomain(index)}
                        className="p-2.5 text-red-500 hover:bg-red-50 rounded-lg"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addDomain}
                className="flex items-center gap-1 mt-2 text-sm text-emerald-600 hover:text-emerald-700 font-medium"
              >
                <Plus className="w-4 h-4" />
                Add domain (SAN)
              </button>
            </div>

            {/* CA Selection */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Certificate Authority
              </label>
              <select
                value={caId}
                onChange={(e) => setCaId(Number(e.target.value))}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
              >
                {cas.map((ca) => (
                  <option key={ca.id} value={ca.id}>
                    {ca.name} {ca.is_staging ? '(Staging)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Challenge Type */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Challenge type
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="dns-01"
                    checked={challengeType === 'dns-01'}
                    onChange={(e) => setChallengeType(e.target.value)}
                    className="text-emerald-500 focus:ring-emerald-500"
                  />
                  <span className="text-sm">
                    DNS-01{' '}
                    <span className="text-slate-400">(wildcard support)</span>
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="http-01"
                    checked={challengeType === 'http-01'}
                    onChange={(e) => setChallengeType(e.target.value)}
                    className="text-emerald-500 focus:ring-emerald-500"
                  />
                  <span className="text-sm">HTTP-01</span>
                </label>
              </div>
            </div>

            {/* DNS Provider */}
            {challengeType === 'dns-01' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  DNS Provider
                </label>
                <select
                  value={dnsProviderId}
                  onChange={(e) => setDnsProviderId(Number(e.target.value))}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
                >
                  <option value="">Select DNS provider</option>
                  {dnsProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.provider_type})
                    </option>
                  ))}
                </select>
                {dnsProviders.length === 0 && (
                  <p className="mt-2 text-sm text-amber-600">
                    No DNS providers configured.{' '}
                    <Link
                      to="/providers"
                      className="underline hover:text-amber-700"
                    >
                      Add one
                    </Link>
                  </p>
                )}
              </div>
            )}

            {/* Subject Information */}
            {!isLetsEncrypt && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-700 flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Subject Information
                </label>
                <button
                  type="button"
                  onClick={() => setShowSubject(!showSubject)}
                  className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  {showSubject ? 'Hide' : 'Add subject fields'}
                </button>
              </div>
              {showSubject && (
                <div className="space-y-3 p-4 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-500 mb-2">
                    Optional subject fields included in the CSR. These are embedded in the certificate if the CA supports them.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Country</label>
                      <input
                        type="text"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        placeholder="NL"
                        maxLength={2}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">State / Province</label>
                      <input
                        type="text"
                        value={stateProvince}
                        onChange={(e) => setStateProvince(e.target.value)}
                        placeholder="Zuid-Holland"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Locality</label>
                      <input
                        type="text"
                        value={locality}
                        onChange={(e) => setLocality(e.target.value)}
                        placeholder="Rotterdam"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Organization</label>
                      <input
                        type="text"
                        value={organization}
                        onChange={(e) => setOrganization(e.target.value)}
                        placeholder="My Company B.V."
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Department (OU)</label>
                      <input
                        type="text"
                        value={organizationalUnit}
                        onChange={(e) => setOrganizationalUnit(e.target.value)}
                        placeholder="IT Department"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Custom OIDs */}
            {!isLetsEncrypt && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-700 flex items-center gap-2">
                  <Tag className="w-4 h-4" />
                  Object Identifiers (OID)
                </label>
                <button
                  type="button"
                  onClick={() => setShowOids(!showOids)}
                  className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
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
                        onChange={(e) => updateOid(index, 'oid', e.target.value)}
                        placeholder="1.3.6.1.5.5.7.3.1"
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                      <input
                        type="text"
                        value={oid.value}
                        onChange={(e) => updateOid(index, 'value', e.target.value)}
                        placeholder="Description / value"
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => removeOid(index)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addOid}
                    className="flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-700 font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    Add OID
                  </button>
                </div>
              )}
            </div>
            )}

            {/* Auto Renew */}
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRenew}
                  onChange={(e) => setAutoRenew(e.target.checked)}
                  className="rounded text-emerald-500 focus:ring-emerald-500"
                />
                <span className="text-sm font-medium text-slate-700">
                  Auto-renew
                </span>
              </label>
              {autoRenew && (
                <div className="ml-6">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Renewal threshold (days before expiry)
                  </label>
                  <input
                    type="number"
                    value={renewalThresholdDays}
                    onChange={(e) => setRenewalThresholdDays(e.target.value)}
                    placeholder="30"
                    min={1}
                    max={365}
                    className="w-48 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">Leave empty for system default (30 days)</p>
                </div>
              )}
            </div>

            {/* Dry Run */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => {
                    setDryRun(e.target.checked);
                    if (!e.target.checked) {
                      setDryRunSteps([]);
                      setDryRunDone(null);
                    }
                  }}
                  className="rounded text-amber-500 focus:ring-amber-500"
                />
                <FlaskConical className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-medium text-slate-700">
                  Dry-run mode
                </span>
                <span className="text-xs text-slate-400">
                  (simulate the request without actually requesting a certificate)
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading || dryRunLoading}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg transition-colors font-medium disabled:opacity-50 ${
                dryRun
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-emerald-500 text-white hover:bg-emerald-600'
              }`}
            >
              {dryRun ? (
                <>
                  <FlaskConical className="w-5 h-5" />
                  {dryRunLoading ? 'Simulation running...' : 'Run dry-run'}
                </>
              ) : (
                <>
                  <ShieldCheck className="w-5 h-5" />
                  {loading ? 'Certificate being requested...' : 'Request certificate'}
                </>
              )}
            </button>
          </form>

          {/* Dry Run Live Results */}
          {(dryRunSteps.length > 0 || dryRunLoading) && (
            <div className="mt-6">
              {/* Header with pulse animation while running */}
              <div className="flex items-center gap-2 mb-4">
                {dryRunLoading && !dryRunDone && (
                  <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
                )}
                <h3 className="text-sm font-semibold text-slate-700">
                  {dryRunLoading && !dryRunDone
                    ? 'Dry-run in progress...'
                    : dryRunDone?.success
                    ? 'Dry-run completed'
                    : dryRunDone
                    ? 'Dry-run failed'
                    : 'Dry-run results'}
                </h3>
              </div>

              {/* Final status banner */}
              {dryRunDone && (
                <div className={`rounded-lg border px-4 py-3 mb-4 ${
                  dryRunDone.success
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-red-50 border-red-200'
                }`}>
                  <div className="flex items-center gap-2">
                    {dryRunDone.success ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600" />
                    )}
                    <span className={`font-medium text-sm ${
                      dryRunDone.success ? 'text-emerald-700' : 'text-red-700'
                    }`}>
                      {dryRunDone.success
                        ? 'All steps completed successfully — ready to request'
                        : 'Errors occurred during the dry-run'}
                    </span>
                  </div>
                </div>
              )}

              {/* Step list */}
              <div className="space-y-2">
                {dryRunSteps.map((step, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-3 px-4 py-3 rounded-lg border transition-all duration-300 animate-in ${
                      step.status === 'ok'
                        ? 'bg-white border-slate-200'
                        : step.status === 'warning'
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {step.status === 'ok' && (
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      )}
                      {step.status === 'warning' && (
                        <AlertTriangle className="w-5 h-5 text-amber-500" />
                      )}
                      {step.status === 'error' && (
                        <XCircle className="w-5 h-5 text-red-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs text-slate-400 font-mono">
                          Step {step.step}
                        </span>
                        <span className="text-sm font-medium text-slate-900">
                          {step.title}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 break-words">
                        {step.description}
                      </p>
                    </div>
                  </div>
                ))}

                {/* Loading indicator for next step */}
                {dryRunLoading && !dryRunDone && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-dashed border-amber-300 bg-amber-50/50">
                    <Loader2 className="w-5 h-5 text-amber-400 animate-spin flex-shrink-0" />
                    <span className="text-sm text-amber-600">Next step in progress...</span>
                  </div>
                )}

                <div ref={stepsEndRef} />
              </div>

              {/* Action button after completion */}
              {dryRunDone?.success && (
                <button
                  type="button"
                  onClick={() => {
                    setDryRun(false);
                    setDryRunSteps([]);
                    setDryRunDone(null);
                  }}
                  className="mt-4 w-full flex items-center justify-center gap-2 bg-emerald-500 text-white py-3 rounded-lg hover:bg-emerald-600 transition-colors font-medium"
                >
                  <ShieldCheck className="w-5 h-5" />
                  Actually request
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Trash2,
  Copy,
  Check,
  Calendar,
  Globe,
  Download,
  FileArchive,
  FileText,
  Key,
  Lock,
  Loader2,
  ChevronDown,
  ChevronRight,
  Info,
  Fingerprint,
  FileLock2,
  Building2,
  ShieldCheck,
  RefreshCw,
  User,
  Tag,
} from 'lucide-react';
import api from '../services/api';
import type { SelfSignedDetail as SelfSignedDetailType, SelfSignedCertificate, OidEntry } from '../types';

export default function SelfSignedDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [cert, setCert] = useState<SelfSignedDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');
  const [downloadPassword, setDownloadPassword] = useState('');
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [parsedDetails, setParsedDetails] = useState<any>(null);
  const [parsedLoading, setParsedLoading] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [renewDays, setRenewDays] = useState(365);
  const [renewCodeSigning, setRenewCodeSigning] = useState(false);
  const [editingAutoRenew, setEditingAutoRenew] = useState(false);
  const [autoRenewForm, setAutoRenewForm] = useState({ auto_renew: false, renewal_threshold_days: '' });
  const [savingAutoRenew, setSavingAutoRenew] = useState(false);
  const [deleteError, setDeleteError] = useState<{ agents: string[]; deployment_count: number } | null>(null);
  const [signedCerts, setSignedCerts] = useState<SelfSignedCertificate[]>([]);

  const fetchCert = () => {
    api.get(`/self-signed/${id}`).then((res) => {
      setCert(res.data);
      setLoading(false);
    });
  };

  const fetchParsedDetails = () => {
    setParsedLoading(true);
    api.get(`/self-signed/${id}/parsed`).then((res) => {
      setParsedDetails(res.data);
    }).catch(() => {}).finally(() => setParsedLoading(false));
  };

  useEffect(() => {
    fetchCert();
  }, [id]);

  useEffect(() => {
    if (cert?.certificate_pem) {
      fetchParsedDetails();
    }
  }, [cert?.certificate_pem]);

  useEffect(() => {
    if (cert?.is_ca) {
      api.get('/self-signed').then((res) => {
        setSignedCerts(res.data.filter((c: SelfSignedCertificate) => c.signed_by_ca_id === cert.id));
      }).catch(() => {});
    }
  }, [cert?.is_ca, cert?.id]);

  const copyToClipboard = (text: string, label: string) => {
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
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const downloadFile = (url: string) => {
    const params = downloadPassword ? `?password=${encodeURIComponent(downloadPassword)}` : '';
    api.get(url + params, { responseType: 'blob' }).then((res) => {
      const disposition = res.headers['content-disposition'] || '';
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch ? filenameMatch[1] : 'download';
      const blob = new Blob([res.data]);
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(blobUrl);
    });
  };

  const handleDelete = async (force = false) => {
    if (force) {
      if (!confirm('This certificate will be detached from all agents and deployments. Continue?')) return;
    }
    try {
      await api.delete(`/self-signed/${id}${force ? '?force=true' : ''}`);
      navigate('/self-signed');
    } catch (err: any) {
      if (err.response?.status === 409) {
        setDeleteError(err.response.data.detail);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  const handleSaveAutoRenew = async () => {
    setSavingAutoRenew(true);
    try {
      const params = new URLSearchParams({ auto_renew: String(autoRenewForm.auto_renew) });
      if (autoRenewForm.auto_renew && autoRenewForm.renewal_threshold_days) {
        params.set('renewal_threshold_days', autoRenewForm.renewal_threshold_days);
      } else if (autoRenewForm.auto_renew && !autoRenewForm.renewal_threshold_days) {
        params.set('clear_threshold', 'true');
      }
      await api.patch(`/self-signed/${id}?${params}`);
      setEditingAutoRenew(false);
      fetchCert();
    } catch {
      // error handling via interceptor
    } finally {
      setSavingAutoRenew(false);
    }
  };

  const handleRenew = async () => {    setRenewing(true);
    try {
      const params = new URLSearchParams({ validity_days: String(renewDays) });
      if (cert?.is_ca && renewCodeSigning) params.set('include_code_signing', 'true');
      await api.post(`/self-signed/${id}/renew?${params}`);
      setShowRenewModal(false);
      fetchCert();
    } catch {
      // error handling via interceptor
    } finally {
      setRenewing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
      </div>
    );
  }

  if (!cert) {
    return <div className="text-center py-16 text-slate-400">Certificate not found</div>;
  }

  const sanDomains: string[] = cert.san_domains ? JSON.parse(cert.san_domains) : [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-8">
        <Link
          to="/self-signed"
          className="p-2 rounded-lg hover:bg-slate-200 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            {cert.is_ca ? (
              <Building2 className="w-6 h-6 text-amber-600" />
            ) : (
              <FileLock2 className="w-6 h-6 text-amber-500" />
            )}
            {cert.common_name}
            <span className="text-sm text-slate-400 font-mono font-normal">ID: {cert.id}</span>
          </h1>
          <p className="text-slate-500 mt-1">
            Self-Signed {cert.is_ca ? 'CA ' : ''}Certificate
            {cert.organization && ` — ${cert.organization}`}
          </p>
          {cert.created_by_username && (
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
              <User className="w-3 h-3" />
              Created by {cert.created_by_username}
            </p>
          )}
          {cert.modified_by_username && (
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
              <User className="w-3 h-3" />
              Modified by {cert.modified_by_username}
              {cert.updated_at && (
                <span className="ml-1">
                  op {new Date(cert.updated_at).toLocaleString()}
                </span>
              )}
            </p>
          )}
        </div>
        {cert.is_ca && (
          <button
            onClick={() => navigate(`/self-signed?ca=${cert.id}`)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
          >
            <FileLock2 className="w-4 h-4" />
            Sign certificate
          </button>
        )}
        <button
          onClick={() => {
            setRenewDays(cert.validity_days);
            const currentEku: string[] = parsedDetails?.certificate?.extensions?.extended_key_usage ?? [];
            setRenewCodeSigning(currentEku.includes('codeSigning'));
            setShowRenewModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors text-sm font-medium"
        >
          <RefreshCw className="w-4 h-4" />
          Renew
        </button>
        <button
          onClick={() => handleDelete()}
          className="flex items-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm font-medium"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>

      {deleteError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6">
          <p className="font-medium text-amber-900 mb-2">
            This certificate is still in use
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
              onClick={() => handleDelete(true)}
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

      {/* Info cards */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-3 text-slate-500 mb-2">
            <Key className="w-5 h-5" />
            <span className="text-sm font-medium">Key</span>
          </div>
          <p className="text-lg font-semibold text-slate-900">
            {cert.key_type.toUpperCase()} {cert.key_size}
            {cert.key_type === 'ec' ? ' bit' : ' bit'}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-3 text-slate-500 mb-2">
            {cert.is_ca ? <Building2 className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
            <span className="text-sm font-medium">Type</span>
          </div>
          <p className="text-lg font-semibold text-slate-900">
            {cert.is_ca ? 'CA Certificate' : 'Server Certificate'}
          </p>
          {cert.signed_by_ca_name && (
            <Link
              to={`/self-signed/${cert.signed_by_ca_id}`}
              className="text-sm text-blue-600 hover:text-blue-800 mt-1 inline-block"
            >
              Signed by {cert.signed_by_ca_name}
            </Link>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3 text-slate-500">
              <RefreshCw className="w-5 h-5" />
              <span className="text-sm font-medium">Auto-Renewal</span>
            </div>
            {!editingAutoRenew && (
              <button
                onClick={() => {
                  setAutoRenewForm({
                    auto_renew: cert.auto_renew,
                    renewal_threshold_days: cert.renewal_threshold_days ? String(cert.renewal_threshold_days) : '',
                  });
                  setEditingAutoRenew(true);
                }}
                className="text-xs text-amber-600 hover:text-amber-700 font-medium"
              >
                Edit
              </button>
            )}
          </div>
          {editingAutoRenew ? (
            <div className="space-y-3 mt-1">
              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoRenewForm.auto_renew}
                    onChange={(e) => setAutoRenewForm({ ...autoRenewForm, auto_renew: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
                <span className="text-sm font-medium text-slate-700">{autoRenewForm.auto_renew ? 'On' : 'Off'}</span>
              </div>
              {autoRenewForm.auto_renew && (
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Days before expiry</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={autoRenewForm.renewal_threshold_days}
                    onChange={(e) => setAutoRenewForm({ ...autoRenewForm, renewal_threshold_days: e.target.value })}
                    placeholder="30 (system default)"
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleSaveAutoRenew}
                  disabled={savingAutoRenew}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 disabled:opacity-50"
                >
                  {savingAutoRenew ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Save
                </button>
                <button
                  onClick={() => setEditingAutoRenew(false)}
                  disabled={savingAutoRenew}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-lg font-semibold text-slate-900">
                {cert.auto_renew ? 'On' : 'Off'}
              </p>
              {cert.auto_renew && (
                <p className="text-sm text-slate-500 mt-1">
                  {cert.renewal_threshold_days
                    ? `${cert.renewal_threshold_days} days before expiry`
                    : 'System default (30 days)'}
                </p>
              )}
            </>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-3 text-slate-500 mb-2">
            <Calendar className="w-5 h-5" />
            <span className="text-sm font-medium">Expires</span>
          </div>
          <p className="text-lg font-semibold text-slate-900">
            {cert.expires_at
              ? format(new Date(cert.expires_at), 'd MMMM yyyy')
              : '-'}
          </p>
        </div>
      </div>

      {/* Domains */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Globe className="w-5 h-5" />
          Domains
        </h2>
        <div className="flex flex-wrap gap-2">
          <span className="px-3 py-1.5 bg-slate-100 rounded-lg text-sm font-medium text-slate-700">
            {cert.common_name}
          </span>
          {sanDomains
            .filter((d) => d !== cert.common_name)
            .map((domain) => (
              <span
                key={domain}
                className="px-3 py-1.5 bg-slate-100 rounded-lg text-sm font-medium text-slate-700"
              >
                {domain}
              </span>
            ))}
        </div>
      </div>

      {/* Subject Details */}
      {(cert.organization || cert.organizational_unit || cert.country || cert.state || cert.locality) && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Subject
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            {cert.organization && (
              <div>
                <span className="text-slate-500">Organization (O):</span>
                <span className="ml-2 font-medium text-slate-900">{cert.organization}</span>
              </div>
            )}
            {cert.organizational_unit && (
              <div>
                <span className="text-slate-500">Department (OU):</span>
                <span className="ml-2 font-medium text-slate-900">{cert.organizational_unit}</span>
              </div>
            )}
            {cert.country && (
              <div>
                <span className="text-slate-500">Country (C):</span>
                <span className="ml-2 font-medium text-slate-900">{cert.country}</span>
              </div>
            )}
            {cert.state && (
              <div>
                <span className="text-slate-500">Province (ST):</span>
                <span className="ml-2 font-medium text-slate-900">{cert.state}</span>
              </div>
            )}
            {cert.locality && (
              <div>
                <span className="text-slate-500">City (L):</span>
                <span className="ml-2 font-medium text-slate-900">{cert.locality}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Extended Key Usage / OIDs */}
      {(() => {
        const customOids: OidEntry[] = cert.custom_oids ? JSON.parse(cert.custom_oids) : [];

        type EkuEntry = { oid: string; label: string; custom?: boolean };

        // Map OID dotted string → friendly name and reverse
        const knownByOid: Record<string, string> = {
          '1.3.6.1.5.5.7.3.1': 'serverAuth',
          '1.3.6.1.5.5.7.3.2': 'clientAuth',
          '1.3.6.1.5.5.7.3.3': 'codeSigning',
          '1.3.6.1.5.5.7.3.4': 'emailProtection',
          '1.3.6.1.5.5.7.3.8': 'timeStamping',
          '1.3.6.1.5.5.7.3.9': 'OCSPSigning',
        };
        const knownByName: Record<string, string> = Object.fromEntries(
          Object.entries(knownByOid).map(([oid, name]) => [name, oid])
        );

        // Default OIDs (always present regardless of user choice)
        const defaultOids = new Set(['1.3.6.1.5.5.7.3.1', '1.3.6.1.5.5.7.3.2']);

        let effectiveEku: EkuEntry[];

        // Prefer the parsed X.509 EKU (ground truth from the actual certificate)
        const parsedEku: string[] | undefined = parsedDetails?.certificate?.extensions?.extended_key_usage;
        if (parsedEku && parsedEku.length > 0) {
          effectiveEku = parsedEku.map((name) => {
            const oid = knownByName[name] ?? name;
            return { oid, label: knownByOid[oid] ?? name, custom: !defaultOids.has(oid) };
          });
        } else {
          // Fallback: reconstruct from defaults + custom_oids (cert not yet parsed)
          effectiveEku = [
            { oid: '1.3.6.1.5.5.7.3.1', label: 'serverAuth' },
            { oid: '1.3.6.1.5.5.7.3.2', label: 'clientAuth' },
          ];
          const seenOids = new Set(effectiveEku.map((e) => e.oid));
          for (const o of customOids) {
            if (!seenOids.has(o.oid)) {
              seenOids.add(o.oid);
              effectiveEku.push({ oid: o.oid, label: knownByOid[o.oid] ?? o.value ?? o.oid, custom: true });
            }
          }
        }

        return (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Tag className="w-5 h-5" />
              Extended Key Usage (OID)
            </h2>
            <div className="space-y-2">
              {effectiveEku.map((entry, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="font-mono text-slate-700 bg-slate-100 px-2 py-1 rounded">
                    {entry.oid}
                  </span>
                  <span className="text-slate-600">{entry.label}</span>
                  {!entry.custom && (
                    <span className="text-xs text-slate-400 italic">default</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Signed Certificates (for CA certs) */}
      {cert.is_ca && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <FileLock2 className="w-5 h-5" />
              Signed Certificates
            </h2>
            <button
              onClick={() => navigate(`/self-signed?ca=${cert.id}`)}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              + Sign new certificate
            </button>
          </div>
          {signedCerts.length === 0 ? (
            <p className="text-sm text-slate-400">No certificates have been signed with this CA yet.</p>
          ) : (
            <div className="space-y-2">
              {signedCerts.map((sc) => (
                <Link
                  key={sc.id}
                  to={`/self-signed/${sc.id}`}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <FileLock2 className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-medium text-slate-900">{sc.common_name}</span>
                    {sc.organization && (
                      <span className="text-xs text-slate-400">{sc.organization}</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500">
                    {sc.expires_at ? `Expires ${format(new Date(sc.expires_at), 'd MMM yyyy')}` : ''}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Download Section */}
      {cert.certificate_pem && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Download className="w-5 h-5" />
            Downloads
          </h2>

          {/* Password protection */}
          <div className="mb-4 p-4 bg-slate-50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Lock className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">
                Password protection (optional)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPasswordInput(!showPasswordInput)}
                className="text-sm text-amber-600 hover:text-amber-700 font-medium"
              >
                {showPasswordInput ? 'Hide' : 'Set password for private key'}
              </button>
            </div>
            {showPasswordInput && (
              <input
                type="password"
                value={downloadPassword}
                onChange={(e) => setDownloadPassword(e.target.value)}
                placeholder="Password for private key..."
                className="mt-2 w-full max-w-sm px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
              />
            )}
            {downloadPassword && (
              <p className="mt-1 text-xs text-amber-600">
                Private key and PFX will be encrypted with this password
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <button
              onClick={() => downloadFile(`/self-signed/${id}/download/zip`)}
              className="flex items-center gap-3 p-4 bg-amber-50 border border-violet-200 rounded-lg hover:bg-amber-100 transition-colors text-left"
            >
              <FileArchive className="w-8 h-8 text-amber-600 flex-shrink-0" />
              <div>
                <p className="font-medium text-amber-900 text-sm">ZIP Bundel</p>
                <p className="text-xs text-amber-700">Certificate + private key</p>
              </div>
            </button>

            <button
              onClick={() => downloadFile(`/self-signed/${id}/download/pem/certificate`)}
              className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-left"
            >
              <FileText className="w-8 h-8 text-blue-600 flex-shrink-0" />
              <div>
                <p className="font-medium text-blue-900 text-sm">Certificate</p>
                <p className="text-xs text-blue-700">certificate.crt</p>
              </div>
            </button>

            <button
              onClick={() => downloadFile(`/self-signed/${id}/download/pem/privatekey`)}
              className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors text-left"
            >
              <Key className="w-8 h-8 text-amber-600 flex-shrink-0" />
              <div>
                <p className="font-medium text-amber-900 text-sm">
                  Private Key {downloadPassword ? '(encrypted)' : ''}
                </p>
                <p className="text-xs text-amber-700">private_key.key</p>
              </div>
            </button>

            <button
              onClick={() => downloadFile(`/self-signed/${id}/download/pem/combined`)}
              className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors text-left"
            >
              <FileText className="w-8 h-8 text-amber-700 flex-shrink-0" />
              <div>
                <p className="font-medium text-amber-900 text-sm">Combined PEM</p>
                <p className="text-xs text-amber-700">Key + cert in one file</p>
              </div>
            </button>

            <button
              onClick={() => downloadFile(`/self-signed/${id}/download/pfx`)}
              className="flex items-center gap-3 p-4 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors text-left"
            >
              <ShieldCheck className="w-8 h-8 text-indigo-600 flex-shrink-0" />
              <div>
                <p className="font-medium text-indigo-900 text-sm">
                  PFX / PKCS#12 {downloadPassword ? '(encrypted)' : ''}
                </p>
                <p className="text-xs text-indigo-700">Windows Server / IIS</p>
              </div>
            </button>

            {cert.signed_by_ca_id && (
              <>
                <button
                  onClick={() => downloadFile(`/self-signed/${id}/download/pem/chain`)}
                  className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors text-left"
                >
                  <ShieldCheck className="w-8 h-8 text-emerald-600 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-emerald-900 text-sm">Full Chain</p>
                    <p className="text-xs text-emerald-700">Certificate + CA certificate</p>
                  </div>
                </button>

                <button
                  onClick={() => downloadFile(`/self-signed/${id}/download/pem/ca`)}
                  className="flex items-center gap-3 p-4 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors text-left"
                >
                  <Building2 className="w-8 h-8 text-purple-600 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-purple-900 text-sm">CA Certificate</p>
                    <p className="text-xs text-purple-700">Issuing CA only</p>
                  </div>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Parsed Certificate Details */}
      {cert.certificate_pem && parsedDetails && (
        <ParsedCertBlock
          title="Certificate details (X.509)"
          data={parsedDetails.certificate}
        />
      )}

      {cert.certificate_pem && parsedLoading && !parsedDetails && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex items-center gap-3 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading certificate details...
        </div>
      )}

      {/* Raw PEM */}
      {cert.certificate_pem && (
        <div className="mt-4">
          <PemBlock
            title="Certificate (PEM)"
            content={cert.certificate_pem}
            copied={copied}
            onCopy={copyToClipboard}
          />
        </div>
      )}

      {/* Renew modal */}
      {showRenewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Renew certificate</h2>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Validity (days)
            </label>
            <input
              type="number"
              min={1}
              max={3650}
              value={renewDays}
              onChange={(e) => setRenewDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
            />
            <p className="text-xs text-slate-500 mt-1">Between 1 and 3650 days</p>
            {cert?.is_ca && (
              <div className="flex items-center gap-3 mt-4">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={renewCodeSigning}
                    onChange={(e) => setRenewCodeSigning(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
                <span className="text-sm font-medium text-slate-700">Code Signing <span className="font-mono text-xs text-slate-500">(1.3.6.1.5.5.7.3.3)</span></span>
              </div>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowRenewModal(false)}
                disabled={renewing}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRenew}
                disabled={renewing}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50"
              >
                {renewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Renew
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- helper components ---------- */

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm font-medium text-slate-500 sm:w-56 flex-shrink-0">{label}</span>
      <span className={`text-sm text-slate-900 break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function NameDisplay({ name }: { name: Record<string, string> }) {
  const order = ['CN', 'O', 'OU', 'L', 'ST', 'C'];
  const entries = Object.entries(name).sort(
    (a, b) => (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0])) -
              (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0]))
  );
  return (
    <span className="font-mono text-sm">
      {entries.map(([k, v]) => `${k}=${v}`).join(', ')}
    </span>
  );
}

const KEY_USAGE_LABELS: Record<string, string> = {
  digital_signature: 'Digital Signature',
  key_encipherment: 'Key Encipherment',
  content_commitment: 'Content Commitment',
  data_encipherment: 'Data Encipherment',
  key_agreement: 'Key Agreement',
  key_cert_sign: 'Certificate Sign',
  crl_sign: 'CRL Sign',
};

function ParsedCertBlock({
  title,
  data,
}: {
  title: string;
  data: any;
}) {
  const [open, setOpen] = useState(true);
  const ext = data.extensions || {};

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-50 transition-colors rounded-xl"
      >
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <Info className="w-5 h-5 text-blue-500" />
          {title}
        </h3>
        {open ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
      </button>

      {open && (
        <div className="px-6 pb-6 space-y-1">
          <DetailRow label="Subject" value={<NameDisplay name={data.subject} />} />
          <DetailRow label="Issuer" value={<NameDisplay name={data.issuer} />} />
          <DetailRow label="Version" value={data.version} />
          <DetailRow label="Serial number" value={data.serial_number} mono />
          <DetailRow
            label="Valid from"
            value={data.not_before ? format(new Date(data.not_before), 'd MMMM yyyy HH:mm:ss') : '-'}
          />
          <DetailRow
            label="Valid until"
            value={data.not_after ? format(new Date(data.not_after), 'd MMMM yyyy HH:mm:ss') : '-'}
          />
          <DetailRow label="Signature algorithm" value={data.signature_algorithm} />
          <DetailRow
            label="Public key"
            value={`${data.public_key_algorithm}${data.public_key_size ? ` ${data.public_key_size}` : ''}`}
          />

          {ext.subject_alternative_names && ext.subject_alternative_names.length > 0 && (
            <DetailRow
              label="Subject Alternative Names"
              value={
                <div className="flex flex-wrap gap-1.5">
                  {ext.subject_alternative_names.map((san: string) => (
                    <span key={san} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-mono">
                      {san}
                    </span>
                  ))}
                </div>
              }
            />
          )}

          {ext.key_usage && (
            <DetailRow
              label={`Key Usage${ext.key_usage_critical ? ' (critical)' : ''}`}
              value={ext.key_usage.map((u: string) => KEY_USAGE_LABELS[u] || u).join(', ')}
            />
          )}

          {ext.extended_key_usage && (
            <DetailRow
              label="Extended Key Usage"
              value={ext.extended_key_usage.join(', ')}
            />
          )}

          {ext.basic_constraints && (
            <DetailRow
              label={`Basic Constraints${ext.basic_constraints.critical ? ' (critical)' : ''}`}
              value={`CA: ${ext.basic_constraints.ca ? 'Yes' : 'No'}${ext.basic_constraints.path_length !== null ? `, Path Length: ${ext.basic_constraints.path_length}` : ''}`}
            />
          )}

          {ext.subject_key_identifier && (
            <DetailRow label="Subject Key Identifier" value={ext.subject_key_identifier} mono />
          )}

          {ext.authority_key_identifier && (
            <DetailRow label="Authority Key Identifier" value={ext.authority_key_identifier} mono />
          )}

          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200">
            <Fingerprint className="w-4 h-4 text-slate-400" />
            <span className="text-xs text-slate-500">Serial number: <span className="font-mono">{data.serial_number}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

function PemBlock({
  title,
  content,
  copied,
  onCopy,
}: {
  title: string;
  content: string;
  copied: string;
  onCopy: (text: string, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-50 transition-colors rounded-xl"
      >
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <div className="flex items-center gap-2">
          {open && (
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(content, title); }}
              className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
            >
              {copied === title ? (
                <><Check className="w-4 h-4 text-emerald-500" /><span className="text-emerald-500">Copied!</span></>
              ) : (
                <><Copy className="w-4 h-4" />Copy</>
              )}
            </button>
          )}
          {open ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
        </div>
      </button>
      {open && (
        <div className="px-6 pb-6">
          <pre className="bg-slate-900 text-slate-300 p-4 rounded-lg text-xs overflow-x-auto max-h-48">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

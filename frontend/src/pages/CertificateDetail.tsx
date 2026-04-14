import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  ShieldCheck,
  ShieldX,
  Calendar,
  Server,
  Globe,
  Download,
  FileArchive,
  FileText,
  Key,
  Lock,
  Tag,
  Loader2,
  ChevronDown,
  ChevronRight,
  Info,
  Link as LinkIcon,
  Fingerprint,
  User,
} from 'lucide-react';
import api from '../services/api';
import type { CertificateDetail as CertDetail, OidEntry } from '../types';
import StatusBadge from '../components/StatusBadge';

export default function CertificateDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [cert, setCert] = useState<CertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');
  const [renewing, setRenewing] = useState(false);
  const [renewError, setRenewError] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState('');
  const [downloadPassword, setDownloadPassword] = useState('');
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [parsedDetails, setParsedDetails] = useState<any>(null);
  const [parsedLoading, setParsedLoading] = useState(false);

  const fetchCert = () => {
    api.get(`/certificates/${id}`).then((res) => {
      setCert(res.data);
      setLoading(false);
    });
  };

  const fetchParsedDetails = () => {
    setParsedLoading(true);
    api.get(`/certificates/${id}/parsed`).then((res) => {
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

  // Poll while renewing/processing
  useEffect(() => {
    if (!cert) return;
    if (!['renewing', 'processing', 'pending', 'revoking'].includes(cert.status)) {
      setRenewing(false);
      setRevoking(false);
      return;
    }
    const interval = setInterval(() => {
      api.get(`/certificates/${id}`).then((res) => {
        setCert(res.data);
        if (!['renewing', 'processing', 'pending', 'revoking'].includes(res.data.status)) {
          setRenewing(false);
          setRevoking(false);
        }
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [cert?.status, id]);

  const handleRenew = async () => {
    setRenewing(true);
    setRenewError('');
    try {
      await api.post(`/certificates/${id}/renew`);
      fetchCert();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setRenewError(axiosErr.response?.data?.detail || 'Error renewing certificate');
      } else {
        setRenewError('Error renewing certificate');
      }
      setRenewing(false);
    }
  };

  const [deleteError, setDeleteError] = useState<{ agents: string[]; deployment_count: number } | null>(null);

  const handleDelete = async (force = false) => {
    if (force) {
      if (!confirm('This certificate will be detached from all agents and deployments. Continue?')) return;
    } else {
      if (!confirm('Are you sure you want to delete this certificate?')) return;
    }
    try {
      await api.delete(`/certificates/${id}${force ? '?force=true' : ''}`);
      navigate('/certificates');
    } catch (err: any) {
      if (err.response?.status === 409) {
        setDeleteError(err.response.data.detail);
      }
    }
  };

  const handleRevoke = async () => {
    if (!confirm('Are you sure you want to revoke this certificate? This cannot be undone.')) return;
    setRevoking(true);
    setRevokeError('');
    try {
      await api.post(`/certificates/${id}/revoke`);
      fetchCert();
    } catch {
      setRevokeError('Error revoking certificate');
      setRevoking(false);
    }
  };

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
    const body = downloadPassword ? { password: downloadPassword } : {};
    const link = document.createElement('a');
    // Use fetch to handle auth header, POST to avoid password in URL
    api.post(url, body, { responseType: 'blob' }).then((res) => {
      const disposition = res.headers['content-disposition'] || '';
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch ? filenameMatch[1] : 'download';
      const blob = new Blob([res.data]);
      const blobUrl = URL.createObjectURL(blob);
      link.href = blobUrl;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(blobUrl);
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  if (!cert) {
    return <div className="text-center py-16 text-slate-400">Certificate not found</div>;
  }

  const sanDomains = cert.san_domains ? JSON.parse(cert.san_domains) : [];
  const customOids: OidEntry[] = cert.custom_oids ? JSON.parse(cert.custom_oids) : [];
  const isProcessing = ['renewing', 'processing', 'pending', 'revoking'].includes(cert.status);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-8">
        <Link
          to="/certificates"
          className="p-2 rounded-lg hover:bg-slate-200 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 truncate">{cert.common_name}</h1>
            <span className="text-sm text-slate-400 font-mono">ID: {cert.id}</span>
          </div>
          <p className="text-slate-500 mt-1">{cert.ca_name || 'Unknown CA'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRenew}
            disabled={renewing || isProcessing || cert.status === 'revoked'}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {renewing || isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {cert.status === 'renewing'
                  ? 'Renewing...'
                  : cert.status === 'revoking'
                    ? 'Revoking...'
                    : 'Requesting...'}
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Renew
              </>
            )}
          </button>
          {cert.status !== 'revoked' && cert.certificate_pem && (
            <button
              onClick={handleRevoke}
              disabled={revoking || isProcessing}
              className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {revoking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Revoking...
                </>
              ) : (
                <>
                  <ShieldX className="w-4 h-4" />
                  Revoke
                </>
              )}
            </button>
          )}
          <button
            onClick={() => handleDelete()}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      {/* Renew loading overlay */}
      {(renewing || isProcessing) && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-6 flex items-center gap-4">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin flex-shrink-0" />
          <div>
            <p className="font-medium text-blue-900">
              {cert.status === 'renewing'
                ? 'Certificate is being renewed...'
                : cert.status === 'revoking'
                  ? 'Certificate is being revoked...'
                  : 'Certificate is being requested...'}
            </p>
            <p className="text-sm text-blue-700 mt-1">
              This may take a few minutes. The page will update automatically.
            </p>
          </div>
        </div>
      )}

      {renewError && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">
          {renewError}
        </div>
      )}

      {revokeError && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">
          {revokeError}
        </div>
      )}

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

      {cert.status === 'revoked' && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-6 mb-6 flex items-center gap-4">
          <ShieldX className="w-6 h-6 text-orange-500 flex-shrink-0" />
          <div>
            <p className="font-medium text-orange-900">Certificate revoked</p>
            <p className="text-sm text-orange-700 mt-1">
              This certificate has been revoked by the Certificate Authority and is no longer valid.
            </p>
          </div>
        </div>
      )}

      {cert.created_by_username && (
        <div className="mb-4 flex items-center gap-2 text-sm text-slate-500">
          <User className="w-4 h-4" />
          Requested by <span className="font-medium text-slate-700">{cert.created_by_username}</span>
        </div>
      )}

      {cert.modified_by_username && (
        <div className="mb-4 flex items-center gap-2 text-sm text-slate-500">
          <User className="w-4 h-4" />
          Modified by <span className="font-medium text-slate-700">{cert.modified_by_username}</span>
          {cert.updated_at && (
            <span className="text-slate-400">
              op {new Date(cert.updated_at).toLocaleString()}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-3 text-slate-500 mb-2">
            <ShieldCheck className="w-5 h-5" />
            <span className="text-sm font-medium">Status</span>
          </div>
          <StatusBadge status={cert.status} />
          {cert.error_message && (
            <p className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
              {cert.error_message}
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-3 text-slate-500 mb-2">
            <Calendar className="w-5 h-5" />
            <span className="text-sm font-medium">Issued</span>
          </div>
          <p className="text-lg font-semibold text-slate-900">
            {cert.issued_at
              ? format(new Date(cert.issued_at), 'd MMMM yyyy')
              : '-'}
          </p>
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
            .filter((d: string) => d !== cert.common_name)
            .map((domain: string) => (
              <span
                key={domain}
                className="px-3 py-1.5 bg-slate-100 rounded-lg text-sm font-medium text-slate-700"
              >
                {domain}
              </span>
            ))}
        </div>
      </div>

      {/* Certificate Details */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Server className="w-5 h-5" />
          Certificate details
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-slate-500">Challenge type:</span>
            <span className="ml-2 font-medium text-slate-900">{cert.challenge_type}</span>
          </div>
          <div>
            <span className="text-slate-500">Auto-renewal:</span>
            <span className="ml-2 font-medium text-slate-900">
              {cert.auto_renew ? 'On' : 'Off'}
            </span>
          </div>
          {cert.auto_renew && (
            <div>
              <span className="text-slate-500">Renewal threshold:</span>
              <span className="ml-2 font-medium text-slate-900">
                {cert.renewal_threshold_days
                  ? `${cert.renewal_threshold_days} days before expiry`
                  : 'System default (30 days)'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* OIDs */}
      {customOids.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Tag className="w-5 h-5" />
            Object Identifiers (OID)
          </h2>
          <div className="space-y-2">
            {customOids.map((oid, i) => (
              <div key={i} className="flex items-center gap-3 text-sm bg-slate-50 p-3 rounded-lg">
                <code className="text-emerald-700 font-mono bg-emerald-50 px-2 py-0.5 rounded">
                  {oid.oid}
                </code>
                <span className="text-slate-600">{oid.value}</span>
              </div>
            ))}
          </div>
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
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
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
                className="mt-2 w-full max-w-sm px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              />
            )}
            {downloadPassword && (
              <p className="mt-1 text-xs text-amber-600">
                Private key and PFX will be encrypted with this password
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* ZIP Bundle */}
            <button
              onClick={() => downloadFile(`/certificates/${id}/download/zip`)}
              className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors text-left"
            >
              <FileArchive className="w-8 h-8 text-emerald-600 flex-shrink-0" />
              <div>
                <p className="font-medium text-emerald-900 text-sm">ZIP Bundel</p>
                <p className="text-xs text-emerald-700">All files in one ZIP</p>
              </div>
            </button>

            {/* Individual PEM downloads */}
            <button
              onClick={() => downloadFile(`/certificates/${id}/download/pem/certificate`)}
              className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-left"
            >
              <FileText className="w-8 h-8 text-blue-600 flex-shrink-0" />
              <div>
                <p className="font-medium text-blue-900 text-sm">Certificate</p>
                <p className="text-xs text-blue-700">certificate.pem</p>
              </div>
            </button>

            {cert.chain_pem && (
              <button
                onClick={() => downloadFile(`/certificates/${id}/download/pem/chain`)}
                className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-left"
              >
                <FileText className="w-8 h-8 text-blue-600 flex-shrink-0" />
                <div>
                  <p className="font-medium text-blue-900 text-sm">Chain</p>
                  <p className="text-xs text-blue-700">chain.pem</p>
                </div>
              </button>
            )}

            <button
              onClick={() => downloadFile(`/certificates/${id}/download/pem/fullchain`)}
              className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-left"
            >
              <FileText className="w-8 h-8 text-blue-600 flex-shrink-0" />
              <div>
                <p className="font-medium text-blue-900 text-sm">Full Chain</p>
                <p className="text-xs text-blue-700">fullchain.pem</p>
              </div>
            </button>

            <button
              onClick={() => downloadFile(`/certificates/${id}/download/pem/privatekey`)}
              className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors text-left"
            >
              <Key className="w-8 h-8 text-amber-600 flex-shrink-0" />
              <div>
                <p className="font-medium text-amber-900 text-sm">
                  Private Key {downloadPassword ? '(encrypted)' : ''}
                </p>
                <p className="text-xs text-amber-700">private_key.pem</p>
              </div>
            </button>

            {/* Combined PEM for Postfix */}
            <button
              onClick={() => downloadFile(`/certificates/${id}/download/pem/combined`)}
              className="flex items-center gap-3 p-4 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors text-left"
            >
              <FileText className="w-8 h-8 text-purple-600 flex-shrink-0" />
              <div>
                <p className="font-medium text-purple-900 text-sm">Combined PEM</p>
                <p className="text-xs text-purple-700">Key + cert + chain in one file</p>
              </div>
            </button>

            {/* PFX for Windows */}
            <button
              onClick={() => downloadFile(`/certificates/${id}/download/pfx`)}
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
          </div>
        </div>
      )}

      {/* Parsed Certificate Details */}
      {cert.certificate_pem && parsedDetails && (
        <div className="space-y-4">
          <ParsedCertBlock
            title="Certificate details (X.509)"
            data={parsedDetails.certificate}
            defaultOpen={true}
            pem={cert.certificate_pem}
            copied={copied}
            onCopy={copyToClipboard}
          />
          {parsedDetails.chain?.map((chainCert: any, i: number) => (
            <ParsedCertBlock
              key={i}
              title={`Chain certificate ${i + 1}${chainCert.subject?.CN ? ` — ${chainCert.subject.CN}` : ''}`}
              data={chainCert}
              defaultOpen={false}
              pem={null}
              copied={copied}
              onCopy={copyToClipboard}
            />
          ))}
        </div>
      )}

      {/* Raw PEM Data */}
      {cert.certificate_pem && (
        <div className="space-y-4 mt-4">
          <PemBlock
            title="Certificate (PEM)"
            content={cert.certificate_pem}
            copied={copied}
            onCopy={copyToClipboard}
          />
          {cert.chain_pem && (
            <PemBlock
              title="Chain (PEM)"
              content={cert.chain_pem}
              copied={copied}
              onCopy={copyToClipboard}
            />
          )}
        </div>
      )}

      {/* Loading state for parsed details */}
      {cert.certificate_pem && parsedLoading && !parsedDetails && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex items-center gap-3 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading certificate details...
        </div>
      )}
    </div>
  );
}

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
  defaultOpen,
  pem: _pem,
  copied: _copied,
  onCopy: _onCopy,
}: {
  title: string;
  data: any;
  defaultOpen: boolean;
  pem: string | null;
  copied: string;
  onCopy: (text: string, label: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
          {/* Subject & Issuer */}
          <DetailRow label="Subject" value={<NameDisplay name={data.subject} />} />
          <DetailRow label="Issuer" value={<NameDisplay name={data.issuer} />} />

          {/* Validity */}
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

          {/* Key Info */}
          <DetailRow label="Signature algorithm" value={data.signature_algorithm} />
          <DetailRow
            label="Public key"
            value={`${data.public_key_algorithm}${data.public_key_size ? ` ${data.public_key_size}` : ''}`}
          />

          {/* Extensions */}
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

          {ext.ocsp_urls && (
            <DetailRow
              label="OCSP"
              value={
                <div className="space-y-1">
                  {ext.ocsp_urls.map((url: string) => (
                    <div key={url} className="flex items-center gap-1">
                      <LinkIcon className="w-3 h-3 text-slate-400 flex-shrink-0" />
                      <span className="font-mono text-xs">{url}</span>
                    </div>
                  ))}
                </div>
              }
            />
          )}

          {ext.ca_issuer_urls && (
            <DetailRow
              label="CA Issuer"
              value={
                <div className="space-y-1">
                  {ext.ca_issuer_urls.map((url: string) => (
                    <div key={url} className="flex items-center gap-1">
                      <LinkIcon className="w-3 h-3 text-slate-400 flex-shrink-0" />
                      <span className="font-mono text-xs">{url}</span>
                    </div>
                  ))}
                </div>
              }
            />
          )}

          {ext.crl_distribution_points && (
            <DetailRow
              label="CRL Distribution Points"
              value={
                <div className="space-y-1">
                  {ext.crl_distribution_points.map((url: string) => (
                    <div key={url} className="flex items-center gap-1">
                      <LinkIcon className="w-3 h-3 text-slate-400 flex-shrink-0" />
                      <span className="font-mono text-xs">{url}</span>
                    </div>
                  ))}
                </div>
              }
            />
          )}

          {ext.sct_count != null && (
            <DetailRow label="Certificate Transparency" value={`${ext.sct_count} Signed Certificate Timestamp${ext.sct_count !== 1 ? 's' : ''}`} />
          )}

          {/* Fingerprint section */}
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

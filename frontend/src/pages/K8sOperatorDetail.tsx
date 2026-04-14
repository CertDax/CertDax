import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  Wifi,
  WifiOff,
  Container,
  Cpu,
  ShieldCheck,
  AlertTriangle,
  Server,
  ScrollText,
  Lock,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import api from '../services/api';
import type { K8sOperator } from '../types';
import StatusBadge from '../components/StatusBadge';

export default function K8sOperatorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [operator, setOperator] = useState<K8sOperator | null>(null);
  const [loading, setLoading] = useState(true);
  const [newToken, setNewToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const prevLogCountRef = useRef(0);

  const fetchOperator = async () => {
    try {
      const { data } = await api.get(`/k8s-operators/${id}`);
      setOperator(data);
    } catch {
      navigate('/k8s-operators');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchOperator();
    const interval = setInterval(fetchOperator, 5000);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    const newCount = operator?.recent_logs?.length || 0;
    if (autoScroll && logContainerRef.current && newCount !== prevLogCountRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
    prevLogCountRef.current = newCount;
  }, [operator?.recent_logs, autoScroll]);

  const handleDelete = async () => {
    if (!confirm('Delete this operator? This cannot be undone.')) return;
    await api.delete(`/k8s-operators/${id}`);
    navigate('/k8s-operators');
  };

  const handleRegenerateToken = async () => {
    if (!confirm('Regenerate operator token? The current token will stop working immediately.')) return;
    const { data } = await api.post(`/k8s-operators/${id}/regenerate-token`);
    setNewToken(data.operator_token);
    setShowToken(true);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  if (!operator) return null;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/k8s-operators')}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                operator.status === 'online'
                  ? 'bg-emerald-100'
                  : 'bg-red-100'
              }`}
            >
              {operator.status === 'online' ? (
                <Wifi className="w-5 h-5 text-emerald-600" />
              ) : (
                <WifiOff className="w-5 h-5 text-red-600" />
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{operator.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <StatusBadge status={operator.status} />
                {operator.operator_version && (
                  <span className="text-xs text-slate-400">v{operator.operator_version}</span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRegenerateToken}
            className="flex items-center gap-2 px-4 py-2 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Regenerate token
          </button>
          <button
            onClick={handleDelete}
            className="flex items-center gap-2 px-4 py-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg text-sm font-medium transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      {/* New token banner */}
      {newToken && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-medium text-amber-800 mb-2">New operator token (shown once)</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-white rounded-lg px-4 py-2 font-mono text-sm break-all border border-amber-200">
              {showToken ? newToken : '•'.repeat(40)}
            </div>
            <button
              onClick={() => setShowToken(!showToken)}
              className="p-2 text-amber-600 hover:text-amber-700 rounded-lg"
            >
              {showToken ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
            <button
              onClick={() => copyToClipboard(newToken, 'new-token')}
              className="p-2 text-amber-600 hover:text-amber-700 rounded-lg"
            >
              {copied === 'new-token' ? (
                <Check className="w-5 h-5 text-emerald-500" />
              ) : (
                <Copy className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Cluster info */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Container className="w-5 h-5 text-blue-500" />
            Cluster Information
          </h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Cluster</dt>
              <dd className="text-sm font-medium text-slate-900">{operator.cluster_name || '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Namespace</dt>
              <dd className="text-sm font-medium text-slate-900 font-mono">{operator.namespace || '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Deployment</dt>
              <dd className="text-sm font-medium text-slate-900 font-mono">{operator.deployment_name || '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Kubernetes version</dt>
              <dd className="text-sm font-medium text-slate-900">{operator.kubernetes_version || '-'}</dd>
            </div>
          </dl>
        </div>

        {/* Pod info */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Server className="w-5 h-5 text-purple-500" />
            Pod Information
          </h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Pod name</dt>
              <dd className="text-sm font-medium text-slate-900 font-mono">{operator.pod_name || '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Node</dt>
              <dd className="text-sm font-medium text-slate-900">{operator.node_name || '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Operator version</dt>
              <dd className="text-sm font-medium text-slate-900">
                {operator.operator_version ? `v${operator.operator_version}` : '-'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Last seen</dt>
              <dd className="text-sm font-medium text-slate-900">
                {operator.last_seen
                  ? format(new Date(operator.last_seen), 'd MMM yyyy HH:mm:ss')
                  : 'Never'}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Resource usage & certificate stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Resource usage */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-orange-500" />
            Resource Usage
          </h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">CPU usage</dt>
              <dd className="text-sm font-medium text-slate-900">{operator.cpu_usage || '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Memory usage</dt>
              <dd className="text-sm font-medium text-slate-900">{operator.memory_usage || '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Memory limit</dt>
              <dd className="text-sm font-medium text-slate-900">{operator.memory_limit || '-'}</dd>
            </div>
          </dl>
        </div>

        {/* Certificate stats */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            Certificate Statistics
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <p className="text-2xl font-bold text-blue-600">{operator.managed_certificates}</p>
              <p className="text-xs text-blue-700 mt-1">Managed</p>
            </div>
            <div className="text-center p-3 bg-emerald-50 rounded-lg">
              <p className="text-2xl font-bold text-emerald-600">{operator.ready_certificates}</p>
              <p className="text-xs text-emerald-700 mt-1">Ready</p>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <p className="text-2xl font-bold text-red-600">{operator.failed_certificates}</p>
              <p className="text-xs text-red-700 mt-1">Failed</p>
            </div>
          </div>
        </div>
      </div>

      {/* Last error */}
      {operator.last_error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold text-red-900 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            Last Error
          </h2>
          <pre className="text-sm text-red-800 font-mono whitespace-pre-wrap break-all bg-red-100/50 rounded-lg p-4">
            {operator.last_error}
          </pre>
        </div>
      )}

      {/* Live logs */}
      <div className="bg-slate-900 rounded-xl shadow-sm border border-slate-700 mb-6 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-emerald-400" />
            Live Logs
            <span className="text-xs text-slate-500">
              ({operator.recent_logs?.length || 0} lines)
            </span>
          </h2>
          <div className="flex items-center gap-3">
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
                const text = (operator.recent_logs || []).join('\n');
                copyToClipboard(text, 'logs');
              }}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"
            >
              {copied === 'logs' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              Copy
            </button>
          </div>
        </div>
        <div ref={logContainerRef} className="overflow-auto max-h-96 p-4 font-mono text-xs leading-5">
          {operator.recent_logs && operator.recent_logs.length > 0 ? (
            operator.recent_logs.map((line, i) => {
              const isError = /\bERROR\b/i.test(line);
              const isWarn = /\bWARN/i.test(line);
              return (
                <div
                  key={i}
                  className={
                    isError
                      ? 'text-red-400'
                      : isWarn
                        ? 'text-amber-400'
                        : 'text-slate-300'
                  }
                >
                  {line}
                </div>
              );
            })
          ) : (
            <div className="text-slate-500 text-center py-8">
              No logs available yet. Logs appear after the first heartbeat.
            </div>
          )}
        </div>
      </div>

      {/* Deployed Certificates */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Lock className="w-5 h-5 text-blue-500" />
            Deployed Certificates
            <span className="text-sm font-normal text-slate-400">
              ({operator.certificates?.length || 0})
            </span>
          </h2>
        </div>
        {operator.certificates && operator.certificates.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Common Name</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Secret</th>
                  <th className="px-6 py-3">Expires</th>
                  <th className="px-6 py-3">Last Synced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {operator.certificates.map((cert, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3">
                      {cert.ready ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 px-2.5 py-1 rounded-full" title={cert.message || undefined}>
                          <XCircle className="w-3.5 h-3.5" />
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-sm font-medium text-slate-900">
                      {cert.common_name || '-'}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full ${
                        cert.type === 'acme'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-violet-50 text-violet-700'
                      }`}>
                        {cert.type}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm font-mono text-slate-600">
                      {cert.namespace}/{cert.secret_name}
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-600">
                      {cert.expires_at
                        ? format(new Date(cert.expires_at), 'd MMM yyyy')
                        : '-'}
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-600">
                      {cert.last_synced_at
                        ? format(new Date(cert.last_synced_at), 'd MMM yyyy HH:mm')
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-12 text-center text-sm text-slate-400">
            No certificates deployed by this operator yet.
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-500 uppercase mb-3">Metadata</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-slate-400">Operator ID</dt>
            <dd className="text-sm font-mono text-slate-700">{operator.id}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Created</dt>
            <dd className="text-sm text-slate-700">
              {format(new Date(operator.created_at), 'd MMM yyyy HH:mm')}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  Plus,
  Container,
  Wifi,
  WifiOff,
  Copy,
  Check,
  Eye,
  EyeOff,
  X,
  ChevronRight,
} from 'lucide-react';
import api from '../services/api';
import type { K8sOperator } from '../types';
import StatusBadge from '../components/StatusBadge';

export default function K8sOperators() {
  const navigate = useNavigate();
  const [operators, setOperators] = useState<K8sOperator[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState<{
    id: number;
    name: string;
    token: string;
  } | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState('');

  // Form state
  const [name, setName] = useState('');

  const fetchOperators = async () => {
    const { data } = await api.get('/k8s-operators');
    setOperators(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchOperators();
    const interval = setInterval(fetchOperators, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data } = await api.post('/k8s-operators', { name });
    setShowAddForm(false);
    setShowTokenModal({
      id: data.id,
      name: data.name,
      token: data.operator_token,
    });
    setName('');
    fetchOperators();
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

  const onlineCount = operators.filter((o) => o.status === 'online').length;
  const offlineCount = operators.filter((o) => o.status === 'offline').length;

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
        <h1 className="text-2xl font-bold text-slate-900">Kubernetes Operators</h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 bg-emerald-500 text-white px-4 py-2 rounded-lg hover:bg-emerald-600 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Add operator
        </button>
      </div>
      <p className="text-slate-500 mb-6">
        Monitor your Kubernetes operators that sync CertDax certificates to clusters
      </p>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Container className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{operators.length}</p>
              <p className="text-sm text-slate-500">Total operators</p>
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

      {/* Add form */}
      {showAddForm && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h3 className="font-semibold text-slate-900 mb-4">Register new K8s operator</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Production Cluster"
                className="w-full max-w-md px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                required
              />
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
                Create operator
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Operator list */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                Operator
              </th>
              <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                Status
              </th>
              <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                Cluster
              </th>
              <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                Namespace
              </th>
              <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                Certificates
              </th>
              <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">
                Last seen
              </th>
              <th className="text-right text-xs font-medium text-slate-500 uppercase px-6 py-3">
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {operators.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                  <Container className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                  <p className="font-medium">No operators registered</p>
                  <p className="text-sm mt-1">
                    Add a K8s operator to sync certificates to your clusters
                  </p>
                </td>
              </tr>
            ) : (
              operators.map((op) => (
                <tr
                  key={op.id}
                  className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => navigate(`/k8s-operators/${op.id}`)}
                >
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{op.name}</p>
                      <p className="text-xs text-slate-500">
                        {op.operator_version ? `v${op.operator_version}` : '-'}
                      </p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={op.status} />
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {op.cluster_name || '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500 font-mono">
                    {op.namespace || '-'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-emerald-600 font-medium">{op.ready_certificates}</span>
                      <span className="text-slate-300">/</span>
                      <span className="text-slate-600">{op.managed_certificates}</span>
                      {op.failed_certificates > 0 && (
                        <span className="text-red-500 text-xs">({op.failed_certificates} failed)</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {op.last_seen
                      ? format(new Date(op.last_seen), 'd MMM yyyy HH:mm')
                      : 'Never'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-700 font-medium">
                      Details
                      <ChevronRight className="w-4 h-4" />
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Token modal */}
      {showTokenModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Operator created: {showTokenModal.name}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  Save the operator token — it will only be shown once
                </p>
              </div>
              <button
                onClick={() => {
                  setShowTokenModal(null);
                  setShowToken(false);
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Operator Token
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-100 rounded-lg px-4 py-3 font-mono text-sm break-all">
                    {showToken
                      ? showTokenModal.token
                      : '•'.repeat(40)}
                  </div>
                  <button
                    onClick={() => setShowToken(!showToken)}
                    className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"
                    title={showToken ? 'Hide' : 'Show'}
                  >
                    {showToken ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={() => copyToClipboard(showTokenModal.token, 'token')}
                    className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"
                    title="Copy"
                  >
                    {copied === 'token' ? (
                      <Check className="w-5 h-5 text-emerald-500" />
                    ) : (
                      <Copy className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800 font-medium mb-2">Helm install command</p>
                <div className="bg-slate-900 rounded-lg p-3">
                  <pre className="text-xs text-emerald-400 font-mono whitespace-pre-wrap break-all">
{`helm install certdax-operator certdax/certdax-operator \\
  --set certdax.apiUrl=${window.location.origin}/api \\
  --set certdax.apiKey=<YOUR_API_KEY> \\
  --set certdax.operatorToken=${showToken ? showTokenModal.token : '<TOKEN>'} \\
  --set clusterName=my-cluster`}
                  </pre>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-800">
                  <strong>Warning:</strong> This token is only shown once. If you lose it,
                  you can regenerate it from the operator detail page.
                </p>
              </div>
            </div>
            <div className="p-6 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => {
                  setShowTokenModal(null);
                  setShowToken(false);
                }}
                className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 text-sm font-medium"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

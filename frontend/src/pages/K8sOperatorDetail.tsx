import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
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
  Clock,
  Globe,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
} from 'lucide-react';
import api from '../services/api';
import type { K8sOperator, Certificate, SelfSignedCertificate } from '../types';
import StatusBadge from '../components/StatusBadge';

export default function K8sOperatorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [operator, setOperator] = useState<K8sOperator | null>(null);
  const [loading, setLoading] = useState(true);
  const [newToken, setNewToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState('');
  const [patchShell, setPatchShell] = useState<'bash' | 'pwsh7' | 'pwsh5'>('bash');
  const [helmShell, setHelmShell] = useState<'bash' | 'powershell'>('bash');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showSetupGuide, setShowSetupGuide] = useState<boolean | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const prevLogCountRef = useRef(0);

  // Credentials passed from create flow (only available once)
  const initialCredentials = useRef(
    (location.state as { operatorToken?: string; apiKey?: string } | null) ?? {}
  );
  const [credentials] = useState<{ operatorToken?: string; apiKey?: string }>(
    initialCredentials.current
  );

  // Deploy certificate modal state
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [deployCertType, setDeployCertType] = useState<'selfsigned' | 'acme'>('selfsigned');
  const [deployCertId, setDeployCertId] = useState<number | ''>('');
  const [deploySecretName, setDeploySecretName] = useState('');
  const [deployNamespace, setDeployNamespace] = useState('default');
  const [deploySyncInterval, setDeploySyncInterval] = useState('1h');
  const [deployIncludeCA, setDeployIncludeCA] = useState(true);
  const [deploySubmitting, setDeploySubmitting] = useState(false);
  const [availableCerts, setAvailableCerts] = useState<(Certificate | SelfSignedCertificate)[]>([]);
  const [deployments, setDeployments] = useState<{ id: number; certificate_id: number; certificate_type: string; secret_name: string; namespace: string }[]>([]);
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(new Set());

  const fetchOperator = async () => {
    try {
      const { data } = await api.get(`/k8s-operators/${id}`);
      setOperator(data);
      // Also fetch deployments so we know the deployment IDs for delete
      try {
        const { data: deps } = await api.get(`/k8s-operators/${id}/deployments`);
        setDeployments(deps);
      } catch {}
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

  // Auto-show setup guide when operator hasn't connected yet, auto-collapse once online
  useEffect(() => {
    if (!operator) return;
    if (showSetupGuide === null) {
      setShowSetupGuide(!operator.last_seen);
    } else if (showSetupGuide && operator.last_seen) {
      setShowSetupGuide(false);
    }
  }, [operator?.last_seen]);

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

  const openDeployModal = async () => {
    setDeployCertType('selfsigned');
    setDeployCertId('');
    setDeploySecretName('');
    setDeployNamespace('default');
    setDeploySyncInterval('1h');
    setDeployIncludeCA(true);
    setShowDeployModal(true);
    // Fetch available certificates
    try {
      const { data } = await api.get('/self-signed');
      setAvailableCerts(data);
    } catch {
      setAvailableCerts([]);
    }
  };

  const onDeployCertTypeChange = async (type: 'selfsigned' | 'acme') => {
    setDeployCertType(type);
    setDeployCertId('');
    try {
      const endpoint = type === 'selfsigned' ? '/self-signed' : '/certificates';
      const { data } = await api.get(endpoint);
      setAvailableCerts(data);
    } catch {
      setAvailableCerts([]);
    }
  };

  const handleDeleteDeployment = async (certId: number, certType: string) => {
    const dep = deployments.find(d => d.certificate_id === certId && d.certificate_type === certType);
    const key = `${certId}:${certType}`;
    if (dep) {
      // Dashboard-deployed cert: remove the deployment record
      if (!confirm('Remove this certificate deployment? The operator will delete the TLS secret from the cluster.')) return;
      setDeletingKeys(prev => new Set(prev).add(key));
      try {
        await api.delete(`/k8s-operators/${id}/deployments/${dep.id}`);
        fetchOperator();
      } catch (err) {
        console.error('Delete deployment failed', err);
        setDeletingKeys(prev => { const s = new Set(prev); s.delete(key); return s; });
      }
    } else {
      // YAML-created cert: request CR deletion via the operator
      if (!confirm('Delete this certificate CR from the cluster? The operator will remove the TLS secret and the CRD.')) return;
      setDeletingKeys(prev => new Set(prev).add(key));
      try {
        await api.post(`/k8s-operators/${id}/delete-cr`, {
          certificate_id: certId,
          certificate_type: certType,
        });
        fetchOperator();
      } catch (err) {
        console.error('Delete CR failed', err);
        setDeletingKeys(prev => { const s = new Set(prev); s.delete(key); return s; });
      }
    }
  };

  const handleDeploy = async () => {
    if (!deployCertId || !deploySecretName) return;
    setDeploySubmitting(true);
    try {
      await api.post(`/k8s-operators/${id}/deployments`, {
        certificate_id: deployCertId,
        certificate_type: deployCertType,
        secret_name: deploySecretName,
        namespace: deployNamespace,
        sync_interval: deploySyncInterval,
        include_ca: deployIncludeCA,
      });
      setShowDeployModal(false);
      fetchOperator();
    } catch (err) {
      console.error('Deploy failed', err);
    }
    setDeploySubmitting(false);
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
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-amber-700">Apply to Kubernetes:</p>
              <div className="flex rounded-md overflow-hidden border border-amber-300 text-xs">
                <button
                  onClick={() => setPatchShell('bash')}
                  className={`px-2.5 py-0.5 font-medium transition-colors ${patchShell === 'bash' ? 'bg-amber-200 text-amber-900' : 'bg-white text-amber-600 hover:bg-amber-50'}`}
                >
                  Bash
                </button>
                <button
                  onClick={() => setPatchShell('pwsh7')}
                  className={`px-2.5 py-0.5 font-medium transition-colors border-l border-amber-300 ${patchShell === 'pwsh7' ? 'bg-amber-200 text-amber-900' : 'bg-white text-amber-600 hover:bg-amber-50'}`}
                >
                  PowerShell 7+
                </button>
                <button
                  onClick={() => setPatchShell('pwsh5')}
                  className={`px-2.5 py-0.5 font-medium transition-colors border-l border-amber-300 ${patchShell === 'pwsh5' ? 'bg-amber-200 text-amber-900' : 'bg-white text-amber-600 hover:bg-amber-50'}`}
                >
                  PowerShell 5
                </button>
              </div>
            </div>
            <div className="relative bg-slate-900 rounded-lg p-3">
              <pre className="text-xs text-emerald-400 font-mono whitespace-pre-wrap break-all">
{patchShell === 'bash'
  ? `kubectl patch secret certdax-operator-operator-token -n certdax-system \\\n  -p '{"data":{"operator-token":"${btoa(newToken)}"}}' && \\\nkubectl rollout restart deployment certdax-operator -n certdax-system`
  : patchShell === 'pwsh7'
  ? `$json = '{"data":{"operator-token":"${btoa(newToken)}"}}'
kubectl patch secret certdax-operator-operator-token -n certdax-system -p $json
kubectl rollout restart deployment certdax-operator -n certdax-system`
  : `kubectl patch secret certdax-operator-operator-token -n certdax-system --% -p "{\\"data\\":{\\"operator-token\\":\\"${btoa(newToken)}\\"}}"
kubectl rollout restart deployment certdax-operator -n certdax-system`}
              </pre>
              <button
                onClick={() => copyToClipboard(
                  patchShell === 'bash'
                    ? `kubectl patch secret certdax-operator-operator-token -n certdax-system \\\n  -p '{"data":{"operator-token":"${btoa(newToken)}"}}' && \\\nkubectl rollout restart deployment certdax-operator -n certdax-system`
                    : patchShell === 'pwsh7'
                    ? `$json = '{"data":{"operator-token":"${btoa(newToken)}"}}'\nkubectl patch secret certdax-operator-operator-token -n certdax-system -p $json\nkubectl rollout restart deployment certdax-operator -n certdax-system`
                    : `kubectl patch secret certdax-operator-operator-token -n certdax-system --% -p "{\\"data\\":{\\"operator-token\\":\\"${btoa(newToken)}\\"}}"
kubectl rollout restart deployment certdax-operator -n certdax-system`,
                  'patch-cmd'
                )}
                className="absolute top-2 right-2 p-1.5 text-slate-500 hover:text-slate-300 rounded"
              >
                {copied === 'patch-cmd' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Setup Guide - only shown when operator hasn't connected yet */}
      {!operator.last_seen && (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 overflow-hidden">
        <button
          onClick={() => setShowSetupGuide(!showSetupGuide)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition-colors"
        >
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-500" />
            Setup Guide
          </h2>
          {showSetupGuide ? (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronRight className="w-5 h-5 text-slate-400" />
          )}
        </button>
        {showSetupGuide && (
          <div className="px-6 pb-6 border-t border-slate-100">
            {/* Step 1 */}
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">1</span>
                Add the Helm repository
              </h3>
              <div className="relative bg-slate-900 rounded-lg p-3">
                <pre className="text-xs text-emerald-400 font-mono whitespace-pre-wrap break-all">
{`helm repo add certdax https://charts.certdax.com
helm repo update`}
                </pre>
                <button
                  onClick={() => copyToClipboard('helm repo add certdax https://charts.certdax.com\nhelm repo update', 'step1')}
                  className="absolute top-2 right-2 p-1.5 text-slate-500 hover:text-slate-300 rounded"
                >
                  {copied === 'step1' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">2</span>
                  Install the operator
                </h3>
                <div className="flex rounded-md overflow-hidden border border-slate-300 text-xs">
                  <button
                    onClick={() => setHelmShell('bash')}
                    className={`px-2.5 py-0.5 font-medium transition-colors ${helmShell === 'bash' ? 'bg-indigo-100 text-indigo-800' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    Bash
                  </button>
                  <button
                    onClick={() => setHelmShell('powershell')}
                    className={`px-2.5 py-0.5 font-medium transition-colors border-l border-slate-300 ${helmShell === 'powershell' ? 'bg-indigo-100 text-indigo-800' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    PowerShell
                  </button>
                </div>
              </div>
              <div className="relative bg-slate-900 rounded-lg p-3">
                <pre className="text-xs text-emerald-400 font-mono whitespace-pre-wrap break-all">
{helmShell === 'bash'
  ? `helm install certdax-operator certdax/certdax-operator \\
  --namespace certdax-system --create-namespace \\
  --set certdax.apiUrl=${window.location.origin}/api \\
  --set certdax.apiKey=${credentials.apiKey || '<YOUR_API_KEY>'} \\
  --set certdax.operatorToken=${credentials.operatorToken || '<OPERATOR_TOKEN>'} \\
  --set clusterName=${operator.cluster_name || 'my-cluster'}`
  : `helm install certdax-operator certdax/certdax-operator \`
  --namespace certdax-system --create-namespace \`
  --set certdax.apiUrl=${window.location.origin}/api \`
  --set certdax.apiKey=${credentials.apiKey || '<YOUR_API_KEY>'} \`
  --set certdax.operatorToken=${credentials.operatorToken || '<OPERATOR_TOKEN>'} \`
  --set clusterName=${operator.cluster_name || 'my-cluster'}`}
                </pre>
                <button
                  onClick={() => copyToClipboard(
                    helmShell === 'bash'
                      ? `helm install certdax-operator certdax/certdax-operator \\\n  --namespace certdax-system --create-namespace \\\n  --set certdax.apiUrl=${window.location.origin}/api \\\n  --set certdax.apiKey=${credentials.apiKey || '<YOUR_API_KEY>'} \\\n  --set certdax.operatorToken=${credentials.operatorToken || '<OPERATOR_TOKEN>'} \\\n  --set clusterName=${operator.cluster_name || 'my-cluster'}`
                      : `helm install certdax-operator certdax/certdax-operator \`\n  --namespace certdax-system --create-namespace \`\n  --set certdax.apiUrl=${window.location.origin}/api \`\n  --set certdax.apiKey=${credentials.apiKey || '<YOUR_API_KEY>'} \`\n  --set certdax.operatorToken=${credentials.operatorToken || '<OPERATOR_TOKEN>'} \`\n  --set clusterName=${operator.cluster_name || 'my-cluster'}`,
                    'step2'
                  )}
                  className="absolute top-2 right-2 p-1.5 text-slate-500 hover:text-slate-300 rounded"
                >
                  {copied === 'step2' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              {credentials.apiKey && credentials.operatorToken ? (
                <p className="text-xs text-emerald-600 mt-2">
                  API key and operator token are pre-filled. You can copy the command above and run it directly.
                </p>
              ) : (
                <p className="text-xs text-slate-500 mt-2">
                  Replace <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">&lt;YOUR_API_KEY&gt;</code> with your CertDax API key and <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">&lt;OPERATOR_TOKEN&gt;</code> with the token shown when you created this operator.
                </p>
              )}
            </div>

            {/* Step 3 */}
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">3</span>
                Verify the installation
              </h3>
              <div className="relative bg-slate-900 rounded-lg p-3">
                <pre className="text-xs text-emerald-400 font-mono whitespace-pre-wrap break-all">
{`# Check the operator pod is running
kubectl get pods -n certdax-system

# Check operator logs
kubectl logs -n certdax-system -l app.kubernetes.io/name=certdax-operator -f`}
                </pre>
                <button
                  onClick={() => copyToClipboard('kubectl get pods -n certdax-system\nkubectl logs -n certdax-system -l app.kubernetes.io/name=certdax-operator -f', 'step3')}
                  className="absolute top-2 right-2 p-1.5 text-slate-500 hover:text-slate-300 rounded"
                >
                  {copied === 'step3' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Step 4 */}
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">4</span>
                Deploy a certificate
              </h3>
              <div className="relative bg-slate-900 rounded-lg p-3">
                <pre className="text-xs text-emerald-400 font-mono whitespace-pre-wrap break-all">
{`apiVersion: certdax.com/v1alpha1
kind: CertDaxCertificate
metadata:
  name: my-cert
spec:
  certificateId: 42        # Certificate ID from CertDax
  type: selfsigned          # selfsigned or acme
  secretName: my-app-tls    # TLS secret to create
  syncInterval: "1h"        # Re-sync interval`}
                </pre>
                <button
                  onClick={() => copyToClipboard(`apiVersion: certdax.com/v1alpha1
kind: CertDaxCertificate
metadata:
  name: my-cert
spec:
  certificateId: 42
  type: selfsigned
  secretName: my-app-tls
  syncInterval: "1h"`, 'step4')}
                  className="absolute top-2 right-2 p-1.5 text-slate-500 hover:text-slate-300 rounded"
                >
                  {copied === 'step4' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                The operator will fetch the certificate and create a standard <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">kubernetes.io/tls</code> secret. Use it in any Ingress or Traefik IngressRoute.
              </p>
            </div>

            {/* Step 5 */}
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">5</span>
                Check certificate status
              </h3>
              <div className="relative bg-slate-900 rounded-lg p-3">
                <pre className="text-xs text-emerald-400 font-mono whitespace-pre-wrap break-all">
{`kubectl get certdaxcertificates
# or use the short name:
kubectl get cdxcert`}
                </pre>
                <button
                  onClick={() => copyToClipboard('kubectl get certdaxcertificates', 'step5')}
                  className="absolute top-2 right-2 p-1.5 text-slate-500 hover:text-slate-300 rounded"
                >
                  {copied === 'step5' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
        )}
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
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <p className="text-2xl font-bold text-blue-600">{operator.managed_certificates}</p>
              <p className="text-xs text-blue-700 mt-1">Managed</p>
            </div>
            <div className="text-center p-3 bg-emerald-50 rounded-lg">
              <p className="text-2xl font-bold text-emerald-600">{operator.ready_certificates}</p>
              <p className="text-xs text-emerald-700 mt-1">Ready</p>
            </div>
            <div className="text-center p-3 bg-amber-50 rounded-lg">
              <p className="text-2xl font-bold text-amber-600">{operator.pending_certificates}</p>
              <p className="text-xs text-amber-700 mt-1">Pending</p>
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
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Lock className="w-5 h-5 text-blue-500" />
            Deployed Certificates
            <span className="text-sm font-normal text-slate-400">
              ({operator.certificates?.length || 0})
            </span>
          </h2>
          <button
            onClick={openDeployModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Deploy Certificate
          </button>
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
                  <th className="px-6 py-3">Ingress</th>
                  <th className="px-6 py-3">Expires</th>
                  <th className="px-6 py-3">Last Synced</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {operator.certificates.map((cert, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3">
                      {deletingKeys.has(`${cert.certificate_id}:${cert.type}`) ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                          <Clock className="w-3.5 h-3.5 animate-spin" />
                          Deleting
                        </span>
                      ) : cert.ready ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Ready
                        </span>
                      ) : (cert as any).dashboard_pending || cert.message === 'Waiting for certificate to be issued' || !cert.message ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full" title={cert.message || 'Pending'}>
                          <Clock className="w-3.5 h-3.5" />
                          Pending
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
                      {cert.ingresses && cert.ingresses.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {cert.ingresses.map((ing, j) => (
                            <span key={j} className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full w-fit">
                              <Globe className="w-3 h-3" />
                              {ing}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
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
                    <td className="px-6 py-3">
                      <button
                        onClick={() => handleDeleteDeployment(cert.certificate_id, cert.type)}
                        disabled={deletingKeys.has(`${cert.certificate_id}:${cert.type}`)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Remove deployment"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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

      {/* Deploy Certificate Modal */}
      {showDeployModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Deploy Certificate to Cluster</h3>
              <button onClick={() => setShowDeployModal(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* Certificate type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Certificate Type</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => onDeployCertTypeChange('selfsigned')}
                    className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg border transition-colors ${
                      deployCertType === 'selfsigned'
                        ? 'bg-violet-50 border-violet-300 text-violet-700'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Self-Signed / CA
                  </button>
                  <button
                    onClick={() => onDeployCertTypeChange('acme')}
                    className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg border transition-colors ${
                      deployCertType === 'acme'
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    ACME (Let's Encrypt)
                  </button>
                </div>
              </div>

              {/* Certificate select */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Certificate</label>
                <select
                  value={deployCertId}
                  onChange={(e) => {
                    const certId = Number(e.target.value);
                    setDeployCertId(certId || '');
                    if (certId && !deploySecretName) {
                      const cert = availableCerts.find((c) => c.id === certId);
                      if (cert) {
                        const slug = cert.common_name
                          .replace(/^\*\.?/, 'wildcard-')
                          .replace(/[^a-z0-9.-]/gi, '-')
                          .replace(/^[-.]+|[-.]+$/g, '')
                          .toLowerCase();
                        setDeploySecretName(`${slug}-tls`);
                      }
                    }
                  }}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  <option value="">Select a certificate…</option>
                  {availableCerts.map((cert) => (
                    <option key={cert.id} value={cert.id}>
                      {cert.common_name} (ID: {cert.id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Secret name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Secret Name</label>
                <input
                  type="text"
                  value={deploySecretName}
                  onChange={(e) => setDeploySecretName(e.target.value)}
                  placeholder="my-cert-tls"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              {/* Namespace */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Namespace</label>
                <input
                  type="text"
                  value={deployNamespace}
                  onChange={(e) => setDeployNamespace(e.target.value)}
                  placeholder="default"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              {/* Advanced: sync interval + include CA */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sync Interval</label>
                  <input
                    type="text"
                    value={deploySyncInterval}
                    onChange={(e) => setDeploySyncInterval(e.target.value)}
                    placeholder="1h"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deployIncludeCA}
                      onChange={(e) => setDeployIncludeCA(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    Include CA chain
                  </label>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setShowDeployModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeploy}
                disabled={!deployCertId || !deploySecretName || deploySubmitting}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {deploySubmitting ? 'Deploying…' : 'Deploy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

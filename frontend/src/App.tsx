import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from './services/api';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Certificates from './pages/Certificates';
import CertificateDetail from './pages/CertificateDetail';
import RequestCertificate from './pages/RequestCertificate';
import Providers from './pages/Providers';
import Deployments from './pages/Deployments';
import Agents from './pages/Agents';
import AgentDetail from './pages/AgentDetail';
import AgentGroups from './pages/AgentGroups';
import AgentGroupDetail from './pages/AgentGroupDetail';
import K8sOperators from './pages/K8sOperators';
import K8sOperatorDetail from './pages/K8sOperatorDetail';
import SelfSigned from './pages/SelfSigned';
import SelfSignedDetail from './pages/SelfSignedDetail';
import Users from './pages/Users';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import EmailTemplates from './pages/EmailTemplates';
import ApiDashboard from './pages/ApiDashboard';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import Setup from './pages/Setup';

function StartingUpScreen() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-6 animate-pulse">
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">CertDax</h1>
        <p className="text-slate-400">Starting up, please wait...</p>
        <div className="mt-6">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500 mx-auto" />
        </div>
      </div>
    </div>
  );
}

function ProtectedRoute() {
  const token = localStorage.getItem('token');
  const [checking, setChecking] = useState(true);
  const [starting, setStarting] = useState(false);
  const [redirect, setRedirect] = useState<string | null>(null);

  useEffect(() => {
    let attempt = 0;
    const check = () => {
      api.get('/setup/status')
        .then(({ data }) => {
          if (data.needs_setup) {
            localStorage.removeItem('token');
            setRedirect('/setup');
          } else if (!token) {
            setRedirect('/login');
          }
          setChecking(false);
        })
        .catch(() => {
          attempt++;
          if (attempt >= 2) setStarting(true);
          setTimeout(check, 2000);
        });
    };
    check();
  }, [token]);

  if (checking) return starting ? <StartingUpScreen /> : null;
  if (redirect) return <Navigate to={redirect} replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/certificates" element={<Certificates />} />
          <Route path="/certificates/new" element={<RequestCertificate />} />
          <Route path="/certificates/:id" element={<CertificateDetail />} />
          <Route path="/providers" element={<Providers />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/agents/:id" element={<AgentDetail />} />
          <Route path="/agent-groups" element={<AgentGroups />} />
          <Route path="/agent-groups/:id" element={<AgentGroupDetail />} />
          <Route path="/k8s-operators" element={<K8sOperators />} />
          <Route path="/k8s-operators/:id" element={<K8sOperatorDetail />} />
          <Route path="/deployments" element={<Deployments />} />
          <Route path="/self-signed" element={<SelfSigned />} />
          <Route path="/self-signed/:id" element={<SelfSignedDetail />} />
          <Route path="/users" element={<Users />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/email-templates" element={<EmailTemplates />} />
          <Route path="/api-keys" element={<ApiDashboard />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
      </Route>
    </Routes>
  );
}

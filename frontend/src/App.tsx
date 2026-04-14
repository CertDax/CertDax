import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
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

function ProtectedRoute() {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
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

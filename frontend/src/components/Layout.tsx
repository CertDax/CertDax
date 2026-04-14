import { Outlet, NavLink, useNavigate, useLocation, Link } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import {
  LayoutDashboard,
  ShieldCheck,
  Server,
  Upload,
  LogOut,
  Lock,
  Monitor,
  FileLock2,
  Users,
  Settings,
  ChevronDown,
  FolderTree,
  Mail,
  Key,
  Menu,
  X,
  Container,
} from 'lucide-react';
import api from '../services/api';
import type { User } from '../types';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/certificates', icon: ShieldCheck, label: 'Certificates' },
  { to: '/providers', icon: Server, label: 'Providers' },
  { to: '/agents', icon: Monitor, label: 'Agents' },
  { to: '/agent-groups', icon: FolderTree, label: 'Agent Groups' },
  { to: '/k8s-operators', icon: Container, label: 'K8s Operators' },
  { to: '/deployments', icon: Upload, label: 'Deployments' },
  { to: '/self-signed', icon: FileLock2, label: 'Self-Signed' },
  { to: '/api-keys', icon: Key, label: 'API' },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/auth/me').then(({ data }) => {
      setCurrentUser(data);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handleProfileUpdate = (e: Event) => {
      setCurrentUser((e as CustomEvent).detail);
    };
    window.addEventListener('profile-updated', handleProfileUpdate);
    return () => window.removeEventListener('profile-updated', handleProfileUpdate);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <div className="flex h-screen">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white flex flex-col transform transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-6 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center">
              <Lock className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold">CertDax</h1>
              <p className="text-xs text-slate-400">SSL Dashboard</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <item.icon className="w-5 h-5" />
              <span className="text-sm font-medium">{item.label}</span>
            </NavLink>
          ))}
          {currentUser?.is_admin && (
            <>
            <NavLink
              to="/users"
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Users className="w-5 h-5" />
              <span className="text-sm font-medium">Users</span>
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Settings className="w-5 h-5" />
              <span className="text-sm font-medium">Settings</span>
            </NavLink>
            <NavLink
              to="/email-templates"
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Mail className="w-5 h-5" />
              <span className="text-sm font-medium">Email Templates</span>
            </NavLink>
            </>
          )}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors w-full"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-sm font-medium">Log out</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top header bar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-8 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-700 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          {currentUser && (
            <div className="relative ml-auto" ref={menuRef}>
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="flex items-center gap-3 hover:bg-slate-50 rounded-lg px-3 py-2 transition-colors"
              >
                {currentUser.profile_image ? (
                  <img
                    src={currentUser.profile_image}
                    alt={currentUser.username}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center">
                    <span className="text-sm font-semibold text-white">
                      {currentUser.username.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="text-left">
                  <p className="text-sm font-medium text-slate-900">{currentUser.display_name || currentUser.username}</p>
                  <p className="text-xs text-slate-400">
                    {currentUser.is_admin ? 'Administrator' : 'User'}
                    {currentUser.group_name ? ` · ${currentUser.group_name}` : ''}
                  </p>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-400" />
              </button>

              {showProfileMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50">
                  <Link
                    to="/profile"
                    onClick={() => setShowProfileMenu(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Profile settings
                  </Link>
                  <div className="border-t border-slate-100" />
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors w-full"
                  >
                    <LogOut className="w-4 h-4" />
                    Log out
                  </button>
                </div>
              )}
            </div>
          )}
        </header>

        <main className="flex-1 overflow-auto bg-slate-50">
          <div className="p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

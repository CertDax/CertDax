import { useEffect, useState } from 'react';
import {
  Plus,
  Users as UsersIcon,
  Pencil,
  Trash2,
  X,
  FolderOpen,
  Shield,
  Share2,
} from 'lucide-react';
import api from '../services/api';
import type { User, Group, GroupShare } from '../types';

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUserForm, setShowUserForm] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [error, setError] = useState('');

  // User form state
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [groupId, setGroupId] = useState<number | null>(null);

  // Group form state
  const [groupName, setGroupName] = useState('');

  // Share modal state
  const [shareGroup, setShareGroup] = useState<Group | null>(null);
  const [shares, setShares] = useState<GroupShare[]>([]);
  const [shareTargetGroupId, setShareTargetGroupId] = useState<number | ''>('');
  const [shareResourceType, setShareResourceType] = useState('certificates');
  const [shareError, setShareError] = useState('');

  const RESOURCE_TYPE_LABELS: Record<string, string> = {
    certificates: 'Certificates',
    self_signed: 'Self-Signed',
    agents: 'Agents',
    providers: 'Providers',
  };

  const fetchData = async () => {
    try {
      const [usersRes, groupsRes] = await Promise.all([
        api.get('/users'),
        api.get('/users/groups'),
      ]);
      setUsers(usersRes.data);
      setGroups(groupsRes.data);
    } catch {
      setError('Unable to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const resetUserForm = () => {
    setUsername('');
    setEmail('');
    setPassword('');
    setIsAdmin(false);
    setGroupId(null);
    setEditingUser(null);
    setShowUserForm(false);
    setError('');
  };

  const openEditUser = (user: User) => {
    setEditingUser(user);
    setUsername(user.username);
    setEmail(user.email);
    setIsAdmin(user.is_admin);
    setGroupId(user.group_id);
    setPassword('');
    setShowUserForm(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      if (editingUser) {
        const body: Record<string, unknown> = {};
        if (username !== editingUser.username) body.username = username;
        if (email !== editingUser.email) body.email = email;
        if (password) body.password = password;
        if (isAdmin !== editingUser.is_admin) body.is_admin = isAdmin;
        if (groupId !== editingUser.group_id) body.group_id = groupId;
        await api.put(`/users/${editingUser.id}`, body);
      } else {
        await api.post('/users', {
          username,
          email,
          password,
          is_admin: isAdmin,
          group_id: groupId,
        });
      }
      resetUserForm();
      fetchData();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setError(axiosErr.response?.data?.detail || 'An error occurred');
      } else {
        setError('An error occurred');
      }
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (!confirm(`Are you sure you want to delete "${user.username}"?`)) return;
    try {
      await api.delete(`/users/${user.id}`);
      fetchData();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setError(axiosErr.response?.data?.detail || 'Unable to delete user');
      }
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/users/groups', { name: groupName });
      setGroupName('');
      setShowGroupForm(false);
      fetchData();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setError(axiosErr.response?.data?.detail || 'Unable to create group');
      }
    }
  };

  const handleDeleteGroup = async (group: Group) => {
    if (!confirm(`Are you sure you want to delete group "${group.name}"?`)) return;
    try {
      await api.delete(`/users/groups/${group.id}`);
      fetchData();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setError(axiosErr.response?.data?.detail || 'Unable to delete group');
      }
    }
  };

  const openShareModal = async (group: Group) => {
    setShareGroup(group);
    setShareError('');
    setShareTargetGroupId('');
    setShareResourceType('certificates');
    try {
      const res = await api.get(`/users/groups/${group.id}/shares`);
      setShares(res.data);
    } catch {
      setShares([]);
    }
  };

  const handleCreateShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareGroup || !shareTargetGroupId) return;
    setShareError('');
    try {
      await api.post(`/users/groups/${shareGroup.id}/shares`, {
        target_group_id: shareTargetGroupId,
        resource_type: shareResourceType,
      });
      const res = await api.get(`/users/groups/${shareGroup.id}/shares`);
      setShares(res.data);
      setShareTargetGroupId('');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setShareError(axiosErr.response?.data?.detail || 'Unable to create share');
      }
    }
  };

  const handleDeleteShare = async (shareId: number) => {
    if (!shareGroup) return;
    try {
      await api.delete(`/users/groups/${shareGroup.id}/shares/${shareId}`);
      setShares(shares.filter((s) => s.id !== shareId));
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setShareError(axiosErr.response?.data?.detail || 'Unable to delete share');
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">User management</h1>
          <p className="text-slate-500 mt-1">
            Manage users and groups
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Groups section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FolderOpen className="w-5 h-5 text-slate-600" />
            <h2 className="text-lg font-semibold text-slate-900">Groups</h2>
            <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2.5 py-0.5 rounded-full">
              {groups.length}
            </span>
          </div>
          <button
            onClick={() => setShowGroupForm(true)}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New group
          </button>
        </div>

        {showGroupForm && (
          <div className="p-6 border-b border-slate-200 bg-slate-50">
            <form onSubmit={handleCreateGroup} className="flex items-end gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Group name
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                  placeholder="E.g. Marketing, IT, Management..."
                  required
                />
              </div>
              <button
                type="submit"
                className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => { setShowGroupForm(false); setGroupName(''); }}
                className="text-slate-500 hover:text-slate-700 px-3 py-2"
              >
                <X className="w-5 h-5" />
              </button>
            </form>
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {groups.map((group) => (
            <div key={group.id} className="p-4 px-6 flex items-center justify-between hover:bg-slate-50">
              <div className="flex items-center gap-3">
                <FolderOpen className="w-4 h-4 text-slate-400" />
                <span className="font-medium text-slate-900">{group.name}</span>
                <span className="text-xs text-slate-400">
                  {users.filter((u) => u.group_id === group.id).length} user(s)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openShareModal(group)}
                  className="text-slate-400 hover:text-blue-500 transition-colors"
                  title="Manage shares"
                >
                  <Share2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDeleteGroup(group)}
                  className="text-slate-400 hover:text-red-500 transition-colors"
                  title="Delete group"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          {groups.length === 0 && (
            <div className="p-8 text-center text-slate-500">No groups found</div>
          )}
        </div>
      </div>

      {/* Share modal */}
      {shareGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Manage shares
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  Group: <span className="font-medium text-slate-700">{shareGroup.name}</span>
                </p>
              </div>
              <button onClick={() => setShareGroup(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {shareError && (
                <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {shareError}
                </div>
              )}

              {/* Add share form */}
              <form onSubmit={handleCreateShare} className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Target group
                  </label>
                  <select
                    value={shareTargetGroupId}
                    onChange={(e) => setShareTargetGroupId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                    required
                  >
                    <option value="">Choose a group...</option>
                    {groups
                      .filter((g) => g.id !== shareGroup.id)
                      .map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Resource type
                  </label>
                  <select
                    value={shareResourceType}
                    onChange={(e) => setShareResourceType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                  >
                    {Object.entries(RESOURCE_TYPE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </form>

              {/* Existing shares */}
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {shares.length === 0 ? (
                  <div className="p-4 text-center text-sm text-slate-500">
                    No shares configured
                  </div>
                ) : (
                  shares.map((share) => (
                    <div key={share.id} className="p-3 px-4 flex items-center justify-between hover:bg-slate-50">
                      <div className="flex items-center gap-3">
                        <Share2 className="w-4 h-4 text-blue-400" />
                        <div>
                          <span className="text-sm font-medium text-slate-900">
                            {share.target_group_name}
                          </span>
                          <span className="ml-2 inline-flex items-center bg-blue-50 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">
                            {RESOURCE_TYPE_LABELS[share.resource_type] || share.resource_type}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteShare(share.id)}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                        title="Delete share"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Users section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <UsersIcon className="w-5 h-5 text-slate-600" />
            <h2 className="text-lg font-semibold text-slate-900">Users</h2>
            <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2.5 py-0.5 rounded-full">
              {users.length}
            </span>
          </div>
          <button
            onClick={() => { resetUserForm(); setShowUserForm(true); }}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New user
          </button>
        </div>

        {/* User form modal */}
        {showUserForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
              <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">
                  {editingUser ? 'Edit user' : 'New user'}
                </h3>
                <button onClick={resetUserForm} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveUser} className="p-6 space-y-4">
                {error && (
                  <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Password {editingUser && <span className="text-slate-400 font-normal">(leave empty to keep unchanged)</span>}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    {...(!editingUser ? { required: true } : {})}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Group
                  </label>
                  <select
                    value={groupId ?? ''}
                    onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                  >
                    <option value="">No group</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isAdmin"
                    checked={isAdmin}
                    onChange={(e) => setIsAdmin(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                  />
                  <label htmlFor="isAdmin" className="text-sm font-medium text-slate-700">
                    Administrator
                  </label>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    {editingUser ? 'Save' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={resetUserForm}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Users table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Email</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Group</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {user.profile_image ? (
                        <img
                          src={user.profile_image}
                          alt={user.username}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-slate-600">
                            {user.username.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <span className="font-medium text-slate-900">{user.username}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{user.email}</td>
                  <td className="px-6 py-4">
                    {user.group_name ? (
                      <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full">
                        <FolderOpen className="w-3 h-3" />
                        {user.group_name}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">No group</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {user.is_admin ? (
                      <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 text-xs font-medium px-2.5 py-1 rounded-full">
                        <Shield className="w-3 h-3" />
                        Admin
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">User</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEditUser(user)}
                        className="text-slate-400 hover:text-emerald-500 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user)}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    No users found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

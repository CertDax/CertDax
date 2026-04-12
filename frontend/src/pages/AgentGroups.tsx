import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  FolderTree,
  Plus,
  Trash2,
  ChevronRight,
  Monitor,
  X,
} from 'lucide-react';
import api from '../services/api';
import type { AgentGroupInfo } from '../types';

export default function AgentGroups() {
  const [groups, setGroups] = useState<AgentGroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchGroups = async () => {
    const { data } = await api.get('/agent-groups');
    setGroups(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/agent-groups', {
        name,
        description: description || null,
      });
      setShowForm(false);
      setName('');
      setDescription('');
      fetchGroups();
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number, groupName: string) => {
    if (!confirm(`Delete agent group '${groupName}'?`)) return;
    await api.delete(`/agent-groups/${id}`);
    fetchGroups();
  };

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
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
          <FolderTree className="w-7 h-7 text-teal-500" />
          Agent Groups
        </h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-teal-500 text-white px-4 py-2 rounded-lg hover:bg-teal-600 transition-colors text-sm font-medium"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancel' : 'New group'}
        </button>
      </div>
      <p className="text-slate-500 mb-6">
        Group agents so certificates are automatically deployed to all members
      </p>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">New agent group</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="bijv. HAProxy Cluster"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optionele beschrijving van de groep"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={creating}
                className="px-6 py-2.5 bg-teal-500 text-white rounded-lg hover:bg-teal-600 text-sm font-medium disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center">
              <FolderTree className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{groups.length}</p>
              <p className="text-sm text-slate-500">Total groups</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Monitor className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">
                {groups.reduce((sum, g) => sum + g.member_count, 0)}
              </p>
              <p className="text-sm text-slate-500">Total members</p>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden overflow-x-auto">
        {groups.length === 0 ? (
          <div className="px-6 py-12 text-center text-slate-400">
            <FolderTree className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <p>No agent groups yet</p>
            <p className="text-sm mt-1">Create a group to bundle agents</p>
          </div>
        ) : (
          <table className="w-full min-w-[500px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">Name</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">Description</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">Members</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-3">Created</th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {groups.map((g) => (
                <tr key={g.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <Link
                      to={`/agent-groups/${g.id}`}
                      className="text-sm font-medium text-teal-600 hover:text-teal-700 flex items-center gap-1"
                    >
                      {g.name}
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {g.description || <span className="text-slate-300">-</span>}
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                      <Monitor className="w-3 h-3" />
                      {g.member_count}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {format(new Date(g.created_at), 'd MMM yyyy')}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleDelete(g.id, g.name)}
                      className="text-red-500 hover:text-red-700 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

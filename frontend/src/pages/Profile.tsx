import { useEffect, useState, useRef } from 'react';
import { Camera, Save, User as UserIcon } from 'lucide-react';
import api from '../services/api';
import type { User } from '../types';

export default function Profile() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get('/auth/me').then(({ data }) => {
      setUser(data);
      setEmail(data.email);
      setDisplayName(data.display_name || '');
      setProfileImage(data.profile_image);
    });
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2_000_000) {
      setError('Profile picture is too large (max 2MB)');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Only images are allowed');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setProfileImage(reader.result as string);
      setError('');
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (password && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, string | null> = {};
      if (displayName !== (user?.display_name || '')) body.display_name = displayName || null;
      if (email !== user?.email) body.email = email;
      if (password) body.password = password;
      if (profileImage !== user?.profile_image) body.profile_image = profileImage;

      if (Object.keys(body).length === 0) {
        setSuccess('No changes to save');
        setSaving(false);
        return;
      }

      const { data } = await api.put('/auth/me', body);
      setUser(data);
      setProfileImage(data.profile_image);
      setPassword('');
      setConfirmPassword('');
      setSuccess('Profile updated successfully');
      window.dispatchEvent(new CustomEvent('profile-updated', { detail: data }));
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setError(axiosErr.response?.data?.detail || 'An error occurred');
      } else {
        setError('An error occurred');
      }
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Profile settings</h1>
        <p className="text-slate-500 mt-1">Manage your account and profile picture</p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}
      {success && (
        <div className="bg-emerald-50 text-emerald-700 px-4 py-3 rounded-lg text-sm">{success}</div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Profile picture */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Profile picture</h2>
          <div className="flex items-center gap-6">
            <div className="relative">
              {profileImage ? (
                <img
                  src={profileImage}
                  alt={user.username}
                  className="w-24 h-24 rounded-full object-cover border-4 border-slate-100"
                />
              ) : (
                <div className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center border-4 border-slate-100">
                  <span className="text-3xl font-bold text-white">
                    {user.username.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 w-8 h-8 bg-slate-900 rounded-full flex items-center justify-center hover:bg-slate-700 transition-colors"
              >
                <Camera className="w-4 h-4 text-white" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">{user.username}</p>
              <p className="text-xs text-slate-400 mt-1">
                JPG, PNG or GIF. Max 2MB.
              </p>
              {profileImage && (
                <button
                  type="button"
                  onClick={() => setProfileImage(null)}
                  className="text-xs text-red-500 hover:text-red-700 mt-1"
                >
                  Remove photo
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Account info */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Account details</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Username
              </label>
              <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                <UserIcon className="w-4 h-4 text-slate-400" />
                <span className="text-sm text-slate-600">{user.username}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Username cannot be changed
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Display name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How do you want to be displayed?"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              />
              <p className="text-xs text-slate-400 mt-1">
                Shown instead of your username
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Password change */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Change password</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                New password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                placeholder="Leave empty to keep unchanged"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Confirm password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                placeholder="Repeat new password"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

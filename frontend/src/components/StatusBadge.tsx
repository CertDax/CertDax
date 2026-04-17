const statusConfig: Record<string, { color: string; label: string }> = {
  valid: { color: 'bg-emerald-100 text-emerald-800', label: 'Active' },
  active: { color: 'bg-emerald-100 text-emerald-800', label: 'Active' },
  pending: { color: 'bg-blue-100 text-blue-800', label: 'Pending' },
  processing: { color: 'bg-blue-100 text-blue-800', label: 'Processing' },
  renewing: { color: 'bg-blue-100 text-blue-800', label: 'Renewing' },
  expired: { color: 'bg-red-100 text-red-800', label: 'Expired' },
  error: { color: 'bg-red-100 text-red-800', label: 'Error' },
  revoked: { color: 'bg-gray-100 text-gray-800', label: 'Revoked' },
  revoking: { color: 'bg-orange-100 text-orange-800', label: 'Revoking' },
  deployed: { color: 'bg-emerald-100 text-emerald-800', label: 'Deployed' },
  pending_removal: { color: 'bg-orange-100 text-orange-800', label: 'Removing' },
  failed: { color: 'bg-red-100 text-red-800', label: 'Failed' },
  deleting: { color: 'bg-slate-100 text-slate-600', label: 'Deleting' },
  online: { color: 'bg-emerald-100 text-emerald-800', label: 'Online' },
  offline: { color: 'bg-gray-100 text-gray-800', label: 'Offline' },
};

export default function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || {
    color: 'bg-gray-100 text-gray-800',
    label: status,
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}
    >
      {config.label}
    </span>
  );
}

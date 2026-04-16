import { format, differenceInDays } from 'date-fns';
import { ShieldCheck, AlertTriangle, XCircle, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Certificate } from '../types';
import StatusBadge from './StatusBadge';

export default function CertificateCard({ cert }: { cert: Certificate }) {
  const daysLeft = cert.expires_at
    ? differenceInDays(new Date(cert.expires_at), new Date())
    : null;

  const getExpiryColor = () => {
    if (daysLeft === null) return 'text-slate-400';
    if (daysLeft <= 0) return 'text-red-600';
    if (daysLeft <= 30) return 'text-amber-600';
    return 'text-emerald-600';
  };

  const getIcon = () => {
    if (cert.status === 'error' || cert.status === 'expired') {
      return <XCircle className="w-10 h-10 text-red-400" />;
    }
    if (daysLeft !== null && daysLeft <= 30) {
      return <AlertTriangle className="w-10 h-10 text-amber-400" />;
    }
    return <ShieldCheck className="w-10 h-10 text-emerald-400" />;
  };

  return (
    <Link
      to={`/certificates/${cert.id}`}
      className="block bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          {getIcon()}
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-900">{cert.common_name}</h3>
              <span className="text-xs text-slate-400 font-mono">#{cert.id}</span>
            </div>
            {cert.san_domains && (
              <p className="text-xs text-slate-400 mt-0.5">
                +{JSON.parse(cert.san_domains).length - 1} SAN domains
              </p>
            )}
            <p className="text-sm text-slate-500 mt-1">
              {cert.ca_name || 'Unknown CA'}
            </p>
            {cert.created_by_username && (
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                <User className="w-3 h-3" />
                Requested by {cert.created_by_username}
              </p>
            )}
            {cert.modified_by_username && (
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                <User className="w-3 h-3" />
                Modified by {cert.modified_by_username}
              </p>
            )}
            {!cert.modified_by_username && cert.updated_at && cert.created_at && cert.updated_at !== cert.created_at && (
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                <User className="w-3 h-3" />
                Modified by System (auto-renewal)
              </p>
            )}
          </div>
        </div>
        <StatusBadge status={cert.status} />
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <div className="space-y-0.5">
          {cert.issued_at && (
            <span className="text-slate-400 block">
              Issued:{' '}
              {format(new Date(cert.issued_at), 'd MMM yyyy')}
            </span>
          )}
          {cert.updated_at && cert.updated_at !== cert.created_at && (
            <span className="text-slate-400 block">
              Last modified:{' '}
              {format(new Date(cert.updated_at), 'd MMM yyyy HH:mm')}
            </span>
          )}
        </div>
        <div className={`font-medium ${getExpiryColor()}`}>
          {daysLeft !== null ? (
            daysLeft <= 0 ? (
              'Expired'
            ) : (
              `${daysLeft} days remaining`
            )
          ) : (
            'No expiry date'
          )}
        </div>
      </div>
    </Link>
  );
}

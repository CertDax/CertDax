import { differenceInDays, format } from 'date-fns';
import { Building2, FileLock2, ShieldAlert, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { SelfSignedCertificate } from '../types';

export default function SelfSignedCard({ cert }: { cert: SelfSignedCertificate }) {
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
    if (cert.is_ca) {
      return <Building2 className="w-10 h-10 text-purple-400" />;
    }
    if (daysLeft !== null && daysLeft <= 0) {
      return <ShieldAlert className="w-10 h-10 text-red-400" />;
    }
    if (daysLeft !== null && daysLeft <= 30) {
      return <ShieldAlert className="w-10 h-10 text-amber-400" />;
    }
    return <FileLock2 className="w-10 h-10 text-amber-400" />;
  };

  const getStatusBadge = () => {
    if (daysLeft !== null && daysLeft <= 0) {
      return (
        <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-red-100 text-red-700">
          Expired
        </span>
      );
    }
    if (daysLeft !== null && daysLeft <= 30) {
      return (
        <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-amber-100 text-amber-700">
          Expiring
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-100 text-emerald-700">
        Active
      </span>
    );
  };

  const sanCount = cert.san_domains
    ? (() => { try { return JSON.parse(cert.san_domains).length - 1; } catch { return 0; } })()
    : 0;

  return (
    <Link
      to={`/self-signed/${cert.id}`}
      className="block bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start gap-3">
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <div className="flex-shrink-0">{getIcon()}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-slate-900 break-all">{cert.common_name}</h3>
              <span className="text-xs text-slate-400 font-mono flex-shrink-0">#{cert.id}</span>
            </div>
            {sanCount > 0 && (
              <p className="text-xs text-slate-400 mt-0.5">+{sanCount} SAN domains</p>
            )}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-sm text-slate-500">
                {cert.key_type.toUpperCase()} {cert.key_size}
                {cert.organization ? ` · ${cert.organization}` : ''}
              </p>
              {cert.is_ca && (
                <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">CA</span>
              )}
              {cert.signed_by_ca_name && (
                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                  Signed by {cert.signed_by_ca_name}
                </span>
              )}
            </div>
            {cert.created_by_username && (
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                <User className="w-3 h-3" />
                Created by {cert.created_by_username}
              </p>
            )}
            {cert.modified_by_username && (
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                <User className="w-3 h-3" />
                Modified by {cert.modified_by_username}
              </p>
            )}
          </div>
        </div>
        <div className="flex-shrink-0">{getStatusBadge()}</div>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <div className="space-y-0.5">
          {cert.issued_at && (
            <span className="text-slate-400 block">
              Issued: {format(new Date(cert.issued_at), 'd MMM yyyy')}
            </span>
          )}
          {cert.expires_at && (
            <span className="text-slate-400 block">
              Expires: {format(new Date(cert.expires_at), 'd MMM yyyy')}
            </span>
          )}
        </div>
        <div className={`font-medium ${getExpiryColor()}`}>
          {daysLeft !== null ? (
            daysLeft <= 0 ? 'Expired' : `${daysLeft} days remaining`
          ) : (
            `${cert.validity_days} days validity`
          )}
        </div>
      </div>
    </Link>
  );
}

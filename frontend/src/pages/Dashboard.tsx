import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Clock,
  Plus,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileLock2,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { format, differenceInDays } from 'date-fns';
import api from '../services/api';
import type { Certificate, CertificateStats, SelfSignedCertificate } from '../types';
import StatsCard from '../components/StatsCard';
import StatusBadge from '../components/StatusBadge';

export default function Dashboard() {
  const [stats, setStats] = useState<CertificateStats | null>(null);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [selfSignedCerts, setSelfSignedCerts] = useState<SelfSignedCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'acme' | 'self-signed'>('acme');

  useEffect(() => {
    Promise.all([
      api.get('/certificates/stats'),
      api.get('/certificates'),
      api.get('/self-signed'),
    ]).then(([statsRes, certsRes, ssRes]) => {
      setStats(statsRes.data);
      setCertificates(certsRes.data);
      setSelfSignedCerts(ssRes.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  // Determine self-signed stats
  const now = new Date();
  const ssTotal = selfSignedCerts.length;
  const ssActive = selfSignedCerts.filter((c) => c.expires_at && new Date(c.expires_at) > now).length;
  const ssExpiringSoon = selfSignedCerts.filter((c) => {
    if (!c.expires_at) return false;
    const days = differenceInDays(new Date(c.expires_at), now);
    return days > 0 && days <= 30;
  }).length;
  const ssExpired = selfSignedCerts.filter((c) => c.expires_at && new Date(c.expires_at) <= now).length;

  // Unified dashboard item type
  type DashboardCert = { id: number; common_name: string; status: string; expires_at: string | null; created_at: string; type: 'acme' | 'self-signed' };

  const allCerts: DashboardCert[] = view === 'acme'
    ? certificates.map((c) => ({ id: c.id, common_name: c.common_name, status: c.status, expires_at: c.expires_at, created_at: c.created_at, type: 'acme' as const }))
    : selfSignedCerts.map((c) => {
        const expired = c.expires_at && new Date(c.expires_at) <= now;
        return { id: c.id, common_name: c.common_name, status: expired ? 'expired' : 'valid', expires_at: c.expires_at, created_at: c.created_at, type: 'self-signed' as const };
      });

  // Extract the registered domain (e.g. squadrasec.com) from any FQDN
  const registeredDomain = (cn: string) => {
    const clean = cn.replace(/^\*\./, '');
    const parts = clean.split('.');
    // Take last 2 parts (handles .com, .nl, etc.)
    return parts.length >= 2 ? parts.slice(-2).join('.') : clean;
  };

  const expiryByDomain = new Map<string, { days: number; certs: { name: string; days: number; expires: string; type: 'acme' | 'self-signed' }[] }>();
  for (const c of allCerts.filter((c) => c.status === 'valid' && c.expires_at)) {
    const base = registeredDomain(c.common_name);
    const days = differenceInDays(new Date(c.expires_at!), new Date());
    const certInfo = {
      name: c.common_name,
      days,
      expires: format(new Date(c.expires_at!), 'd MMM yyyy'),
      type: c.type,
    };
    const existing = expiryByDomain.get(base);
    if (!existing) {
      expiryByDomain.set(base, { days, certs: [certInfo] });
    } else {
      existing.certs.push(certInfo);
      if (days < existing.days) existing.days = days;
    }
  }

  const expiryData = [...expiryByDomain.entries()]
    .map(([domain, { days, certs }]) => ({
      name: domain,
      fullName: domain,
      days,
      count: certs.length,
      certs: certs.sort((a, b) => a.days - b.days),
    }))
    .sort((a, b) => a.days - b.days)
    .slice(0, 10);

  const getBarColor = (days: number) => {
    if (days <= 0) return '#ef4444';
    if (days <= 30) return '#f59e0b';
    if (days <= 60) return '#3b82f6';
    return '#10b981';
  };

  const recentCerts = [...allCerts]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 20);

  // Group recent certificates by registered domain
  const grouped = new Map<string, DashboardCert[]>();
  for (const cert of recentCerts) {
    const key = registeredDomain(cert.common_name);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(cert);
  }

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 mt-1">Overview of all your SSL certificates</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => { setView('acme'); setExpandedDomains(new Set()); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                view === 'acme'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              ACME
            </button>
            <button
              onClick={() => { setView('self-signed'); setExpandedDomains(new Set()); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                view === 'self-signed'
                  ? 'bg-white text-amber-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <FileLock2 className="w-4 h-4" />
              Self-Signed
            </button>
          </div>
          <Link
            to={view === 'self-signed' ? '/self-signed' : '/certificates/new'}
            className={`flex items-center gap-2 text-white px-4 py-2.5 rounded-lg transition-colors font-medium text-sm ${
              view === 'self-signed'
                ? 'bg-amber-500 hover:bg-amber-600'
                : 'bg-emerald-500 hover:bg-emerald-600'
            }`}
          >
            <Plus className="w-4 h-4" />
            New certificate
          </Link>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatsCard
            title="Total certificates"
            value={view === 'acme' ? stats.total : ssTotal}
            icon={ShieldCheck}
            color="text-blue-600"
            bgColor="bg-blue-50"
          />
          <StatsCard
            title="Active"
            value={view === 'acme' ? stats.active : ssActive}
            icon={ShieldCheck}
            color="text-emerald-600"
            bgColor="bg-emerald-50"
          />
          <StatsCard
            title="Expiring soon"
            value={view === 'acme' ? stats.expiring_soon : ssExpiringSoon}
            icon={ShieldAlert}
            color="text-amber-600"
            bgColor="bg-amber-50"
          />
          <StatsCard
            title="Expired / Errors"
            value={view === 'acme' ? stats.expired + stats.error : ssExpired}
            icon={ShieldX}
            color="text-red-600"
            bgColor="bg-red-50"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Expiry Chart */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            Expiry timeline
          </h2>
          {expiryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(80, expiryData.length * 50 + 30)}>
              <BarChart data={expiryData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={150}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const data = payload[0].payload as (typeof expiryData)[0];
                    return (
                      <div className="bg-white rounded-lg border border-slate-200 shadow-lg p-3 max-w-xs">
                        <p className="font-semibold text-slate-900 text-sm mb-2">
                          {data.fullName}
                          <span className="text-slate-400 font-normal ml-1">({data.count} cert{data.count !== 1 ? 's' : ''})</span>
                        </p>
                        <div className="space-y-1.5">
                          {data.certs.map((cert, i) => (
                            <div key={i} className="flex items-center justify-between gap-4 text-xs">
                              <span className="text-slate-700 truncate max-w-[160px]" title={cert.name}>{cert.name}</span>
                              <span className={`whitespace-nowrap font-medium ${
                                cert.days <= 0 ? 'text-red-600' : cert.days <= 30 ? 'text-amber-600' : 'text-slate-500'
                              }`}>
                                {cert.expires} ({cert.days}d)
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="days" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }}
                  onClick={(_data: unknown, index: number) => {
                    const domain = expiryData[index]?.fullName;
                    if (domain) {
                      setExpandedDomains((prev) => {
                        const next = new Set(prev);
                        next.add(domain);
                        return next;
                      });
                      // Scroll to the recent certs panel
                      document.getElementById('recent-certs')?.scrollIntoView({ behavior: 'smooth' });
                    }
                  }}
                >
                  {expiryData.map((entry, index) => (
                    <Cell key={index} fill={getBarColor(entry.days)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <Clock className="w-12 h-12 mb-3" />
              <p>No active certificates yet</p>
            </div>
          )}
        </div>

        {/* Recent Certificates */}
        <div id="recent-certs" className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            Recent certificates
          </h2>
          {recentCerts.length > 0 ? (
            <div className="space-y-1">
              {[...grouped.entries()].map(([domain, certs]) =>
                certs.length === 1 ? (
                  <Link
                    key={`${certs[0].type}:${certs[0].id}`}
                    to={certs[0].type === 'self-signed' ? `/self-signed/${certs[0].id}` : `/certificates/${certs[0].id}`}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {certs[0].status === 'error' || certs[0].status === 'expired' ? (
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                      ) : view === 'self-signed' ? (
                        <FileLock2 className="w-5 h-5 text-amber-400" />
                      ) : (
                        <ShieldCheck className="w-5 h-5 text-emerald-400" />
                      )}
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {certs[0].common_name}
                        </p>
                        <p className="text-xs text-slate-400">
                          {format(new Date(certs[0].created_at), 'd MMM yyyy')}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={certs[0].status} />
                  </Link>
                ) : (
                  <div key={domain}>
                    <button
                      onClick={() => toggleDomain(domain)}
                      className="flex items-center justify-between w-full p-3 rounded-lg hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        {expandedDomains.has(domain) ? (
                          <ChevronDown className="w-5 h-5 text-slate-400" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-slate-400" />
                        )}
                        <div>
                          <p className="text-sm font-medium text-slate-900">{domain}</p>
                          <p className="text-xs text-slate-400">
                            {certs.length} certificates
                          </p>
                        </div>
                      </div>
                    </button>
                    {expandedDomains.has(domain) && (
                      <div className="ml-8 border-l border-slate-200 pl-3 space-y-1">
                        {certs.map((cert) => (
                          <Link
                            key={`${cert.type}:${cert.id}`}
                            to={cert.type === 'self-signed' ? `/self-signed/${cert.id}` : `/certificates/${cert.id}`}
                            className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-50 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              {cert.status === 'error' || cert.status === 'expired' ? (
                                <AlertTriangle className="w-4 h-4 text-red-400" />
                              ) : view === 'self-signed' ? (
                                <FileLock2 className="w-4 h-4 text-amber-400" />
                              ) : (
                                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                              )}
                              <div>
                                <p className="text-sm font-medium text-slate-900">
                                  {cert.common_name}
                                </p>
                                <p className="text-xs text-slate-400">
                                  {format(new Date(cert.created_at), 'd MMM yyyy')}
                                </p>
                              </div>
                            </div>
                            <StatusBadge status={cert.status} />
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <ShieldCheck className="w-12 h-12 mb-3" />
              <p>No certificates yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

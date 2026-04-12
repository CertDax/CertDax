import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import {
  Upload,
  Server,
  ChevronDown,
  ChevronRight,
  FileText,
  ExternalLink,
  ShieldCheck,
  FileLock2,
} from 'lucide-react';
import api from '../services/api';
import type {
  DeploymentTarget,
  CertificateDeployment,
} from '../types';
import StatusBadge from '../components/StatusBadge';

interface AgentGroup {
  target: DeploymentTarget;
  deployments: CertificateDeployment[];
}

export default function Deployments() {
  const [targets, setTargets] = useState<DeploymentTarget[]>([]);
  const [deployments, setDeployments] = useState<CertificateDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState<number | null>(null);
  const [expandedDeployment, setExpandedDeployment] = useState<number | null>(null);

  const fetchData = async () => {
    const [targetsRes, deploymentsRes] = await Promise.all([
      api.get('/agents'),
      api.get('/deployments'),
    ]);
    setTargets(targetsRes.data);
    setDeployments(deploymentsRes.data);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, []);

  // Group deployments by target
  const agentGroups: AgentGroup[] = targets.map((t) => ({
    target: t,
    deployments: deployments.filter((d) => d.target_id === t.id),
  }));

  const renderDeploymentTable = (deps: CertificateDeployment[]) => (
    <div className="overflow-x-auto">
    <table className="w-full table-fixed min-w-[600px]">
      <colgroup>
        <col className="w-[45%]" />
        <col className="w-[15%]" />
        <col className="w-[15%]" />
        <col className="w-[25%]" />
      </colgroup>
      <tbody className="divide-y divide-slate-100">
        {deps.map((d) => (
          <React.Fragment key={d.id}>
            <tr
              className="hover:bg-slate-50 cursor-pointer"
              onClick={() =>
                setExpandedDeployment(
                  expandedDeployment === d.id ? null : d.id
                )
              }
            >
              <td className="px-6 py-3 text-sm font-medium text-slate-900">
                <div className="flex items-center gap-2">
                  {d.file_paths?.length > 0 ? (
                    expandedDeployment === d.id ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    )
                  ) : (
                    <span className="w-3.5" />
                  )}
                  {d.certificate_name || '-'}
                </div>
              </td>
              <td className="px-6 py-3">
                <StatusBadge status={d.status} />
              </td>
              <td className="px-6 py-3 text-sm text-slate-500 uppercase">
                {d.deploy_format || 'crt'}
              </td>
              <td className="px-6 py-3 text-sm text-slate-500">
                {d.deployed_at
                  ? format(new Date(d.deployed_at), 'd MMM yyyy HH:mm')
                  : '-'}
              </td>
            </tr>
            {expandedDeployment === d.id && d.file_paths?.length > 0 && (
              <tr className="bg-slate-50">
                <td colSpan={4} className="px-6 py-3">
                  <div className="ml-5 space-y-1">
                    <p className="text-xs font-medium text-slate-500 uppercase mb-2">
                      Files on target
                    </p>
                    {d.file_paths.map((fp, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-sm text-slate-600"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <code className="text-xs bg-white border border-slate-200 px-2 py-0.5 rounded font-mono">
                          {fp}
                        </code>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            )}
          </React.Fragment>
        ))}
      </tbody>
    </table>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Deployments</h1>
      <p className="text-slate-500 mb-8">
        Overview of all deployed certificates per agent
      </p>

      {agentGroups.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <Server className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p className="text-slate-500">No agents configured yet</p>
          <Link
            to="/agents"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium mt-2 inline-block"
          >
            Go to Agents
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {agentGroups.map(({ target, deployments: agentDeps }) => (
            <div
              key={target.id}
              className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
            >
              {/* Agent header - clickable */}
              <button
                onClick={() =>
                  setExpandedAgent(expandedAgent === target.id ? null : target.id)
                }
                className="w-full flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors text-left"
              >
                <div className="flex-shrink-0">
                  {expandedAgent === target.id ? (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                  )}
                </div>
                <Server className="w-5 h-5 text-slate-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-slate-900">{target.name}</span>
                    <StatusBadge status={target.status} />
                    <span className="text-sm text-slate-400">{target.hostname}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {target.deploy_path}
                    {target.last_seen && (
                      <> · Last seen: {format(new Date(target.last_seen), 'd MMM yyyy HH:mm')}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <span className="text-sm text-slate-500">
                    {agentDeps.length} {agentDeps.length === 1 ? 'certificate' : 'certificates'}
                  </span>
                  <Link
                    to={`/agents/${target.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                    title="Manage agent"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Link>
                </div>
              </button>

              {/* Expanded: deployment list */}
              {expandedAgent === target.id && (
                <div className="border-t border-slate-200">
                  {agentDeps.length === 0 ? (
                    <div className="px-6 py-8 text-center">
                      <Upload className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      <p className="text-sm text-slate-400">
                        No certificates deployed on this agent
                      </p>
                      <Link
                        to={`/agents/${target.id}`}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium mt-1 inline-block"
                      >
                        Assign certificate
                      </Link>
                    </div>
                  ) : (
                    <>
                      {/* Column headers */}
                      <div className="overflow-x-auto">
                      <table className="w-full table-fixed min-w-[600px]">
                        <colgroup>
                          <col className="w-[45%]" />
                          <col className="w-[15%]" />
                          <col className="w-[15%]" />
                          <col className="w-[25%]" />
                        </colgroup>
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-2.5">
                              Certificate
                            </th>
                            <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-2.5">
                              Status
                            </th>
                            <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-2.5">
                              Format
                            </th>
                            <th className="text-left text-xs font-medium text-slate-500 uppercase px-6 py-2.5">
                              Deployed on
                            </th>
                          </tr>
                        </thead>
                      </table>
                      </div>

                      {/* ACME Certificates */}
                      {agentDeps.filter((d) => d.certificate_type !== 'self-signed').length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 px-6 py-2 bg-emerald-50 border-b border-emerald-200">
                            <ShieldCheck className="w-4 h-4 text-emerald-600" />
                            <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                              ACME Certificates
                            </span>
                          </div>
                          {renderDeploymentTable(
                            agentDeps.filter((d) => d.certificate_type !== 'self-signed')
                          )}
                        </div>
                      )}

                      {/* Self-Signed Certificates */}
                      {agentDeps.filter((d) => d.certificate_type === 'self-signed').length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 px-6 py-2 bg-amber-50 border-b border-amber-200 border-t border-t-slate-200">
                            <FileLock2 className="w-4 h-4 text-amber-600" />
                            <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                              Self-Signed Certificates
                            </span>
                          </div>
                          {renderDeploymentTable(
                            agentDeps.filter((d) => d.certificate_type === 'self-signed')
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

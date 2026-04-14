export interface Certificate {
  id: number;
  common_name: string;
  san_domains: string | null;
  ca_id: number;
  ca_name: string | null;
  dns_provider_id: number | null;
  challenge_type: string;
  status: string;
  issued_at: string | null;
  expires_at: string | null;
  auto_renew: boolean;
  renewal_threshold_days: number | null;
  custom_oids: string | null;
  error_message: string | null;
  created_by_username: string | null;
  modified_by_username: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CertificateDetail extends Certificate {
  certificate_pem: string | null;
  chain_pem: string | null;
}

export interface OidEntry {
  oid: string;
  value: string;
}

export interface CertificateStats {
  total: number;
  active: number;
  expiring_soon: number;
  expired: number;
  pending: number;
  error: number;
}

export interface CertificateAuthority {
  id: number;
  name: string;
  directory_url: string;
  is_staging: boolean;
  contact_email: string | null;
  has_account: boolean;
  has_eab: boolean;
  is_active: boolean;
  created_at: string;
}

export interface DnsProvider {
  id: number;
  name: string;
  provider_type: string;
  is_active: boolean;
  created_at: string;
}

export interface DeploymentTarget {
  id: number;
  name: string;
  hostname: string;
  deploy_path: string;
  reload_command: string | null;
  pre_deploy_script: string | null;
  post_deploy_script: string | null;
  status: string;
  last_seen: string | null;
  agent_os: string | null;
  agent_arch: string | null;
  agent_version: string | null;
  agent_ip: string | null;
  created_at: string;
}

export interface DeploymentTargetCreate extends DeploymentTarget {
  agent_token: string;
}

export interface AgentCertificate {
  id: number;
  certificate_id: number | null;
  self_signed_certificate_id: number | null;
  certificate_name: string | null;
  certificate_status: string | null;
  certificate_type: string;
  expires_at: string | null;
  auto_deploy: boolean;
  deploy_format: string;
  created_at: string;
}

export interface AgentDetail extends DeploymentTarget {
  assigned_certificates: AgentCertificate[];
  agent_groups: { id: number; name: string }[];
  deployment_count: number;
  deployed_count: number;
  failed_count: number;
}

export interface CertificateDeployment {
  id: number;
  certificate_id: number | null;
  self_signed_certificate_id: number | null;
  target_id: number;
  target_name: string | null;
  certificate_name: string | null;
  certificate_type: string;
  status: string;
  deploy_format: string;
  deployed_at: string | null;
  error_message: string | null;
  created_at: string;
  file_paths: string[];
}

export interface User {
  id: number;
  username: string;
  display_name: string | null;
  email: string;
  is_admin: boolean;
  group_id: number | null;
  group_name: string | null;
  profile_image: string | null;
}

export interface Group {
  id: number;
  name: string;
  created_at: string | null;
}

export interface GroupShare {
  id: number;
  owner_group_id: number;
  owner_group_name: string;
  target_group_id: number;
  target_group_name: string;
  resource_type: string;
  created_at: string;
}

export interface DryRunStep {
  step: number;
  title: string;
  description: string;
  status: 'ok' | 'warning' | 'error';
}

export interface DryRunResponse {
  success: boolean;
  steps: DryRunStep[];
}

export interface SelfSignedCertificate {
  id: number;
  common_name: string;
  san_domains: string | null;
  organization: string | null;
  organizational_unit: string | null;
  country: string | null;
  state: string | null;
  locality: string | null;
  key_type: string;
  key_size: number;
  validity_days: number;
  is_ca: boolean;
  signed_by_ca_id: number | null;
  signed_by_ca_name: string | null;
  auto_renew: boolean;
  renewal_threshold_days: number | null;
  custom_oids: string | null;
  issued_at: string | null;
  expires_at: string | null;
  created_by_username: string | null;
  modified_by_username: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface SelfSignedDetail extends SelfSignedCertificate {
  certificate_pem: string | null;
}

export interface AgentGroupMemberInfo {
  id: number;
  target_id: number;
  target_name: string | null;
  target_hostname: string | null;
  target_status: string;
  created_at: string;
}

export interface AgentGroupInfo {
  id: number;
  name: string;
  description: string | null;
  member_count: number;
  created_at: string;
}

export interface AgentGroupDetail extends AgentGroupInfo {
  members: AgentGroupMemberInfo[];
  assigned_certificate_ids: number[];
  assigned_self_signed_ids: number[];
}

export interface K8sOperator {
  id: number;
  name: string;
  namespace: string | null;
  deployment_name: string | null;
  cluster_name: string | null;
  operator_version: string | null;
  kubernetes_version: string | null;
  pod_name: string | null;
  node_name: string | null;
  cpu_usage: string | null;
  memory_usage: string | null;
  memory_limit: string | null;
  managed_certificates: number;
  ready_certificates: number;
  failed_certificates: number;
  status: string;
  last_seen: string | null;
  last_error: string | null;
  recent_logs: string[];
  created_at: string;
}

export interface K8sOperatorCreate extends K8sOperator {
  operator_token: string;
}

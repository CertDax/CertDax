import { useEffect, useState } from 'react';
import {
  Mail,
  Save,
  RotateCcw,
  Loader2,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Eye,
  Code,
  Info,
} from 'lucide-react';
import api from '../services/api';

interface EmailTemplate {
  key: string;
  subject: string;
  body_html: string;
  is_custom: boolean;
  variables: string[];
}

const TEMPLATE_LABELS: Record<string, string> = {
  password_reset: 'Password Reset',
  certificate_requested: 'Certificate Requested',
  certificate_issued: 'Certificate Issued',
  certificate_renewed: 'Certificate Renewed',
  certificate_revoked: 'Certificate Revoked',
  certificate_error: 'Certificate Error',
  certificate_expired: 'Certificate Expired',
  certificate_deleted: 'Certificate Deleted',
  selfsigned_created: 'Self-Signed Created',
  selfsigned_renewed: 'Self-Signed Renewed',
  selfsigned_deleted: 'Self-Signed Deleted',
};

const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  password_reset: 'Sent when a user requests a password reset',
  certificate_requested: 'Sent when a new certificate is requested',
  certificate_issued: 'Sent when a certificate is successfully issued',
  certificate_renewed: 'Sent when a certificate is renewed',
  certificate_revoked: 'Sent when a certificate is revoked',
  certificate_error: 'Sent when a certificate request fails',
  certificate_expired: 'Sent when a certificate expires',
  certificate_deleted: 'Sent when a certificate is deleted',
  selfsigned_created: 'Sent when a self-signed certificate is created',
  selfsigned_renewed: 'Sent when a self-signed certificate is renewed',
  selfsigned_deleted: 'Sent when a self-signed certificate is deleted',
};

// Base wrapper template shown for reference
const BASE_WRAPPER = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #0f172a; color: white; padding: 20px 24px; border-radius: 12px 12px 0 0;">
    <h2 style="margin: 0; font-size: 18px;">🔒 CertDax</h2>
  </div>
  <div style="background: #ffffff; border: 1px solid #e2e8f0; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
    <h3 style="margin-top: 0; color: #1e293b;">[Title from subject]</h3>
    <!-- Your template content goes here -->
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
    <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">
      This notification was automatically sent by CertDax.
    </p>
  </div>
</div>`;

export default function EmailTemplates() {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [timezone, setTimezone] = useState('UTC');

  useEffect(() => {
    loadTemplates();
    api.get('/settings/app').then(({ data }) => {
      if (data.timezone) setTimezone(data.timezone);
    }).catch(() => {});
  }, []);

  const loadTemplates = async () => {
    try {
      const { data } = await api.get('/settings/email-templates');
      setTemplates(data);
    } catch {
      setError('Failed to load email templates');
    } finally {
      setLoading(false);
    }
  };

  const handleExpand = (key: string) => {
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    const tpl = templates.find((t) => t.key === key);
    if (tpl) {
      setEditSubject(tpl.subject);
      setEditBody(tpl.body_html);
    }
    setExpandedKey(key);
    setPreviewKey(null);
  };

  const handleSave = async (key: string) => {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api.put(`/settings/email-templates/${key}`, {
        subject: editSubject,
        body_html: editBody,
      });
      await loadTemplates();
      setSuccess(`Template "${TEMPLATE_LABELS[key] || key}" saved`);
    } catch {
      setError('Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (key: string) => {
    setError('');
    setSuccess('');
    setResetting(key);
    try {
      await api.delete(`/settings/email-templates/${key}`);
      const { data } = await api.get(`/settings/email-templates/${key}`);
      // Update local state with the default values
      setTemplates((prev) =>
        prev.map((t) => (t.key === key ? data : t))
      );
      if (expandedKey === key) {
        setEditSubject(data.subject);
        setEditBody(data.body_html);
      }
      setSuccess(`Template "${TEMPLATE_LABELS[key] || key}" reset to default`);
    } catch {
      setError('Failed to reset template');
    } finally {
      setResetting(null);
    }
  };

  // Map timezone to a matching locale and 12h/24h preference
  const formatInfoForTimezone = (tz: string): { locale: string; hour12: boolean } => {
    const map: Record<string, { locale: string; hour12: boolean }> = {
      'Europe/London': { locale: 'en-GB', hour12: true },
      'Europe/Dublin': { locale: 'en-IE', hour12: true },
      'Europe/Amsterdam': { locale: 'nl-NL', hour12: false },
      'Europe/Berlin': { locale: 'de-DE', hour12: false },
      'Europe/Vienna': { locale: 'de-AT', hour12: false },
      'Europe/Zurich': { locale: 'de-CH', hour12: false },
      'Europe/Paris': { locale: 'fr-FR', hour12: false },
      'Europe/Brussels': { locale: 'fr-BE', hour12: false },
      'Europe/Madrid': { locale: 'es-ES', hour12: false },
      'Europe/Rome': { locale: 'it-IT', hour12: false },
      'Europe/Lisbon': { locale: 'pt-PT', hour12: false },
      'Europe/Stockholm': { locale: 'sv-SE', hour12: false },
      'Europe/Oslo': { locale: 'nb-NO', hour12: false },
      'Europe/Copenhagen': { locale: 'da-DK', hour12: false },
      'Europe/Helsinki': { locale: 'fi-FI', hour12: false },
      'Europe/Warsaw': { locale: 'pl-PL', hour12: false },
      'Europe/Prague': { locale: 'cs-CZ', hour12: false },
      'Europe/Budapest': { locale: 'hu-HU', hour12: false },
      'Europe/Bucharest': { locale: 'ro-RO', hour12: false },
      'Europe/Athens': { locale: 'el-GR', hour12: false },
      'Europe/Istanbul': { locale: 'tr-TR', hour12: false },
      'Europe/Moscow': { locale: 'ru-RU', hour12: false },
      'Europe/Kiev': { locale: 'uk-UA', hour12: false },
      'Europe/Kyiv': { locale: 'uk-UA', hour12: false },
      'Asia/Tokyo': { locale: 'ja-JP', hour12: false },
      'Asia/Seoul': { locale: 'ko-KR', hour12: true },
      'Asia/Shanghai': { locale: 'zh-CN', hour12: false },
      'Asia/Hong_Kong': { locale: 'zh-HK', hour12: true },
      'Asia/Taipei': { locale: 'zh-TW', hour12: true },
      'Asia/Singapore': { locale: 'en-SG', hour12: true },
      'Asia/Kolkata': { locale: 'en-IN', hour12: true },
      'Asia/Calcutta': { locale: 'en-IN', hour12: true },
      'Asia/Dubai': { locale: 'ar-AE', hour12: true },
      'Asia/Riyadh': { locale: 'ar-SA', hour12: true },
      'Asia/Bangkok': { locale: 'th-TH', hour12: false },
      'Asia/Jakarta': { locale: 'id-ID', hour12: false },
      'Asia/Kuala_Lumpur': { locale: 'ms-MY', hour12: true },
      'Australia/Sydney': { locale: 'en-AU', hour12: true },
      'Australia/Melbourne': { locale: 'en-AU', hour12: true },
      'Australia/Perth': { locale: 'en-AU', hour12: true },
      'Australia/Brisbane': { locale: 'en-AU', hour12: true },
      'Pacific/Auckland': { locale: 'en-NZ', hour12: true },
      'America/Sao_Paulo': { locale: 'pt-BR', hour12: false },
      'America/Argentina/Buenos_Aires': { locale: 'es-AR', hour12: false },
      'America/Mexico_City': { locale: 'es-MX', hour12: true },
      'America/Bogota': { locale: 'es-CO', hour12: true },
      'America/Santiago': { locale: 'es-CL', hour12: false },
      'Africa/Johannesburg': { locale: 'en-ZA', hour12: false },
      'Africa/Cairo': { locale: 'ar-EG', hour12: true },
      'Africa/Lagos': { locale: 'en-NG', hour12: true },
      'Africa/Nairobi': { locale: 'en-KE', hour12: false },
    };
    if (map[tz]) return map[tz];
    // Region-based fallback
    if (tz.startsWith('America/')) return { locale: 'en-US', hour12: true };
    if (tz.startsWith('Europe/')) return { locale: 'en-GB', hour12: false };
    if (tz.startsWith('Asia/')) return { locale: 'en-GB', hour12: false };
    if (tz.startsWith('Australia/') || tz.startsWith('Pacific/')) return { locale: 'en-AU', hour12: true };
    if (tz.startsWith('Africa/')) return { locale: 'en-GB', hour12: false };
    return { locale: 'en-GB', hour12: false };
  };

  const renderPreview = (body: string) => {
    // Format sample dates using the configured timezone and matching locale
    const now = new Date();
    const { locale, hour12 } = formatInfoForTimezone(timezone);
    const dtFmt = new Intl.DateTimeFormat(locale, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      timeZone: timezone,
      hour12,
    });
    const dateFmt = new Intl.DateTimeFormat(locale, {
      year: 'numeric', month: 'short', day: '2-digit',
      timeZone: timezone,
    });
    const formattedDt = dtFmt.format(now);
    const formattedExpiry = dateFmt.format(new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000));

    // Replace {{variable}} with example values for preview
    const replaced = body.replace(
      /\{\{(\s*\w+\s*)\}\}/g,
      (_match, varName: string) => {
        const name = varName.trim();
        const examples: Record<string, string> = {
          username: 'John Doe',
          reset_url: '#',
          common_name: 'example.com',
          requested_by: 'John Doe',
          requested_at: formattedDt,
          expires_at: formattedExpiry,
          issued_by: 'John Doe',
          issued_at: formattedDt,
          renewed_by: 'John Doe',
          renewed_at: formattedDt,
          created_by: 'John Doe',
          created_at: formattedDt,
          deleted_by: 'John Doe',
          deleted_at: formattedDt,
          error_message: 'DNS validation failed',
        };
        return `<span style="background: #fef3c7; padding: 1px 4px; border-radius: 2px;">${examples[name] || name}</span>`;
      }
    );
    return replaced;
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
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
          <Mail className="w-7 h-7 text-slate-500" />
          Email Templates
        </h1>
        <p className="text-slate-500 mt-1">
          Customize email notification templates. Changes override the default templates.
        </p>
      </div>

      {success && (
        <div className="mb-6 flex items-center gap-2 bg-emerald-50 text-emerald-700 px-4 py-3 rounded-lg text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}
      {error && (
        <div className="mb-6 flex items-center gap-2 bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Info box about base wrapper */}
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-900">Template structure</p>
            <p className="text-sm text-blue-700 mt-1">
              Each template body is wrapped in a base layout with the CertDax header and footer.
              You only edit the inner content. Use <code className="bg-blue-100 px-1 py-0.5 rounded text-xs">{'{{variable_name}}'}</code> to
              insert dynamic values.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {templates.map((tpl) => (
          <div
            key={tpl.key}
            className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
          >
            {/* Header */}
            <button
              onClick={() => handleExpand(tpl.key)}
              className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                {expandedKey === tpl.key ? (
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-slate-400" />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {TEMPLATE_LABELS[tpl.key] || tpl.key}
                    </span>
                    {tpl.is_custom && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                        Customized
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {TEMPLATE_DESCRIPTIONS[tpl.key] || ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {tpl.variables.length > 0 && (
                  <div className="hidden md:flex items-center gap-1 flex-wrap">
                    {tpl.variables.slice(0, 3).map((v) => (
                      <span
                        key={v}
                        className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono"
                      >
                        {v}
                      </span>
                    ))}
                    {tpl.variables.length > 3 && (
                      <span className="text-xs text-slate-400">
                        +{tpl.variables.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>

            {/* Expanded editor */}
            {expandedKey === tpl.key && (
              <div className="border-t border-slate-200 px-6 py-5 space-y-4">
                {/* Variables reference */}
                {tpl.variables.length > 0 && (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs font-semibold text-slate-600 mb-2">
                      Available variables:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {tpl.variables.map((v) => (
                        <code
                          key={v}
                          className="text-xs bg-white border border-slate-200 text-slate-700 px-2 py-1 rounded font-mono cursor-pointer hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 transition-colors"
                          title={`Click to copy {{${v}}}`}
                          onClick={() => navigator.clipboard.writeText(`{{${v}}}`)}
                        >
                          {`{{${v}}}`}
                        </code>
                      ))}
                    </div>
                  </div>
                )}

                {/* Subject */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm font-mono"
                  />
                </div>

                {/* Body editor / preview toggle */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-slate-700">
                      Body (HTML)
                    </label>
                    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                      <button
                        type="button"
                        onClick={() => setPreviewKey(null)}
                        className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                          previewKey !== tpl.key
                            ? 'bg-white text-slate-700 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        <Code className="w-3 h-3" />
                        Code
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewKey(tpl.key)}
                        className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                          previewKey === tpl.key
                            ? 'bg-white text-slate-700 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        <Eye className="w-3 h-3" />
                        Preview
                      </button>
                    </div>
                  </div>

                  {previewKey === tpl.key ? (
                    <div className="border border-slate-300 rounded-lg p-4 bg-white min-h-[200px]">
                      <div
                        dangerouslySetInnerHTML={{
                          __html: renderPreview(editBody),
                        }}
                      />
                    </div>
                  ) : (
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={12}
                      className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm font-mono leading-relaxed"
                      spellCheck={false}
                    />
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => handleReset(tpl.key)}
                    disabled={!tpl.is_custom || resetting === tpl.key}
                    className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {resetting === tpl.key ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RotateCcw className="w-4 h-4" />
                    )}
                    Reset to default
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSave(tpl.key)}
                    disabled={saving}
                    className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    {saving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    Save template
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Base wrapper reference (collapsible) */}
      <details className="mt-8 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <summary className="px-6 py-4 cursor-pointer hover:bg-slate-50 transition-colors text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Code className="w-4 h-4" />
          Base wrapper template (read-only reference)
        </summary>
        <div className="border-t border-slate-200 px-6 py-4">
          <pre className="text-xs font-mono text-slate-600 bg-slate-50 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
            {BASE_WRAPPER}
          </pre>
        </div>
      </details>
    </div>
  );
}

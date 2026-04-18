{{/*
Expand the name of the chart.
*/}}
{{- define "certdax.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "certdax.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "certdax.labels" -}}
helm.sh/chart: {{ include "certdax.name" . }}-{{ .Chart.Version | replace "+" "_" }}
{{ include "certdax.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels (base — use component-specific variants below)
*/}}
{{- define "certdax.selectorLabels" -}}
app.kubernetes.io/name: {{ include "certdax.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Backend selector labels
*/}}
{{- define "certdax.backendSelectorLabels" -}}
{{ include "certdax.selectorLabels" . }}
app.kubernetes.io/component: backend
{{- end }}

{{/*
Frontend selector labels
*/}}
{{- define "certdax.frontendSelectorLabels" -}}
{{ include "certdax.selectorLabels" . }}
app.kubernetes.io/component: frontend
{{- end }}

{{/*
PostgreSQL selector labels
*/}}
{{- define "certdax.postgresqlSelectorLabels" -}}
{{ include "certdax.selectorLabels" . }}
app.kubernetes.io/component: postgresql
{{- end }}

{{/*
Service account name
*/}}
{{- define "certdax.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "certdax.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
PostgreSQL host
*/}}
{{- define "certdax.postgresqlHost" -}}
{{- printf "%s-postgresql" (include "certdax.fullname" .) }}
{{- end }}

{{/*
Database URL — built-in PostgreSQL or external
*/}}
{{- define "certdax.databaseUrl" -}}
{{- if .Values.postgresql.enabled }}
{{- printf "postgresql://%s:$(DB_PASSWORD)@%s:5432/%s" .Values.postgresql.auth.username (include "certdax.postgresqlHost" .) .Values.postgresql.auth.database }}
{{- else }}
{{- .Values.certdax.externalDatabaseUrl }}
{{- end }}
{{- end }}

{{/*
Secret name that holds certdax credentials
*/}}
{{- define "certdax.secretName" -}}
{{- if .Values.certdax.existingSecret }}
{{- .Values.certdax.existingSecret }}
{{- else }}
{{- printf "%s-secrets" (include "certdax.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Secret name that holds the PostgreSQL password
*/}}
{{- define "certdax.postgresqlSecretName" -}}
{{- if .Values.postgresql.auth.existingSecret }}
{{- .Values.postgresql.auth.existingSecret }}
{{- else }}
{{- printf "%s-postgresql" (include "certdax.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Public URL — derived from ingress settings
*/}}
{{- define "certdax.publicUrl" -}}
{{- if and .Values.ingress.enabled .Values.ingress.tls.enabled }}
{{- printf "https://%s" .Values.ingress.host }}
{{- else if .Values.ingress.enabled }}
{{- printf "http://%s" .Values.ingress.host }}
{{- else }}
{{- printf "http://%s-frontend" (include "certdax.fullname" .) }}
{{- end }}
{{- end }}

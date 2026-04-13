{{/*
Expand the name of the chart.
*/}}
{{- define "certdax-operator.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "certdax-operator.fullname" -}}
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
{{- define "certdax-operator.labels" -}}
helm.sh/chart: {{ include "certdax-operator.name" . }}-{{ .Chart.Version | replace "+" "_" }}
{{ include "certdax-operator.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "certdax-operator.selectorLabels" -}}
app.kubernetes.io/name: {{ include "certdax-operator.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service account name
*/}}
{{- define "certdax-operator.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "certdax-operator.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Secret name for API credentials
*/}}
{{- define "certdax-operator.secretName" -}}
{{- if .Values.certdax.existingSecret }}
{{- .Values.certdax.existingSecret }}
{{- else }}
{{- include "certdax-operator.fullname" . }}-api
{{- end }}
{{- end }}

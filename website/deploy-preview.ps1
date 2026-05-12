# deploy-preview.ps1 — build + deploy letsfg-website-preview via Cloud Build
# Usage: .\deploy-preview.ps1 [-Tag cofounder-preview]
param(
    [string]$Tag = 'cofounder-preview'
)

$ErrorActionPreference = 'Stop'
$SRC = "C:\Users\Adam\Desktop\folder\LetsFG\website"

gcloud builds submit `
    --config="$SRC\cloudbuild.yaml" `
    --project=sms-caller `
    --substitutions="_DEPLOY_TAG=$Tag" `
    $SRC

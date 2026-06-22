<#
  Buddy — Azure deployment (App Service for Containers + Postgres Flexible Server + Key Vault).

  Provisions a secure, self-contained deployment:
    - Azure Container Registry (builds the image in the cloud — no local Docker needed)
    - Azure Database for PostgreSQL Flexible Server (Burstable B1ms) + 'buddy' database
    - Key Vault holding SESSION_KEY + the DB connection string
    - Linux App Service (B1) Web App for Containers with a system-assigned managed identity
      that reads those secrets via Key Vault references; HTTPS is automatic.

  Prerequisites:
    - Azure CLI logged in:  az login   (run this yourself: `! az login`)
    - Your account needs Contributor + User Access Administrator (or Owner) on the
      subscription/RG (role assignments are created below).
    - Run from the repo root or this folder: pwsh ./infra/deploy.ps1 -ResourceGroup buddy-rg

  Re-running is safe-ish: most creates are idempotent; it rebuilds + redeploys the image.

  NOTE: This is a first-run scaffold tailored to Buddy. Review names/region/SKUs and
  `az` versions before running in your subscription.
#>
param(
  [string]$ResourceGroup = "buddy-rg",
  [string]$Location = "eastus",
  # Used as the base for globally-unique resource names (lowercase alphanumeric).
  [string]$Prefix = "buddy$(Get-Random -Minimum 1000 -Maximum 9999)",
  [string]$PgPassword = "",
  [string]$SessionKey = ""
)
$ErrorActionPreference = "Stop"
$Prefix = ($Prefix.ToLower() -replace '[^a-z0-9]', '')

# Repo root = parent of this script's folder.
$RepoRoot = Split-Path -Parent $PSScriptRoot

# --- Generate secrets if not supplied ---
function New-HexKey { -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }) }
if (-not $SessionKey) { $SessionKey = New-HexKey }                       # 64 hex chars
if (-not $PgPassword) { $PgPassword = "Bd!" + ([guid]::NewGuid().ToString('N')) + "Z9" }  # meets complexity

$acr   = "${Prefix}acr"
$pg    = "${Prefix}pg"
$kv    = "${Prefix}kv"
$plan  = "${Prefix}plan"
$app   = "${Prefix}app"
$image = "$acr.azurecr.io/buddy:latest"

Write-Host "== Resource group ==" -ForegroundColor Cyan
az group create -n $ResourceGroup -l $Location | Out-Null

Write-Host "== Container registry + build image ($image) ==" -ForegroundColor Cyan
az acr create -g $ResourceGroup -n $acr --sku Basic --admin-enabled true | Out-Null
az acr build -r $acr -t buddy:latest $RepoRoot | Out-Null

Write-Host "== Postgres Flexible Server ($pg) ==" -ForegroundColor Cyan
# --public-access 0.0.0.0 allows other Azure services (the Web App) to connect; SSL required.
az postgres flexible-server create `
  -g $ResourceGroup -n $pg -l $Location `
  --admin-user buddyadmin --admin-password $PgPassword `
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 `
  --database-name buddy --public-access 0.0.0.0 --yes | Out-Null
$dbUrl = "postgres://buddyadmin:$PgPassword@$pg.postgres.database.azure.com:5432/buddy"

Write-Host "== Key Vault ($kv) + secrets ==" -ForegroundColor Cyan
az keyvault create -g $ResourceGroup -n $kv --enable-rbac-authorization true | Out-Null
$kvId = az keyvault show -n $kv --query id -o tsv
$me   = az ad signed-in-user show --query id -o tsv
az role assignment create --assignee $me --role "Key Vault Secrets Officer" --scope $kvId | Out-Null
Write-Host "  waiting for RBAC propagation..." ; Start-Sleep -Seconds 30
az keyvault secret set --vault-name $kv -n session-key  --value $SessionKey | Out-Null
az keyvault secret set --vault-name $kv -n database-url --value $dbUrl      | Out-Null
$sessionUri = az keyvault secret show --vault-name $kv -n session-key  --query id -o tsv
$dbUri      = az keyvault secret show --vault-name $kv -n database-url --query id -o tsv

Write-Host "== App Service plan + Web App ==" -ForegroundColor Cyan
az appservice plan create -g $ResourceGroup -n $plan --is-linux --sku B1 | Out-Null
az webapp create -g $ResourceGroup -n $app --plan $plan --deployment-container-image-name $image | Out-Null

# Pull the image from ACR using its admin credentials.
$acrPwd = az acr credential show -n $acr --query "passwords[0].value" -o tsv
az webapp config container set -g $ResourceGroup -n $app `
  --container-image-name $image `
  --container-registry-url "https://$acr.azurecr.io" `
  --container-registry-user $acr --container-registry-password $acrPwd | Out-Null

# Managed identity → read Key Vault secrets.
$principalId = az webapp identity assign -g $ResourceGroup -n $app --query principalId -o tsv
az role assignment create --assignee $principalId --role "Key Vault Secrets User" --scope $kvId | Out-Null

Write-Host "== App settings (secrets via Key Vault references) ==" -ForegroundColor Cyan
az webapp config appsettings set -g $ResourceGroup -n $app --settings `
  NODE_ENV=production `
  WEBSITES_PORT=8080 `
  WEB_DIST_PATH=/app/web/dist `
  BACKUP_DIR=/home/backups `
  DATABASE_SSL=true `
  COOKIE_SECURE=true `
  "DATABASE_URL=@Microsoft.KeyVault(SecretUri=$dbUri)" `
  "SESSION_KEY=@Microsoft.KeyVault(SecretUri=$sessionUri)" | Out-Null

az webapp restart -g $ResourceGroup -n $app | Out-Null

Write-Host ""
Write-Host "Deployed. URL: https://$app.azurewebsites.net" -ForegroundColor Green
Write-Host "First visit: register the first user — they become the system admin." -ForegroundColor Green
Write-Host "(DB migrations run automatically on container start.)"

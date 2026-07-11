<#
  Buddy - deploy to the lilnas Docker Compose stack (production).

  Deploys a new image tag to the `buddy` service running on the Debian NAS
  reachable via the SSH alias `lilnas` (see ~/.ssh/config), by updating
  BUDDY_TAG in the remote .env, pulling, and restarting via `docker compose`.
  Health-checks the deployed app and auto-rolls-back to the previous tag if
  it never becomes healthy.

  Usage:
    .\deploy-lilnas.ps1 [-Sha <sha>]
        Deploy the given image tag (ghcr.io/dhtaylor/buddy:<sha>).
        If -Sha is omitted, defaults to the current `main` HEAD sha
        (`git rev-parse HEAD`).

    .\deploy-lilnas.ps1 rollback
        Re-pin the previously running tag (recorded during the last deploy)
        and restart the stack.

  Other params (all optional):
    -RemoteHost <name>   SSH alias for the NAS. Default: lilnas
    -RemoteDir  <path>   Remote directory holding docker-compose.yml/.env. Default: /srv/buddy
    -HealthUrl  <url>    Health endpoint polled after deploy/rollback. Default: http://192.168.1.197:8080/health

  Prerequisites: key-based SSH to $RemoteHost (no password prompt), and
  `docker compose` available on the NAS.
#>
param(
    [Parameter(Position = 0)]
    [string]$Mode = "deploy",

    [string]$Sha,

    [string]$RemoteHost = "lilnas",

    [string]$RemoteDir = "/srv/buddy",

    [string]$HealthUrl = "http://192.168.1.197:8080/health"
)

$ErrorActionPreference = "Stop"

# Local fallback record of the previous tag, in case the remote state file
# is ever unavailable. Keyed by nothing in particular - one deploy history
# per checkout is enough for this project.
$LocalStateFile = Join-Path $PSScriptRoot ".lilnas_previous_tag"
$RemoteStateFile = "$RemoteDir/.previous_tag"

function Invoke-Remote {
    param([string]$Command)
    ssh -n -o BatchMode=yes $RemoteHost $Command
    if ($LASTEXITCODE -ne 0) {
        throw "ssh command failed (exit $LASTEXITCODE): $Command"
    }
}

function Get-RemoteOutput {
    param([string]$Command)
    $output = ssh -n -o BatchMode=yes $RemoteHost $Command
    if ($LASTEXITCODE -ne 0) {
        throw "ssh command failed (exit $LASTEXITCODE): $Command"
    }
    return $output
}

function Get-RemoteTag {
    $line = Get-RemoteOutput "grep -E '^BUDDY_TAG=' '$RemoteDir/.env' || true"
    if (-not $line) {
        return $null
    }
    return ($line -replace '^BUDDY_TAG=', '').Trim()
}

function Set-RemoteTag {
    param([string]$Tag)
    Write-Host "Setting BUDDY_TAG=$Tag in $RemoteHost`:$RemoteDir/.env" -ForegroundColor Cyan
    $cmd = "sed -i -E 's/^BUDDY_TAG=.*/BUDDY_TAG=$Tag/' '$RemoteDir/.env' && grep -q '^BUDDY_TAG=' '$RemoteDir/.env' || echo 'BUDDY_TAG=$Tag' >> '$RemoteDir/.env'"
    Invoke-Remote $cmd
}

function Save-PreviousTag {
    param([string]$Tag)
    Write-Host "Recording previous tag: $Tag" -ForegroundColor Cyan
    Invoke-Remote "echo '$Tag' > '$RemoteStateFile'"
    Set-Content -Path $LocalStateFile -Value $Tag -NoNewline
}

function Get-PreviousTag {
    $tag = $null
    try {
        $tag = (Get-RemoteOutput "cat '$RemoteStateFile' 2>/dev/null || true").Trim()
    } catch {
        $tag = $null
    }
    if (-not $tag -and (Test-Path $LocalStateFile)) {
        $tag = (Get-Content -Path $LocalStateFile -Raw).Trim()
    }
    return $tag
}

function Invoke-ComposeUp {
    param([switch]$Pull)
    if ($Pull) {
        Write-Host "Pulling image on $RemoteHost..." -ForegroundColor Cyan
        Invoke-Remote "cd '$RemoteDir' && docker compose pull buddy"
    }
    Write-Host "Starting stack on $RemoteHost..." -ForegroundColor Cyan
    Invoke-Remote "cd '$RemoteDir' && docker compose up -d"
}

function Invoke-PreDeploySnapshot {
    # Version-matched pre-migration snapshot (gap #2): dump the live DB from the
    # db container's own pg_dump BEFORE the new image (which may run migrations)
    # comes up. Best-effort - warn but don't block the deploy (nightly cron also
    # covers backups), since e.g. a first-ever deploy has no data yet.
    param([string]$Sha)
    Write-Host "Taking pre-deploy DB snapshot on $RemoteHost..." -ForegroundColor Cyan
    $short = if ($Sha.Length -ge 12) { $Sha.Substring(0, 12) } else { $Sha }
    ssh -n -o BatchMode=yes $RemoteHost "/srv/buddy/backup.sh pre-deploy-$short"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "WARNING: pre-deploy snapshot failed - continuing (nightly backups still apply)." -ForegroundColor Yellow
    } else {
        Write-Host "Pre-deploy snapshot written." -ForegroundColor Green
    }
}

function Test-Health {
    Write-Host "Health-checking $HealthUrl ..." -ForegroundColor Cyan
    for ($i = 1; $i -le 10; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) {
                Write-Host "Health check passed (attempt $i/10)." -ForegroundColor Green
                return $true
            }
            Write-Host "Attempt $i/10: got status $($response.StatusCode)" -ForegroundColor Yellow
        } catch {
            Write-Host "Attempt $i/10: not yet healthy ($($_.Exception.Message))" -ForegroundColor Yellow
        }
        if ($i -lt 10) {
            Start-Sleep -Seconds 2
        }
    }
    return $false
}

function Show-RemoteStatus {
    Write-Host "== docker ps on $RemoteHost ==" -ForegroundColor Cyan
    Invoke-Remote "cd '$RemoteDir' && docker ps"
}

function Invoke-Rollback {
    param([string]$Reason)

    if ($Reason) {
        Write-Host "FAILURE: $Reason" -ForegroundColor Red
    }

    $previousTag = Get-PreviousTag
    if (-not $previousTag) {
        Write-Host "No previous tag on record - cannot auto-rollback." -ForegroundColor Red
        exit 1
    }

    Write-Host "Rolling back to previous tag: $previousTag" -ForegroundColor Yellow
    Set-RemoteTag -Tag $previousTag
    Invoke-ComposeUp -Pull

    if (Test-Health) {
        Write-Host "Rollback succeeded - $previousTag is healthy." -ForegroundColor Green
        Show-RemoteStatus
        exit 1
    } else {
        Write-Host "Rollback FAILED - $previousTag did not become healthy either. Manual intervention required." -ForegroundColor Red
        Show-RemoteStatus
        exit 1
    }
}

# --- Main ---

if ($Mode -eq "rollback") {
    Write-Host "== Buddy rollback on $RemoteHost ==" -ForegroundColor Cyan
    $previousTag = Get-PreviousTag
    if (-not $previousTag) {
        Write-Host "No previous tag on record - nothing to roll back to." -ForegroundColor Red
        exit 1
    }
    Write-Host "Restoring previous tag: $previousTag" -ForegroundColor Cyan
    Set-RemoteTag -Tag $previousTag
    Invoke-ComposeUp -Pull

    if (Test-Health) {
        Write-Host "Rollback succeeded - $previousTag is healthy." -ForegroundColor Green
        Show-RemoteStatus
        exit 0
    } else {
        Write-Host "Rollback FAILED - $previousTag did not become healthy." -ForegroundColor Red
        Show-RemoteStatus
        exit 1
    }
}
elseif ($Mode -eq "deploy") {
    if (-not $Sha) {
        Write-Host "No -Sha given, resolving current main HEAD sha..." -ForegroundColor Cyan
        $Sha = (git rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $Sha) {
            throw "Failed to resolve git HEAD sha."
        }
    }
    Write-Host "== Buddy deploy: tag $Sha to $RemoteHost`:$RemoteDir ==" -ForegroundColor Cyan

    $currentTag = Get-RemoteTag
    if (-not $currentTag) {
        Write-Host "Could not read current BUDDY_TAG from remote .env - proceeding without a rollback point." -ForegroundColor Yellow
    } else {
        Write-Host "Currently running tag: $currentTag" -ForegroundColor Cyan
        Save-PreviousTag -Tag $currentTag
    }

    Invoke-PreDeploySnapshot -Sha $Sha
    Set-RemoteTag -Tag $Sha
    Invoke-ComposeUp -Pull

    if (Test-Health) {
        Write-Host "Deploy succeeded - $Sha is healthy." -ForegroundColor Green
        Show-RemoteStatus
        exit 0
    } else {
        Invoke-Rollback -Reason "New tag $Sha never returned a healthy response from $HealthUrl."
    }
}
else {
    throw "Unknown mode '$Mode'. Use no argument (deploy) or 'rollback'."
}

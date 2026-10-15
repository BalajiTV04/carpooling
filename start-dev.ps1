<#
  start-dev.ps1 — one-command dev stack for the carpooling project.

    .\start-dev.ps1                  open TWO windows: backend (:8000) + frontend (:3000)
    .\start-dev.ps1 -BackendOnly     backend only
    .\start-dev.ps1 -FrontendOnly    frontend only

  The -Auto switch is what the "Carpooling Backend" / "Carpooling Frontend"
  scheduled tasks (Task Scheduler, AtLogOn) call: same script, but the servers
  run hidden inside the task process with output redirected to backend\run.log
  and frontend\dev.log, so nothing pops up at logon.

  MongoDB is a Windows service on this machine ("MongoDB Server") and starts
  with Windows by itself; this script only nudges it if it is stopped.
#>
param(
  [switch]$BackendOnly,
  [switch]$FrontendOnly,
  [switch]$Auto
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
# No flag  -> both. -BackendOnly / -FrontendOnly -> just that one.
$doBackend  = -not $FrontendOnly
$doFrontend = -not $BackendOnly

function Test-Port([int]$Port) {
  (Test-NetConnection -ComputerName localhost -Port $Port -WarningAction SilentlyContinue).TcpTestSucceeded
}

# ── MongoDB (interactive mode only; -Auto assumes the service is up) ─────────
if ($doBackend -and -not $Auto) {
  $mongo = Get-Service -Name MongoDB -ErrorAction SilentlyContinue
  if ($mongo -and $mongo.Status -ne 'Running') {
    Write-Host "MongoDB service is stopped — trying to start it (needs an elevated shell)..."
    try { Start-Service MongoDB; Write-Host "MongoDB started." }
    catch { Write-Warning "Could not start MongoDB. Open PowerShell as Administrator and run: Start-Service MongoDB" }
  } elseif (-not $mongo) {
    Write-Warning "No MongoDB service found — make sure mongod is reachable on mongodb://localhost:27017"
  }
}

# ── Backend :8000 ────────────────────────────────────────────────────────────
if ($doBackend) {
  if (Test-Port 8000) {
    if (-not $Auto) { Write-Host "Backend already running -> http://localhost:8000/api/v1/health" }
  } elseif ($Auto) {
    # cmd does the redirection (uvicorn logs to stderr; PowerShell's *>
    # would wrap those lines in NativeCommandError noise in run.log).
    Set-Location (Join-Path $root 'backend')
    cmd /c "python -m uvicorn app.main:app --port 8000 > run.log 2>&1"
  } else {
    Start-Process powershell -ArgumentList '-NoExit', '-Command',
      "Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force; Set-Location '$root\backend'; python -m uvicorn app.main:app --port 8000"
    Write-Host "Backend window opened -> http://localhost:8000/api/v1/health"
  }
}

# ── Frontend :3000 ───────────────────────────────────────────────────────────
if ($doFrontend) {
  if (Test-Port 3000) {
    if (-not $Auto) { Write-Host "Frontend already running -> http://localhost:3000" }
  } elseif ($Auto) {
    # Bypass is per-process: needed because npm.ps1 is blocked by the machine
    # execution policy, and the task runs non-interactively.
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
    Set-Location (Join-Path $root 'frontend')
    npm run dev *> dev.log
  } else {
    Start-Process powershell -ArgumentList '-NoExit', '-Command',
      "Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force; Set-Location '$root\frontend'; npm run dev"
    Write-Host "Frontend window opened -> http://localhost:3000"
  }
}

if (-not $Auto) {
  Write-Host ""
  Write-Host "Project:  http://localhost:3000   API: http://localhost:8000/docs"
  Write-Host "Stop a window with Ctrl+C (or close it)."
}

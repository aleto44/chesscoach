# Starts Chess Coach from the current code (`npm run tauri dev`). The desktop shortcut runs this.
# Under tauri dev, code changes reload on their own: the frontend live, the Rust side after a
# rebuild. The phone server is part of the same app and serves the same live frontend, so the
# phone is always on whatever the computer is running.

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$Host.UI.RawUI.WindowTitle = "Chess Coach (dev) - close this window to quit"

# Already running? A second copy can't start (Vite's port is taken), so just say so.
if (Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "Chess Coach is already running (look for its window or the other console)." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    exit 0
}

# Dependencies changed since the last install (e.g. another branch or session added one).
$installed = Join-Path $repo "node_modules\.package-lock.json"
if (-not (Test-Path $installed) -or (Get-Item "package-lock.json").LastWriteTime -gt (Get-Item $installed).LastWriteTime) {
    Write-Host "Installing npm packages..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { Read-Host "npm install failed. Press Enter to close"; exit 1 }
}

Write-Host "Starting Chess Coach. The first start after Rust changes compiles for a minute or two." -ForegroundColor Cyan
npm run tauri dev
if ($LASTEXITCODE -ne 0) { Read-Host "Chess Coach stopped with an error (see above). Press Enter to close" }

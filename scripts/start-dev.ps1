# Starts Chess Coach from the current code (`npm run tauri dev`). The desktop shortcut runs this.
# Under tauri dev, code changes reload on their own: the frontend live, the Rust side after a
# rebuild. The phone server is part of the same app and serves the same live frontend, so the
# phone is always on whatever the computer is running.
# -Hidden (used by start-hidden.vbs) runs with no visible console: messages become popups, and the
# app's input comes from NUL so nothing can sit waiting for a key in a window nobody sees. Without
# it the console stays open as before ("close this window to quit").

param([switch]$Hidden)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$Host.UI.RawUI.WindowTitle = "Chess Coach (dev) - close this window to quit"

# Tells the user something: in the console normally, as a popup (closing after $wait seconds, 0 =
# stays) when hidden.
function Show-Message([string]$text, [int]$wait = 0, [int]$icon = 48) {
    if ($Hidden) { [void](New-Object -ComObject WScript.Shell).Popup($text, $wait, "Chess Coach", $icon) }
    elseif ($wait -gt 0) { Write-Host $text -ForegroundColor Yellow; Start-Sleep -Seconds $wait }
    else { Read-Host "$text Press Enter to close" }
}

# Already running? A second copy can't start (Vite's port is taken), so just say so.
if (Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue) {
    Show-Message "Chess Coach is already running (look for its window)." 5 64
    exit 0
}

# Dependencies changed since the last install (e.g. another branch or session added one).
$installed = Join-Path $repo "node_modules\.package-lock.json"
if (-not (Test-Path $installed) -or (Get-Item "package-lock.json").LastWriteTime -gt (Get-Item $installed).LastWriteTime) {
    Write-Host "Installing npm packages..." -ForegroundColor Cyan
    cmd /c "npm install 2>&1" | Tee-Object -FilePath (Join-Path $repo "dev-console.log")
    if ($LASTEXITCODE -ne 0) { Show-Message "npm install failed (see dev-console.log)."; exit 1 }
}

Write-Host "Starting Chess Coach. The first start after Rust changes compiles for a minute or two." -ForegroundColor Cyan
# A crash after the app has been up a while (e.g. a native WebView2 crash on a page reload) restarts
# it; the data is in SQLite, so nothing is lost. A failure right after starting is usually a build
# error, which restarting won't fix, so that one stops and waits.
# The console is also kept in dev-console.log, and a crashed run's in crash-console.log, so a crash
# can be looked into afterwards: the exit code alone doesn't say what died. cmd does the 2>&1, since
# PowerShell 5.1 turns a native command's stderr into errors, which would stop this script.
$log = Join-Path $repo "dev-console.log"
$stdin = if ($Hidden) { " < NUL" } else { "" }
while ($true) {
    $started = Get-Date
    cmd /c "npm run tauri dev$stdin 2>&1" | Tee-Object -FilePath $log
    $code = $LASTEXITCODE
    if ($code -eq 0) { break }
    $ranFor = ((Get-Date) - $started).TotalSeconds
    if ($ranFor -lt 60) {
        if ($Hidden) { Start-Process notepad.exe $log }
        Show-Message "Chess Coach stopped with an error (see $(if ($Hidden) { 'dev-console.log' } else { 'above' }))."
        break
    }
    Write-Host "Chess Coach crashed (exit $code) after $([int]$ranFor)s. Restarting..." -ForegroundColor Yellow
    Copy-Item $log (Join-Path $repo "crash-console.log") -Force
    Add-Content -Path (Join-Path $repo "crash.log") -Value "$(Get-Date -Format s) exit $code after $([int]$ranFor)s (console: crash-console.log)"
}

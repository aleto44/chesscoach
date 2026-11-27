# Starts Chess Coach on the desktop, updating it first if the deployed version changed it
# (docs/deployment.md). Installed with the program in %USERPROFILE%\.chesscoach\app; the desktop
# shortcut runs it through start.vbs (no console). The page comes from the server, so only this
# program (src-tauri) needs installing here: when the server's /api/version names another build
# of it than installed.json, it's built from that commit (in ..\build, a clone kept for that) with
# cargo, installed, and started. Offline, or if the build fails, the installed one starts as is.
#
# -After <pid>: the running program asked to restart for an update ("Restart to update"); wait
# for it to quit first.
param([int]$After = 0)

$ErrorActionPreference = 'Continue'
$app = $PSScriptRoot
$root = Split-Path -Parent $app                 # %USERPROFILE%\.chesscoach
$build = Join-Path $root 'build'
$exe = Join-Path $app 'chesscoach.exe'
$installedFile = Join-Path $app 'installed.json'
$log = Join-Path $app 'update.log'
$repoUrl = 'https://github.com/aleto44/chesscoach.git'

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
function Show-Popup([string]$text, [int]$icon = 48) {
    [void](New-Object -ComObject WScript.Shell).Popup($text, 0, 'Chess Coach', $icon)
}
function Write-Log([string]$text) { Add-Content -Encoding utf8 -Path $log -Value "$(Get-Date -Format s) $text" }

if ($After) { Wait-Process -Id $After -Timeout 30 -ErrorAction SilentlyContinue }
elseif (Get-Process chesscoach -ErrorAction SilentlyContinue | Where-Object Path -eq $exe) {
    # Already open: bring it forward instead of opening a second window.
    [void](New-Object -ComObject WScript.Shell).AppActivate('Chess Coach')
    exit 0
}

$server = $null
try { $server = (Get-Content (Join-Path $root 'server.json') -Raw | ConvertFrom-Json).url.TrimEnd('/') } catch {}
$installed = $null
try { $installed = Get-Content $installedFile -Raw | ConvertFrom-Json } catch {}
$deployed = $null
if ($server) {
    try { $deployed = Invoke-RestMethod "$server/api/version" -TimeoutSec 8 } catch { Write-Log "can't reach $server ($_)" }
}

$needs = $deployed -and $deployed.shell -and $deployed.commit -and
    (-not (Test-Path $exe) -or -not $installed -or $installed.shell -ne $deployed.shell)
if ($needs) {
    $tray = New-Object System.Windows.Forms.NotifyIcon
    $tray.Icon = if (Test-Path $exe) { [System.Drawing.Icon]::ExtractAssociatedIcon($exe) } else { [System.Drawing.SystemIcons]::Information }
    $tray.Text = 'Chess Coach is updating'
    $tray.Visible = $true
    $tray.ShowBalloonTip(10000, 'Chess Coach', 'Updating the desktop app. This takes a minute or two (longer the first time).', 'Info')
    try {
        Write-Log "updating to $($deployed.commit) (shell $($deployed.shell))"
        if (-not (Test-Path (Join-Path $build '.git'))) {
            git clone -q --no-checkout $repoUrl $build 2>&1 | Out-File -Append -Encoding utf8 $log
        }
        git -C $build fetch -q origin main 2>&1 | Out-File -Append -Encoding utf8 $log
        git -C $build checkout -q -f --detach $deployed.commit 2>&1 | Out-File -Append -Encoding utf8 $log
        if ($LASTEXITCODE -ne 0) { throw "couldn't check out $($deployed.commit)" }
        # The workspace's release profile is tuned for the server (full LTO); the window doesn't need it.
        $env:CC_SHELL_VERSION = $deployed.shell
        $env:CARGO_PROFILE_RELEASE_LTO = 'thin'
        $env:CARGO_PROFILE_RELEASE_CODEGEN_UNITS = '16'
        Push-Location $build
        cmd /c "cargo build --release -p chesscoach 2>&1" | Out-File -Append -Encoding utf8 $log
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { throw "cargo build failed (exit $code)" }
        Copy-Item (Join-Path $build 'target\release\chesscoach.exe') $exe -Force
        # This script and start.vbs are part of the program too (src-tauri).
        Copy-Item (Join-Path $build 'src-tauri\launch.ps1'), (Join-Path $build 'src-tauri\start.vbs') $app -Force
        @{ shell = $deployed.shell; commit = $deployed.commit; installedAt = (Get-Date -Format s) } |
            ConvertTo-Json | Set-Content -Encoding utf8 $installedFile
        Write-Log "installed shell $($deployed.shell)"
    } catch {
        Write-Log "update failed: $_"
        if (Test-Path $exe) { Show-Popup "Couldn't update Chess Coach ($_). Starting the installed version; details in $log." }
        else { Show-Popup "Couldn't install Chess Coach ($_). Details in $log." 16; exit 1 }
    } finally {
        $tray.Dispose()
    }
}

if (-not (Test-Path $exe)) {
    Show-Popup "Chess Coach isn't installed yet, and the server ($server) can't be reached to install it. Is Tailscale on?" 16
    exit 1
}
Start-Process $exe

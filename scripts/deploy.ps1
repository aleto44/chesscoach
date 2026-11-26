# Deploys Chess Coach's server to laptop-server (docs/server-migration.md, phase 4): sends this
# working tree (tracked files plus new untracked ones, so uncommitted work deploys too) over SSH,
# then deploy/install.sh rebuilds and restarts the container there and waits until it's healthy.
# The first build on the laptop takes 10-20 minutes; later ones reuse Docker's cache.
param([string]$Server = 'alex@laptop-server')

# Native tools (ssh, docker) write progress to stderr; PowerShell 5.1 would turn that into errors.
# Failures are caught by exit code instead.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$ssh = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15')

$list = Join-Path $env:TEMP 'chesscoach-files.txt'
$tgz = Join-Path $env:TEMP 'chesscoach-src.tgz'
# Only files that exist (a deleted file can still be listed until it's staged).
git ls-files -co --exclude-standard | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Set-Content -Encoding ascii $list
Write-Host "Packing $((Get-Content $list).Count) files..."
tar -czf $tgz -T $list
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }

Write-Host 'Sending to the server...'
& scp @ssh -q $tgz "${Server}:/tmp/chesscoach-src.tgz"
if ($LASTEXITCODE -ne 0) { throw 'scp failed' }
& scp @ssh -q (Join-Path $repo 'deploy/install.sh') "${Server}:/tmp/chesscoach-install.sh"
if ($LASTEXITCODE -ne 0) { throw 'scp failed' }
Remove-Item $tgz, $list

& ssh @ssh $Server 'bash /tmp/chesscoach-install.sh /tmp/chesscoach-src.tgz; s=$?; rm -f /tmp/chesscoach-install.sh; exit $s'
if ($LASTEXITCODE -ne 0) { throw "deploy failed (exit $LASTEXITCODE)" }
Write-Host 'Deployed: https://laptop-server.tail3adf5e.ts.net'

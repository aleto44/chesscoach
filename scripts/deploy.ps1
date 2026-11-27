# Deploys what's on main on GitHub right now, and shows how it went (docs/deployment.md). The
# server also does this by itself within a minute of a push; this only skips the wait. It never
# sends local files: what runs is always a commit on main, so push first.
param([string]$Server = 'alex@laptop-server')

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)
git fetch -q origin main
$local = git rev-parse HEAD
$main = git rev-parse origin/main
if ($local -ne $main) {
    Write-Host "Note: this checkout ($($local.Substring(0, 7))) isn't what's on main ($($main.Substring(0, 7))). Main is what deploys." -ForegroundColor Yellow
}
& ssh -o BatchMode=yes -o ConnectTimeout=15 $Server 'chesscoach-deploy now && chesscoach-deploy status'
if ($LASTEXITCODE -ne 0) { throw "deploy failed (exit $LASTEXITCODE)" }

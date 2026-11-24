# PR Peer installer for Windows (PowerShell 5.1+). Run it from the downloaded PR Peer folder:
#   powershell -ExecutionPolicy Bypass -File install.ps1          (asks before installing anything)
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Yes     (installs what is missing without asking)
# Installs what is missing (git, Node 24, Python 3, optionally gh) with winget, fixes the Microsoft Store
# Python alias, installs PR Peer, puts `prpeer` on PATH and finishes with `prpeer doctor`.
param([switch]$Yes)
# not 'Stop': in PowerShell 5.1 native stderr output would abort it; every native call checks $LASTEXITCODE instead
$ErrorActionPreference = 'Continue'
$app = $PSScriptRoot

function Fail($msg) { Write-Host "prpeer install: $msg" -ForegroundColor Red; Write-Host 'The duck is disappointed, but not surprised.' -ForegroundColor DarkGray; exit 1 }
function Step($msg) { Write-Host "-> $msg" -ForegroundColor Cyan }
function Ask($q) { if ($Yes) { return $true }; $a = Read-Host "$q [Y/n]"; return ($a -eq '' -or $a -match '^[yYsS]') }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
# winget installs update the registry PATH, not this session's: reload it
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function NodeMajor { if (Has node) { try { return [int]((node -v).TrimStart('v').Split('.')[0]) } catch {} }; return 0 }
function RealPython { foreach ($c in 'python3', 'python') { try { $v = & $c --version 2>$null; if ($LASTEXITCODE -eq 0 -and "$v" -match '^Python 3') { return $true } } catch {} }; return $false }
function Winget($id, $what) {
  if (-not (Has winget)) { Fail "$what is missing and winget is not available. Install $what by hand and run this again." }
  Step "Installing $what with winget ($id)..."
  winget install --id $id -e --source winget --accept-package-agreements --accept-source-agreements --silent
  if ($LASTEXITCODE) { Fail "winget could not install $what (code $LASTEXITCODE)." }
  Refresh-Path
}

# the logo: two eyes peeking over the orange bar (plain ASCII: PowerShell 5.1 reads this file as ANSI)
Write-Host '     .-----.   .-----.'
Write-Host '    /  .-.  \ /  .-.  \'
Write-Host '   |  ( o )  |  ( o )  |'
Write-Host '  .---------------------.' -ForegroundColor DarkYellow
Write-Host '  |  ===========        |' -ForegroundColor DarkYellow -NoNewline; Write-Host '   P R   P E E R   installer'
Write-Host '  |  ======             |' -ForegroundColor DarkYellow -NoNewline; Write-Host '   Hatching a code reviewer. Please do not tap the glass.'
Write-Host "  '---------------------'" -ForegroundColor DarkYellow
Write-Host ''

if (-not (Test-Path (Join-Path $app 'package.json'))) { Fail "no package.json next to this script ($app). Run it from the downloaded PR Peer folder." }

Step 'Checking your toolbox...'
if (-not (Has git)) {
  if (Ask 'git is missing. Install it with winget?') { Winget 'Git.Git' 'git' } else { Fail 'git is required.' }
}
if ((NodeMajor) -lt 24) {
  $now = if (Has node) { "Node $(node -v) is too old" } else { 'Node.js is missing' }
  if (Ask "$now (PR Peer needs 24+). Install Node LTS with winget?") { Winget 'OpenJS.NodeJS.LTS' 'Node.js' } else { Fail 'Node 24+ is required.' }
  if ((NodeMajor) -lt 24) { Fail 'Node is still older than 24 in this session. Open a new terminal and run the installer again.' }
}
if (-not (RealPython)) {
  # a real Python hiding behind the Microsoft Store alias: put it first in the user PATH
  $hidden = (where.exe python 2>$null) | Where-Object { $_ -and $_ -notmatch 'WindowsApps' } | Select-Object -First 1
  if ($hidden) {
    $dir = Split-Path $hidden
    if (Ask "Python is installed at $dir but the Microsoft Store alias wins on PATH. Put the real one first in your user PATH?") {
      $user = [Environment]::GetEnvironmentVariable('Path', 'User') -split ';' | Where-Object { $_ -and $_ -ne $dir -and $_ -ne "$dir\Scripts" }
      [Environment]::SetEnvironmentVariable('Path', (@($dir, "$dir\Scripts") + $user) -join ';', 'User')
      Refresh-Path
    }
  } elseif (Ask 'Python 3 is missing (only needed to analyze Python repos). Install it with winget?') { Winget 'Python.Python.3.13' 'Python 3' }
}
if (-not (Has gh)) {
  if (Ask 'GitHub CLI (gh) is missing (optional: open PRs by number, private repos). Install it?') { Winget 'GitHub.cli' 'GitHub CLI'; Write-Host '   Run "gh auth login" afterwards to connect your account.' -ForegroundColor DarkGray }
}

Push-Location $app
try {
  Step 'Downloading half the internet (npm ci). Good time for a coffee...'
  npm ci --no-audit --no-fund; if ($LASTEXITCODE) { Fail 'npm ci failed. Check your connection or proxy and try again.' }
  Step 'Teaching your terminal a new word: prpeer...'
  # dependencies and the build are already in place: the global entry is only a link to this folder
  npm install -g . --ignore-scripts --no-audit --no-fund; if ($LASTEXITCODE) { Fail 'npm install -g failed.' }
} finally { Pop-Location }

Write-Host ''
Step 'Asking the doctor for a second opinion...'
node (Join-Path $app 'bin.mjs') doctor
Write-Host ''
Write-Host 'PR Peer is installed. Your PRs are now being watched (in a supportive way).' -ForegroundColor Green
Write-Host 'Open a new terminal and try:'
Write-Host '  prpeer --serve                                  # home screen'
Write-Host '  prpeer https://github.com/owner/repo/pull/123   # open a PR'
Write-Host '  prpeer doctor                                   # check the setup any time'

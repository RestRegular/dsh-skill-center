param(
  [Parameter(Mandatory = $true)]
  [string]$Action,

  [string]$Name = 'dsh-skill-center',
  [string]$Description = 'DeepSeek Harness 技能中心插件：浏览并管理当前会话可见的技能 / Skill Center plugin for DeepSeek Harness.',
  [string]$Repo = 'dsh-skill-center',
  [string]$Owner = '',

  [string]$GitHelper = '',
  [string]$DevCred = 'devcred',
  [string]$InjectName = '',

  [string]$Message = '',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# `$PSScriptRoot` is empty when this file is invoked as `powershell -File`; fall back to the
# script path so every path below resolves absolutely.
if (-not $PSScriptRoot) { $PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $GitHelper) { $GitHelper = Join-Path $PSScriptRoot '.git-credential.ps1' }

function Resolve-Token {
  $tok = $env:DEVCRED_ACCESS_TOKEN
  if (-not $tok) { $tok = [Environment]::GetEnvironmentVariable('DEVCRED_ACCESS_TOKEN', 'User') }
  if (-not $tok) { throw 'DEVCRED_ACCESS_TOKEN is not set (env or User scope).' }
  $env:DEVCRED_PASSWORD = $tok
}

# Runs `devcred <args>` via cmd, stdin from NUL so a missing token fails fast instead of
# blocking on an interactive prompt. Output is returned as text; devcred redacts secrets.
function Invoke-DevCred {
  param([string[]]$DevCredArgs)
  $argv = @($DevCred) + $DevCredArgs
  $cmd = ($argv | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' '
  $out = cmd /c "$cmd < NUL 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "devcred failed ($LASTEXITCODE): $out" }
  return $out
}

switch ($Action) {
  'gh-create' {
    Resolve-Token
    if (-not $InjectName) { $InjectName = 'github-agent-use' }
    $payload = @{
      name        = $Repo
      description = $Description
      private     = $false
      has_issues  = $true
      has_wiki    = $false
      auto_init   = $false
    } | ConvertTo-Json -Compress
    # Payload is passed through a file so no JSON quoting survives into the shell.
    $tmp = Join-Path $env:TEMP "dsh-skill-center-gh-create-$PID.json"
    # PowerShell 5.1's `-Encoding utf8` writes a BOM, which JSON.parse rejects; write raw UTF-8.
    [IO.File]::WriteAllText($tmp, $payload, (New-Object System.Text.UTF8Encoding($false)))
    try {
      # The script only prints the resulting status/JSON, never the token.
      $lines = Invoke-DevCred @(
        'inject', '--only', $InjectName, '--',
        'node', "$PSScriptRoot\.gh-api.mjs", 'create-repo', $tmp
      )
      $lines
    } finally {
      Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    }
  }

  'gh-whoami' {
    Resolve-Token
    if (-not $InjectName) { $InjectName = 'github-agent-use' }
    Invoke-DevCred @('inject', '--only', $InjectName, '--', 'node', "$PSScriptRoot\.gh-api.mjs", 'whoami')
  }

  'git-config' {
    # Registers a credential helper that reads the token from the environment
    # (the child of `devcred inject`), so no secret ever lands in argv or on disk.
    git -C $PSScriptRoot config --local "credential.https://github.com.helper" "!powershell -NoProfile -ExecutionPolicy Bypass -File `"$GitHelper`""
    git -C $PSScriptRoot config --local lfs.locksverify false
    Write-Host "credential helper registered -> $GitHelper"
    git -C $PSScriptRoot config --local --get credential.https://github.com.helper
  }

  'git-push' {
    Resolve-Token
    if (-not $InjectName) { $InjectName = 'github-agent-use' }
    git -C $PSScriptRoot add -A
    git -C $PSScriptRoot status --short
    if ($Message) {
      git -C $PSScriptRoot commit -m $Message
    }
    $url = "https://github.com/$Owner/$Repo.git"
    if ($DryRun) { Write-Host "[dry-run] would push to $url"; break }
    Invoke-DevCred @('inject', '--only', $InjectName, '--', 'git', '-C', $PSScriptRoot, 'push', '-u', 'origin', $url, 'refs/heads/main')
  }

  'npm-publish' {
    Resolve-Token
    if (-not $InjectName) { $InjectName = 'npm-agent-use' }
    Invoke-DevCred @('inject', '--only', $InjectName, '--', 'npm', 'publish', $PSScriptRoot, '--access', 'public', '--loglevel', 'http')
  }

  default { throw "unknown action: $Action" }
}

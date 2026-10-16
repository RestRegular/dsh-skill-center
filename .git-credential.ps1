# Git credential helper. Git invokes this as:
#   powershell -File .git-credential.ps1 get
# The token is read from the environment that `devcred inject` prepared — it is
# never written to disk and never appears in a command line.
param([string]$Action)

function Get-Secret([string[]]$Names) {
  foreach ($n in $Names) {
    $v = [Environment]::GetEnvironmentVariable($n)
    if (-not [string]::IsNullOrWhiteSpace($v)) { return $v }
  }
  return $null
}

if ($Action -eq 'get') {
  $token = Get-Secret @('GITHUB_TOKEN', 'GH_TOKEN')
  if (-not $token) { [Console]::Error.WriteLine('no GITHUB_TOKEN in environment'); exit 1 }
  Write-Output 'username=x-access-token'
  Write-Output "password=$token"
}
exit 0

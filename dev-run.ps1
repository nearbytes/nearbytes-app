$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $repoRoot) {
  throw 'Could not resolve the repository root.'
}

$normalizedRepoRoot =
  if ($repoRoot.StartsWith('\\?\UNC\')) {
    '\\' + $repoRoot.Substring('\\?\UNC\'.Length)
  } elseif ($repoRoot.StartsWith('\\?\')) {
    $repoRoot.Substring('\\?\'.Length)
  } else {
    $repoRoot
  }

Push-Location $normalizedRepoRoot
try {
  node .\scripts\run-dev.mjs @args
} finally {
  Pop-Location
}

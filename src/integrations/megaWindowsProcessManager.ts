const MANAGED_MEGA_SERVER_PATH_PATTERNS = ['\\\\.nearbytes-dev\\\\megacmd\\\\', '\\\\.nearbytes\\\\helpers\\\\megacmd\\\\'] as const;

export interface ManagedMegaServerCleanupOptions {
  readonly currentServerCommand?: string;
}

export function supportsManagedMegaServerProcessControl(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32';
}

export function buildManagedMegaServerCleanupEnv(
  options: ManagedMegaServerCleanupOptions
): Record<string, string> {
  const env: Record<string, string> = {};
  if (options.currentServerCommand?.trim()) {
    env.NEARBYTES_CURRENT_MEGACMD_SERVER = options.currentServerCommand.trim();
  }
  return env;
}

export function buildManagedMegaServerCleanupPowerShell(): string {
  return [
    "$current = $env:NEARBYTES_CURRENT_MEGACMD_SERVER",
    "if ($current) { $current = [System.IO.Path]::GetFullPath($current).ToLowerInvariant() }",
    buildManagedMegaServerPathPatternsAssignment(),
    "$killed = @()",
    "Get-CimInstance Win32_Process -Filter \"Name = 'MEGAcmdServer.exe'\" | ForEach-Object {",
    "  if (-not $_.ExecutablePath) { return }",
    "  $path = [System.IO.Path]::GetFullPath($_.ExecutablePath).ToLowerInvariant()",
    "  $managed = $false",
    "  foreach ($pattern in $patterns) { if ($path -match $pattern) { $managed = $true; break } }",
    "  if (-not $managed) { return }",
    "  $kind = if ($current -and $path -eq $current) { 'current' } else { 'stale' }",
    "  Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null",
    "  $killed += \"${kind}:$($_.ProcessId):$path\"",
    "}",
    "$killed -join [Environment]::NewLine",
  ].join('; ');
}

export function buildManagedMegaServerWatchdogPowerShell(targetPid: number, timeoutMs: number): string {
  return [
    `Start-Sleep -Milliseconds ${timeoutMs}`,
    `$pidToKill = ${targetPid}`,
    buildManagedMegaServerPathPatternsAssignment(),
    "$targets = Get-CimInstance Win32_Process | Where-Object {",
    "  if ($_.ProcessId -eq $pidToKill) { return $true }",
    "  if ($_.Name -ne 'MEGAcmdServer.exe' -or -not $_.ExecutablePath) { return $false }",
    "  $path = [System.IO.Path]::GetFullPath($_.ExecutablePath).ToLowerInvariant()",
    "  foreach ($pattern in $patterns) { if ($path -match $pattern) { return $true } }",
    "  return $false",
    "}",
    "$targets | ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }",
  ].join('; ');
}

function buildManagedMegaServerPathPatternsAssignment(): string {
  const serialized = MANAGED_MEGA_SERVER_PATH_PATTERNS.map((pattern) => `'${pattern}'`).join(', ');
  return `$patterns = @(${serialized})`;
}
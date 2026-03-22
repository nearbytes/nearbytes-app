import {
  buildManagedMegaServerCleanupEnv,
  buildManagedMegaServerCleanupPowerShell,
  buildManagedMegaServerWatchdogPowerShell,
  supportsManagedMegaServerProcessControl,
} from '../megaWindowsProcessManager.js';
import { describe, expect, it } from 'vitest';

describe('megaWindowsProcessManager', () => {
  it('limits managed process control to Windows', () => {
    expect(supportsManagedMegaServerProcessControl('win32')).toBe(true);
    expect(supportsManagedMegaServerProcessControl('darwin')).toBe(false);
    expect(supportsManagedMegaServerProcessControl('linux')).toBe(false);
  });

  it('emits cleanup environment only when a current server command is present', () => {
    expect(buildManagedMegaServerCleanupEnv({})).toEqual({});
    expect(
      buildManagedMegaServerCleanupEnv({
        currentServerCommand: ' C:/MEGAcmd/MEGAcmdServer.exe ',
      })
    ).toEqual({
      NEARBYTES_CURRENT_MEGACMD_SERVER: 'C:/MEGAcmd/MEGAcmdServer.exe',
    });
  });

  it('builds cleanup PowerShell that distinguishes current vs stale daemons safely', () => {
    const script = buildManagedMegaServerCleanupPowerShell();
    expect(script).toContain("${kind}:$($_.ProcessId):$path");
    expect(script).toContain("Name = 'MEGAcmdServer.exe'");
    expect(script).toContain('\\\\.nearbytes-dev\\\\megacmd\\\\');
  });

  it('builds watchdog PowerShell that only targets the current app pid and managed daemons', () => {
    const script = buildManagedMegaServerWatchdogPowerShell(1234, 5000);
    expect(script).toContain('Start-Sleep -Milliseconds 5000');
    expect(script).toContain('$pidToKill = 1234');
    expect(script).toContain("$_.Name -ne 'MEGAcmdServer.exe'");
    expect(script).toContain('\\\\.nearbytes\\\\helpers\\\\megacmd\\\\');
  });
});
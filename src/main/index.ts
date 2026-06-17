/** Electron entry — boots the NearBytes runtime, window, tray, and IPC. */
import { app, BrowserWindow } from 'electron';
import { NearbytesService } from './service.js';
import { registerIpc } from './ipc.js';
import { createWindow } from './window.js';
import { createTray, bindWindowCloseToTray } from './tray.js';
import { IPC, type PushEvent } from '../shared/ipc.js';

let win: BrowserWindow | null = null;
let service: NearbytesService | null = null;

// Linux dev environments without setuid sandbox (common on remote/ephemeral hosts)
// need this to launch Electron without root-owned chrome-sandbox.
if (process.platform === 'linux' && !app.isPackaged && process.env.NEARBYTES_ELECTRON_SANDBOX !== '1') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
}

function emit(e: PushEvent): void {
  win?.webContents.send(IPC.event, e);
}

function show(): void {
  if (win === null || win.isDestroyed()) win = createWindow();
  win.show();
  win.focus();
}

app.whenReady().then(async () => {
  service = await NearbytesService.boot(emit);
  registerIpc(service);

  win = createWindow();
  bindWindowCloseToTray(win);
  createTray(show);

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) show(); });
});

// Keep running with no windows (tray-resident); quit only on explicit request.
app.on('window-all-closed', () => { /* stay alive in the tray */ });

app.on('before-quit', () => { (app as unknown as { isQuitting: boolean }).isQuitting = true; });
app.on('will-quit', () => { void service?.destroy(); });

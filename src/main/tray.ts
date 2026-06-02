/**
 * Portable tray / status indicator. Keeps the app running when the window is
 * closed (macOS menu bar, Windows system tray, Linux desktop status area).
 */
import { Tray, Menu, nativeImage, app, type BrowserWindow } from 'electron';

let tray: Tray | null = null;

export function createTray(show: () => void): Tray {
  // 1×1 transparent placeholder — replace with a templated icon asset later.
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('NearBytes');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open NearBytes', click: show },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.exit(0); } }
    ])
  );
  tray.on('click', show);
  return tray;
}

export function bindWindowCloseToTray(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (!(app as unknown as { isQuitting?: boolean }).isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

import electronUpdater from 'electron-updater';
import { dialog, type BrowserWindow } from 'electron';

const { autoUpdater } = electronUpdater;

export function setupAutoUpdater(window: BrowserWindow, enabled: boolean): void {
  if (!enabled) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (error) => {
    console.warn(`Auto-update check failed: ${error.message}`);
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`Update available: ${info.version}`);
  });

  autoUpdater.on('update-downloaded', () => {
    void dialog
      .showMessageBox(window, {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update ready',
        message: 'A new Nearbytes update has been downloaded.',
        detail: 'Restart to install the update.',
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  void autoUpdater.checkForUpdatesAndNotify();
}

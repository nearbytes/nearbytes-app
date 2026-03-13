import { describe, expect, it } from 'vitest';
import { APP_CONFIG, isProviderEnabled } from '../appConfig.js';

describe('appConfig', () => {
  it('disables Google Drive by default in compiled app config', () => {
    expect(APP_CONFIG.features.providers.googleDrive).toBe(false);
    expect(isProviderEnabled('gdrive')).toBe(false);
    expect(isProviderEnabled('google-drive')).toBe(false);
  });

  it('keeps other shipped providers enabled', () => {
    expect(isProviderEnabled('mega')).toBe(true);
    expect(isProviderEnabled('github')).toBe(true);
  });
});

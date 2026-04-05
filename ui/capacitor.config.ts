import type { CapacitorConfig } from '@capacitor/cli';

const remoteServerUrl = process.env.NEARBYTES_MOBILE_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: 'org.nearbytes.mobile',
  appName: 'Nearbytes',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
  },
  server: remoteServerUrl
    ? {
        url: remoteServerUrl,
        cleartext: remoteServerUrl.startsWith('http://'),
        allowNavigation: ['*'],
      }
    : undefined,
};

export default config;
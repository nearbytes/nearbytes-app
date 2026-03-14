export const APP_CONFIG = {
  features: {
    providers: {
      googleDrive: false,
      mega: true,
      github: true,
    },
    performance: {
      appMetrics: false,
    },
  },
} as const;

export function isProviderEnabled(provider: string): boolean {
  switch (normalizeProvider(provider)) {
    case 'gdrive':
    case 'google-drive':
    case 'google_drive':
    case 'googledrive':
      return APP_CONFIG.features.providers.googleDrive;
    case 'mega':
      return APP_CONFIG.features.providers.mega;
    case 'github':
      return APP_CONFIG.features.providers.github;
    default:
      return true;
  }
}

function normalizeProvider(value: string): string {
  return value.trim().toLowerCase();
}

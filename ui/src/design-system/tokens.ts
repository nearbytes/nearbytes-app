export type DesignMoodboardPalette = {
  bg: string;
  paper: string;
  panel: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  glow: string;
};

export type DesignMoodboardTypography = {
  display: string;
  body: string;
  mono: string;
  displayLabel: string;
  bodyLabel: string;
  monoLabel: string;
};

export type DesignMoodboardChrome = {
  styleLabel: string;
  shellLabel: string;
  radiusXl: string;
  radiusLg: string;
  radiusMd: string;
  radiusSm: string;
  radiusPill: string;
  blur: string;
  overlayBlur: string;
  shadowLg: string;
  shadowMd: string;
  shadowSm: string;
};

export type DesignMoodboardMotion = {
  fast: string;
  medium: string;
  slow: string;
};

export type DesignMoodboardSpace = {
  pageInset: string;
  panelGap: string;
  panelPadding: string;
  clusterGap: string;
};

export type DesignMoodboard = {
  id: string;
  name: string;
  summary: string;
  notes: string[];
  palette: DesignMoodboardPalette;
  typography: DesignMoodboardTypography;
  chrome: DesignMoodboardChrome;
  motion: DesignMoodboardMotion;
  space: DesignMoodboardSpace;
};

export const DESIGN_MOODBOARDS: DesignMoodboard[] = [
  {
    id: 'linen-ledger',
    name: 'Linen Ledger',
    summary: 'Editorial, tactile, calm, paper-first.',
    notes: [
      'Soft daylight, cream paper, brass accent',
      'Quiet luxury without dashboard chrome',
      'Readable long-form density',
    ],
    palette: {
      bg: '#f3ede2',
      paper: 'rgba(255, 251, 245, 0.92)',
      panel: 'rgba(255, 255, 255, 0.78)',
      ink: '#17130f',
      muted: '#6d645d',
      line: 'rgba(41, 31, 23, 0.12)',
      accent: '#245e91',
      accentStrong: '#164162',
      accentSoft: 'rgba(36, 94, 145, 0.12)',
      glow: 'rgba(36, 94, 145, 0.18)',
    },
    typography: {
      display: '"Iowan Old Style", "Palatino Linotype", serif',
      body: '"IBM Plex Sans", "Avenir Next", sans-serif',
      mono: '"IBM Plex Mono", monospace',
      displayLabel: 'Iowan Old Style',
      bodyLabel: 'IBM Plex Sans',
      monoLabel: 'IBM Plex Mono',
    },
    chrome: {
      styleLabel: 'Warm glass',
      shellLabel: 'Cream paper surfaces with long editorial shadows',
      radiusXl: '28px',
      radiusLg: '20px',
      radiusMd: '14px',
      radiusSm: '10px',
      radiusPill: '999px',
      blur: '14px',
      overlayBlur: '4px',
      shadowLg: '0 28px 70px rgba(34, 25, 18, 0.12)',
      shadowMd: '0 18px 38px rgba(34, 25, 18, 0.08)',
      shadowSm: '0 10px 24px rgba(34, 25, 18, 0.06)',
    },
    motion: {
      fast: '160ms',
      medium: '180ms',
      slow: '240ms',
    },
    space: {
      pageInset: '24px',
      panelGap: '18px',
      panelPadding: '22px',
      clusterGap: '10px',
    },
  },
  {
    id: 'signal-stone',
    name: 'Signal Stone',
    summary: 'Sharper contrast, denser information, clearer system feel.',
    notes: [
      'Stone, graphite, electric blue',
      'Operational confidence over romance',
      'Harder edges and stronger dividers',
    ],
    palette: {
      bg: '#ece8df',
      paper: 'rgba(252, 250, 246, 0.94)',
      panel: 'rgba(255, 255, 255, 0.86)',
      ink: '#101113',
      muted: '#5e646c',
      line: 'rgba(18, 22, 29, 0.12)',
      accent: '#1472c4',
      accentStrong: '#0d4c83',
      accentSoft: 'rgba(20, 114, 196, 0.12)',
      glow: 'rgba(20, 114, 196, 0.20)',
    },
    typography: {
      display: '"Fraunces", "Iowan Old Style", serif',
      body: '"IBM Plex Sans", "Avenir Next", sans-serif',
      mono: '"IBM Plex Mono", monospace',
      displayLabel: 'Fraunces',
      bodyLabel: 'IBM Plex Sans',
      monoLabel: 'IBM Plex Mono',
    },
    chrome: {
      styleLabel: 'Signal glass',
      shellLabel: 'Denser panels, tighter corners, stronger dividers',
      radiusXl: '24px',
      radiusLg: '18px',
      radiusMd: '12px',
      radiusSm: '10px',
      radiusPill: '999px',
      blur: '12px',
      overlayBlur: '3px',
      shadowLg: '0 24px 56px rgba(16, 17, 19, 0.12)',
      shadowMd: '0 16px 32px rgba(16, 17, 19, 0.08)',
      shadowSm: '0 8px 18px rgba(16, 17, 19, 0.06)',
    },
    motion: {
      fast: '140ms',
      medium: '170ms',
      slow: '220ms',
    },
    space: {
      pageInset: '22px',
      panelGap: '16px',
      panelPadding: '20px',
      clusterGap: '9px',
    },
  },
  {
    id: 'harbor-night',
    name: 'Harbor Night',
    summary: 'Cooler, cinematic, but still light-mode first.',
    notes: [
      'Mist blue, slate, shell white',
      'Atmosphere without losing legibility',
      'More pronounced gradient depth',
    ],
    palette: {
      bg: '#e7edf1',
      paper: 'rgba(252, 255, 255, 0.90)',
      panel: 'rgba(255, 255, 255, 0.84)',
      ink: '#162028',
      muted: '#5f6f7d',
      line: 'rgba(21, 37, 48, 0.12)',
      accent: '#0d7e8f',
      accentStrong: '#07505b',
      accentSoft: 'rgba(13, 126, 143, 0.12)',
      glow: 'rgba(13, 126, 143, 0.18)',
    },
    typography: {
      display: '"Cormorant Garamond", "Iowan Old Style", serif',
      body: '"IBM Plex Sans", "Avenir Next", sans-serif',
      mono: '"IBM Plex Mono", monospace',
      displayLabel: 'Cormorant Garamond',
      bodyLabel: 'IBM Plex Sans',
      monoLabel: 'IBM Plex Mono',
    },
    chrome: {
      styleLabel: 'Mist glass',
      shellLabel: 'Cool gradients, deeper blur, lighter atmospheric chrome',
      radiusXl: '30px',
      radiusLg: '22px',
      radiusMd: '16px',
      radiusSm: '12px',
      radiusPill: '999px',
      blur: '16px',
      overlayBlur: '5px',
      shadowLg: '0 28px 64px rgba(21, 37, 48, 0.10)',
      shadowMd: '0 18px 36px rgba(21, 37, 48, 0.08)',
      shadowSm: '0 10px 22px rgba(21, 37, 48, 0.06)',
    },
    motion: {
      fast: '180ms',
      medium: '220ms',
      slow: '280ms',
    },
    space: {
      pageInset: '24px',
      panelGap: '18px',
      panelPadding: '22px',
      clusterGap: '10px',
    },
  },
];

function buildAtmosphere(palette: DesignMoodboardPalette): string {
  return [
    `radial-gradient(circle at top, rgba(255,250,243,0.98) 0%, color-mix(in srgb, ${palette.bg} 88%, white) 48%, ${palette.bg} 100%)`,
    `linear-gradient(180deg, color-mix(in srgb, ${palette.bg} 72%, white), ${palette.bg})`,
  ].join(',');
}

function buildCardSurface(palette: DesignMoodboardPalette): string {
  return `color-mix(in srgb, ${palette.paper} 92%, white)`;
}

function buildPanelSurface(palette: DesignMoodboardPalette): string {
  return `color-mix(in srgb, ${palette.panel} 96%, white)`;
}

export function defaultDesignMoodboard(): DesignMoodboard {
  return DESIGN_MOODBOARDS[0];
}

export function findDesignMoodboard(id: string | null | undefined): DesignMoodboard {
  return DESIGN_MOODBOARDS.find((entry) => entry.id === id) ?? defaultDesignMoodboard();
}

export function designMoodboardVariables(moodboard: DesignMoodboard): Record<string, string> {
  const { palette, typography, chrome, motion, space } = moodboard;
  return {
    '--nb-font-display': typography.display,
    '--nb-font-body': typography.body,
    '--nb-font-mono': typography.mono,
    '--nb-radius-xl': chrome.radiusXl,
    '--nb-radius-lg': chrome.radiusLg,
    '--nb-radius-md': chrome.radiusMd,
    '--nb-radius-sm': chrome.radiusSm,
    '--nb-radius-pill': chrome.radiusPill,
    '--nb-surface-blur': chrome.blur,
    '--nb-overlay-blur': chrome.overlayBlur,
    '--nb-shadow-lg': chrome.shadowLg,
    '--nb-shadow-md': chrome.shadowMd,
    '--nb-shadow-sm': chrome.shadowSm,
    '--nb-motion-fast': motion.fast,
    '--nb-motion-medium': motion.medium,
    '--nb-motion-slow': motion.slow,
    '--nb-space-page': space.pageInset,
    '--nb-space-panel-gap': space.panelGap,
    '--nb-space-panel-padding': space.panelPadding,
    '--nb-space-cluster-gap': space.clusterGap,
    '--nb-app-bg': palette.bg,
    '--nb-shell-top': palette.paper,
    '--nb-shell-bottom': palette.panel,
    '--nb-panel-bg': buildPanelSurface(palette),
    '--nb-card-bg': buildCardSurface(palette),
    '--nb-border': palette.line,
    '--nb-text-main': palette.ink,
    '--nb-text-soft': palette.muted,
    '--nb-text-faint': palette.muted,
    '--nb-accent': palette.accent,
    '--nb-accent-strong': palette.accentStrong,
    '--nb-accent-soft': palette.accentSoft,
    '--nb-glow': palette.glow,
    '--ds-paper': palette.paper,
    '--ds-panel': palette.panel,
    '--ds-line': palette.line,
    '--ds-ink': palette.ink,
    '--ds-muted': palette.muted,
    '--ds-accent': palette.accent,
    '--ds-accent-soft': palette.accentSoft,
    '--ds-panel-bg': buildPanelSurface(palette),
    '--ds-card-bg': buildCardSurface(palette),
    '--ds-atmosphere': buildAtmosphere(palette),
  };
}

export function applyDesignMoodboardVariables(root: CSSStyleDeclaration, moodboard: DesignMoodboard): void {
  Object.entries(designMoodboardVariables(moodboard)).forEach(([key, value]) => {
    root.setProperty(key, value);
  });
}
import type { MoodboardId } from '../state/types.js';

export type PaletteTokens = {
  canvas: string;
  canvasGlow: string;
  shellTop: string;
  shellBottom: string;
  surface: string;
  surfaceStrong: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  text: string;
  textSoft: string;
  textFaint: string;
  success: string;
  warning: string;
  danger: string;
};

export type TypographyTokens = {
  displayFont: string;
  bodyFont: string;
  monoFont: string;
  displayWeight: string;
  headingWeight: string;
  bodyWeight: string;
  tracking: string;
  scale: Array<{ label: string; size: string; lineHeight: string; use: string }>;
};

export type ChromeTokens = {
  shellRadius: string;
  panelRadius: string;
  dialogRadius: string;
  itemRadius: string;
  controlRadius: string;
  frameRadius: string;
  shadowPanel: string;
  shadowFrame: string;
  contrastSoft: string;
  contrastStrong: string;
  scrollbarSize: string;
  scrollbarInset: string;
  scrollbarTrack: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
};

export type Moodboard = {
  id: MoodboardId;
  mode: 'light' | 'dark';
  label: string;
  tagline: string;
  summary: string;
  palette: PaletteTokens;
  typography: TypographyTokens;
  chrome: ChromeTokens;
  atmosphere: string[];
};

const TYPE_SCALE = [
  { label: 'Display', size: '3.2rem', lineHeight: '0.96', use: 'Page hero and surface headers' },
  { label: 'Title', size: '1.6rem', lineHeight: '1.08', use: 'Section titles and dialogs' },
  { label: 'Body', size: '1rem', lineHeight: '1.55', use: 'Primary prose and panel descriptions' },
  { label: 'Meta', size: '0.82rem', lineHeight: '1.35', use: 'Badges, labels, timestamps' },
];

export const MOODBOARDS: Moodboard[] = [
  {
    id: 'quartz-light',
    mode: 'light',
    label: 'Quartz Light',
    tagline: 'Soft neutral chrome with the familiar iOS blue accent.',
    summary: 'A clean light system with modern platform-grade surfaces: quiet, bright, and highly legible.',
    atmosphere: ['platform', 'clean', 'familiar'],
    palette: {
      canvas: '#f2f2f7',
      canvasGlow: '#f2f2f7',
      shellTop: '#f5f5f7',
      shellBottom: '#f5f5f7',
      surface: '#fbfbfd',
      surfaceStrong: '#ffffff',
      border: '#d7d9df',
      borderStrong: '#bcc1ca',
      accent: '#007aff',
      accentStrong: '#0059c7',
      accentSoft: '#d9ecff',
      text: '#1d1d1f',
      textSoft: '#5f6368',
      textFaint: '#8e8e93',
      success: '#248a53',
      warning: '#9c6b16',
      danger: '#d93025',
    },
    typography: {
      displayFont: '"SF Pro Display", "Inter", sans-serif',
      bodyFont: '"IBM Plex Sans", "Segoe UI", sans-serif',
      monoFont: '"IBM Plex Mono", monospace',
      displayWeight: '700',
      headingWeight: '600',
      bodyWeight: '400',
      tracking: '-0.015em',
      scale: TYPE_SCALE,
    },
    chrome: {
      shellRadius: '34px',
      panelRadius: '24px',
      dialogRadius: '28px',
      itemRadius: '18px',
      controlRadius: '999px',
      frameRadius: '42px',
      shadowPanel: '0 18px 50px rgba(30, 38, 50, 0.1)',
      shadowFrame: '0 24px 60px rgba(24, 32, 44, 0.18)',
      contrastSoft: '18%',
      contrastStrong: '30%',
      scrollbarSize: '0.78rem',
      scrollbarInset: '0.2rem',
      scrollbarTrack: 'color-mix(in srgb, var(--nb-surface-strong) 78%, transparent)',
      scrollbarThumb: 'color-mix(in srgb, var(--nb-border-strong) 72%, var(--nb-accent) 16%)',
      scrollbarThumbHover: 'color-mix(in srgb, var(--nb-accent) 28%, var(--nb-border-strong))',
    },
  },
  {
    id: 'slate-day',
    mode: 'light',
    label: 'Slate Day',
    tagline: 'Cool paper neutrals with a restrained product-blue signal.',
    summary: 'A serious desktop-app light palette with reduced gloss and stronger editorial neutrality.',
    atmosphere: ['neutral', 'professional', 'controlled'],
    palette: {
      canvas: '#eef1f5',
      canvasGlow: '#eef1f5',
      shellTop: '#f4f6f9',
      shellBottom: '#f4f6f9',
      surface: '#f9fafc',
      surfaceStrong: '#ffffff',
      border: '#d1d8e0',
      borderStrong: '#b0bcc8',
      accent: '#2f6feb',
      accentStrong: '#194fb6',
      accentSoft: '#dbe7ff',
      text: '#111827',
      textSoft: '#4b5563',
      textFaint: '#7b8794',
      success: '#237b59',
      warning: '#9c6a14',
      danger: '#c2413c',
    },
    typography: {
      displayFont: '"Plus Jakarta Sans", "Inter", sans-serif',
      bodyFont: '"IBM Plex Sans", "Segoe UI", sans-serif',
      monoFont: '"IBM Plex Mono", monospace',
      displayWeight: '700',
      headingWeight: '600',
      bodyWeight: '400',
      tracking: '-0.012em',
      scale: TYPE_SCALE,
    },
    chrome: {
      shellRadius: '28px',
      panelRadius: '20px',
      dialogRadius: '24px',
      itemRadius: '16px',
      controlRadius: '14px',
      frameRadius: '34px',
      shadowPanel: '0 14px 34px rgba(25, 37, 52, 0.09)',
      shadowFrame: '0 22px 48px rgba(20, 31, 44, 0.16)',
      contrastSoft: '14%',
      contrastStrong: '24%',
      scrollbarSize: '0.72rem',
      scrollbarInset: '0.18rem',
      scrollbarTrack: 'color-mix(in srgb, var(--nb-surface-strong) 84%, transparent)',
      scrollbarThumb: 'color-mix(in srgb, var(--nb-border-strong) 80%, var(--nb-accent) 10%)',
      scrollbarThumbHover: 'color-mix(in srgb, var(--nb-accent) 20%, var(--nb-border-strong))',
    },
  },
  {
    id: 'sand',
    mode: 'light',
    label: 'Sand',
    tagline: 'Warm off-white surfaces with a muted bronze accent.',
    summary: 'A softer light palette for apps that need warmth without drifting into lifestyle branding.',
    atmosphere: ['warm', 'quiet', 'freeform'],
    palette: {
      canvas: '#f3efe8',
      canvasGlow: '#f3efe8',
      shellTop: '#f8f4ee',
      shellBottom: '#f8f4ee',
      surface: '#fcfaf6',
      surfaceStrong: '#fffdfa',
      border: '#d9cfc1',
      borderStrong: '#baab96',
      accent: '#9a6a3a',
      accentStrong: '#6d471f',
      accentSoft: '#eadccf',
      text: '#1f1914',
      textSoft: '#5e5246',
      textFaint: '#8d7d70',
      success: '#2a7a58',
      warning: '#95680f',
      danger: '#ba4a3d',
    },
    typography: {
      displayFont: '"Manrope", "Inter", sans-serif',
      bodyFont: '"IBM Plex Sans", "Segoe UI", sans-serif',
      monoFont: '"IBM Plex Mono", monospace',
      displayWeight: '700',
      headingWeight: '600',
      bodyWeight: '400',
      tracking: '-0.015em',
      scale: TYPE_SCALE,
    },
    chrome: {
      shellRadius: '32px',
      panelRadius: '24px',
      dialogRadius: '26px',
      itemRadius: '18px',
      controlRadius: '999px',
      frameRadius: '40px',
      shadowPanel: '0 16px 42px rgba(68, 48, 26, 0.12)',
      shadowFrame: '0 24px 54px rgba(66, 46, 24, 0.18)',
      contrastSoft: '16%',
      contrastStrong: '26%',
      scrollbarSize: '0.8rem',
      scrollbarInset: '0.2rem',
      scrollbarTrack: 'color-mix(in srgb, var(--nb-surface-strong) 74%, transparent)',
      scrollbarThumb: 'color-mix(in srgb, var(--nb-border-strong) 64%, var(--nb-accent) 24%)',
      scrollbarThumbHover: 'color-mix(in srgb, var(--nb-accent) 34%, var(--nb-border-strong))',
    },
  },
  {
    id: 'graphite-night',
    mode: 'dark',
    label: 'Graphite Night',
    tagline: 'Graphite surfaces with a familiar system-blue accent.',
    summary: 'A dark system aligned with modern platform surfaces: polished, readable, and understated.',
    atmosphere: ['platform', 'dark', 'polished'],
    palette: {
      canvas: '#000000',
      canvasGlow: '#000000',
      shellTop: '#1c1c1e',
      shellBottom: '#1c1c1e',
      surface: '#1c1c1e',
      surfaceStrong: '#2c2c2e',
      border: '#3a3a3c',
      borderStrong: '#545458',
      accent: '#0a84ff',
      accentStrong: '#8ec8ff',
      accentSoft: '#123a60',
      text: '#f5f5f7',
      textSoft: '#c7c7cc',
      textFaint: '#8e8e93',
      success: '#30d158',
      warning: '#ff9f0a',
      danger: '#ff453a',
    },
    typography: {
      displayFont: '"SF Pro Display", "Inter", sans-serif',
      bodyFont: '"IBM Plex Sans", "Segoe UI", sans-serif',
      monoFont: '"IBM Plex Mono", monospace',
      displayWeight: '700',
      headingWeight: '600',
      bodyWeight: '400',
      tracking: '-0.015em',
      scale: TYPE_SCALE,
    },
    chrome: {
      shellRadius: '30px',
      panelRadius: '22px',
      dialogRadius: '26px',
      itemRadius: '16px',
      controlRadius: '14px',
      frameRadius: '36px',
      shadowPanel: '0 18px 48px rgba(0, 0, 0, 0.34)',
      shadowFrame: '0 28px 64px rgba(0, 0, 0, 0.42)',
      contrastSoft: '12%',
      contrastStrong: '20%',
      scrollbarSize: '0.72rem',
      scrollbarInset: '0.18rem',
      scrollbarTrack: 'color-mix(in srgb, var(--nb-surface-strong) 44%, transparent)',
      scrollbarThumb: 'color-mix(in srgb, var(--nb-border-strong) 74%, var(--nb-accent) 14%)',
      scrollbarThumbHover: 'color-mix(in srgb, var(--nb-accent) 26%, var(--nb-border-strong))',
    },
  },
  {
    id: 'workbench',
    mode: 'dark',
    label: 'Workbench',
    tagline: 'A VS Code-like dark workbench with clear blue focus states.',
    summary: 'Modeled on VS Code standards for long coding sessions: low noise, familiar hierarchy, and stable contrast.',
    atmosphere: ['vscode', 'familiar', 'functional'],
    palette: {
      canvas: '#1e1e1e',
      canvasGlow: '#1e1e1e',
      shellTop: '#252526',
      shellBottom: '#252526',
      surface: '#252526',
      surfaceStrong: '#2d2d30',
      border: '#3c3c3c',
      borderStrong: '#4e4e50',
      accent: '#3794ff',
      accentStrong: '#a6d1ff',
      accentSoft: '#082e52',
      text: '#cccccc',
      textSoft: '#9da1a6',
      textFaint: '#6b6f76',
      success: '#4ec9b0',
      warning: '#cca700',
      danger: '#f14c4c',
    },
    typography: {
      displayFont: '"Segoe UI", "Inter", sans-serif',
      bodyFont: '"IBM Plex Sans", "Segoe UI", sans-serif',
      monoFont: '"IBM Plex Mono", monospace',
      displayWeight: '600',
      headingWeight: '600',
      bodyWeight: '400',
      tracking: '-0.005em',
      scale: TYPE_SCALE,
    },
    chrome: {
      shellRadius: '22px',
      panelRadius: '16px',
      dialogRadius: '20px',
      itemRadius: '12px',
      controlRadius: '10px',
      frameRadius: '28px',
      shadowPanel: '0 10px 24px rgba(0, 0, 0, 0.26)',
      shadowFrame: '0 18px 42px rgba(0, 0, 0, 0.34)',
      contrastSoft: '10%',
      contrastStrong: '18%',
      scrollbarSize: '0.68rem',
      scrollbarInset: '0.16rem',
      scrollbarTrack: 'color-mix(in srgb, var(--nb-surface-strong) 36%, transparent)',
      scrollbarThumb: 'color-mix(in srgb, var(--nb-border-strong) 88%, var(--nb-accent) 8%)',
      scrollbarThumbHover: 'color-mix(in srgb, var(--nb-accent) 16%, var(--nb-border-strong))',
    },
  },
  {
    id: 'pine-night',
    mode: 'dark',
    label: 'Pine Night',
    tagline: 'Deep green-black surfaces with a muted mint accent.',
    summary: 'The freeform option: distinctive without being loud, with a calmer identity than blue-led dark themes.',
    atmosphere: ['freeform', 'calm', 'distinct'],
    palette: {
      canvas: '#0d1413',
      canvasGlow: '#0d1413',
      shellTop: '#13201d',
      shellBottom: '#13201d',
      surface: '#152421',
      surfaceStrong: '#1b2d29',
      border: '#294440',
      borderStrong: '#3b605b',
      accent: '#49a38d',
      accentStrong: '#b7eadf',
      accentSoft: '#1a4138',
      text: '#ecf8f5',
      textSoft: '#bfd3ce',
      textFaint: '#839b95',
      success: '#73d39b',
      warning: '#ddbb63',
      danger: '#ef8f84',
    },
    typography: {
      displayFont: '"Sora", "Inter", sans-serif',
      bodyFont: '"IBM Plex Sans", "Segoe UI", sans-serif',
      monoFont: '"IBM Plex Mono", monospace',
      displayWeight: '700',
      headingWeight: '600',
      bodyWeight: '400',
      tracking: '-0.015em',
      scale: TYPE_SCALE,
    },
    chrome: {
      shellRadius: '28px',
      panelRadius: '20px',
      dialogRadius: '24px',
      itemRadius: '16px',
      controlRadius: '14px',
      frameRadius: '34px',
      shadowPanel: '0 16px 40px rgba(4, 18, 14, 0.28)',
      shadowFrame: '0 24px 56px rgba(3, 16, 12, 0.36)',
      contrastSoft: '12%',
      contrastStrong: '22%',
      scrollbarSize: '0.72rem',
      scrollbarInset: '0.18rem',
      scrollbarTrack: 'color-mix(in srgb, var(--nb-surface-strong) 42%, transparent)',
      scrollbarThumb: 'color-mix(in srgb, var(--nb-border-strong) 76%, var(--nb-accent) 16%)',
      scrollbarThumbHover: 'color-mix(in srgb, var(--nb-accent) 28%, var(--nb-border-strong))',
    },
  },
];

function expandHex(value: string): string {
  if (value.length === 4 || value.length === 5) {
    return `#${value.slice(1).split('').map((part) => part + part).join('')}`;
  }
  return value;
}

function hexToRgb(value: string): [number, number, number] {
  const normalized = expandHex(value.trim());
  if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(normalized)) {
    throw new Error(`Contrast validation requires solid hex colors, received ${value}`);
  }

  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ];
}

function channelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(value: string): number {
  const [red, green, blue] = hexToRgb(value);
  return 0.2126 * channelToLinear(red) + 0.7152 * channelToLinear(green) + 0.0722 * channelToLinear(blue);
}

function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
}

function assertContrast(label: string, foreground: string, background: string, minimum: number) {
  const ratio = contrastRatio(foreground, background);
  if (ratio < minimum) {
    throw new Error(`${label} contrast ${ratio.toFixed(2)} is below ${minimum.toFixed(1)}`);
  }
}

function validateMoodboards(boards: Moodboard[]) {
  const lightCount = boards.filter((board) => board.mode === 'light').length;
  const darkCount = boards.filter((board) => board.mode === 'dark').length;

  if (lightCount !== 3 || darkCount !== 3) {
    throw new Error(`Expected exactly 3 light and 3 dark moodboards, received ${lightCount} light and ${darkCount} dark`);
  }

  for (const board of boards) {
    assertContrast(`${board.label} text on surface`, board.palette.text, board.palette.surface, 7);
    assertContrast(`${board.label} text on surfaceStrong`, board.palette.text, board.palette.surfaceStrong, 7);
    assertContrast(`${board.label} textSoft on surfaceStrong`, board.palette.textSoft, board.palette.surfaceStrong, 4.5);
    assertContrast(`${board.label} accentStrong on accentSoft`, board.palette.accentStrong, board.palette.accentSoft, 4.5);
  }
}

validateMoodboards(MOODBOARDS);

export const MOODBOARD_BY_ID = Object.fromEntries(MOODBOARDS.map((board) => [board.id, board])) as Record<
  MoodboardId,
  Moodboard
>;

export function buildThemeStyle(id: MoodboardId): string {
  const board = MOODBOARD_BY_ID[id];
  return [
    `--nb-canvas:${board.palette.canvas}`,
    `--nb-canvas-glow:${board.palette.canvasGlow}`,
    `--nb-shell-top:${board.palette.shellTop}`,
    `--nb-shell-bottom:${board.palette.shellBottom}`,
    `--nb-surface:${board.palette.surface}`,
    `--nb-surface-strong:${board.palette.surfaceStrong}`,
    `--nb-border:${board.palette.border}`,
    `--nb-border-strong:${board.palette.borderStrong}`,
    `--nb-accent:${board.palette.accent}`,
    `--nb-accent-strong:${board.palette.accentStrong}`,
    `--nb-accent-soft:${board.palette.accentSoft}`,
    `--nb-text:${board.palette.text}`,
    `--nb-text-soft:${board.palette.textSoft}`,
    `--nb-text-faint:${board.palette.textFaint}`,
    `--nb-success:${board.palette.success}`,
    `--nb-warning:${board.palette.warning}`,
    `--nb-danger:${board.palette.danger}`,
    `--nb-font-display:${board.typography.displayFont}`,
    `--nb-font-body:${board.typography.bodyFont}`,
    `--nb-font-mono:${board.typography.monoFont}`,
    `--nb-font-display-weight:${board.typography.displayWeight}`,
    `--nb-font-heading-weight:${board.typography.headingWeight}`,
    `--nb-font-body-weight:${board.typography.bodyWeight}`,
    `--nb-font-tracking:${board.typography.tracking}`,
    `--nb-radius-shell:${board.chrome.shellRadius}`,
    `--nb-radius-panel:${board.chrome.panelRadius}`,
    `--nb-radius-dialog:${board.chrome.dialogRadius}`,
    `--nb-radius-item:${board.chrome.itemRadius}`,
    `--nb-radius-control:${board.chrome.controlRadius}`,
    `--nb-radius-frame:${board.chrome.frameRadius}`,
    `--nb-shadow-panel:${board.chrome.shadowPanel}`,
    `--nb-shadow-frame:${board.chrome.shadowFrame}`,
    `--nb-chrome-contrast-soft:${board.chrome.contrastSoft}`,
    `--nb-chrome-contrast-strong:${board.chrome.contrastStrong}`,
    `--nb-scrollbar-size:${board.chrome.scrollbarSize}`,
    `--nb-scrollbar-inset:${board.chrome.scrollbarInset}`,
    `--nb-scrollbar-track:${board.chrome.scrollbarTrack}`,
    `--nb-scrollbar-thumb:${board.chrome.scrollbarThumb}`,
    `--nb-scrollbar-thumb-hover:${board.chrome.scrollbarThumbHover}`,
  ].join(';');
}

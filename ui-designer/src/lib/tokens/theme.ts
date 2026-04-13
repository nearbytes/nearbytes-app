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

export type Moodboard = {
  id: MoodboardId;
  mode: 'light' | 'dark';
  label: string;
  tagline: string;
  summary: string;
  palette: PaletteTokens;
  typography: TypographyTokens;
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
    id: 'apple-light',
    mode: 'light',
    label: 'Apple Light',
    tagline: 'Soft neutral chrome with the familiar iOS blue accent.',
    summary: 'A clean light system modeled on current Apple product surfaces: quiet, bright, and highly legible.',
    atmosphere: ['apple-like', 'clean', 'familiar'],
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
  },
  {
    id: 'slate-day',
    mode: 'light',
    label: 'Slate Day',
    tagline: 'Cool paper neutrals with a restrained product-blue signal.',
    summary: 'A serious desktop-app light palette with less gloss than Apple and more editorial neutrality.',
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
  },
  {
    id: 'apple-dark',
    mode: 'dark',
    label: 'Apple Dark',
    tagline: 'Graphite surfaces with the familiar Apple blue accent.',
    summary: 'A dark system aligned with modern Apple product surfaces: polished, readable, and understated.',
    atmosphere: ['apple-like', 'dark', 'polished'],
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
  ].join(';');
}

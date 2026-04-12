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
    id: 'warm-ledger',
    label: 'Warm Ledger',
    tagline: 'Documentary trust with tactile copper signal.',
    summary: 'Paper-white surfaces, dark graphite text, and copper accents for a calm archival feel.',
    atmosphere: ['archival', 'crafted', 'clear'],
    palette: {
      canvas: '#f3efe7',
      canvasGlow: 'rgba(175, 114, 76, 0.18)',
      shellTop: '#fbf7f1',
      shellBottom: '#ebe3d8',
      surface: 'rgba(255, 251, 246, 0.88)',
      surfaceStrong: '#fffaf4',
      border: 'rgba(86, 70, 56, 0.15)',
      borderStrong: 'rgba(86, 70, 56, 0.26)',
      accent: '#a55d37',
      accentStrong: '#7c4324',
      accentSoft: 'rgba(165, 93, 55, 0.12)',
      text: '#231b16',
      textSoft: 'rgba(35, 27, 22, 0.72)',
      textFaint: 'rgba(35, 27, 22, 0.42)',
      success: '#267f57',
      warning: '#ba7b17',
      danger: '#b44738',
    },
    typography: {
      displayFont: '"Newsreader", serif',
      bodyFont: '"IBM Plex Sans", sans-serif',
      monoFont: '"IBM Plex Mono", monospace',
      displayWeight: '600',
      headingWeight: '600',
      bodyWeight: '400',
      tracking: '0.02em',
      scale: TYPE_SCALE,
    },
  },
  {
    id: 'signal-harbor',
    label: 'Signal Harbor',
    tagline: 'Network topology with a maritime pulse.',
    summary: 'Oceanic blues, teal relays, and crisp shells suited to sync-heavy surfaces.',
    atmosphere: ['networked', 'directional', 'confident'],
    palette: {
      canvas: '#e7f1f4',
      canvasGlow: 'rgba(42, 130, 126, 0.18)',
      shellTop: '#f3fafb',
      shellBottom: '#d7e7ea',
      surface: 'rgba(247, 252, 252, 0.86)',
      surfaceStrong: '#fbffff',
      border: 'rgba(19, 72, 84, 0.14)',
      borderStrong: 'rgba(19, 72, 84, 0.24)',
      accent: '#187d87',
      accentStrong: '#0f5e68',
      accentSoft: 'rgba(24, 125, 135, 0.13)',
      text: '#0c2530',
      textSoft: 'rgba(12, 37, 48, 0.7)',
      textFaint: 'rgba(12, 37, 48, 0.4)',
      success: '#198754',
      warning: '#b56d10',
      danger: '#b53d33',
    },
    typography: {
      displayFont: '"Space Grotesk", sans-serif',
      bodyFont: '"IBM Plex Sans", sans-serif',
      monoFont: '"IBM Plex Mono", monospace',
      displayWeight: '700',
      headingWeight: '600',
      bodyWeight: '400',
      tracking: '0.01em',
      scale: TYPE_SCALE,
    },
  },
  {
    id: 'quiet-workshop',
    label: 'Quiet Workshop',
    tagline: 'Maker-bench calm with earthy precision.',
    summary: 'Soft stone surfaces and workshop browns, designed to feel intentional rather than corporate.',
    atmosphere: ['tactile', 'humble', 'intentional'],
    palette: {
      canvas: '#ede8df',
      canvasGlow: 'rgba(126, 94, 58, 0.16)',
      shellTop: '#f7f3ec',
      shellBottom: '#e1d8ca',
      surface: 'rgba(252, 248, 241, 0.87)',
      surfaceStrong: '#fffaf1',
      border: 'rgba(72, 56, 39, 0.13)',
      borderStrong: 'rgba(72, 56, 39, 0.24)',
      accent: '#7d5b3f',
      accentStrong: '#60452f',
      accentSoft: 'rgba(125, 91, 63, 0.12)',
      text: '#211912',
      textSoft: 'rgba(33, 25, 18, 0.68)',
      textFaint: 'rgba(33, 25, 18, 0.38)',
      success: '#35765d',
      warning: '#af6d1e',
      danger: '#b34b39',
    },
    typography: {
      displayFont: '"Newsreader", serif',
      bodyFont: '"Space Grotesk", sans-serif',
      monoFont: '"IBM Plex Mono", monospace',
      displayWeight: '600',
      headingWeight: '500',
      bodyWeight: '400',
      tracking: '0.015em',
      scale: TYPE_SCALE,
    },
  },
  {
    id: 'polar-archive',
    label: 'Polar Archive',
    tagline: 'Cold-light legibility for long-form inspection.',
    summary: 'Clean white, steel, and blue tokens tuned for precise reading and dense state displays.',
    atmosphere: ['precise', 'archival', 'cool'],
    palette: {
      canvas: '#edf4fb',
      canvasGlow: 'rgba(82, 126, 182, 0.18)',
      shellTop: '#f7fbff',
      shellBottom: '#dce8f5',
      surface: 'rgba(252, 254, 255, 0.9)',
      surfaceStrong: '#ffffff',
      border: 'rgba(66, 98, 134, 0.14)',
      borderStrong: 'rgba(66, 98, 134, 0.24)',
      accent: '#406f9d',
      accentStrong: '#2d5378',
      accentSoft: 'rgba(64, 111, 157, 0.12)',
      text: '#132033',
      textSoft: 'rgba(19, 32, 51, 0.72)',
      textFaint: 'rgba(19, 32, 51, 0.42)',
      success: '#2d7f63',
      warning: '#ba791c',
      danger: '#b34439',
    },
    typography: {
      displayFont: '"Space Grotesk", sans-serif',
      bodyFont: '"IBM Plex Sans", sans-serif',
      monoFont: '"IBM Plex Mono", monospace',
      displayWeight: '700',
      headingWeight: '600',
      bodyWeight: '400',
      tracking: '0.008em',
      scale: TYPE_SCALE,
    },
  },
  {
    id: 'night-relay',
    label: 'Night Relay',
    tagline: 'Carbon shells with relay-light contrast.',
    summary: 'Low-light operational workspace with cyan emphasis and restrained alert tones.',
    atmosphere: ['focused', 'signal-rich', 'night'],
    palette: {
      canvas: '#091219',
      canvasGlow: 'rgba(60, 192, 204, 0.18)',
      shellTop: '#0c1b23',
      shellBottom: '#081017',
      surface: 'rgba(11, 24, 31, 0.82)',
      surfaceStrong: '#0f2028',
      border: 'rgba(168, 221, 228, 0.12)',
      borderStrong: 'rgba(168, 221, 228, 0.24)',
      accent: '#48bac4',
      accentStrong: '#7ad9df',
      accentSoft: 'rgba(72, 186, 196, 0.14)',
      text: '#effbfd',
      textSoft: 'rgba(239, 251, 253, 0.7)',
      textFaint: 'rgba(239, 251, 253, 0.42)',
      success: '#5dc48f',
      warning: '#e0ac44',
      danger: '#ea7964',
    },
    typography: {
      displayFont: '"Space Grotesk", sans-serif',
      bodyFont: '"IBM Plex Sans", sans-serif',
      monoFont: '"IBM Plex Mono", monospace',
      displayWeight: '700',
      headingWeight: '600',
      bodyWeight: '400',
      tracking: '0.01em',
      scale: TYPE_SCALE,
    },
  },
];

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

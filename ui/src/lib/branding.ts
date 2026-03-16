export type NearbytesArcStyle = 'dashed' | 'dotted' | 'solid';

export type NearbytesLogoOptions = {
  peers: number;
  accentColor: string;
  peerColor: string;
  arcColor: string;
  bgFill: string;
  nodeFill: string;
  nodeStroke: string;
  orbitScale: number;
  sizeScale: number;
  bulgeScale: number;
  lineWeight: number;
  circleStroke: number;
  pulseSpeed: number;
  pulseMag: number;
  luminosity: number;
  contrast: number;
  arcStyle: NearbytesArcStyle;
};

export type NearbytesPalette = {
  id: string;
  label: string;
  description: string;
  appBg: string;
  shellTop: string;
  shellBottom: string;
  shellGlow: string;
  panelBg: string;
  panelGlow: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  accentText: string;
  textMain: string;
  textSoft: string;
  textFaint: string;
  success: string;
  warning: string;
  danger: string;
};

export type NearbytesThemePresetId = 'blue-current' | 'amber-classic';

export type NearbytesThemeSettings = {
  presetId: NearbytesThemePresetId;
  palette: NearbytesPalette;
  logo: NearbytesLogoOptions;
};

const BLUE_PALETTE: NearbytesPalette = {
  id: 'blue-current',
  label: 'Blue Current',
  description: 'Cool cyan and steel tones tuned to the current shell.',
  appBg: '#060c18',
  shellTop: 'rgba(10, 22, 40, 0.98)',
  shellBottom: 'rgba(7, 13, 24, 0.98)',
  shellGlow: 'rgba(34, 211, 238, 0.14)',
  panelBg: 'rgba(9, 18, 34, 0.92)',
  panelGlow: 'rgba(34, 211, 238, 0.1)',
  border: 'rgba(111, 173, 252, 0.18)',
  borderStrong: 'rgba(45, 212, 191, 0.42)',
  accent: '#38bdf8',
  accentStrong: '#22d3ee',
  accentSoft: 'rgba(34, 211, 238, 0.14)',
  accentText: '#ecfeff',
  textMain: 'rgba(241, 245, 249, 0.96)',
  textSoft: 'rgba(191, 219, 254, 0.78)',
  textFaint: 'rgba(191, 219, 254, 0.62)',
  success: '#5eead4',
  warning: '#fde68a',
  danger: '#fecaca',
};

const AMBER_PALETTE: NearbytesPalette = {
  id: 'amber-classic',
  label: 'Amber Classic',
  description: 'Warm bronze and parchment tones based on the original logo treatment.',
  appBg: '#15110c',
  shellTop: 'rgba(32, 24, 16, 0.98)',
  shellBottom: 'rgba(20, 15, 10, 0.98)',
  shellGlow: 'rgba(200, 160, 74, 0.16)',
  panelBg: 'rgba(31, 24, 17, 0.92)',
  panelGlow: 'rgba(212, 176, 106, 0.09)',
  border: 'rgba(200, 160, 74, 0.2)',
  borderStrong: 'rgba(212, 176, 106, 0.42)',
  accent: '#c8a04a',
  accentStrong: '#d4b06a',
  accentSoft: 'rgba(212, 176, 106, 0.14)',
  accentText: '#fff4dd',
  textMain: 'rgba(251, 244, 226, 0.96)',
  textSoft: 'rgba(230, 214, 184, 0.78)',
  textFaint: 'rgba(205, 188, 161, 0.62)',
  success: '#bbf7d0',
  warning: '#fde68a',
  danger: '#fecaca',
};

const BLUE_LOGO: NearbytesLogoOptions = {
  peers: 3,
  accentColor: '#38bdf8',
  peerColor: '#67e8f9',
  arcColor: '#22d3ee',
  bgFill: '#08131f',
  nodeFill: '#102030',
  nodeStroke: '#36536f',
  orbitScale: 1.12,
  sizeScale: 1.27,
  bulgeScale: 1.18,
  lineWeight: 2.74,
  circleStroke: 2.42,
  pulseSpeed: 0.84,
  pulseMag: 1.18,
  luminosity: 6,
  contrast: 18,
  arcStyle: 'dashed',
};

const AMBER_LOGO: NearbytesLogoOptions = {
  peers: 3,
  accentColor: '#c8a04a',
  peerColor: '#d4b06a',
  arcColor: '#c8a04a',
  bgFill: '#1a1816',
  nodeFill: '#272420',
  nodeStroke: '#504c48',
  orbitScale: 1.12,
  sizeScale: 1.27,
  bulgeScale: 1.22,
  lineWeight: 2.87,
  circleStroke: 2.57,
  pulseSpeed: 0.81,
  pulseMag: 1.29,
  luminosity: 9,
  contrast: 26,
  arcStyle: 'dashed',
};

export const NEARBYTES_THEME_PRESETS: Record<NearbytesThemePresetId, NearbytesThemeSettings> = {
  'blue-current': {
    presetId: 'blue-current',
    palette: BLUE_PALETTE,
    logo: BLUE_LOGO,
  },
  'amber-classic': {
    presetId: 'amber-classic',
    palette: AMBER_PALETTE,
    logo: AMBER_LOGO,
  },
};

export const NEARBYTES_THEME_PRESET_LIST = Object.values(NEARBYTES_THEME_PRESETS);

export function cloneThemeSettings(settings: NearbytesThemeSettings): NearbytesThemeSettings {
  return {
    presetId: settings.presetId,
    palette: { ...settings.palette },
    logo: { ...settings.logo },
  };
}

export function defaultThemeSettings(): NearbytesThemeSettings {
  return cloneThemeSettings(NEARBYTES_THEME_PRESETS['blue-current']);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

export function normalizeThemeSettings(input: unknown): NearbytesThemeSettings {
  const base = defaultThemeSettings();
  const object = asObject(input);
  if (!object) {
    return base;
  }

  const presetId = object.presetId === 'amber-classic' ? 'amber-classic' : 'blue-current';
  const preset = cloneThemeSettings(NEARBYTES_THEME_PRESETS[presetId]);
  const paletteInput = asObject(object.palette);
  const logoInput = asObject(object.logo);

  if (paletteInput) {
    preset.palette = {
      ...preset.palette,
      accent: normalizeHexColor(paletteInput.accent, preset.palette.accent),
      accentStrong: normalizeHexColor(paletteInput.accentStrong, preset.palette.accentStrong),
      textMain: typeof paletteInput.textMain === 'string' ? paletteInput.textMain : preset.palette.textMain,
      textSoft: typeof paletteInput.textSoft === 'string' ? paletteInput.textSoft : preset.palette.textSoft,
      textFaint: typeof paletteInput.textFaint === 'string' ? paletteInput.textFaint : preset.palette.textFaint,
      appBg: normalizeHexColor(paletteInput.appBg, preset.palette.appBg),
      shellTop: typeof paletteInput.shellTop === 'string' ? paletteInput.shellTop : preset.palette.shellTop,
      shellBottom: typeof paletteInput.shellBottom === 'string' ? paletteInput.shellBottom : preset.palette.shellBottom,
      shellGlow: typeof paletteInput.shellGlow === 'string' ? paletteInput.shellGlow : preset.palette.shellGlow,
      panelBg: typeof paletteInput.panelBg === 'string' ? paletteInput.panelBg : preset.palette.panelBg,
      panelGlow: typeof paletteInput.panelGlow === 'string' ? paletteInput.panelGlow : preset.palette.panelGlow,
      border: typeof paletteInput.border === 'string' ? paletteInput.border : preset.palette.border,
      borderStrong: typeof paletteInput.borderStrong === 'string' ? paletteInput.borderStrong : preset.palette.borderStrong,
      accentSoft: typeof paletteInput.accentSoft === 'string' ? paletteInput.accentSoft : preset.palette.accentSoft,
      accentText: typeof paletteInput.accentText === 'string' ? paletteInput.accentText : preset.palette.accentText,
      success: typeof paletteInput.success === 'string' ? paletteInput.success : preset.palette.success,
      warning: typeof paletteInput.warning === 'string' ? paletteInput.warning : preset.palette.warning,
      danger: typeof paletteInput.danger === 'string' ? paletteInput.danger : preset.palette.danger,
    };
  }

  if (logoInput) {
    preset.logo = {
      ...preset.logo,
      peers: Math.round(normalizeNumber(logoInput.peers, preset.logo.peers, 2, 8)),
      accentColor: normalizeHexColor(logoInput.accentColor, preset.logo.accentColor),
      peerColor: normalizeHexColor(logoInput.peerColor, preset.logo.peerColor),
      arcColor: normalizeHexColor(logoInput.arcColor, preset.logo.arcColor),
      bgFill: normalizeHexColor(logoInput.bgFill, preset.logo.bgFill),
      nodeFill: normalizeHexColor(logoInput.nodeFill, preset.logo.nodeFill),
      nodeStroke: normalizeHexColor(logoInput.nodeStroke, preset.logo.nodeStroke),
      orbitScale: normalizeNumber(logoInput.orbitScale, preset.logo.orbitScale, 0.5, 1.8),
      sizeScale: normalizeNumber(logoInput.sizeScale, preset.logo.sizeScale, 0.7, 1.8),
      bulgeScale: normalizeNumber(logoInput.bulgeScale, preset.logo.bulgeScale, 0.5, 2.2),
      lineWeight: normalizeNumber(logoInput.lineWeight, preset.logo.lineWeight, 0.5, 4),
      circleStroke: normalizeNumber(logoInput.circleStroke, preset.logo.circleStroke, 0.5, 4),
      pulseSpeed: normalizeNumber(logoInput.pulseSpeed, preset.logo.pulseSpeed, 0.2, 2),
      pulseMag: normalizeNumber(logoInput.pulseMag, preset.logo.pulseMag, 0.2, 2),
      luminosity: normalizeNumber(logoInput.luminosity, preset.logo.luminosity, -40, 40),
      contrast: normalizeNumber(logoInput.contrast, preset.logo.contrast, -60, 60),
      arcStyle:
        logoInput.arcStyle === 'dotted' || logoInput.arcStyle === 'solid' || logoInput.arcStyle === 'dashed'
          ? logoInput.arcStyle
          : preset.logo.arcStyle,
    };
  }

  return preset;
}

export function themeCssVariables(settings: NearbytesThemeSettings): string {
  const { palette, logo } = settings;
  return [
    `--nb-app-bg:${palette.appBg}`,
    `--nb-shell-top:${palette.shellTop}`,
    `--nb-shell-bottom:${palette.shellBottom}`,
    `--nb-shell-glow:${palette.shellGlow}`,
    `--nb-panel-bg:${palette.panelBg}`,
    `--nb-panel-glow:${palette.panelGlow}`,
    `--nb-border:${palette.border}`,
    `--nb-border-strong:${palette.borderStrong}`,
    `--nb-accent:${palette.accent}`,
    `--nb-accent-strong:${palette.accentStrong}`,
    `--nb-accent-soft:${palette.accentSoft}`,
    `--nb-accent-text:${palette.accentText}`,
    `--nb-accent-ink:${palette.accentText}`,
    `--nb-accent-surface:color-mix(in srgb, ${palette.accent} 22%, ${palette.shellBottom})`,
    `--nb-accent-surface-strong:color-mix(in srgb, ${palette.accentStrong} 34%, ${palette.shellTop})`,
    `--nb-text-main:${palette.textMain}`,
    `--nb-text-soft:${palette.textSoft}`,
    `--nb-text-faint:${palette.textFaint}`,
    `--nb-success:${palette.success}`,
    `--nb-warning:${palette.warning}`,
    `--nb-danger:${palette.danger}`,
    `--nb-success-surface:color-mix(in srgb, ${palette.success} 18%, ${palette.shellBottom})`,
    `--nb-warning-surface:color-mix(in srgb, ${palette.warning} 18%, ${palette.shellBottom})`,
    `--nb-danger-surface:color-mix(in srgb, ${palette.danger} 18%, ${palette.shellBottom})`,
    `--nb-logo-bg:${logo.bgFill}`,
  ].join(';');
}
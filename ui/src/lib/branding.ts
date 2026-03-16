export type NearbytesArcStyle = 'dashed' | 'dotted' | 'solid';

export type NearbytesSurfaceStyle = 'flat' | 'gradient';

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
  surfaceStyle: NearbytesSurfaceStyle;
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

export type NearbytesThemePresetId = string;

export type NearbytesThemeSettings = {
  presetId: NearbytesThemePresetId;
  palette: NearbytesPalette;
  logo: NearbytesLogoOptions;
};

export type NearbytesThemeRegistry = {
  version: number;
  defaultPresetId: NearbytesThemePresetId;
  presets: NearbytesThemeSettings[];
};

const DEFAULT_PRESETS: NearbytesThemeSettings[] = [
  {
    presetId: 'blue-current',
    palette: {
      id: 'blue-current',
      label: 'Blue Current',
      description: 'Cool cyan and steel tones tuned to the current shell.',
      surfaceStyle: 'gradient',
      appBg: '#060c18',
      shellTop: 'rgba(10, 22, 40, 0.98)',
      shellBottom: 'rgba(7, 13, 24, 0.98)',
      shellGlow: 'rgba(34, 211, 238, 0.14)',
      panelBg: 'rgba(9, 18, 34, 0.92)',
      panelGlow: 'rgba(34, 211, 238, 0.10)',
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
    },
    logo: {
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
    },
  },
  {
    presetId: 'amber-classic',
    palette: {
      id: 'amber-classic',
      label: 'Amber Classic',
      description: 'Warm bronze and parchment tones based on the original logo treatment.',
      surfaceStyle: 'gradient',
      appBg: '#15110c',
      shellTop: 'rgba(32, 24, 16, 0.98)',
      shellBottom: 'rgba(20, 15, 10, 0.98)',
      shellGlow: 'rgba(200, 160, 74, 0.16)',
      panelBg: 'rgba(31, 24, 17, 0.92)',
      panelGlow: 'rgba(212, 176, 106, 0.09)',
      border: 'rgba(200, 160, 74, 0.20)',
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
    },
    logo: {
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
    },
  },
  {
    presetId: 'mint-vector',
    palette: {
      id: 'mint-vector',
      label: 'Mint Vector',
      description: 'Sea-glass mint with clean alpine neutrals and bright data highlights.',
      surfaceStyle: 'gradient',
      appBg: '#071514',
      shellTop: 'rgba(9, 33, 31, 0.98)',
      shellBottom: 'rgba(5, 19, 18, 0.98)',
      shellGlow: 'rgba(45, 212, 191, 0.16)',
      panelBg: 'rgba(9, 27, 26, 0.92)',
      panelGlow: 'rgba(125, 211, 252, 0.08)',
      border: 'rgba(94, 234, 212, 0.17)',
      borderStrong: 'rgba(45, 212, 191, 0.38)',
      accent: '#2dd4bf',
      accentStrong: '#7dd3fc',
      accentSoft: 'rgba(45, 212, 191, 0.15)',
      accentText: '#e6fffb',
      textMain: 'rgba(236, 253, 250, 0.96)',
      textSoft: 'rgba(167, 243, 208, 0.76)',
      textFaint: 'rgba(153, 246, 228, 0.62)',
      success: '#86efac',
      warning: '#fcd34d',
      danger: '#fca5a5',
    },
    logo: {
      peers: 4,
      accentColor: '#2dd4bf',
      peerColor: '#7dd3fc',
      arcColor: '#99f6e4',
      bgFill: '#0c1f1d',
      nodeFill: '#143230',
      nodeStroke: '#35635f',
      orbitScale: 1.08,
      sizeScale: 1.23,
      bulgeScale: 1.16,
      lineWeight: 2.52,
      circleStroke: 2.28,
      pulseSpeed: 0.92,
      pulseMag: 1.14,
      luminosity: 8,
      contrast: 16,
      arcStyle: 'dashed',
    },
  },
  {
    presetId: 'coral-signal',
    palette: {
      id: 'coral-signal',
      label: 'Coral Signal',
      description: 'Signal coral and ember orange over deep volcanic browns.',
      surfaceStyle: 'gradient',
      appBg: '#180b0d',
      shellTop: 'rgba(40, 14, 18, 0.98)',
      shellBottom: 'rgba(24, 8, 10, 0.98)',
      shellGlow: 'rgba(251, 113, 133, 0.18)',
      panelBg: 'rgba(34, 13, 16, 0.92)',
      panelGlow: 'rgba(249, 115, 22, 0.08)',
      border: 'rgba(251, 146, 60, 0.18)',
      borderStrong: 'rgba(251, 113, 133, 0.38)',
      accent: '#fb7185',
      accentStrong: '#fb923c',
      accentSoft: 'rgba(251, 113, 133, 0.15)',
      accentText: '#fff1f2',
      textMain: 'rgba(255, 241, 242, 0.96)',
      textSoft: 'rgba(254, 205, 211, 0.76)',
      textFaint: 'rgba(253, 164, 175, 0.62)',
      success: '#86efac',
      warning: '#fdba74',
      danger: '#fecaca',
    },
    logo: {
      peers: 3,
      accentColor: '#fb7185',
      peerColor: '#fdba74',
      arcColor: '#fb923c',
      bgFill: '#221013',
      nodeFill: '#35171b',
      nodeStroke: '#71323b',
      orbitScale: 1.14,
      sizeScale: 1.26,
      bulgeScale: 1.28,
      lineWeight: 2.78,
      circleStroke: 2.46,
      pulseSpeed: 0.88,
      pulseMag: 1.26,
      luminosity: 7,
      contrast: 22,
      arcStyle: 'solid',
    },
  },
  {
    presetId: 'graphite-lime',
    palette: {
      id: 'graphite-lime',
      label: 'Graphite Lime',
      description: 'Dark graphite framing sharp lime and soft glacier text tones.',
      surfaceStyle: 'gradient',
      appBg: '#0b100c',
      shellTop: 'rgba(19, 26, 22, 0.98)',
      shellBottom: 'rgba(10, 14, 12, 0.98)',
      shellGlow: 'rgba(163, 230, 53, 0.14)',
      panelBg: 'rgba(15, 21, 18, 0.92)',
      panelGlow: 'rgba(190, 242, 100, 0.07)',
      border: 'rgba(163, 230, 53, 0.16)',
      borderStrong: 'rgba(190, 242, 100, 0.34)',
      accent: '#a3e635',
      accentStrong: '#bef264',
      accentSoft: 'rgba(163, 230, 53, 0.14)',
      accentText: '#f7fee7',
      textMain: 'rgba(247, 254, 231, 0.95)',
      textSoft: 'rgba(217, 249, 157, 0.76)',
      textFaint: 'rgba(190, 242, 100, 0.60)',
      success: '#86efac',
      warning: '#fde047',
      danger: '#fca5a5',
    },
    logo: {
      peers: 5,
      accentColor: '#a3e635',
      peerColor: '#d9f99d',
      arcColor: '#bef264',
      bgFill: '#141814',
      nodeFill: '#202720',
      nodeStroke: '#59684c',
      orbitScale: 1.06,
      sizeScale: 1.18,
      bulgeScale: 1.08,
      lineWeight: 2.36,
      circleStroke: 2.12,
      pulseSpeed: 0.96,
      pulseMag: 1.08,
      luminosity: 5,
      contrast: 24,
      arcStyle: 'dotted',
    },
  },
  {
    presetId: 'polar-night',
    palette: {
      id: 'polar-night',
      label: 'Polar Night',
      description: 'Ice-blue highlights with a denser midnight shell and subdued chrome.',
      surfaceStyle: 'gradient',
      appBg: '#040912',
      shellTop: 'rgba(9, 15, 30, 0.98)',
      shellBottom: 'rgba(5, 9, 20, 0.98)',
      shellGlow: 'rgba(96, 165, 250, 0.14)',
      panelBg: 'rgba(7, 13, 26, 0.92)',
      panelGlow: 'rgba(125, 211, 252, 0.07)',
      border: 'rgba(96, 165, 250, 0.15)',
      borderStrong: 'rgba(125, 211, 252, 0.30)',
      accent: '#60a5fa',
      accentStrong: '#7dd3fc',
      accentSoft: 'rgba(96, 165, 250, 0.12)',
      accentText: '#eff6ff',
      textMain: 'rgba(239, 246, 255, 0.96)',
      textSoft: 'rgba(191, 219, 254, 0.75)',
      textFaint: 'rgba(147, 197, 253, 0.58)',
      success: '#86efac',
      warning: '#fcd34d',
      danger: '#fca5a5',
    },
    logo: {
      peers: 3,
      accentColor: '#60a5fa',
      peerColor: '#7dd3fc',
      arcColor: '#bfdbfe',
      bgFill: '#0b1325',
      nodeFill: '#121d35',
      nodeStroke: '#41567e',
      orbitScale: 1.16,
      sizeScale: 1.24,
      bulgeScale: 1.20,
      lineWeight: 2.68,
      circleStroke: 2.34,
      pulseSpeed: 0.78,
      pulseMag: 1.12,
      luminosity: 4,
      contrast: 18,
      arcStyle: 'dashed',
    },
  },
  {
    presetId: 'sunset-radio',
    palette: {
      id: 'sunset-radio',
      label: 'Sunset Radio',
      description: 'Magenta-to-gold warmth with studio-dark surfaces and glossy accents.',
      surfaceStyle: 'gradient',
      appBg: '#170812',
      shellTop: 'rgba(36, 12, 27, 0.98)',
      shellBottom: 'rgba(22, 8, 18, 0.98)',
      shellGlow: 'rgba(244, 114, 182, 0.18)',
      panelBg: 'rgba(30, 10, 24, 0.92)',
      panelGlow: 'rgba(251, 191, 36, 0.07)',
      border: 'rgba(244, 114, 182, 0.18)',
      borderStrong: 'rgba(251, 191, 36, 0.34)',
      accent: '#f472b6',
      accentStrong: '#fbbf24',
      accentSoft: 'rgba(244, 114, 182, 0.14)',
      accentText: '#fdf2f8',
      textMain: 'rgba(253, 242, 248, 0.96)',
      textSoft: 'rgba(251, 207, 232, 0.76)',
      textFaint: 'rgba(244, 114, 182, 0.60)',
      success: '#86efac',
      warning: '#fde68a',
      danger: '#fecaca',
    },
    logo: {
      peers: 4,
      accentColor: '#f472b6',
      peerColor: '#fbbf24',
      arcColor: '#f9a8d4',
      bgFill: '#220d1b',
      nodeFill: '#351028',
      nodeStroke: '#7a2a5d',
      orbitScale: 1.11,
      sizeScale: 1.25,
      bulgeScale: 1.31,
      lineWeight: 2.82,
      circleStroke: 2.52,
      pulseSpeed: 0.86,
      pulseMag: 1.24,
      luminosity: 10,
      contrast: 20,
      arcStyle: 'solid',
    },
  },
  {
    presetId: 'mono-scarlet',
    palette: {
      id: 'mono-scarlet',
      label: 'Mono Scarlet',
      description: 'Porcelain whites, graphite text, and disciplined scarlet accents tuned for an Apple-like light shell.',
      surfaceStyle: 'flat',
      appBg: '#f3f2f5',
      shellTop: 'rgba(255, 255, 255, 0.99)',
      shellBottom: 'rgba(244, 244, 247, 0.99)',
      shellGlow: 'rgba(255, 255, 255, 0)',
      panelBg: 'rgba(255, 255, 255, 0.96)',
      panelGlow: 'rgba(255, 59, 48, 0.025)',
      border: 'rgba(60, 60, 67, 0.10)',
      borderStrong: 'rgba(255, 59, 48, 0.22)',
      accent: '#ff3b30',
      accentStrong: '#d70015',
      accentSoft: 'rgba(255, 59, 48, 0.08)',
      accentText: 'rgba(28, 28, 30, 0.98)',
      textMain: 'rgba(28, 28, 30, 0.98)',
      textSoft: 'rgba(58, 58, 60, 0.72)',
      textFaint: 'rgba(110, 110, 115, 0.58)',
      success: '#30d158',
      warning: '#ffd60a',
      danger: '#ff453a',
    },
    logo: {
      peers: 3,
      accentColor: '#ff3b30',
      peerColor: '#3a3a3c',
      arcColor: '#ff6b61',
      bgFill: '#ffffff',
      nodeFill: '#f2f2f7',
      nodeStroke: '#a1a1aa',
      orbitScale: 1.1,
      sizeScale: 1.24,
      bulgeScale: 1.08,
      lineWeight: 3.38,
      circleStroke: 3.02,
      pulseSpeed: 0.78,
      pulseMag: 1.06,
      luminosity: -4,
      contrast: 14,
      arcStyle: 'solid',
    },
  },
  {
    presetId: 'rose-copper',
    palette: {
      id: 'rose-copper',
      label: 'Rose Copper',
      description: 'A softer copper family with rose highlights and parchment text.',
      surfaceStyle: 'gradient',
      appBg: '#130d0c',
      shellTop: 'rgba(31, 21, 19, 0.98)',
      shellBottom: 'rgba(18, 12, 11, 0.98)',
      shellGlow: 'rgba(217, 119, 87, 0.16)',
      panelBg: 'rgba(27, 19, 17, 0.92)',
      panelGlow: 'rgba(251, 191, 36, 0.06)',
      border: 'rgba(217, 119, 87, 0.17)',
      borderStrong: 'rgba(251, 146, 60, 0.32)',
      accent: '#d97757',
      accentStrong: '#fb923c',
      accentSoft: 'rgba(217, 119, 87, 0.14)',
      accentText: '#fff7ed',
      textMain: 'rgba(255, 247, 237, 0.96)',
      textSoft: 'rgba(254, 215, 170, 0.76)',
      textFaint: 'rgba(251, 146, 60, 0.58)',
      success: '#86efac',
      warning: '#fde68a',
      danger: '#fecaca',
    },
    logo: {
      peers: 3,
      accentColor: '#d97757',
      peerColor: '#fdba74',
      arcColor: '#fb923c',
      bgFill: '#1f1715',
      nodeFill: '#2c1d1a',
      nodeStroke: '#6d483f',
      orbitScale: 1.10,
      sizeScale: 1.22,
      bulgeScale: 1.18,
      lineWeight: 2.64,
      circleStroke: 2.34,
      pulseSpeed: 0.82,
      pulseMag: 1.16,
      luminosity: 8,
      contrast: 18,
      arcStyle: 'dashed',
    },
  },
];

export const DEFAULT_THEME_REGISTRY: NearbytesThemeRegistry = {
  version: 2,
  defaultPresetId: 'blue-current',
  presets: DEFAULT_PRESETS,
};

export const NEARBYTES_THEME_PRESET_LIST = DEFAULT_THEME_REGISTRY.presets;

export function cloneThemeSettings(settings: NearbytesThemeSettings): NearbytesThemeSettings {
  return {
    presetId: settings.presetId,
    palette: { ...settings.palette },
    logo: { ...settings.logo },
  };
}

export function cloneThemeRegistry(registry: NearbytesThemeRegistry): NearbytesThemeRegistry {
  return {
    version: registry.version,
    defaultPresetId: registry.defaultPresetId,
    presets: registry.presets.map((preset) => cloneThemeSettings(preset)),
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function normalizeColorString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeSurfaceStyle(
  value: unknown,
  fallback: NearbytesSurfaceStyle
): NearbytesSurfaceStyle {
  return value === 'flat' || value === 'gradient' ? value : fallback;
}

function normalizePalette(input: unknown, fallback: NearbytesPalette): NearbytesPalette {
  const paletteInput = asObject(input);
  if (!paletteInput) {
    return { ...fallback };
  }
  return {
    ...fallback,
    id:
      typeof paletteInput.id === 'string' && paletteInput.id.trim().length > 0
        ? paletteInput.id.trim()
        : fallback.id,
    label:
      typeof paletteInput.label === 'string' && paletteInput.label.trim().length > 0
        ? paletteInput.label.trim()
        : fallback.label,
    description:
      typeof paletteInput.description === 'string' && paletteInput.description.trim().length > 0
        ? paletteInput.description.trim()
        : fallback.description,
    surfaceStyle: normalizeSurfaceStyle(paletteInput.surfaceStyle, fallback.surfaceStyle),
    appBg: normalizeHexColor(paletteInput.appBg, fallback.appBg),
    shellTop: normalizeColorString(paletteInput.shellTop, fallback.shellTop),
    shellBottom: normalizeColorString(paletteInput.shellBottom, fallback.shellBottom),
    shellGlow: normalizeColorString(paletteInput.shellGlow, fallback.shellGlow),
    panelBg: normalizeColorString(paletteInput.panelBg, fallback.panelBg),
    panelGlow: normalizeColorString(paletteInput.panelGlow, fallback.panelGlow),
    border: normalizeColorString(paletteInput.border, fallback.border),
    borderStrong: normalizeColorString(paletteInput.borderStrong, fallback.borderStrong),
    accent: normalizeHexColor(paletteInput.accent, fallback.accent),
    accentStrong: normalizeHexColor(paletteInput.accentStrong, fallback.accentStrong),
    accentSoft: normalizeColorString(paletteInput.accentSoft, fallback.accentSoft),
    accentText: normalizeColorString(paletteInput.accentText, fallback.accentText),
    textMain: normalizeColorString(paletteInput.textMain, fallback.textMain),
    textSoft: normalizeColorString(paletteInput.textSoft, fallback.textSoft),
    textFaint: normalizeColorString(paletteInput.textFaint, fallback.textFaint),
    success: normalizeColorString(paletteInput.success, fallback.success),
    warning: normalizeColorString(paletteInput.warning, fallback.warning),
    danger: normalizeColorString(paletteInput.danger, fallback.danger),
  };
}

function normalizeLogoOptions(input: unknown, fallback: NearbytesLogoOptions): NearbytesLogoOptions {
  const logoInput = asObject(input);
  if (!logoInput) {
    return { ...fallback };
  }
  return {
    ...fallback,
    peers: Math.round(normalizeNumber(logoInput.peers, fallback.peers, 2, 8)),
    accentColor: normalizeHexColor(logoInput.accentColor, fallback.accentColor),
    peerColor: normalizeHexColor(logoInput.peerColor, fallback.peerColor),
    arcColor: normalizeHexColor(logoInput.arcColor, fallback.arcColor),
    bgFill: normalizeHexColor(logoInput.bgFill, fallback.bgFill),
    nodeFill: normalizeHexColor(logoInput.nodeFill, fallback.nodeFill),
    nodeStroke: normalizeHexColor(logoInput.nodeStroke, fallback.nodeStroke),
    orbitScale: normalizeNumber(logoInput.orbitScale, fallback.orbitScale, 0.5, 1.8),
    sizeScale: normalizeNumber(logoInput.sizeScale, fallback.sizeScale, 0.7, 1.8),
    bulgeScale: normalizeNumber(logoInput.bulgeScale, fallback.bulgeScale, 0.5, 2.2),
    lineWeight: normalizeNumber(logoInput.lineWeight, fallback.lineWeight, 0.5, 4),
    circleStroke: normalizeNumber(logoInput.circleStroke, fallback.circleStroke, 0.5, 4),
    pulseSpeed: normalizeNumber(logoInput.pulseSpeed, fallback.pulseSpeed, 0.2, 2),
    pulseMag: normalizeNumber(logoInput.pulseMag, fallback.pulseMag, 0.2, 2),
    luminosity: normalizeNumber(logoInput.luminosity, fallback.luminosity, -40, 40),
    contrast: normalizeNumber(logoInput.contrast, fallback.contrast, -60, 60),
    arcStyle:
      logoInput.arcStyle === 'dotted' ||
      logoInput.arcStyle === 'solid' ||
      logoInput.arcStyle === 'dashed'
        ? logoInput.arcStyle
        : fallback.arcStyle,
  };
}

function normalizeThemePreset(
  input: unknown,
  fallback: NearbytesThemeSettings
): NearbytesThemeSettings {
  const presetInput = asObject(input);
  if (!presetInput) {
    return cloneThemeSettings(fallback);
  }
  const presetId =
    typeof presetInput.presetId === 'string' && presetInput.presetId.trim().length > 0
      ? presetInput.presetId.trim()
      : fallback.presetId;
  return {
    presetId,
    palette: normalizePalette(presetInput.palette, { ...fallback.palette, id: presetId }),
    logo: normalizeLogoOptions(presetInput.logo, fallback.logo),
  };
}

export function findThemePreset(
  registry: NearbytesThemeRegistry,
  presetId: NearbytesThemePresetId | null | undefined
): NearbytesThemeSettings {
  return (
    registry.presets.find((preset) => preset.presetId === presetId) ??
    registry.presets[0] ??
    cloneThemeSettings(DEFAULT_THEME_REGISTRY.presets[0])
  );
}

export function defaultThemeRegistry(): NearbytesThemeRegistry {
  return cloneThemeRegistry(DEFAULT_THEME_REGISTRY);
}

export function defaultThemeSettings(
  registry: NearbytesThemeRegistry = DEFAULT_THEME_REGISTRY
): NearbytesThemeSettings {
  return cloneThemeSettings(findThemePreset(registry, registry.defaultPresetId));
}

export function normalizeThemeRegistry(input: unknown): NearbytesThemeRegistry {
  const registryInput = asObject(input);
  if (!registryInput) {
    return defaultThemeRegistry();
  }

  const presetsInput = Array.isArray(registryInput.presets) ? registryInput.presets : [];
  const presets =
    presetsInput.length > 0
      ? presetsInput.map((preset, index) =>
          normalizeThemePreset(preset, DEFAULT_THEME_REGISTRY.presets[index] ?? DEFAULT_THEME_REGISTRY.presets[0])
        )
      : DEFAULT_THEME_REGISTRY.presets.map((preset) => cloneThemeSettings(preset));

  const defaultPresetIdCandidate =
    typeof registryInput.defaultPresetId === 'string' && registryInput.defaultPresetId.trim().length > 0
      ? registryInput.defaultPresetId.trim()
      : DEFAULT_THEME_REGISTRY.defaultPresetId;

  return {
    version:
      typeof registryInput.version === 'number' && Number.isFinite(registryInput.version)
        ? registryInput.version
        : DEFAULT_THEME_REGISTRY.version,
    defaultPresetId: presets.some((preset) => preset.presetId === defaultPresetIdCandidate)
      ? defaultPresetIdCandidate
      : presets[0]?.presetId ?? DEFAULT_THEME_REGISTRY.defaultPresetId,
    presets,
  };
}

export function normalizeThemeSettings(
  input: unknown,
  registry: NearbytesThemeRegistry = DEFAULT_THEME_REGISTRY
): NearbytesThemeSettings {
  const themeInput = asObject(input);
  const basePreset = findThemePreset(registry, themeInput?.presetId as string | undefined);
  if (!themeInput) {
    return cloneThemeSettings(basePreset);
  }
  return {
    presetId: basePreset.presetId,
    palette: normalizePalette(themeInput.palette, basePreset.palette),
    logo: normalizeLogoOptions(themeInput.logo, basePreset.logo),
  };
}

export function replaceThemePresetInRegistry(
  registry: NearbytesThemeRegistry,
  preset: NearbytesThemeSettings
): NearbytesThemeRegistry {
  const nextPresets = registry.presets.map((entry) =>
    entry.presetId === preset.presetId ? cloneThemeSettings(preset) : cloneThemeSettings(entry)
  );
  if (!nextPresets.some((entry) => entry.presetId === preset.presetId)) {
    nextPresets.push(cloneThemeSettings(preset));
  }
  return {
    version: registry.version,
    defaultPresetId: nextPresets.some((entry) => entry.presetId === registry.defaultPresetId)
      ? registry.defaultPresetId
      : preset.presetId,
    presets: nextPresets,
  };
}

export function themeCssVariables(settings: NearbytesThemeSettings): string {
  const { palette, logo } = settings;
  const isFlat = palette.surfaceStyle === 'flat';
  const appSurface = isFlat
    ? `${palette.appBg}`
    : `radial-gradient(120% 140% at 0% 0%, ${palette.shellGlow}, transparent 48%), radial-gradient(110% 130% at 100% 0%, ${palette.panelGlow}, transparent 42%), linear-gradient(180deg, ${palette.shellTop} 0%, ${palette.panelBg} 44%, ${palette.shellBottom} 100%)`;
  const headerSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 98%, ${palette.shellTop})`
    : `color-mix(in srgb, ${palette.shellBottom} 88%, transparent)`;
  const layeredPanelSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 98%, ${palette.shellBottom})`
    : `radial-gradient(120% 120% at 0% 0%, ${palette.panelGlow}, transparent 40%), linear-gradient(180deg, color-mix(in srgb, ${palette.panelBg} 96%, transparent), color-mix(in srgb, ${palette.shellBottom} 96%, transparent))`;
  const identitySurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 97%, ${palette.shellBottom})`
    : `radial-gradient(140% 120% at 0% 0%, ${palette.accentSoft}, transparent 42%), linear-gradient(180deg, color-mix(in srgb, ${palette.panelBg} 96%, transparent), color-mix(in srgb, ${palette.shellBottom} 94%, transparent))`;
  const themeDialogSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 98%, ${palette.shellBottom})`
    : `radial-gradient(120% 120% at 0% 0%, ${palette.panelGlow}, transparent 48%), radial-gradient(120% 120% at 100% 0%, color-mix(in srgb, ${palette.accent} 18%, transparent), transparent 42%), linear-gradient(180deg, color-mix(in srgb, ${palette.panelBg} 98%, transparent), color-mix(in srgb, ${palette.shellBottom} 98%, transparent))`;
  const dialogSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 99%, ${palette.shellTop})`
    : `linear-gradient(180deg, color-mix(in srgb, ${palette.panelBg} 98%, transparent), color-mix(in srgb, ${palette.shellBottom} 98%, transparent))`;
  const volumeTransitionSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 98%, ${palette.shellBottom})`
    : `radial-gradient(120% 120% at 0% 0%, ${palette.accentSoft}, transparent 52%), radial-gradient(120% 120% at 100% 0%, color-mix(in srgb, ${palette.accentStrong} 16%, transparent), transparent 48%), linear-gradient(160deg, color-mix(in srgb, ${palette.shellTop} 98%, transparent), color-mix(in srgb, ${palette.shellBottom} 96%, transparent))`;
  const timeMachineSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 98%, ${palette.shellBottom})`
    : `radial-gradient(140% 120% at 0% 0%, ${palette.accentSoft}, transparent 44%), linear-gradient(180deg, color-mix(in srgb, ${palette.panelBg} 96%, transparent), color-mix(in srgb, ${palette.shellBottom} 90%, transparent))`;
  const volumeChipSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 97%, ${palette.shellBottom})`
    : `linear-gradient(180deg, color-mix(in srgb, ${palette.shellTop} 94%, transparent), color-mix(in srgb, ${palette.panelBg} 94%, transparent))`;
  const volumeChipExpandedSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 98%, ${palette.shellBottom})`
    : `linear-gradient(180deg, color-mix(in srgb, ${palette.shellTop} 98%, transparent), color-mix(in srgb, ${palette.panelBg} 98%, transparent))`;
  const volumeChipSelectedSurface = isFlat
    ? `color-mix(in srgb, ${palette.accent} 10%, ${palette.panelBg})`
    : `radial-gradient(120% 180% at 0% 0%, color-mix(in srgb, ${palette.accent} 28%, transparent), transparent 52%), linear-gradient(180deg, color-mix(in srgb, ${palette.accentStrong} 34%, ${palette.shellTop}) 98%, color-mix(in srgb, ${palette.panelBg} 98%, transparent))`;
  const volumeChipDraggingSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 96%, ${palette.shellBottom})`
    : `linear-gradient(180deg, color-mix(in srgb, ${palette.shellTop} 94%, transparent), color-mix(in srgb, ${palette.panelBg} 94%, transparent))`;
  const volumeChipHoverSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 92%, white 8%)`
    : `linear-gradient(180deg, rgba(14, 29, 50, 0.36), rgba(9, 21, 39, 0.18))`;
  const volumeChipFocusSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 88%, white 12%)`
    : `linear-gradient(180deg, rgba(14, 29, 50, 0.46), rgba(9, 21, 39, 0.26))`;
  const volumeChipActionSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 94%, white 6%)`
    : `linear-gradient(180deg, rgba(9, 18, 33, 0.36), rgba(7, 14, 26, 0.18))`;
  const volumeChipActionHoverSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 84%, ${palette.accentSoft})`
    : `linear-gradient(180deg, rgba(18, 35, 60, 0.9), rgba(11, 22, 40, 0.84))`;
  const volumeChipActionFocusSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 80%, ${palette.accentSoft})`
    : `linear-gradient(180deg, rgba(18, 35, 60, 0.94), rgba(11, 22, 40, 0.9))`;
  /* ── Button / control surfaces ─────────────────────────── */
  const btnBg = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 96%, ${palette.shellBottom})`
    : `rgba(10, 19, 34, 0.52)`;
  const btnHoverBg = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 90%, ${palette.accentSoft})`
    : `rgba(16, 32, 56, 0.88)`;
  const btnActiveBg = isFlat
    ? `color-mix(in srgb, ${palette.accent} 12%, ${palette.panelBg})`
    : `linear-gradient(180deg, rgba(16, 66, 91, 0.92), rgba(10, 44, 66, 0.94))`;
  const btnBorder = isFlat
    ? `color-mix(in srgb, ${palette.border} 80%, transparent)`
    : `rgba(56, 189, 248, 0.14)`;
  const btnHoverBorder = isFlat
    ? `${palette.border}`
    : `rgba(96, 165, 250, 0.28)`;
  const btnActiveBorder = isFlat
    ? `color-mix(in srgb, ${palette.accent} 42%, transparent)`
    : `rgba(34, 211, 238, 0.42)`;
  const btnColor = isFlat
    ? `${palette.textSoft}`
    : `rgba(191, 219, 254, 0.78)`;
  const btnHoverColor = isFlat
    ? `${palette.textMain}`
    : `rgba(224, 242, 254, 0.96)`;
  const btnActiveColor = isFlat
    ? `${palette.textMain}`
    : `rgba(236, 254, 255, 0.98)`;
  const btnActiveShadow = isFlat
    ? `0 1px 2px color-mix(in srgb, ${palette.accent} 10%, transparent)`
    : `0 10px 24px rgba(6, 182, 212, 0.16)`;
  const btnDangerBg = isFlat
    ? `color-mix(in srgb, ${palette.danger} 8%, ${palette.panelBg})`
    : `rgba(67, 20, 20, 0.62)`;
  const btnDangerBorder = isFlat
    ? `color-mix(in srgb, ${palette.danger} 22%, transparent)`
    : `rgba(248, 113, 113, 0.24)`;
  const btnDangerColor = isFlat
    ? `${palette.danger}`
    : `rgba(254, 226, 226, 0.95)`;
  const btnDangerHoverBg = isFlat
    ? `color-mix(in srgb, ${palette.danger} 14%, ${palette.panelBg})`
    : `rgba(88, 24, 24, 0.76)`;
  const btnDangerHoverBorder = isFlat
    ? `color-mix(in srgb, ${palette.danger} 34%, transparent)`
    : `rgba(252, 165, 165, 0.4)`;
  const btnFocusRing = isFlat
    ? `0 0 0 3px color-mix(in srgb, ${palette.accent} 22%, transparent)`
    : `inset 0 0 0 1px rgba(125, 211, 252, 0.18)`;
  return [
    `--nb-surface-style:${palette.surfaceStyle}`,
    `--nb-app-bg:${palette.appBg}`,
    `--nb-shell-top:${palette.shellTop}`,
    `--nb-shell-bottom:${palette.shellBottom}`,
    `--nb-shell-glow:${palette.shellGlow}`,
    `--nb-panel-bg:${palette.panelBg}`,
    `--nb-panel-glow:${palette.panelGlow}`,
    `--nb-app-shell-bg:${appSurface}`,
    `--nb-header-bg:${headerSurface}`,
    `--nb-brand-rail-bg:${layeredPanelSurface}`,
    `--nb-identity-surface-bg:${identitySurface}`,
    `--nb-dialog-bg:${dialogSurface}`,
    `--nb-theme-dialog-bg:${themeDialogSurface}`,
    `--nb-time-machine-bg:${timeMachineSurface}`,
    `--nb-volume-transition-bg:${volumeTransitionSurface}`,
    `--nb-volume-chip-bg:${volumeChipSurface}`,
    `--nb-volume-chip-expanded-bg:${volumeChipExpandedSurface}`,
    `--nb-volume-chip-selected-bg:${volumeChipSelectedSurface}`,
    `--nb-volume-chip-dragging-bg:${volumeChipDraggingSurface}`,
    `--nb-volume-chip-hover-bg:${volumeChipHoverSurface}`,
    `--nb-volume-chip-focus-bg:${volumeChipFocusSurface}`,
    `--nb-volume-chip-action-bg:${volumeChipActionSurface}`,
    `--nb-volume-chip-action-hover-bg:${volumeChipActionHoverSurface}`,
    `--nb-volume-chip-action-focus-bg:${volumeChipActionFocusSurface}`,
    `--nb-border:${palette.border}`,
    `--nb-border-strong:${palette.borderStrong}`,
    `--nb-accent:${palette.accent}`,
    `--nb-accent-strong:${palette.accentStrong}`,
    `--nb-accent-soft:${palette.accentSoft}`,
    `--nb-accent-text:${palette.accentText}`,
    `--nb-accent-ink:${palette.accentText}`,
    `--nb-accent-surface:color-mix(in srgb, ${palette.accent} ${isFlat ? 16 : 22}%, ${isFlat ? palette.panelBg : palette.shellBottom})`,
    `--nb-accent-surface-strong:color-mix(in srgb, ${palette.accentStrong} ${isFlat ? 22 : 34}%, ${isFlat ? palette.panelBg : palette.shellTop})`,
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
    `--nb-btn-bg:${btnBg}`,
    `--nb-btn-hover-bg:${btnHoverBg}`,
    `--nb-btn-active-bg:${btnActiveBg}`,
    `--nb-btn-border:${btnBorder}`,
    `--nb-btn-hover-border:${btnHoverBorder}`,
    `--nb-btn-active-border:${btnActiveBorder}`,
    `--nb-btn-color:${btnColor}`,
    `--nb-btn-hover-color:${btnHoverColor}`,
    `--nb-btn-active-color:${btnActiveColor}`,
    `--nb-btn-active-shadow:${btnActiveShadow}`,
    `--nb-btn-danger-bg:${btnDangerBg}`,
    `--nb-btn-danger-border:${btnDangerBorder}`,
    `--nb-btn-danger-color:${btnDangerColor}`,
    `--nb-btn-danger-hover-bg:${btnDangerHoverBg}`,
    `--nb-btn-danger-hover-border:${btnDangerHoverBorder}`,
    `--nb-btn-focus-ring:${btnFocusRing}`,
  ].join(';');
}

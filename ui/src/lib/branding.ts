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
    presetId: 'clarity-light',
    palette: {
      id: 'clarity-light',
      label: 'Clarity',
      description: 'Pure white, strong contrast, warm graphite accents — clean and composed.',
      surfaceStyle: 'flat',
      appBg: '#ffffff',
      shellTop: 'rgba(255, 255, 255, 1)',
      shellBottom: 'rgba(245, 245, 247, 1)',
      shellGlow: 'rgba(255, 255, 255, 0)',
      panelBg: 'rgba(255, 255, 255, 0.99)',
      panelGlow: 'rgba(0, 0, 0, 0)',
      border: 'rgba(0, 0, 0, 0.10)',
      borderStrong: 'rgba(0, 0, 0, 0.18)',
      accent: '#6b5e54',
      accentStrong: '#4a3f37',
      accentSoft: 'rgba(107, 94, 84, 0.08)',
      accentText: '#ffffff',
      textMain: 'rgba(0, 0, 0, 0.88)',
      textSoft: 'rgba(60, 60, 67, 0.6)',
      textFaint: 'rgba(60, 60, 67, 0.36)',
      success: '#34C759',
      warning: '#FF9500',
      danger: '#FF3B30',
    },
    logo: {
      peers: 3,
      accentColor: '#6b5e54',
      peerColor: '#a09890',
      arcColor: '#6b5e54',
      bgFill: '#ffffff',
      nodeFill: '#f5f5f7',
      nodeStroke: '#d1d1d6',
      orbitScale: 1.35,
      sizeScale: 1.71,
      bulgeScale: 1.08,
      lineWeight: 8,
      circleStroke: 4,
      pulseSpeed: 1.32,
      pulseMag: 1.61,
      luminosity: -4,
      contrast: 14,
      arcStyle: 'solid',
    },
  },
  {
    presetId: 'ink-dark',
    palette: {
      id: 'ink-dark',
      label: 'Ink',
      description: 'True dark background with crisp white text and blue accents for low-light focus.',
      surfaceStyle: 'flat',
      appBg: '#1c1c1e',
      shellTop: 'rgba(28, 28, 30, 1)',
      shellBottom: 'rgba(22, 22, 24, 1)',
      shellGlow: 'rgba(0, 0, 0, 0)',
      panelBg: 'rgba(28, 28, 30, 0.99)',
      panelGlow: 'rgba(0, 0, 0, 0)',
      border: 'rgba(255, 255, 255, 0.10)',
      borderStrong: 'rgba(255, 255, 255, 0.20)',
      accent: '#0A84FF',
      accentStrong: '#409CFF',
      accentSoft: 'rgba(10, 132, 255, 0.12)',
      accentText: '#ffffff',
      textMain: 'rgba(255, 255, 255, 0.92)',
      textSoft: 'rgba(235, 235, 245, 0.6)',
      textFaint: 'rgba(235, 235, 245, 0.36)',
      success: '#30D158',
      warning: '#FFD60A',
      danger: '#FF453A',
    },
    logo: {
      peers: 3,
      accentColor: '#0A84FF',
      peerColor: '#64D2FF',
      arcColor: '#0A84FF',
      bgFill: '#1c1c1e',
      nodeFill: '#2c2c2e',
      nodeStroke: '#48484a',
      orbitScale: 1.35,
      sizeScale: 1.71,
      bulgeScale: 1.08,
      lineWeight: 8,
      circleStroke: 4,
      pulseSpeed: 1.32,
      pulseMag: 1.61,
      luminosity: 6,
      contrast: 18,
      arcStyle: 'solid',
    },
  },
  {
    presetId: 'polar-night',
    palette: {
      id: 'polar-night',
      label: 'Polar Night',
      description: 'Deep midnight tones with ice-blue highlights for an immersive dark workspace.',
      surfaceStyle: 'gradient',
      appBg: '#0a0e1a',
      shellTop: 'rgba(12, 18, 36, 0.99)',
      shellBottom: 'rgba(8, 12, 26, 0.99)',
      shellGlow: 'rgba(96, 165, 250, 0.10)',
      panelBg: 'rgba(10, 16, 32, 0.96)',
      panelGlow: 'rgba(96, 165, 250, 0.05)',
      border: 'rgba(148, 163, 184, 0.12)',
      borderStrong: 'rgba(148, 163, 184, 0.22)',
      accent: '#60a5fa',
      accentStrong: '#93bbfc',
      accentSoft: 'rgba(96, 165, 250, 0.10)',
      accentText: '#f0f4ff',
      textMain: 'rgba(241, 245, 249, 0.94)',
      textSoft: 'rgba(203, 213, 225, 0.6)',
      textFaint: 'rgba(203, 213, 225, 0.36)',
      success: '#86efac',
      warning: '#fcd34d',
      danger: '#fca5a5',
    },
    logo: {
      peers: 3,
      accentColor: '#60a5fa',
      peerColor: '#7dd3fc',
      arcColor: '#bfdbfe',
      bgFill: '#0e1428',
      nodeFill: '#151d38',
      nodeStroke: '#3b4f7c',
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
    presetId: 'mono-scarlet',
    palette: {
      id: 'mono-scarlet',
      label: 'Warm Stone',
      description: 'Warm porcelain surfaces with graphite text and subtle stone accents — soft but readable.',
      surfaceStyle: 'flat',
      appBg: '#f5f4f1',
      shellTop: 'rgba(255, 255, 255, 0.99)',
      shellBottom: 'rgba(242, 241, 237, 0.99)',
      shellGlow: 'rgba(255, 255, 255, 0)',
      panelBg: 'rgba(255, 255, 255, 0.98)',
      panelGlow: 'rgba(0, 0, 0, 0)',
      border: 'rgba(0, 0, 0, 0.09)',
      borderStrong: 'rgba(0, 0, 0, 0.16)',
      accent: '#7c6f64',
      accentStrong: '#5d524a',
      accentSoft: 'rgba(124, 111, 100, 0.08)',
      accentText: '#ffffff',
      textMain: 'rgba(28, 28, 30, 0.92)',
      textSoft: 'rgba(60, 60, 67, 0.56)',
      textFaint: 'rgba(60, 60, 67, 0.34)',
      success: '#34C759',
      warning: '#FF9500',
      danger: '#FF3B30',
    },
    logo: {
      peers: 3,
      accentColor: '#7c6f64',
      peerColor: '#3a3a3c',
      arcColor: '#a09890',
      bgFill: '#ffffff',
      nodeFill: '#f5f4f1',
      nodeStroke: '#c8c3bc',
      orbitScale: 1.35,
      sizeScale: 1.71,
      bulgeScale: 1.08,
      lineWeight: 8,
      circleStroke: 4,
      pulseSpeed: 1.32,
      pulseMag: 1.61,
      luminosity: -4,
      contrast: 14,
      arcStyle: 'solid',
    },
  },
];

export const DEFAULT_THEME_REGISTRY: NearbytesThemeRegistry = {
  version: 4,
  defaultPresetId: 'mono-scarlet',
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
    lineWeight: normalizeNumber(logoInput.lineWeight, fallback.lineWeight, 0.5, 8),
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

function shouldMigrateMonoScarletPalette(input: unknown): boolean {
  const paletteInput = asObject(input);
  if (!paletteInput) {
    return false;
  }
  const accent = typeof paletteInput.accent === 'string' ? paletteInput.accent.trim().toLowerCase() : '';
  const accentStrong =
    typeof paletteInput.accentStrong === 'string' ? paletteInput.accentStrong.trim().toLowerCase() : '';
  const accentSoft =
    typeof paletteInput.accentSoft === 'string' ? paletteInput.accentSoft.trim().toLowerCase() : '';
  return (
    accent === '#ff3b30' ||
    accent === '#d27a54' ||
    accentStrong === '#1c1c1e' ||
    accentStrong === '#b85f39' ||
    accentSoft.includes('255, 59, 48') ||
    accentSoft.includes('210, 122, 84')
  );
}

function shouldMigrateMonoScarletLogo(input: unknown): boolean {
  const logoInput = asObject(input);
  if (!logoInput) {
    return false;
  }
  const accentColor =
    typeof logoInput.accentColor === 'string' ? logoInput.accentColor.trim().toLowerCase() : '';
  const arcColor = typeof logoInput.arcColor === 'string' ? logoInput.arcColor.trim().toLowerCase() : '';
  const lineWeight = typeof logoInput.lineWeight === 'number' ? logoInput.lineWeight : null;
  const circleStroke = typeof logoInput.circleStroke === 'number' ? logoInput.circleStroke : null;
  return (
    accentColor === '#ff3b30' ||
    accentColor === '#d27a54' ||
    arcColor === '#ff6b61' ||
    arcColor === '#e5a07d' ||
    lineWeight === 2.56 ||
    lineWeight === 3.38 ||
    circleStroke === 2.28 ||
    circleStroke === 3.02
  );
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
  const migrateMonoScarlet =
    basePreset.presetId === 'mono-scarlet' && shouldMigrateMonoScarletPalette(themeInput.palette);
  const migrateMonoScarletLogo =
    basePreset.presetId === 'mono-scarlet' && shouldMigrateMonoScarletLogo(themeInput.logo);
  return {
    presetId: basePreset.presetId,
    palette: migrateMonoScarlet
      ? { ...basePreset.palette }
      : normalizePalette(themeInput.palette, basePreset.palette),
    logo: migrateMonoScarletLogo
      ? { ...basePreset.logo }
      : normalizeLogoOptions(themeInput.logo, basePreset.logo),
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
    ? `color-mix(in srgb, ${palette.panelBg} 94%, ${palette.shellBottom})`
    : `radial-gradient(120% 180% at 0% 0%, color-mix(in srgb, ${palette.accent} 28%, transparent), transparent 52%), linear-gradient(180deg, color-mix(in srgb, ${palette.accentStrong} 34%, ${palette.shellTop}) 98%, color-mix(in srgb, ${palette.panelBg} 98%, transparent))`;
  const volumeChipDraggingSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 96%, ${palette.shellBottom})`
    : `linear-gradient(180deg, color-mix(in srgb, ${palette.shellTop} 94%, transparent), color-mix(in srgb, ${palette.panelBg} 94%, transparent))`;
  const volumeChipHoverSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 92%, white 8%)`
    : `color-mix(in srgb, ${palette.panelBg} 90%, white 10%)`;
  const volumeChipFocusSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 88%, white 12%)`
    : `color-mix(in srgb, ${palette.panelBg} 86%, white 14%)`;
  const volumeChipActionSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 94%, white 6%)`
    : `color-mix(in srgb, ${palette.panelBg} 94%, ${palette.shellBottom})`;
  const volumeChipActionHoverSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 90%, white 10%)`
    : `color-mix(in srgb, ${palette.panelBg} 90%, white 10%)`;
  const volumeChipActionFocusSurface = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 86%, white 14%)`
    : `color-mix(in srgb, ${palette.panelBg} 86%, white 14%)`;
  /* ── Button / control surfaces ─────────────────────────── */
  const btnBg = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 96%, ${palette.shellBottom})`
    : `color-mix(in srgb, ${palette.panelBg} 94%, ${palette.shellBottom})`;
  const btnHoverBg = isFlat
    ? `color-mix(in srgb, ${palette.panelBg} 92%, white 8%)`
    : `color-mix(in srgb, ${palette.panelBg} 88%, ${palette.accentSoft})`;
  const btnActiveBg = isFlat
    ? `linear-gradient(180deg, color-mix(in srgb, ${palette.accentStrong} 82%, ${palette.accent}) 0%, color-mix(in srgb, ${palette.accentStrong} 94%, ${palette.shellBottom}) 100%)`
    : `linear-gradient(180deg, color-mix(in srgb, ${palette.accentStrong} 78%, ${palette.accent}) 0%, color-mix(in srgb, ${palette.accentStrong} 92%, ${palette.shellBottom}) 100%)`;
  const btnBorder = isFlat
    ? `color-mix(in srgb, ${palette.border} 80%, transparent)`
    : `color-mix(in srgb, ${palette.border} 82%, transparent)`;
  const btnHoverBorder = isFlat
    ? `${palette.border}`
    : `color-mix(in srgb, ${palette.border} 94%, ${palette.accent} 8%)`;
  const btnActiveBorder = isFlat
    ? `color-mix(in srgb, ${palette.accent} 42%, ${palette.accentStrong})`
    : `color-mix(in srgb, ${palette.accent} 54%, ${palette.accentStrong})`;
  const btnColor = isFlat
    ? `${palette.textSoft}`
    : `${palette.textSoft}`;
  const btnHoverColor = isFlat
    ? `${palette.textMain}`
    : `${palette.textMain}`;
  const btnActiveColor = isFlat
    ? `${palette.accentText}`
    : `${palette.accentText}`;
  const btnActiveShadow = isFlat
    ? `0 10px 24px color-mix(in srgb, ${palette.accentStrong} 18%, transparent)`
    : `0 12px 28px color-mix(in srgb, ${palette.accentStrong} 20%, transparent)`;
  const btnDangerBg = isFlat
    ? `color-mix(in srgb, ${palette.danger} 8%, ${palette.panelBg})`
    : `color-mix(in srgb, ${palette.danger} 8%, ${palette.panelBg})`;
  const btnDangerBorder = isFlat
    ? `color-mix(in srgb, ${palette.danger} 22%, transparent)`
    : `color-mix(in srgb, ${palette.danger} 22%, transparent)`;
  const btnDangerColor = isFlat
    ? `${palette.danger}`
    : `${palette.danger}`;
  const btnDangerHoverBg = isFlat
    ? `color-mix(in srgb, ${palette.danger} 14%, ${palette.panelBg})`
    : `color-mix(in srgb, ${palette.danger} 14%, ${palette.panelBg})`;
  const btnDangerHoverBorder = isFlat
    ? `color-mix(in srgb, ${palette.danger} 34%, transparent)`
    : `color-mix(in srgb, ${palette.danger} 34%, transparent)`;
  const btnFocusRing = isFlat
    ? `0 0 0 3px color-mix(in srgb, ${palette.borderStrong} 42%, transparent)`
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
    `--nb-accent-surface:color-mix(in srgb, ${palette.accent} ${isFlat ? 10 : 22}%, ${isFlat ? palette.panelBg : palette.shellBottom})`,
    `--nb-accent-surface-strong:color-mix(in srgb, ${palette.accentStrong} ${isFlat ? 14 : 34}%, ${isFlat ? palette.panelBg : palette.shellTop})`,
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

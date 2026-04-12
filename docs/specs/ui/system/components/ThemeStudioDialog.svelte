<script lang="ts">
  import AppDialog from './AppDialog.svelte';
  import NearbytesLogo from './NearbytesLogo.svelte';
  import StatusNotice from './StatusNotice.svelte';
  import type { NearbytesArcStyle, NearbytesSurfaceStyle } from '../../../../../ui/src/lib/branding.ts';

  type ThemeDialogSection = 'preset' | 'material' | 'accent' | 'logo';

  type ThemePreset = {
    presetId: string;
    palette: {
      label: string;
      description: string;
      appBg: string;
      accent: string;
    };
    logo: {
      peerColor: string;
    };
  };

  type ThemeSettings = {
    presetId: string;
    palette: {
      label?: string;
      description?: string;
      surfaceStyle: NearbytesSurfaceStyle;
      appBg: string;
      shellTop: string;
      shellBottom: string;
      shellGlow: string;
      panelBg: string;
      panelGlow: string;
      border: string;
      borderStrong: string;
      textMain: string;
      textSoft: string;
      textFaint: string;
      accentText: string;
      accent: string;
      accentStrong: string;
      accentSoft: string;
      success: string;
      warning: string;
      danger: string;
    };
    logo: {
      accentColor: string;
      peerColor: string;
      arcColor: string;
      bgFill: string;
      nodeFill: string;
      nodeStroke: string;
      peers: number;
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
  };

  type ThemeFeedback = {
    tone: 'success' | 'warning';
    message: string;
  };

  let {
    themeSettings,
    themeRegistry,
    activePreset,
    section = 'preset',
    busy = false,
    errorMessage = '',
    feedback = null,
    onClose = undefined,
    onSetSection = undefined,
    onApplyPreset = undefined,
    onUpdateSurfaceStyle = undefined,
    onUpdatePaletteColor = undefined,
    onUpdateLogoColor = undefined,
    onUpdateLogoNumber = undefined,
    onUpdateArcStyle = undefined,
    onSavePresetJson = undefined,
    onSetAsDefault = undefined,
    onExportLogoPng = undefined,
    onResetToPreset = undefined,
    onLogoPreviewChange = undefined,
  } = $props<{
    themeSettings: ThemeSettings;
    themeRegistry: { presets: ThemePreset[] };
    activePreset: ThemePreset;
    section?: ThemeDialogSection;
    busy?: boolean;
    errorMessage?: string;
    feedback?: ThemeFeedback | null;
    onClose?: (() => void) | undefined;
    onSetSection?: ((value: ThemeDialogSection) => void) | undefined;
    onApplyPreset?: ((presetId: string) => void) | undefined;
    onUpdateSurfaceStyle?: ((value: NearbytesSurfaceStyle) => void) | undefined;
    onUpdatePaletteColor?: ((key: keyof ThemeSettings['palette'], value: string) => void) | undefined;
    onUpdateLogoColor?: ((key: 'accentColor' | 'peerColor' | 'arcColor' | 'bgFill' | 'nodeFill' | 'nodeStroke', value: string) => void) | undefined;
    onUpdateLogoNumber?: ((key: 'peers' | 'orbitScale' | 'sizeScale' | 'bulgeScale' | 'lineWeight' | 'circleStroke' | 'pulseSpeed' | 'pulseMag' | 'luminosity' | 'contrast', value: number) => void) | undefined;
    onUpdateArcStyle?: ((value: NearbytesArcStyle) => void) | undefined;
    onSavePresetJson?: (() => void | Promise<void>) | undefined;
    onSetAsDefault?: (() => void | Promise<void>) | undefined;
    onExportLogoPng?: (() => void | Promise<void>) | undefined;
    onResetToPreset?: (() => void) | undefined;
    onLogoPreviewChange?: ((value: any) => void) | undefined;
  }>();

  let logoPreview = $state<any>(null);

  $effect(() => {
    onLogoPreviewChange?.(logoPreview);
  });
</script>

<AppDialog
  ariaLabel="Appearance settings"
  eyebrow="Appearance"
  title="Brand system"
  width="xwide"
  closeLabel="Close appearance dialog"
  onClose={onClose}
>
  {#snippet body()}
    <section class="theme-dialog-section theme-dialog-hero">
      <div class="theme-dialog-preview-mark">
        <NearbytesLogo bind:this={logoPreview} size={132} options={themeSettings.logo} ariaLabel="Current Nearbytes logo preview" />
      </div>
      <div class="theme-dialog-preview-copy">
        <p class="theme-dialog-section-title">{activePreset.palette.label}</p>
        <p class="theme-dialog-note">{activePreset.palette.description}</p>
        <div class="theme-dialog-chip-row">
          <span class="theme-studio-chip strong">Accent {themeSettings.palette.accent}</span>
          <span class="theme-studio-chip">{themeSettings.logo.arcStyle}</span>
          <span class="theme-studio-chip">{themeSettings.logo.peers} peers</span>
        </div>
      </div>
    </section>

    <section class="theme-dialog-section">
      <div class="theme-dialog-tab-row" role="tablist" aria-label="Appearance sections">
        <button type="button" class="theme-dialog-tab" class:active={section === 'preset'} onclick={() => onSetSection?.('preset')}>Presets</button>
        <button type="button" class="theme-dialog-tab" class:active={section === 'material'} onclick={() => onSetSection?.('material')}>Material</button>
        <button type="button" class="theme-dialog-tab" class:active={section === 'accent'} onclick={() => onSetSection?.('accent')}>Accent</button>
        <button type="button" class="theme-dialog-tab" class:active={section === 'logo'} onclick={() => onSetSection?.('logo')}>Logo</button>
      </div>

      {#if section === 'preset'}
        <div class="theme-preset-grid">
          {#each themeRegistry.presets as preset (preset.presetId)}
            <button
              type="button"
              class="theme-preset-card"
              class:active={themeSettings.presetId === preset.presetId}
              onclick={() => onApplyPreset?.(preset.presetId)}
            >
              <span class="theme-preset-swatches">
                <span style:background={preset.palette.appBg}></span>
                <span style:background={preset.palette.accent}></span>
                <span style:background={preset.logo.peerColor}></span>
              </span>
              <span class="theme-preset-copy">
                <strong>{preset.palette.label}</strong>
                <span>{preset.palette.description}</span>
              </span>
            </button>
          {/each}
        </div>
      {:else if section === 'material'}
        <div class="theme-form-grid theme-form-grid-wide">
          <label>
            <span>Surface style</span>
            <select
              value={themeSettings.palette.surfaceStyle}
              oninput={(event) => onUpdateSurfaceStyle?.((event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="gradient">Gradient</option>
              <option value="flat">Flat</option>
            </select>
          </label>
          <label><span>App background</span><input type="color" value={themeSettings.palette.appBg} oninput={(event) => onUpdatePaletteColor?.('appBg', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Shell top</span><input type="text" value={themeSettings.palette.shellTop} oninput={(event) => onUpdatePaletteColor?.('shellTop', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Shell bottom</span><input type="text" value={themeSettings.palette.shellBottom} oninput={(event) => onUpdatePaletteColor?.('shellBottom', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Shell glow</span><input type="text" value={themeSettings.palette.shellGlow} oninput={(event) => onUpdatePaletteColor?.('shellGlow', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Panel background</span><input type="text" value={themeSettings.palette.panelBg} oninput={(event) => onUpdatePaletteColor?.('panelBg', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Panel glow</span><input type="text" value={themeSettings.palette.panelGlow} oninput={(event) => onUpdatePaletteColor?.('panelGlow', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Border</span><input type="text" value={themeSettings.palette.border} oninput={(event) => onUpdatePaletteColor?.('border', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Border strong</span><input type="text" value={themeSettings.palette.borderStrong} oninput={(event) => onUpdatePaletteColor?.('borderStrong', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Main text</span><input type="text" value={themeSettings.palette.textMain} oninput={(event) => onUpdatePaletteColor?.('textMain', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Soft text</span><input type="text" value={themeSettings.palette.textSoft} oninput={(event) => onUpdatePaletteColor?.('textSoft', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Faint text</span><input type="text" value={themeSettings.palette.textFaint} oninput={(event) => onUpdatePaletteColor?.('textFaint', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Accent text</span><input type="text" value={themeSettings.palette.accentText} oninput={(event) => onUpdatePaletteColor?.('accentText', (event.currentTarget as HTMLInputElement).value)} /></label>
        </div>
      {:else if section === 'accent'}
        <div class="theme-form-grid">
          <label><span>Accent</span><input type="color" value={themeSettings.palette.accent} oninput={(event) => onUpdatePaletteColor?.('accent', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Accent strong</span><input type="color" value={themeSettings.palette.accentStrong} oninput={(event) => onUpdatePaletteColor?.('accentStrong', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Accent soft</span><input type="text" value={themeSettings.palette.accentSoft} oninput={(event) => onUpdatePaletteColor?.('accentSoft', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Success</span><input type="color" value={themeSettings.palette.success} oninput={(event) => onUpdatePaletteColor?.('success', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Warning</span><input type="color" value={themeSettings.palette.warning} oninput={(event) => onUpdatePaletteColor?.('warning', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Danger</span><input type="color" value={themeSettings.palette.danger} oninput={(event) => onUpdatePaletteColor?.('danger', (event.currentTarget as HTMLInputElement).value)} /></label>
        </div>
      {:else}
        <div class="theme-form-grid logo-grid">
          <label><span>Accent node</span><input type="color" value={themeSettings.logo.accentColor} oninput={(event) => onUpdateLogoColor?.('accentColor', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Peer node</span><input type="color" value={themeSettings.logo.peerColor} oninput={(event) => onUpdateLogoColor?.('peerColor', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Arc color</span><input type="color" value={themeSettings.logo.arcColor} oninput={(event) => onUpdateLogoColor?.('arcColor', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Background</span><input type="color" value={themeSettings.logo.bgFill} oninput={(event) => onUpdateLogoColor?.('bgFill', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Node fill</span><input type="color" value={themeSettings.logo.nodeFill} oninput={(event) => onUpdateLogoColor?.('nodeFill', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Node stroke</span><input type="color" value={themeSettings.logo.nodeStroke} oninput={(event) => onUpdateLogoColor?.('nodeStroke', (event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Peers</span><input type="range" min="2" max="8" step="1" value={themeSettings.logo.peers} oninput={(event) => onUpdateLogoNumber?.('peers', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.peers}</em></label>
          <label><span>Orbit scale</span><input type="range" min="0.5" max="1.8" step="0.01" value={themeSettings.logo.orbitScale} oninput={(event) => onUpdateLogoNumber?.('orbitScale', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.orbitScale.toFixed(2)}</em></label>
          <label><span>Size scale</span><input type="range" min="0.7" max="1.8" step="0.01" value={themeSettings.logo.sizeScale} oninput={(event) => onUpdateLogoNumber?.('sizeScale', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.sizeScale.toFixed(2)}</em></label>
          <label><span>Bulge</span><input type="range" min="0.5" max="2.2" step="0.01" value={themeSettings.logo.bulgeScale} oninput={(event) => onUpdateLogoNumber?.('bulgeScale', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.bulgeScale.toFixed(2)}</em></label>
          <label><span>Line weight</span><input type="range" min="0.5" max="8" step="0.01" value={themeSettings.logo.lineWeight} oninput={(event) => onUpdateLogoNumber?.('lineWeight', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.lineWeight.toFixed(2)}</em></label>
          <label><span>Circle stroke</span><input type="range" min="0.5" max="4" step="0.01" value={themeSettings.logo.circleStroke} oninput={(event) => onUpdateLogoNumber?.('circleStroke', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.circleStroke.toFixed(2)}</em></label>
          <label><span>Pulse speed</span><input type="range" min="0.2" max="2" step="0.01" value={themeSettings.logo.pulseSpeed} oninput={(event) => onUpdateLogoNumber?.('pulseSpeed', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.pulseSpeed.toFixed(2)}</em></label>
          <label><span>Pulse magnitude</span><input type="range" min="0.2" max="2" step="0.01" value={themeSettings.logo.pulseMag} oninput={(event) => onUpdateLogoNumber?.('pulseMag', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.pulseMag.toFixed(2)}</em></label>
          <label><span>Luminosity</span><input type="range" min="-40" max="40" step="1" value={themeSettings.logo.luminosity} oninput={(event) => onUpdateLogoNumber?.('luminosity', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.luminosity}</em></label>
          <label><span>Contrast</span><input type="range" min="-60" max="60" step="1" value={themeSettings.logo.contrast} oninput={(event) => onUpdateLogoNumber?.('contrast', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.contrast}</em></label>
          <label>
            <span>Arc style</span>
            <select value={themeSettings.logo.arcStyle} oninput={(event) => onUpdateArcStyle?.((event.currentTarget as HTMLSelectElement).value)}>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
              <option value="solid">Solid</option>
            </select>
          </label>
        </div>
      {/if}

      {#if feedback}
        <StatusNotice tone={feedback.tone === 'warning' ? 'warning' : 'success'} compact={true} message={feedback.message} />
      {/if}
      {#if errorMessage}
        <StatusNotice tone="error" role="alert" compact={true} message={errorMessage} />
      {/if}

      <div class="theme-dialog-actions">
        <button type="button" class="status-link-btn secondary" disabled={busy} onclick={() => void onSavePresetJson?.()}>Save preset JSON</button>
        <button type="button" class="status-link-btn secondary" disabled={busy} onclick={() => void onSetAsDefault?.()}>Set as default</button>
        <button type="button" class="status-link-btn secondary" disabled={busy} onclick={() => void onExportLogoPng?.()}>Export logo PNG</button>
        <button type="button" class="status-link-btn secondary" onclick={() => onResetToPreset?.()}>Reset to preset</button>
        <button type="button" class="status-link-btn" onclick={() => onClose?.()}>Done</button>
      </div>
    </section>
  {/snippet}
</AppDialog>

<style>
  .theme-dialog-section {
    display: grid;
    gap: 0.9rem;
    padding: 1rem;
    border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.04));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(245, 243, 240, 0.88));
  }

  .theme-dialog-hero {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
  }

  .theme-dialog-preview-mark {
    display: inline-flex;
    padding: 0.8rem;
    border-radius: 24px;
    background: color-mix(in srgb, var(--nb-logo-bg, #f7efe9) 70%, rgba(255, 247, 241, 0.95));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 82%, rgba(0, 0, 0, 0.05));
  }

  .theme-dialog-preview-copy {
    display: grid;
    gap: 0.45rem;
  }

  .theme-dialog-section-title,
  .theme-dialog-note {
    margin: 0;
  }

  .theme-dialog-section-title {
    font-family: var(--nb-font-display);
    font-size: 0.96rem;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  .theme-dialog-note {
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.76));
    font-size: 0.84rem;
    line-height: 1.55;
  }

  .theme-form-grid-wide {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .theme-dialog-chip-row,
  .theme-dialog-tab-row,
  .theme-dialog-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
  }

  .theme-studio-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.38rem 0.72rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, rgba(252, 244, 238, 0.92));
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.78));
    font-family: var(--nb-font-body);
    font-size: 0.76rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .theme-studio-chip.strong {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 28%, rgba(60, 60, 67, 0.16));
    background: color-mix(in srgb, var(--nb-accent-soft, rgba(0, 0, 0, 0.03)) 85%, rgba(245, 243, 240, 0.98));
    color: color-mix(in srgb, var(--nb-accent-strong, #5d524a) 70%, rgba(28, 28, 30, 0.96));
  }

  .theme-dialog-tab {
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 90%, rgba(0, 0, 0, 0.04));
    background: var(--nb-btn-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, var(--nb-shell-bottom, #f4f4f7)));
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.88));
    border-radius: 999px;
    min-height: 34px;
    padding: 0 0.95rem;
    font-family: var(--nb-font-body);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }

  .theme-dialog-tab.active {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 26%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-accent-soft, rgba(0, 0, 0, 0.03)) 86%, var(--nb-panel-bg, white));
    color: color-mix(in srgb, var(--nb-accent-strong, #5d524a) 78%, rgba(28, 28, 30, 0.96));
  }

  .theme-preset-grid,
  .theme-form-grid {
    display: grid;
    gap: 0.8rem;
  }

  .theme-preset-grid {
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }

  .theme-preset-card {
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 90%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(252, 244, 238, 0.86));
    border-radius: 18px;
    padding: 0.95rem;
    display: grid;
    gap: 0.75rem;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .theme-preset-card.active {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 24%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-accent-soft, rgba(0, 0, 0, 0.03)) 82%, var(--nb-panel-bg, white));
  }

  .theme-preset-swatches {
    display: flex;
    gap: 0.5rem;
  }

  .theme-preset-swatches span {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .theme-preset-copy {
    display: grid;
    gap: 0.18rem;
  }

  .theme-preset-copy strong {
    font-family: var(--nb-font-display);
    font-size: 0.92rem;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  .theme-preset-copy span {
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.78));
  }

  .theme-form-grid {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .theme-form-grid.logo-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .theme-form-grid label {
    display: grid;
    gap: 0.45rem;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.78));
    font-family: var(--nb-font-body);
    font-size: 0.8rem;
  }

  .theme-form-grid input[type='color'],
  .theme-form-grid input[type='range'],
  .theme-form-grid select {
    width: 100%;
  }

  .theme-form-grid input[type='color'],
  .theme-form-grid select {
    min-height: 40px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 90%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(245, 243, 240, 0.88));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    padding: 0.45rem 0.6rem;
  }

  .theme-form-grid em {
    font-style: normal;
    font-size: 0.75rem;
    color: var(--nb-text-faint, rgba(110, 110, 115, 0.66));
  }

  .status-link-btn {
    appearance: none;
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.24));
    border-radius: 999px;
    background: var(--nb-btn-bg, rgba(12, 24, 43, 0.82));
    color: var(--nb-btn-color, rgba(226, 232, 240, 0.92));
    min-height: 34px;
    padding: 0 0.8rem;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .status-link-btn.secondary {
    background: var(--nb-btn-bg, rgba(8, 17, 31, 0.8));
  }

  @media (max-width: 760px) {
    .theme-dialog-hero {
      grid-template-columns: 1fr;
    }

    .theme-form-grid-wide {
      grid-template-columns: 1fr;
    }
  }
</style>
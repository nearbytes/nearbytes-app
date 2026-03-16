<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { NearbytesLogoOptions } from '../lib/branding.js';

  let {
    size = 88,
    options,
    ariaLabel = 'Nearbytes logo',
    bootAnimate = true,
  }: {
    size?: number;
    options: NearbytesLogoOptions;
    ariaLabel?: string;
    bootAnimate?: boolean;
  } = $props();

  let canvas: HTMLCanvasElement | null = null;
  let stopAnimation: (() => void) | null = null;

  type NearbytesRenderOptions = {
    bootAnimate?: boolean;
  };

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  let colorProbeContext: CanvasRenderingContext2D | null = null;

  function parseCssColor(color: string): [number, number, number] {
    if (!colorProbeContext) {
      const probeCanvas = document.createElement('canvas');
      probeCanvas.width = 1;
      probeCanvas.height = 1;
      colorProbeContext = probeCanvas.getContext('2d');
    }

    if (!colorProbeContext) {
      return [128, 128, 128];
    }

    colorProbeContext.fillStyle = '#808080';
    colorProbeContext.fillStyle = color;
    const normalized = colorProbeContext.fillStyle;
    const rgbMatch = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgbMatch) {
      return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
    }

    const hexMatch = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    if (hexMatch) {
      const value = hexMatch[1];
      if (value.length === 3) {
        return [
          Number.parseInt(`${value[0]}${value[0]}`, 16),
          Number.parseInt(`${value[1]}${value[1]}`, 16),
          Number.parseInt(`${value[2]}${value[2]}`, 16),
        ];
      }
      return [
        Number.parseInt(value.slice(0, 2), 16),
        Number.parseInt(value.slice(2, 4), 16),
        Number.parseInt(value.slice(4, 6), 16),
      ];
    }

    return [128, 128, 128];
  }

  function mixHexColors(first: string, second: string, amount: number): string {
    const [firstRed, firstGreen, firstBlue] = parseCssColor(first);
    const [secondRed, secondGreen, secondBlue] = parseCssColor(second);
    const mix = clamp(amount, 0, 1);
    const red = Math.round(firstRed + (secondRed - firstRed) * mix);
    const green = Math.round(firstGreen + (secondGreen - firstGreen) * mix);
    const blue = Math.round(firstBlue + (secondBlue - firstBlue) * mix);
    return `rgb(${red}, ${green}, ${blue})`;
  }

  function alphaColor(hex: string, alpha: number): string {
    const [red, green, blue] = parseCssColor(hex);
    return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
  }

  function traceRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
    const boundedRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + boundedRadius, y);
    context.lineTo(x + width - boundedRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + boundedRadius);
    context.lineTo(x + width, y + height - boundedRadius);
    context.quadraticCurveTo(x + width, y + height, x + width - boundedRadius, y + height);
    context.lineTo(x + boundedRadius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - boundedRadius);
    context.lineTo(x, y + boundedRadius);
    context.quadraticCurveTo(x, y, x + boundedRadius, y);
    context.closePath();
  }

  function renderAppIconSurface(context: CanvasRenderingContext2D, size: number, options: NearbytesLogoOptions): void {
    const outerInset = size * 0.07;
    const plateSize = size - outerInset * 2;
    const plateRadius = plateSize * 0.225;
    const plateX = outerInset;
    const plateY = outerInset;
    const plateTop = mixHexColors(options.bgFill, '#ffffff', 0.18);
    const plateBottom = mixHexColors(options.nodeFill, options.bgFill, 0.56);
    const plateBorder = alphaColor(options.nodeStroke, 0.18);
    const topGlow = alphaColor('#ffffff', 0.42);
    const accentGlow = alphaColor(options.accentColor, 0.16);

    context.clearRect(0, 0, size, size);
    context.save();
    context.shadowColor = alphaColor('#0f172a', 0.18);
    context.shadowBlur = size * 0.055;
    context.shadowOffsetY = size * 0.018;
    traceRoundedRect(context, plateX, plateY, plateSize, plateSize, plateRadius);
    const plateGradient = context.createLinearGradient(0, plateY, 0, plateY + plateSize);
    plateGradient.addColorStop(0, plateTop);
    plateGradient.addColorStop(0.58, mixHexColors(plateTop, plateBottom, 0.28));
    plateGradient.addColorStop(1, plateBottom);
    context.fillStyle = plateGradient;
    context.fill();
    context.restore();

    context.save();
    traceRoundedRect(context, plateX, plateY, plateSize, plateSize, plateRadius);
    context.clip();

    const gloss = context.createLinearGradient(plateX, plateY, plateX, plateY + plateSize * 0.46);
    gloss.addColorStop(0, topGlow);
    gloss.addColorStop(1, alphaColor('#ffffff', 0));
    context.fillStyle = gloss;
    context.fillRect(plateX, plateY, plateSize, plateSize * 0.46);

    const accent = context.createRadialGradient(
      plateX + plateSize * 0.7,
      plateY + plateSize * 0.18,
      plateSize * 0.04,
      plateX + plateSize * 0.7,
      plateY + plateSize * 0.18,
      plateSize * 0.42
    );
    accent.addColorStop(0, accentGlow);
    accent.addColorStop(1, alphaColor(options.accentColor, 0));
    context.fillStyle = accent;
    context.fillRect(plateX, plateY, plateSize, plateSize);
    context.restore();

    context.save();
    traceRoundedRect(context, plateX, plateY, plateSize, plateSize, plateRadius);
    context.strokeStyle = plateBorder;
    context.lineWidth = Math.max(2, size * 0.004);
    context.stroke();
    context.restore();
  }

  function nearbytesCogo(
    canvasElement: HTMLCanvasElement,
    opts: Partial<NearbytesLogoOptions> = {},
    renderOptions: NearbytesRenderOptions = {}
  ) {
    const W = canvasElement.width;
    const H = canvasElement.height;
    const context = canvasElement.getContext('2d');
    if (!context) {
      return () => {};
    }
    const ctx = context;
    const scale = W / 300;

    const nP = opts.peers ?? 3;
    const accentColor = opts.accentColor ?? '#c8a04a';
    const peerColor = opts.peerColor ?? '#d4b06a';
    const arcColor = opts.arcColor ?? '#c8a04a';
    const bgFill = opts.bgFill ?? '#f7f5f1';
    const nodeFill = opts.nodeFill ?? '#eceae4';
    const nodeStroke = opts.nodeStroke ?? '#b8b4ac';
    const orbitScale = opts.orbitScale ?? 1.0;
    const sizeScale = opts.sizeScale ?? 1.0;
    const bulgeScale = opts.bulgeScale ?? 1.0;
    const lineWeight = opts.lineWeight ?? 1.0;
    const circleStroke = opts.circleStroke ?? 1.0;
    const pulseSpeed = opts.pulseSpeed ?? 1.0;
    const pulseMag = opts.pulseMag ?? 1.0;
    const luminosity = opts.luminosity ?? 0;
    const contrast = opts.contrast ?? 0;
    const arcStyle = opts.arcStyle ?? 'dashed';
    const bootAnimate = renderOptions.bootAnimate ?? true;

    const ease = {
      outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
      outElastic: (t: number) => {
        if (t <= 0 || t >= 1) return t;
        return Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * Math.PI * 2) / 3) + 1;
      },
      outBack: (t: number) => {
        const c = 2.70158;
        return 1 + c * Math.pow(t - 1, 3) + (c - 1) * Math.pow(t - 1, 2);
      },
      outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
      outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
    };

    const prog = (t: number, s: number, e: number) => clamp((t - s) / (e - s), 0, 1);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    function parseHex(hex: string) {
      return [
        Number.parseInt(hex.slice(1, 3), 16),
        Number.parseInt(hex.slice(3, 5), 16),
        Number.parseInt(hex.slice(5, 7), 16),
      ] as const;
    }

    function adjustColor(r: number, g: number, b: number, lum: number, con: number) {
      r = clamp(r + lum * 2.55, 0, 255);
      g = clamp(g + lum * 2.55, 0, 255);
      b = clamp(b + lum * 2.55, 0, 255);
      const f = (259 * (con + 255)) / (255 * (259 - con));
      r = clamp(f * (r - 128) + 128, 0, 255);
      g = clamp(f * (g - 128) + 128, 0, 255);
      b = clamp(f * (b - 128) + 128, 0, 255);
      return [Math.round(r), Math.round(g), Math.round(b)] as const;
    }

    function hexA(hex: string, a: number, adjust = false) {
      let [r, g, b] = parseHex(hex);
      if (adjust && (luminosity !== 0 || contrast !== 0)) {
        [r, g, b] = adjustColor(r, g, b, luminosity, contrast);
      }
      return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
    }

    function visualOffsetY(n: number, r: number) {
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < n; i += 1) {
        const a = (2 * Math.PI * i) / n - Math.PI / 2;
        const y = r * Math.sin(a);
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      return -((minY + maxY) / 2) * 0.5;
    }

    function getPeers(cx: number, cy: number, r: number, n: number) {
      const peers: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < n; i += 1) {
        const a = (2 * Math.PI * i) / n - Math.PI / 2;
        peers.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
      return peers;
    }

    function quadPt(ax: number, ay: number, cpx: number, cpy: number, bx: number, by: number, t: number) {
      return {
        x: (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cpx + t * t * bx,
        y: (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cpy + t * t * by,
      };
    }

    function arcCP(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, bulge: number) {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const dx = mx - cx;
      const dy = my - cy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      return { cpx: mx + (dx / len) * bulge, cpy: my + (dy / len) * bulge };
    }

    function drawArc(ax: number, ay: number, cpx: number, cpy: number, bx: number, by: number, tEnd: number, lw: number, col: string) {
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      if (arcStyle === 'dashed') ctx.setLineDash([5 * scale, 6 * scale]);
      else if (arcStyle === 'dotted') ctx.setLineDash([1.5 * scale, 5 * scale]);
      else ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i <= 60; i += 1) {
        const t = (i / 60) * tEnd;
        const p = quadPt(ax, ay, cpx, cpy, bx, by, t);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    const cx = W / 2;
    const cy = H / 2;
    const baseOrbit = 88 * orbitScale * scale;
    const drawCY = cy + visualOffsetY(nP, baseOrbit);
    const rCenter = 18 * sizeScale * scale;
    const rPeer = 12 * sizeScale * scale;
    const pDot = 4.5 * sizeScale * scale;
    const bulge = 44 * bulgeScale * scale;
    const lw = 1.3 * lineWeight * scale;
    const cs = 1.0 * circleStroke * scale;

    let animStart: number | null = null;
    let breatheT = 0;
    let rafId = 0;

    function renderFrame(t: number, breathePhase: number) {
      const settle = clamp((t - 2.0) * 0.7, 0, 1);

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = hexA(bgFill, ease.outQuart(prog(t, 0, 0.35)));
      ctx.fillRect(0, 0, W, H);

      const peers = getPeers(cx, drawCY, baseOrbit, nP);

      peers.forEach((p, i) => {
        const d = 0.4 + i * 0.08;
        const sp = ease.outExpo(prog(t, d, d + 0.45));
        if (sp <= 0) return;
        ctx.save();
        ctx.strokeStyle = hexA(arcColor, 0.28 * sp, true);
        ctx.lineWidth = lw * 0.75;
        ctx.beginPath();
        ctx.moveTo(cx, drawCY);
        ctx.lineTo(lerp(cx, p.x, sp), lerp(drawCY, p.y, sp));
        ctx.stroke();
        ctx.restore();
      });

      for (let i = 0; i < peers.length; i += 1) {
        const j = (i + 1) % peers.length;
        const pa = peers[i];
        const pb = peers[j];
        const d = 1.2 + i * 0.15;
        const ap = ease.outCubic(prog(t, d, d + 0.6));
        if (ap <= 0) continue;
        const { cpx, cpy } = arcCP(pa.x, pa.y, pb.x, pb.y, cx, drawCY, bulge);
        drawArc(pa.x, pa.y, cpx, cpy, pb.x, pb.y, ap, lw, hexA(arcColor, 0.55 * ap, true));
      }

      peers.forEach((p, i) => {
        const d = 0.45 + i * 0.12;
        const pp = ease.outElastic(clamp(prog(t, d, d + 0.7), 0, 1));
        if (pp <= 0) return;
        const phase = i * ((Math.PI * 2) / nP);
        const bs = 1 + Math.sin(breathePhase * pulseSpeed * 0.65 + phase) * pulseMag * 0.042 * settle;
        const ro = rPeer * pp * bs;
        const ri = pDot * pp * bs;
        ctx.save();
        ctx.fillStyle = hexA(nodeFill, pp);
        ctx.strokeStyle = hexA(nodeStroke, 0.9 * pp, true);
        ctx.lineWidth = cs;
        ctx.beginPath();
        ctx.arc(p.x, p.y, ro, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = hexA(peerColor, pp);
        ctx.beginPath();
        ctx.arc(p.x, p.y, ri, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      const cp = ease.outBack(prog(t, 0.25, 1.0));
      if (cp > 0) {
        const bs = 1 + Math.sin(breathePhase * pulseSpeed * 0.65) * pulseMag * 0.055 * settle;
        const ro = rCenter * cp * bs;
        const rm = rCenter * 0.6 * cp * bs;
        const rc = rCenter * 0.22 * cp * bs;
        ctx.save();
        ctx.fillStyle = hexA(nodeFill, cp);
        ctx.strokeStyle = hexA(nodeStroke, cp, true);
        ctx.lineWidth = cs * 1.15;
        ctx.beginPath();
        ctx.arc(cx, drawCY, ro, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = hexA(accentColor, cp);
        ctx.beginPath();
        ctx.arc(cx, drawCY, rm, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexA(nodeFill, cp);
        ctx.beginPath();
        ctx.arc(cx, drawCY, rc, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    if (!bootAnimate) {
      renderFrame(4, 3.2);
      return () => {};
    }

    function tick(ts: number) {
      if (!animStart) animStart = ts;
      const t = (ts - animStart) / 1000;
      breatheT += 0.016;
      renderFrame(t, breatheT);

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return function stop() {
      cancelAnimationFrame(rafId);
    };
  }

  function restartLogo() {
    if (!canvas) {
      return;
    }
    stopAnimation?.();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    stopAnimation = nearbytesCogo(canvas, options, { bootAnimate });
  }

  export async function exportPngDataUrl(): Promise<string | null> {
    if (!canvas) {
      return null;
    }

    const exportSize = 1024;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = exportSize;
    exportCanvas.height = exportSize;
    const exportContext = exportCanvas.getContext('2d');
    if (!exportContext) {
      return canvas.toDataURL('image/png');
    }

    renderAppIconSurface(exportContext, exportSize, options);

    const logoCanvas = document.createElement('canvas');
    const logoSize = 724;
    logoCanvas.width = logoSize;
    logoCanvas.height = logoSize;
    nearbytesCogo(logoCanvas, options, { bootAnimate: false });

    const logoInset = Math.round((exportSize - logoSize) / 2);
    const logoRadius = logoSize / 2;

    exportContext.save();
    exportContext.shadowColor = alphaColor('#0f172a', 0.14);
    exportContext.shadowBlur = exportSize * 0.03;
    exportContext.shadowOffsetY = exportSize * 0.014;
    exportContext.beginPath();
    exportContext.arc(exportSize / 2, exportSize / 2, logoRadius, 0, Math.PI * 2);
    exportContext.fillStyle = alphaColor(options.nodeFill, 0.72);
    exportContext.fill();
    exportContext.restore();

    exportContext.save();
    exportContext.beginPath();
    exportContext.arc(exportSize / 2, exportSize / 2, logoRadius, 0, Math.PI * 2);
    exportContext.clip();
    exportContext.imageSmoothingEnabled = true;
    exportContext.imageSmoothingQuality = 'high';
    exportContext.drawImage(logoCanvas, logoInset, logoInset, logoSize, logoSize);
    exportContext.restore();

    exportContext.save();
    exportContext.beginPath();
    exportContext.arc(exportSize / 2, exportSize / 2, logoRadius, 0, Math.PI * 2);
    exportContext.strokeStyle = alphaColor(options.nodeStroke, 0.18);
    exportContext.lineWidth = exportSize * 0.004;
    exportContext.stroke();
    exportContext.restore();

    return exportCanvas.toDataURL('image/png');
  }

  $effect(() => {
    options;
    size;
    restartLogo();
  });

  onDestroy(() => {
    stopAnimation?.();
  });
</script>

<canvas bind:this={canvas} class="nearbytes-logo-canvas" aria-label={ariaLabel}></canvas>

<style>
  .nearbytes-logo-canvas {
    display: block;
    border-radius: 50%;
    box-shadow: none;
  }
</style>
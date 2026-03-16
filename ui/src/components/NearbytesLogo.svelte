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

  function nearbytesCogo(canvasElement: HTMLCanvasElement, opts: Partial<NearbytesLogoOptions> = {}) {
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

    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
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

    function tick(ts: number) {
      if (!animStart) animStart = ts;
      const t = bootAnimate ? (ts - animStart) / 1000 : 4;
      breatheT += 0.016;
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
        const bs = 1 + Math.sin(breatheT * pulseSpeed * 0.65 + phase) * pulseMag * 0.042 * settle;
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
        const bs = 1 + Math.sin(breatheT * pulseSpeed * 0.65) * pulseMag * 0.055 * settle;
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
    stopAnimation = nearbytesCogo(canvas, options);
  }

  export async function exportPngDataUrl(): Promise<string | null> {
    return canvas?.toDataURL('image/png') ?? null;
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
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 18px 40px rgba(2, 6, 23, 0.26);
  }
</style>
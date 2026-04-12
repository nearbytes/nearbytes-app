<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { devSurface, getDevContext } from '../dev.js';
  import {
    getRootsConfig,
    watchSources,
    watchVolume,
    getTimeline,
    type Auth,
    type RootRuntimeStatus,
    type SourceVolumeUsage,
    type SourceProvider,
    type VolumeWatchConnection,
    type VolumeWatchUpdate,
    type SourceWatchUpdate,
  } from '../../../../../ui/src/lib/api.js';
  import StatusNotice from './StatusNotice.svelte';

  let {
    auth = undefined,
    volumeId = '',
  } = $props<{
    auth?: Auth;
    volumeId?: string;
  }>();
  const dev = getDevContext();

  /* ── Types ── */
  interface StorageNode {
    id: string;
    provider: SourceProvider | string;
    path: string;
    label: string;
    enabled: boolean;
    writable: boolean;
    exists: boolean;
    canWrite: boolean;
    availableBytes?: number;
    sessionEventCount: number;
    sessionBlockCount: number;
    totalEventCount: number;
    totalBlockCount: number;
    totalStoredBytes: number;
    bandwidthInBytes: number;
    bandwidthOutBytes: number;
    x: number;
    y: number;
    radius: number;
    pulse: number;
    health: 'ok' | 'warn' | 'error' | 'offline';
    lastActivity: number;
  }

  interface Particle {
    id: number;
    fromNode: string;
    toNode: string;
    progress: number;
    speed: number;
    color: string;
    size: number;
    kind: 'event' | 'block' | 'sync';
    label: string;
    opacity: number;
    trail: Array<{ x: number; y: number; opacity: number }>;
  }

  interface ActivityEntry {
    id: number;
    timestamp: number;
    kind: 'incoming' | 'outgoing' | 'sync' | 'error';
    message: string;
    sourceNode?: string;
    targetNode?: string;
    color: string;
  }

  /* ── State ── */
  let canvas = $state<HTMLCanvasElement | null>(null);
  let container = $state<HTMLDivElement | null>(null);
  let storageNodes = $state<StorageNode[]>([]);
  let particles = $state<Particle[]>([]);
  let activityLog = $state<ActivityEntry[]>([]);
  let loading = $state(true);
  let error = $state('');
  let canvasWidth = $state(800);
  let canvasHeight = $state(500);
  let particleIdCounter = 0;
  let activityIdCounter = 0;
  let animFrameId: number | null = null;
  let sourceWatchConn: VolumeWatchConnection | null = null;
  let volumeWatchConn: VolumeWatchConnection | null = null;
  let hoveredNode = $state<string | null>(null);
  let totalEvents = $state(0);
  let totalBlocks = $state(0);
  let sessionEvents = $state(0);
  let sessionBlocks = $state(0);
  let sessionBandwidthInBytes = $state(0);
  let sessionBandwidthOutBytes = $state(0);
  let lastRefresh = $state(0);
  let statsRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  const baselineUsageByNode = new Map<string, SourceVolumeUsage>();
  const previousUsageByNode = new Map<string, SourceVolumeUsage>();
  const EMPTY_USAGE: SourceVolumeUsage = {
    volumeId: '',
    historyBytes: 0,
    historyFileCount: 0,
    fileBytes: 0,
    fileCount: 0,
  };

  const PROVIDER_COLORS: Record<string, string> = {
    local: '#22d3ee',
    mega: '#ef4444',
    gdrive: '#facc15',
    github: '#a78bfa',
    dropbox: '#3b82f6',
    icloud: '#f472b6',
    onedrive: '#06b6d4',
  };

  const PROVIDER_ICONS: Record<string, string> = {
    local: '💻',
    mega: '☁️',
    gdrive: '📁',
    github: '🐙',
    dropbox: '📦',
    icloud: '🍎',
    onedrive: '🌐',
  };

  /* ── Layout ── */
  function layoutNodes(sources: RootRuntimeStatus[]): StorageNode[] {
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const orbitRadius = Math.min(canvasWidth, canvasHeight) * 0.32;
    const count = sources.length;

    return sources.map((src, i) => {
      const angle = (i / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
      const health: StorageNode['health'] =
        !src.exists ? 'offline'
        : !src.canWrite && src.writable ? 'warn'
        : src.enabled ? 'ok'
        : 'error';

      return {
        id: src.id,
        provider: src.provider,
        path: src.path,
        label: src.id.replace(/^src-/, ''),
        enabled: src.enabled,
        writable: src.writable,
        exists: src.exists,
        canWrite: src.canWrite,
        availableBytes: src.availableBytes,
        x: cx + Math.cos(angle) * orbitRadius,
        y: cy + Math.sin(angle) * orbitRadius,
        radius: 32,
        pulse: 0,
        health,
        sessionEventCount: 0,
        sessionBlockCount: 0,
        totalEventCount: 0,
        totalBlockCount: 0,
        totalStoredBytes: 0,
        bandwidthInBytes: 0,
        bandwidthOutBytes: 0,
        lastActivity: 0,
      };
    });
  }

  function aggregateVolumeUsage(usage: RootRuntimeStatus['usage']): SourceVolumeUsage {
    if (volumeId) {
      return usage.volumeUsages.find((entry) => entry.volumeId === volumeId) ?? EMPTY_USAGE;
    }
    return usage.volumeUsages.reduce<SourceVolumeUsage>((aggregate, entry) => ({
      volumeId: '',
      historyBytes: aggregate.historyBytes + entry.historyBytes,
      historyFileCount: aggregate.historyFileCount + entry.historyFileCount,
      fileBytes: aggregate.fileBytes + entry.fileBytes,
      fileCount: aggregate.fileCount + entry.fileCount,
    }), EMPTY_USAGE);
  }

  function scheduleStatsRefresh(delayMs = 350): void {
    if (statsRefreshTimer) {
      clearTimeout(statsRefreshTimer);
    }
    statsRefreshTimer = setTimeout(() => {
      statsRefreshTimer = null;
      void loadStorageState();
    }, delayMs);
  }

  /* ── Particles ── */
  function spawnParticle(fromId: string, toId: string, kind: Particle['kind'], label: string): void {
    const color =
      kind === 'event' ? '#22d3ee'
      : kind === 'block' ? '#a78bfa'
      : '#facc15';

    particles = [...particles, {
      id: particleIdCounter++,
      fromNode: fromId,
      toNode: toId,
      progress: 0,
      speed: 0.008 + Math.random() * 0.006,
      color,
      size: kind === 'event' ? 5 : kind === 'block' ? 4 : 3,
      kind,
      label,
      opacity: 1,
      trail: [],
    }];
  }

  function spawnReplicationBurst(sourceId: string, eventLabel: string): void {
    const otherNodes = storageNodes.filter(n => n.id !== sourceId && n.enabled);
    for (const target of otherNodes) {
      setTimeout(() => {
        spawnParticle(sourceId, target.id, 'sync', eventLabel);
      }, Math.random() * 400);
    }
  }

  function addActivity(kind: ActivityEntry['kind'], message: string, sourceNode?: string, targetNode?: string): void {
    const colors = { incoming: '#22d3ee', outgoing: '#a78bfa', sync: '#facc15', error: '#ef4444' };
    activityLog = [{
      id: activityIdCounter++,
      timestamp: Date.now(),
      kind,
      message,
      sourceNode,
      targetNode,
      color: colors[kind],
    }, ...activityLog].slice(0, 50);
  }

  /* ── Data Loading ── */
  async function loadStorageState(): Promise<void> {
    try {
      loading = true;
      error = '';
      const rootsResp = await getRootsConfig({ includeUsage: true });
      const nextNodes = layoutNodes(rootsResp.runtime.sources);

      for (const node of nextNodes) {
        const source = rootsResp.runtime.sources.find((entry) => entry.id === node.id);
        if (!source) {
          continue;
        }
        const currentUsage = aggregateVolumeUsage(source.usage);
        const baselineUsage = baselineUsageByNode.get(node.id) ?? currentUsage;
        const previousUsage = previousUsageByNode.get(node.id) ?? currentUsage;

        if (!baselineUsageByNode.has(node.id)) {
          baselineUsageByNode.set(node.id, baselineUsage);
        }

        const currentTotalBytes = currentUsage.historyBytes + currentUsage.fileBytes;
        const previousTotalBytes = previousUsage.historyBytes + previousUsage.fileBytes;
        const byteDelta = currentTotalBytes - previousTotalBytes;

        node.sessionEventCount = Math.max(0, currentUsage.historyFileCount - baselineUsage.historyFileCount);
        node.sessionBlockCount = Math.max(0, currentUsage.fileCount - baselineUsage.fileCount);
        node.totalEventCount = currentUsage.historyFileCount;
        node.totalBlockCount = currentUsage.fileCount;
        node.totalStoredBytes = currentTotalBytes;
        node.bandwidthInBytes = Math.max(0, byteDelta);
        node.bandwidthOutBytes = Math.max(0, -byteDelta);

        previousUsageByNode.set(node.id, currentUsage);
      }

      storageNodes = nextNodes;
      sessionEvents = nextNodes.reduce((sum, node) => sum + node.sessionEventCount, 0);
      sessionBlocks = nextNodes.reduce((sum, node) => sum + node.sessionBlockCount, 0);
      sessionBandwidthInBytes = nextNodes.reduce((sum, node) => sum + node.bandwidthInBytes, 0);
      sessionBandwidthOutBytes = nextNodes.reduce((sum, node) => sum + node.bandwidthOutBytes, 0);
      totalBlocks = nextNodes.reduce((sum, node) => sum + node.totalBlockCount, 0);

      if (auth && volumeId) {
        try {
          const timeline = await getTimeline(auth);
          totalEvents = timeline.eventCount;
        } catch { /* no volume open */ }
      } else {
        totalEvents = nextNodes.reduce((sum, node) => sum + node.totalEventCount, 0);
      }

      lastRefresh = Date.now();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  /* ── Watch Streams ── */
  function connectWatchers(): void {
    disconnectWatchers();

    sourceWatchConn = watchSources({
      onReady(event) {
        addActivity('incoming', `Source watcher ready (${event.providers.join(', ')})`);
      },
      onUpdate(event: SourceWatchUpdate) {
        addActivity('sync', `Sources rescan: ${event.changedPaths.length} paths changed`);
        for (const node of storageNodes) {
          node.pulse = 1;
          node.lastActivity = Date.now();
        }
        scheduleStatsRefresh();
        // Visual: spawn sync particles between all pairs
        if (storageNodes.length >= 2) {
          spawnParticle(storageNodes[0].id, storageNodes[storageNodes.length - 1].id, 'sync', 'rescan');
        }
      },
      onError(err) {
        const msg = err instanceof Error ? err.message : 'message' in err ? err.message : 'Unknown error';
        addActivity('error', `Source watcher error: ${msg}`);
      },
    });

    if (auth) {
      volumeWatchConn = watchVolume(auth, {
        onReady(event) {
          addActivity('incoming', `Volume watcher ready for ${event.volumeId.slice(0, 12)}…`);
        },
        onUpdate(event: VolumeWatchUpdate) {
          const isBlock = event.path.includes('blocks');
          const isChannel = event.path.includes('channels');
          const fileName = event.path.split(/[/\\]/).pop() ?? event.path;

          // Determine which node received this
          const primaryNode = storageNodes.find(n => n.provider === 'local') ?? storageNodes[0];
          if (!primaryNode) return;

          primaryNode.pulse = 1;
          primaryNode.lastActivity = Date.now();

          if (event.change === 'add' || event.change === 'change') {
            if (isChannel) {
              addActivity('incoming', `Event: ${fileName.slice(0, 16)}… (${event.change})`, undefined, primaryNode.id);
              // Spawn replication particles to other nodes
              spawnReplicationBurst(primaryNode.id, fileName.slice(0, 8));
            } else if (isBlock) {
              addActivity('incoming', `Block: ${fileName.slice(0, 16)}… (${event.change})`, undefined, primaryNode.id);
              spawnReplicationBurst(primaryNode.id, fileName.slice(0, 8));
            }
          } else if (event.change === 'unlink') {
            addActivity('outgoing', `Removed: ${fileName.slice(0, 16)}…`, primaryNode.id);
          }
          scheduleStatsRefresh(250);
        },
        onError(err) {
          const msg = err instanceof Error ? err.message : 'message' in err ? err.message : 'Unknown error';
          addActivity('error', `Volume watcher error: ${msg}`);
        },
      });
    }
  }

  function disconnectWatchers(): void {
    sourceWatchConn?.close();
    sourceWatchConn = null;
    volumeWatchConn?.close();
    volumeWatchConn = null;
  }

  /* ── Canvas Rendering ── */
  function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  function drawFrame(): void {
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) {
      animFrameId = requestAnimationFrame(drawFrame);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;

    // Draw orbit ring
    const orbitRadius = Math.min(canvasWidth, canvasHeight) * 0.32;
    ctx.beginPath();
    ctx.arc(cx, cy, orbitRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw center hub
    const hubGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40);
    hubGrad.addColorStop(0, 'rgba(34, 211, 238, 0.18)');
    hubGrad.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, 40, 0, Math.PI * 2);
    ctx.fillStyle = hubGrad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.7)';
    ctx.fill();

    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.5)';
    ctx.fillText(volumeId ? `Hub ${volumeId.slice(0, 8)}…` : 'Nearbytes', cx, cy + 22);

    // Draw connection lines from center to nodes
    for (const node of storageNodes) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(node.x, node.y);
      ctx.strokeStyle = node.health === 'ok'
        ? 'rgba(56, 189, 248, 0.1)'
        : node.health === 'warn'
        ? 'rgba(250, 204, 21, 0.1)'
        : 'rgba(239, 68, 68, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw particles with trails
    const aliveParticles: Particle[] = [];
    for (const p of particles) {
      const fromNode = storageNodes.find(n => n.id === p.fromNode);
      const toNode = storageNodes.find(n => n.id === p.toNode);
      if (!fromNode || !toNode) continue;

      // Use center hub as intermediate for visual clarity
      let px: number, py: number;
      if (p.progress < 0.4) {
        // from source to center
        const t = p.progress / 0.4;
        px = lerp(fromNode.x, cx, t);
        py = lerp(fromNode.y, cy, t);
      } else {
        // from center to target
        const t = (p.progress - 0.4) / 0.6;
        px = lerp(cx, toNode.x, t);
        py = lerp(cy, toNode.y, t);
      }

      // Store trail
      p.trail.push({ x: px, y: py, opacity: p.opacity });
      if (p.trail.length > 12) p.trail.shift();

      // Draw trail
      for (let i = 0; i < p.trail.length; i++) {
        const t = p.trail[i];
        const trailOpacity = (i / p.trail.length) * 0.4 * t.opacity;
        ctx.beginPath();
        ctx.arc(t.x, t.y, p.size * 0.6 * (i / p.trail.length), 0, Math.PI * 2);
        ctx.fillStyle = p.color.replace(')', `, ${trailOpacity})`).replace('rgb', 'rgba');
        ctx.fill();
      }

      // Draw particle glow
      const glowGrad = ctx.createRadialGradient(px, py, 0, px, py, p.size * 3);
      glowGrad.addColorStop(0, p.color.replace(')', `, ${0.3 * p.opacity})`).replace('rgb', 'rgba'));
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(px, py, p.size * 3, 0, Math.PI * 2);
      ctx.fillStyle = glowGrad;
      ctx.fill();

      // Draw particle core
      ctx.beginPath();
      ctx.arc(px, py, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.opacity;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Advance
      p.progress += p.speed;
      if (p.progress < 1) {
        aliveParticles.push(p);
      } else {
        // Arrival flash on target node
        const tn = toNode;
        tn.pulse = Math.min(1, tn.pulse + 0.5);
        tn.lastActivity = Date.now();
      }
    }
    particles = aliveParticles;

    // Draw nodes
    for (const node of storageNodes) {
      const isHovered = hoveredNode === node.id;
      const color = PROVIDER_COLORS[node.provider] ?? '#94a3b8';

      // Pulse glow
      if (node.pulse > 0) {
        const pulseRadius = node.radius + node.pulse * 20;
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
          const pulseGrad = ctx.createRadialGradient(node.x, node.y, node.radius, node.x, node.y, pulseRadius);
          pulseGrad.addColorStop(0, `rgba(${r},${g},${b},${0.3 * node.pulse})`);
          pulseGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.arc(node.x, node.y, pulseRadius, 0, Math.PI * 2);
          ctx.fillStyle = pulseGrad;
        ctx.fill();
        node.pulse = Math.max(0, node.pulse - 0.015);
      }

      // Node body
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      const bodyGrad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.radius);
      bodyGrad.addColorStop(0, `rgba(${r},${g},${b},${isHovered ? 0.35 : 0.2})`);
      bodyGrad.addColorStop(1, `rgba(${r},${g},${b},${isHovered ? 0.1 : 0.05})`);
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = bodyGrad;
      ctx.fill();

      // Node ring
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.strokeStyle = node.health === 'ok'
        ? `rgba(${r},${g},${b},${isHovered ? 0.8 : 0.4})`
        : node.health === 'warn'
        ? `rgba(250,204,21,${isHovered ? 0.8 : 0.5})`
        : node.health === 'offline'
        ? 'rgba(100,100,100,0.3)'
        : `rgba(239,68,68,${isHovered ? 0.8 : 0.5})`;
      ctx.lineWidth = isHovered ? 2 : 1.5;
      ctx.stroke();

      // Health dot
      const dotColor =
        node.health === 'ok' ? '#22c55e'
        : node.health === 'warn' ? '#facc15'
        : node.health === 'offline' ? '#6b7280'
        : '#ef4444';
      ctx.beginPath();
      ctx.arc(node.x + node.radius * 0.7, node.y - node.radius * 0.7, 4, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();

      // Provider icon & label
      const icon = PROVIDER_ICONS[node.provider] ?? '📂';
      ctx.font = '16px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(icon, node.x, node.y + 5);

      ctx.font = `${isHovered ? 'bold ' : ''}10px system-ui, sans-serif`;
      ctx.fillStyle = `rgba(226,232,240,${isHovered ? 0.95 : 0.7})`;
      ctx.fillText(node.label, node.x, node.y + node.radius + 14);

      // Stats below
      if (node.totalEventCount > 0 || node.totalBlockCount > 0) {
        ctx.font = '9px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(148,163,184,0.6)';
        ctx.fillText(`Σ ${node.totalEventCount}E ${node.totalBlockCount}B`, node.x, node.y + node.radius + 26);
      }
    }

    ctx.restore();
    animFrameId = requestAnimationFrame(drawFrame);
  }

  /* ── Canvas sizing ── */
  function updateCanvasSize(): void {
    if (!container || !canvas) return;
    const rect = container.getBoundingClientRect();
    canvasWidth = Math.max(400, rect.width);
    canvasHeight = Math.max(300, rect.height - 140);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    // Re-layout nodes
    if (storageNodes.length > 0) {
      const orbitRadius = Math.min(canvasWidth, canvasHeight) * 0.32;
      const cx = canvasWidth / 2;
      const cy = canvasHeight / 2;
      const count = storageNodes.length;
      storageNodes.forEach((node, i) => {
        const angle = (i / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
        node.x = cx + Math.cos(angle) * orbitRadius;
        node.y = cy + Math.sin(angle) * orbitRadius;
      });
    }
  }

  function handleCanvasMouseMove(e: MouseEvent): void {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let found: string | null = null;
    for (const node of storageNodes) {
      const dx = mx - node.x;
      const dy = my - node.y;
      if (dx * dx + dy * dy <= (node.radius + 8) * (node.radius + 8)) {
        found = node.id;
        break;
      }
    }
    hoveredNode = found;
  }

  function handleCanvasMouseLeave(): void {
    hoveredNode = null;
  }

  /* ── Lifecycle ── */
  onMount(() => {
    const resizeObserver = new ResizeObserver(() => updateCanvasSize());

    void (async () => {
      await loadStorageState();
      updateCanvasSize();
      animFrameId = requestAnimationFrame(drawFrame);
      connectWatchers();
      if (container) resizeObserver.observe(container);
    })();

    return () => {
      resizeObserver.disconnect();
    };
  });

  onDestroy(() => {
    if (animFrameId !== null) cancelAnimationFrame(animFrameId);
    if (statsRefreshTimer) clearTimeout(statsRefreshTimer);
    disconnectWatchers();
  });

  /* ── Formatting ── */
  function formatBytes(bytes: number | undefined): string {
    if (bytes === undefined) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(1)} GB`;
  }

  function timeAgo(ts: number): string {
    if (!ts) return '—';
    const diff = Date.now() - ts;
    if (diff < 1000) return 'just now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  }
</script>

<div class="event-flow-panel" bind:this={container} use:devSurface={{ enabled: $dev, name: 'EventFlowPanel' }}>
  <div class="ef-header">
    <div class="ef-title-row">
      <h2 class="ef-title">Event Flow</h2>
      <div class="ef-stats">
        <span class="ef-stat"><span class="ef-stat-dot event"></span>{totalEvents} events</span>
        <span class="ef-stat"><span class="ef-stat-dot block"></span>{totalBlocks} blocks</span>
        <span class="ef-stat"><span class="ef-stat-dot sync"></span>session +{sessionEvents}E +{sessionBlocks}B</span>
        <span class="ef-stat"><span class="ef-stat-dot sync"></span>{formatBytes(sessionBandwidthInBytes)} in / {formatBytes(sessionBandwidthOutBytes)} out</span>
        <span class="ef-stat"><span class="ef-stat-dot node"></span>{storageNodes.length} storage nodes</span>
      </div>
    </div>
    <div class="ef-legend">
      <span class="ef-legend-item"><span class="ef-legend-swatch" style="background:#22d3ee"></span>Events</span>
      <span class="ef-legend-item"><span class="ef-legend-swatch" style="background:#a78bfa"></span>Blocks</span>
      <span class="ef-legend-item"><span class="ef-legend-swatch" style="background:#facc15"></span>Sync</span>
      <button type="button" class="ef-refresh-btn" onclick={() => loadStorageState()} disabled={loading}>
        {loading ? '⟳' : '↻'} Refresh
      </button>
    </div>
  </div>

  {#if error}
    <StatusNotice tone="error" role="alert" compact={true} message={error} />
  {/if}

  <div class="ef-canvas-wrap">
    <canvas
      bind:this={canvas}
      class="ef-canvas"
      onmousemove={handleCanvasMouseMove}
      onmouseleave={handleCanvasMouseLeave}
    ></canvas>

    {#if hoveredNode}
      {@const node = storageNodes.find(n => n.id === hoveredNode)}
      {#if node}
        <div class="ef-tooltip" style="left:{Math.min(node.x + 44, canvasWidth - 200)}px;top:{Math.max(node.y - 20, 8)}px">
          <div class="ef-tooltip-provider">{PROVIDER_ICONS[node.provider] ?? '📂'} {node.provider}</div>
          <div class="ef-tooltip-path">{node.path}</div>
          <div class="ef-tooltip-stats">
            <span>Session events: +{node.sessionEventCount}</span>
            <span>Session blocks: +{node.sessionBlockCount}</span>
            <span>Total events: {node.totalEventCount}</span>
            <span>Total blocks: {node.totalBlockCount}</span>
            <span>Bandwidth in: {formatBytes(node.bandwidthInBytes)}</span>
            <span>Bandwidth out: {formatBytes(node.bandwidthOutBytes)}</span>
            <span>Stored here: {formatBytes(node.totalStoredBytes)}</span>
            <span>Free: {formatBytes(node.availableBytes)}</span>
          </div>
          <div class="ef-tooltip-health">
            Status: <span class="ef-health-badge {node.health}">{node.health}</span>
            {#if !node.canWrite && node.writable}<span class="ef-health-note">⚠ read-only</span>{/if}
          </div>
        </div>
      {/if}
    {/if}
  </div>

  <div class="ef-activity">
    <h3 class="ef-activity-title">Activity Stream</h3>
    <div class="ef-activity-list">
      {#if activityLog.length === 0}
        <div class="ef-activity-empty">Watching for real events… particles appear only when the source or volume watchers observe storage activity.</div>
      {/if}
      {#each activityLog as entry (entry.id)}
        <div class="ef-activity-entry" style="border-left-color:{entry.color}">
          <span class="ef-activity-kind" style="color:{entry.color}">
            {entry.kind === 'incoming' ? '↓' : entry.kind === 'outgoing' ? '↑' : entry.kind === 'sync' ? '⇄' : '⚠'}
          </span>
          <span class="ef-activity-msg">{entry.message}</span>
          <span class="ef-activity-time">{timeAgo(entry.timestamp)}</span>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .event-flow-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--nb-surface-bg, rgba(8, 16, 32, 0.96));
    color: var(--nb-text-primary, rgba(226, 232, 240, 0.92));
    overflow: hidden;
  }

  .ef-header {
    padding: 16px 20px 8px;
    flex-shrink: 0;
  }

  .ef-title-row {
    display: flex;
    align-items: baseline;
    gap: 16px;
    flex-wrap: wrap;
  }

  .ef-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: rgba(226, 232, 240, 0.95);
  }

  .ef-stats {
    display: flex;
    gap: 14px;
    font-size: 0.73rem;
    color: rgba(148, 163, 184, 0.7);
  }

  .ef-stat {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .ef-stat-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    display: inline-block;
  }
  .ef-stat-dot.event { background: #22d3ee; }
  .ef-stat-dot.block { background: #a78bfa; }
  .ef-stat-dot.node { background: #22c55e; }

  .ef-legend {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: 6px;
    font-size: 0.68rem;
    color: rgba(148, 163, 184, 0.55);
  }

  .ef-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .ef-legend-swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  .ef-refresh-btn {
    margin-left: auto;
    background: rgba(56, 189, 248, 0.08);
    border: 1px solid rgba(56, 189, 248, 0.18);
    color: rgba(56, 189, 248, 0.8);
    border-radius: 4px;
    padding: 2px 10px;
    font-size: 0.68rem;
    cursor: pointer;
    transition: background 0.15s;
  }
  .ef-refresh-btn:hover:not(:disabled) {
    background: rgba(56, 189, 248, 0.16);
  }
  .ef-refresh-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .ef-error {
    padding: 8px 20px;
    color: #fca5a5;
    font-size: 0.78rem;
    background: rgba(239, 68, 68, 0.08);
  }

  .ef-canvas-wrap {
    flex: 1;
    min-height: 200px;
    position: relative;
    overflow: hidden;
  }

  .ef-canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: crosshair;
  }

  .ef-tooltip {
    position: absolute;
    background: rgba(12, 24, 43, 0.95);
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 0.72rem;
    pointer-events: none;
    z-index: 10;
    min-width: 160px;
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .ef-tooltip-provider {
    font-weight: 700;
    font-size: 0.8rem;
    margin-bottom: 4px;
    text-transform: capitalize;
  }

  .ef-tooltip-path {
    color: rgba(148, 163, 184, 0.6);
    font-size: 0.66rem;
    word-break: break-all;
    margin-bottom: 6px;
  }

  .ef-tooltip-stats {
    display: flex;
    gap: 10px;
    color: rgba(148, 163, 184, 0.75);
    font-size: 0.66rem;
    margin-bottom: 4px;
  }

  .ef-tooltip-health {
    font-size: 0.66rem;
  }

  .ef-health-badge {
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 600;
    font-size: 0.62rem;
    text-transform: uppercase;
  }
  .ef-health-badge.ok { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
  .ef-health-badge.warn { background: rgba(250, 204, 21, 0.15); color: #facc15; }
  .ef-health-badge.error { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
  .ef-health-badge.offline { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
  .ef-health-note { color: #facc15; margin-left: 6px; }

  .ef-activity {
    flex-shrink: 0;
    max-height: 140px;
    border-top: 1px solid rgba(56, 189, 248, 0.08);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .ef-activity-title {
    margin: 0;
    padding: 8px 20px 4px;
    font-size: 0.72rem;
    font-weight: 600;
    color: rgba(148, 163, 184, 0.6);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .ef-activity-list {
    overflow-y: auto;
    padding: 0 20px 8px;
    flex: 1;
  }

  .ef-activity-empty {
    color: rgba(148, 163, 184, 0.4);
    font-size: 0.72rem;
    padding: 6px 0;
    font-style: italic;
  }

  .ef-activity-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    border-left: 2px solid transparent;
    padding-left: 8px;
    font-size: 0.7rem;
    animation: ef-slide-in 0.3s ease;
  }

  @keyframes ef-slide-in {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .ef-activity-kind {
    font-weight: 700;
    font-size: 0.82rem;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }

  .ef-activity-msg {
    color: rgba(226, 232, 240, 0.75);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ef-activity-time {
    color: rgba(148, 163, 184, 0.4);
    font-size: 0.62rem;
    flex-shrink: 0;
  }
</style>

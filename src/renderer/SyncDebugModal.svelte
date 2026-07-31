<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createSyncTraceClient, type SyncFrame } from './lib/syncTrace.svelte.js';

  let { onClose }: { onClose: () => void } = $props();

  const trace = createSyncTraceClient();
  void trace.start();
  onDestroy(() => trace.stop());

  let paused = $state(false);
  let selectedAssoc = $state<string | null>(null);
  let scrollEl: HTMLDivElement | undefined = $state();

  const associations = $derived.by(() => {
    const set = new Set<string>();
    for (const f of trace.frames) if (f.assoc !== 'active') set.add(f.assoc);
    return [...set];
  });

  const visible = $derived(
    selectedAssoc === null
      ? trace.frames
      : trace.frames.filter((f) => f.assoc === selectedAssoc || f.assoc === 'active'),
  );

  const phaseLabel: Record<SyncFrame['phase'], string> = {
    discovery: 'DISCOVERY',
    handshake: 'HANDSHAKE',
    attach: 'ATTACH / RESUME WALK',
    'anti-entropy': 'ANTI-ENTROPY',
    closed: 'CLOSED',
  };

  const outcomeClass: Record<string, string> = {
    ok: 'text-neutral-400',
    suppressed: 'text-neutral-600',
    rejected: 'text-red-400',
    failed: 'text-red-400',
    'missing-local': 'text-amber-400',
  };

  const levelClass: Record<SyncFrame['level'], string> = {
    error: 'text-red-400',
    warn: 'text-amber-400',
    info: 'text-sky-400',
    debug: 'text-neutral-500',
    trace: 'text-neutral-700',
  };

  function fmtTime(at: number): string {
    const d = new Date(at);
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }

  $effect(() => {
    void visible.length;
    if (paused || scrollEl === undefined) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  });

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
  <div class="flex h-[85vh] w-[90vw] max-w-5xl flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-200 shadow-2xl">
    <div class="flex items-center gap-3 border-b border-neutral-700 px-4 py-2">
      <span class="font-semibold">Sync Protocol Debug</span>
      {#if associations.length > 1}
        <select
          class="rounded bg-neutral-800 px-2 py-1 text-sm"
          bind:value={selectedAssoc}
        >
          <option value={null}>all peers</option>
          {#each associations as a (a)}
            <option value={a}>{a.slice(0, 12)}…</option>
          {/each}
        </select>
      {/if}
      <div class="flex-1"></div>
      <button
        class="rounded px-2 py-1 text-sm hover:bg-neutral-800"
        onclick={() => (paused = !paused)}
      >{paused ? '▶ resume' : '⏸ pause'}</button>
      <button class="rounded px-2 py-1 text-sm hover:bg-neutral-800" onclick={() => trace.clear()}>clear</button>
      <button class="rounded px-2 py-1 text-sm hover:bg-neutral-800" onclick={onClose}>✕</button>
    </div>

    {#if associations.length === 0}
      <div class="flex flex-1 items-center justify-center text-neutral-500">
        0 associations — no transport discovered yet.
      </div>
    {:else}
      <div bind:this={scrollEl} class="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs">
        {#each visible as f, i (f.seq)}
          {#if i === 0 || f.phase !== visible[i - 1]?.phase}
            <div class="sticky top-0 my-1 bg-neutral-900/95 py-1 text-[10px] font-bold tracking-wider text-neutral-500">
              ─── {phaseLabel[f.phase]} ───
            </div>
          {/if}
          <div class="flex items-baseline gap-2 py-0.5">
            <span class="w-24 shrink-0 text-neutral-600">{fmtTime(f.at)}</span>
            <span class={`w-12 shrink-0 uppercase ${levelClass[f.level]}`}>{f.level}</span>
            <span class="w-4 shrink-0 text-center">
              {f.dir === 'out' ? '→' : f.dir === 'in' ? '←' : '●'}
            </span>
            <span class="w-28 shrink-0 font-semibold">{f.msg}</span>
            <span class="flex-1 truncate text-neutral-400">{f.detail}</span>
            {#if f.outcome && f.outcome !== 'ok'}
              <span class={`shrink-0 font-semibold ${outcomeClass[f.outcome]}`}>{f.outcome}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

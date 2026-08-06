<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createSyncTraceClient, type SyncFrame } from './lib/syncTrace.svelte.js';
  import {
    layerStatuses, correlate, objectRows, invariantStatuses, associationSummaries,
    friendStatuses, journalProgress, toJsonl, fromJsonl, ASSOC_STATES,
    type Layer,
  } from './lib/syncAnalysis.js';

  let { onClose }: { onClose: () => void } = $props();

  const trace = createSyncTraceClient();
  void trace.start();
  onDestroy(() => trace.stop());

  type Tab = 'stack' | 'peers' | 'frames' | 'unmatched' | 'objects' | 'invariants';
  let tab = $state<Tab>('stack');
  let paused = $state(false);
  let selectedAssoc = $state<string | null>(null);
  let layerFilter = $state<Layer | null>(null);
  let minLevel = $state<'error' | 'warn' | 'info' | 'debug' | 'trace'>('trace');
  let scrollEl: HTMLDivElement | undefined = $state();
  let imported = $state<SyncFrame[] | null>(null);
  let importName = $state<string | null>(null);
  let now = $state(Date.now());
  const ticker = setInterval(() => { if (!paused) now = Date.now(); }, 1000);
  onDestroy(() => clearInterval(ticker));

  let names = $state<Record<string, string>>({});
  void (async () => {
    try {
      names = (await window.nb.invoke({ api: 'profile' as never, method: 'directory', args: [] })) as Record<string, string>;
    } catch { names = {}; }
  })();

  // Imported traces replace the live stream so every panel renders the
  // artifact identically to the session that produced it (TRACE-51).
  const frames = $derived(imported ?? trace.frames);

  const LEVEL_ORDER = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 } as const;
  const visible = $derived(
    frames.filter(
      (f) =>
        (selectedAssoc === null || f.assoc === selectedAssoc) &&
        (layerFilter === null || f.phase === layerFilter) &&
        LEVEL_ORDER[f.level] <= LEVEL_ORDER[minLevel],
    ),
  );

  const layers = $derived(layerStatuses(frames));
  const corr = $derived(correlate(frames, now));
  const objects = $derived(objectRows(frames));
  const invariants = $derived(invariantStatuses(frames));
  const assocs = $derived(associationSummaries(frames));
  const friends = $derived(friendStatuses(frames));
  const journal = $derived(journalProgress(frames));

  const associations = $derived.by(() => {
    const set = new Set<string>();
    for (const f of frames) if (f.assoc !== 'active' && f.assoc !== 'unknown') set.add(f.assoc);
    return [...set];
  });

  function peerLabel(profile: string | undefined): string {
    if (!profile) return '—';
    return names[profile] ?? `${profile.slice(0, 10)}…`;
  }
  function fmtTime(at: number): string {
    const d = new Date(at);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  }
  function fmtAge(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
  }

  const layerTone: Record<string, string> = {
    armed: 'border-neutral-700 bg-neutral-900 text-neutral-500',
    active: 'border-sky-700/70 bg-sky-950/40 text-sky-200',
    quiet: 'border-neutral-700 bg-neutral-900/60 text-neutral-300',
    error: 'border-red-800 bg-red-950/40 text-red-200',
  };
  const dotTone: Record<string, string> = {
    armed: 'bg-neutral-600', active: 'bg-sky-400', quiet: 'bg-neutral-400', error: 'bg-red-400',
  };
  const invTone: Record<string, string> = {
    watching: 'text-neutral-500', ok: 'text-emerald-400', violated: 'text-red-400',
  };
  const objTone: Record<string, string> = {
    arrived: 'text-emerald-400', 'in-flight': 'text-sky-400', wanted: 'text-amber-400',
    announced: 'text-neutral-400', 'timed-out': 'text-red-400',
  };
  const levelClass: Record<SyncFrame['level'], string> = {
    error: 'text-red-400', warn: 'text-amber-400', info: 'text-sky-400',
    debug: 'text-neutral-500', trace: 'text-neutral-700',
  };
  const outcomeClass: Record<string, string> = {
    ok: 'text-neutral-400', suppressed: 'text-neutral-600', rejected: 'text-red-400',
    failed: 'text-red-400', 'missing-local': 'text-amber-400',
  };

  $effect(() => {
    void visible.length;
    if (paused || tab !== 'frames' || scrollEl === undefined) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  });

  function exportTrace(): void {
    const blob = new Blob([toJsonl(frames)], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nearbytes-trace-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function importTrace(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    imported = fromJsonl(await file.text());
    importName = file.name;
    paused = true;
  }
  function handleKeydown(e: KeyboardEvent): void { if (e.key === 'Escape') onClose(); }

  const friendTone: Record<string, string> = {
    'never-contacted': 'text-red-400', 'dial-failed': 'text-amber-400', rejected: 'text-amber-400',
    stalled: 'text-amber-400', sighted: 'text-sky-400', connected: 'text-emerald-400',
  };

  const TABS: { id: Tab; label: string; badge: () => string | null }[] = [
    { id: 'stack', label: 'Stack', badge: () => null },
    { id: 'peers', label: 'Peers', badge: () => {
      const bad = friends.filter((f) => f.state === 'never-contacted').length;
      return bad > 0 ? String(bad) : String(friends.length);
    } },
    { id: 'frames', label: 'Frames', badge: () => String(visible.length) },
    { id: 'unmatched', label: 'Unmatched', badge: () => String(corr.unmatched.length) },
    { id: 'objects', label: 'Objects', badge: () => String(objects.length) },
    { id: 'invariants', label: 'Invariants', badge: () => {
      const v = invariants.filter((i) => i.state === 'violated').length;
      return v > 0 ? String(v) : null;
    } },
  ];
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
  <div class="flex h-[90vh] w-[94vw] max-w-6xl flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-200 shadow-2xl">

    <!-- header -->
    <div class="flex items-center gap-3 border-b border-neutral-700 px-4 py-2">
      <span class="font-semibold">Sync Protocol Debug</span>
      {#if imported}
        <span class="rounded bg-amber-900/60 px-2 py-0.5 text-xs text-amber-200">replay · {importName}</span>
        <button class="rounded px-2 py-0.5 text-xs hover:bg-neutral-800" onclick={() => { imported = null; importName = null; paused = false; }}>back to live</button>
      {/if}
      <div class="flex-1"></div>
      <select class="rounded bg-neutral-800 px-2 py-1 text-xs" bind:value={minLevel}>
        {#each ['error', 'warn', 'info', 'debug', 'trace'] as l (l)}<option value={l}>≥ {l}</option>{/each}
      </select>
      <select class="rounded bg-neutral-800 px-2 py-1 text-xs" bind:value={selectedAssoc}>
        <option value={null}>all peers</option>
        {#each associations as a (a)}<option value={a}>{peerLabel(a.split(':')[1])}</option>{/each}
      </select>
      <button class="rounded px-2 py-1 text-xs hover:bg-neutral-800" onclick={() => (paused = !paused)}>{paused ? '▶ resume' : '⏸ pause'}</button>
      <button class="rounded px-2 py-1 text-xs hover:bg-neutral-800" onclick={exportTrace}>export</button>
      <label class="cursor-pointer rounded px-2 py-1 text-xs hover:bg-neutral-800">
        import<input type="file" accept=".jsonl,.ndjson,application/x-ndjson" class="hidden" onchange={importTrace} />
      </label>
      <button class="rounded px-2 py-1 text-xs hover:bg-neutral-800" onclick={() => trace.clear()}>clear</button>
      <button class="rounded px-2 py-1 text-sm hover:bg-neutral-800" onclick={onClose}>✕</button>
    </div>

    <!-- association state strip: every state always drawn, current one lit -->
    <div class="border-b border-neutral-800 px-4 py-2">
      {#if assocs.length === 0}
        <div class="flex items-center gap-2 text-xs text-neutral-500">
          <span class="font-semibold uppercase tracking-wider">association</span>
          <span>no association yet — discovery is running</span>
        </div>
      {/if}
      {#each assocs as a (a.assoc)}
        <div class="flex items-center gap-2 py-0.5 text-xs">
          <span class="w-40 shrink-0 truncate font-semibold" title={a.remoteProfile}>{peerLabel(a.remoteProfile)}</span>
          {#each ASSOC_STATES as s (s)}
            {@const on = a.state === s}
            {@const past = ASSOC_STATES.indexOf(a.state) > ASSOC_STATES.indexOf(s)}
            <span class={`rounded px-1.5 py-0.5 ${on ? (s === 'stalled' ? 'bg-red-800 text-red-100' : 'bg-sky-700 text-white') : past ? 'bg-neutral-800 text-neutral-500' : 'bg-neutral-900 text-neutral-700'}`}>{s}</span>
          {/each}
          <span class="text-neutral-500">{fmtAge(now - a.since)} in state</span>
        </div>
      {/each}
    </div>

    <!-- tabs -->
    <div class="flex gap-1 border-b border-neutral-800 px-3 pt-2 text-xs">
      {#each TABS as t (t.id)}
        {@const badge = t.badge()}
        <button
          class={`rounded-t px-3 py-1.5 ${tab === t.id ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
          onclick={() => (tab = t.id)}
        >{t.label}{#if badge}<span class="ml-1.5 rounded bg-neutral-700 px-1.5 text-[10px]">{badge}</span>{/if}</button>
      {/each}
      <div class="flex-1"></div>
      {#if trace.dropped > 0}
        <span class="self-center pr-2 text-[10px] text-amber-500" title="ring buffer overflow (TRACE-61)">{trace.dropped} frames dropped</span>
      {/if}
    </div>

    <div bind:this={scrollEl} class="flex-1 overflow-auto p-4 font-mono text-xs">

      <!-- ── STACK ───────────────────────────────────────────────── -->
      {#if tab === 'stack'}
        <div class="mb-3 font-sans text-[11px] text-neutral-500">
          All seven layers are instrumented and shown at all times. <span class="text-neutral-400">armed</span> means the
          layer is watching but has produced no frames yet — per TRACE-20 a permanently silent layer is a defect, not a
          configuration.
        </div>
        <div class="flex gap-2">
          <!-- family band, after the paper's stack figure -->
          <div class="flex w-5 shrink-0 flex-col">
            <div class="flex flex-1 items-center justify-center rounded-l border-y border-l border-neutral-700 text-[9px] uppercase tracking-widest text-neutral-500" style="writing-mode:vertical-rl;transform:rotate(180deg)">local</div>
            <div class="h-1"></div>
            <div class="flex flex-[5] items-center justify-center rounded-l border-y border-l border-neutral-700 text-[9px] uppercase tracking-widest text-neutral-500" style="writing-mode:vertical-rl;transform:rotate(180deg)">wire</div>
          </div>
          <div class="flex-1">
            {#each layers as l, i (l.layer)}
              {#if i === 1}<div class="my-1 border-t-2 border-double border-neutral-600"></div>{/if}
              <button
                class={`mb-1 flex w-full items-center gap-3 rounded border px-3 py-2 text-left transition ${layerTone[l.state]} ${layerFilter === l.layer ? 'ring-1 ring-sky-500' : ''}`}
                onclick={() => { layerFilter = layerFilter === l.layer ? null : l.layer; tab = 'frames'; }}
              >
                <span class={`h-2 w-2 shrink-0 rounded-full ${dotTone[l.state]}`}></span>
                <span class="w-28 shrink-0 font-semibold">{l.title}</span>
                <span class="flex-1 truncate font-sans text-[11px] opacity-70">{l.blurb}</span>
                <span class="w-20 shrink-0 text-right">{l.frames === 0 ? 'armed' : `${l.frames}`}</span>
                <span class="w-16 shrink-0 text-right text-[10px] opacity-60">{l.lastAt ? fmtAge(now - l.lastAt) : '—'}</span>
                {#if l.errors > 0}<span class="w-10 shrink-0 text-right text-red-400">{l.errors}e</span>
                {:else if l.warnings > 0}<span class="w-10 shrink-0 text-right text-amber-400">{l.warnings}w</span>
                {:else}<span class="w-10 shrink-0"></span>{/if}
                <span class="w-24 shrink-0 text-right text-[10px] text-neutral-500">{l.rules}</span>
              </button>
            {/each}
            <!-- dashed, outside the stack: not a layer of the model -->
            <div class="mt-2 rounded border border-dashed border-neutral-700 bg-neutral-900/40 px-3 py-2 text-[11px] italic text-neutral-500">
              carrier — LAN, DHT, relay: untrusted and interchangeable, not a traced layer
            </div>
          </div>
        </div>

        <!-- journal progress (SYNC-19/22): always shown, even before a walk starts -->
        <div class="mt-4 rounded border border-neutral-700 p-3 font-sans">
          <div class="mb-1 flex items-baseline gap-2">
            <span class="text-[10px] uppercase tracking-wider text-neutral-500">journal catch-up</span>
            <span class="text-[11px] text-neutral-500">
              {#if journal.remoteMax === null}
                no resume page seen yet — nothing to page through
              {:else}
                cursor {journal.localCursor ?? 0} of {journal.remoteMax}{journal.walking ? ' · walking' : ' · complete'}
              {/if}
            </span>
          </div>
          <div class="h-1.5 w-full overflow-hidden rounded bg-neutral-800">
            <div class={`h-full ${journal.walking ? 'bg-sky-500' : 'bg-emerald-600'}`} style={`width:${journal.pct ?? 0}%`}></div>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-3 gap-3 font-sans">
          <div class="rounded border border-neutral-700 p-3">
            <div class="text-[10px] uppercase tracking-wider text-neutral-500">correlated</div>
            <div class="text-lg">{corr.matched}</div>
            <div class="text-[11px] text-neutral-500">median {corr.medianRttMs === null ? '—' : `${corr.medianRttMs}ms`}</div>
          </div>
          <div class="rounded border border-neutral-700 p-3">
            <div class="text-[10px] uppercase tracking-wider text-neutral-500">outstanding</div>
            <div class={`text-lg ${corr.unmatched.length > 0 ? 'text-amber-400' : ''}`}>{corr.unmatched.length}</div>
            <div class="text-[11px] text-neutral-500">{corr.unmatched.length === 0 ? 'all matched' : 'awaiting response'}</div>
          </div>
          <div class="rounded border border-neutral-700 p-3">
            <div class="text-[10px] uppercase tracking-wider text-neutral-500">invariants</div>
            <div class={`text-lg ${invariants.some((i) => i.state === 'violated') ? 'text-red-400' : 'text-emerald-400'}`}>
              {invariants.filter((i) => i.state !== 'violated').length}/{invariants.length}
            </div>
            <div class="text-[11px] text-neutral-500">holding</div>
          </div>
        </div>

      <!-- ── PEERS ───────────────────────────────────────────────── -->
      {:else if tab === 'peers'}
        <div class="mb-3 font-sans text-[11px] text-neutral-500">
          One row per <em>configured</em> friend, contacted or not (TRACE-23). A friend discovery has never yielded
          produces no frames of its own — without an explicit row, “never dialled” looks identical to “dialled and
          failed”.
        </div>
        {#if friends.length === 0}
          <div class="py-8 text-center font-sans text-neutral-500">
            No friends configured on the active profile.
          </div>
        {:else}
          <div class="flex gap-2 border-b border-neutral-800 pb-1 text-[10px] uppercase tracking-wider text-neutral-500">
            <span class="w-40">peer</span><span class="w-32">state</span><span class="w-16 text-right">sighted</span>
            <span class="w-16 text-right">dials</span><span class="w-16 text-right">failed</span>
            <span class="w-16 text-right">hello</span><span class="w-16 text-right">stalls</span><span class="w-20 text-right">last</span>
          </div>
          {#each friends as fr (fr.profile)}
            <div class="flex gap-2 py-1">
              <span class="w-40 truncate font-semibold" title={fr.profile}>{peerLabel(fr.profile)}</span>
              <span class={`w-32 font-semibold ${friendTone[fr.state]}`}>{fr.state}{#if fr.sibling}<span class="ml-1 text-[10px] text-neutral-500">sibling</span>{/if}</span>
              <span class="w-16 text-right text-neutral-400">{fr.sightings}</span>
              <span class="w-16 text-right text-neutral-400">{fr.dials}</span>
              <span class={`w-16 text-right ${fr.dialFails > 0 ? 'text-amber-400' : 'text-neutral-600'}`}>{fr.dialFails}</span>
              <span class="w-16 text-right text-neutral-400">{fr.handshakes}</span>
              <span class={`w-16 text-right ${fr.stalls > 0 ? 'text-amber-400' : 'text-neutral-600'}`}>{fr.stalls}</span>
              <span class="w-20 text-right text-neutral-600">{fr.lastSeenAt ? fmtAge(now - fr.lastSeenAt) : '—'}</span>
            </div>
            {#if fr.state === 'never-contacted'}
              <div class="mb-1 ml-40 font-sans text-[11px] text-red-400/80">
                configured, but discovery has never produced this peer — no transport was attempted
              </div>
            {/if}
          {/each}
        {/if}

      <!-- ── FRAMES ──────────────────────────────────────────────── -->
      {:else if tab === 'frames'}
        {#if layerFilter}
          <div class="mb-2 font-sans text-[11px]">
            filtered to <span class="font-semibold">{layerFilter}</span>
            <button class="ml-2 underline hover:text-neutral-100" onclick={() => (layerFilter = null)}>clear</button>
          </div>
        {/if}
        {#if visible.length === 0}
          <div class="py-8 text-center font-sans text-neutral-500">
            No frames match this filter yet. The capture is running — layers are armed and waiting.
          </div>
        {/if}
        {#each visible as f, i (f.seq)}
          {#if i === 0 || f.phase !== visible[i - 1]?.phase}
            <div class="sticky top-0 my-1 min-w-max bg-neutral-900/95 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">─── {f.phase} ───</div>
          {/if}
          <div class="flex min-w-max items-baseline gap-2 whitespace-nowrap py-0.5">
            <span class="w-24 shrink-0 text-neutral-600">{fmtTime(f.at)}</span>
            <span class={`w-12 shrink-0 uppercase ${levelClass[f.level]}`}>{f.level}</span>
            <span class="w-4 shrink-0 text-center">{f.dir === 'out' ? '→' : f.dir === 'in' ? '←' : '●'}</span>
            <span class="w-32 shrink-0 truncate text-neutral-500" title={f.remoteProfile}>{peerLabel(f.remoteProfile)}</span>
            <span class="w-32 shrink-0 font-semibold">{f.msg}</span>
            <span class="text-neutral-400">{f.detail}</span>
            {#if f.outcome && f.outcome !== 'ok'}<span class={`shrink-0 font-semibold ${outcomeClass[f.outcome]}`}>{f.outcome}</span>{/if}
          </div>
        {/each}

      <!-- ── UNMATCHED ───────────────────────────────────────────── -->
      {:else if tab === 'unmatched'}
        <div class="mb-3 font-sans text-[11px] text-neutral-500">
          Requests sent with no correlated response (TRACE-32). In anti-entropy the defect is almost always the message
          that never arrived, which a chronological log cannot show.
        </div>
        {#if corr.unmatched.length === 0}
          <div class="rounded border border-emerald-900/60 bg-emerald-950/20 py-6 text-center font-sans text-emerald-400">
            0 outstanding — every request has been answered.
            <div class="mt-1 text-[11px] text-neutral-500">{corr.matched} pairs matched{corr.medianRttMs !== null ? `, median ${corr.medianRttMs}ms` : ''}</div>
          </div>
        {:else}
          <div class="flex gap-2 border-b border-neutral-800 pb-1 text-[10px] uppercase tracking-wider text-neutral-500">
            <span class="w-24">age</span><span class="w-32">request</span><span class="w-28">layer</span><span class="w-24">key</span><span>id</span>
          </div>
          {#each corr.unmatched as u (u.assoc + u.corrId + u.at)}
            <div class="flex gap-2 py-0.5">
              <span class={`w-24 ${u.ageMs > 30_000 ? 'text-red-400' : u.ageMs > 5_000 ? 'text-amber-400' : 'text-neutral-400'}`}>{fmtAge(u.ageMs)}</span>
              <span class="w-32 font-semibold">{u.msg}</span>
              <span class="w-28 text-neutral-500">{u.layer}</span>
              <span class="w-24 text-neutral-500">{u.corrKind}</span>
              <span class="text-neutral-600">{u.corrId}…</span>
            </div>
          {/each}
        {/if}

      <!-- ── OBJECTS ─────────────────────────────────────────────── -->
      {:else if tab === 'objects'}
        <div class="mb-3 font-sans text-[11px] text-neutral-500">
          Per-hash lifecycle: announced → wanted → arrived. Separates “we never asked” from “we asked and it never came”.
        </div>
        {#if objects.length === 0}
          <div class="py-8 text-center font-sans text-neutral-500">
            No objects seen yet. Hashes appear here as soon as a <span class="font-mono">have</span> or
            <span class="font-mono">want</span> carries them.
          </div>
        {:else}
          <div class="flex gap-2 border-b border-neutral-800 pb-1 text-[10px] uppercase tracking-wider text-neutral-500">
            <span class="w-24">state</span><span class="w-48">hash</span><span class="w-24">announced</span><span class="w-24">wanted</span><span class="w-24">arrived</span><span class="w-20">bytes</span>
          </div>
          {#each objects as o (o.hash)}
            <div class="flex gap-2 py-0.5">
              <span class={`w-24 font-semibold ${objTone[o.state]}`}>{o.state}</span>
              <span class="w-48 truncate text-neutral-500" title={o.hash}>{o.hash.slice(0, 24)}…</span>
              <span class="w-24 text-neutral-600">{o.announcedAt ? fmtTime(o.announcedAt) : '—'}</span>
              <span class="w-24 text-neutral-600">{o.wantedAt ? fmtTime(o.wantedAt) : '—'}</span>
              <span class="w-24 text-neutral-600">{o.arrivedAt ? fmtTime(o.arrivedAt) : '—'}</span>
              <span class="w-20 text-neutral-600">{o.bytes ?? '—'}</span>
            </div>
          {/each}
        {/if}

      <!-- ── INVARIANTS ──────────────────────────────────────────── -->
      {:else if tab === 'invariants'}
        <div class="mb-3 font-sans text-[11px] text-neutral-500">
          Every rule is evaluated continuously against the frame stream and listed here at all times.
          <span class="text-neutral-400">watching</span> means armed but not yet exercised — a guard you cannot see is a
          guard you cannot trust.
        </div>
        {#each invariants as inv (inv.id)}
          <div class="mb-1 flex items-start gap-3 rounded border border-neutral-800 px-3 py-2">
            <span class={`w-2 shrink-0 pt-1 ${invTone[inv.state]}`}>●</span>
            <span class="w-24 shrink-0 font-semibold">{inv.id}</span>
            <div class="flex-1">
              <div>{inv.rule}</div>
              <div class="font-sans text-[11px] text-neutral-500">detects: {inv.checks}</div>
              {#if inv.detail}<div class="mt-1 text-[11px] text-red-400">{inv.detail}</div>{/if}
            </div>
            <span class={`w-28 shrink-0 text-right font-semibold ${invTone[inv.state]}`}>
              {inv.state === 'violated' ? `${inv.violations} violation${inv.violations === 1 ? '' : 's'}` : inv.state}
            </span>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

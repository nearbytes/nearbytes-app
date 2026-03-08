<script lang="ts">
  import { onMount } from 'svelte';
  import { AudioLines, Disc3 } from 'lucide-svelte';

  let {
    src,
    title,
    mimeType = '',
  }: {
    src: string;
    title: string;
    mimeType?: string;
  } = $props();

  let audioElement: HTMLAudioElement | null = null;
  let canvasElement: HTMLCanvasElement | null = null;
  let animationFrame = 0;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let mediaSource: MediaElementAudioSourceNode | null = null;
  let spectrumData: Uint8Array | null = null;
  let playing = $state(false);

  function cancelLoop() {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  }

  function drawSpectrum() {
    const canvas = canvasElement;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const ratio = window.devicePixelRatio || 1;
    const nextWidth = Math.floor(width * ratio);
    const nextHeight = Math.floor(height * ratio);
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const barCount = Math.max(24, Math.floor(width / 14));
    const gap = 4;
    const barWidth = Math.max(4, (width - gap * (barCount - 1)) / barCount);
    const gradient = context.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, 'rgba(34, 211, 238, 0.28)');
    gradient.addColorStop(0.55, 'rgba(56, 189, 248, 0.72)');
    gradient.addColorStop(1, 'rgba(191, 219, 254, 0.96)');

    const glow = context.createLinearGradient(0, 0, width, height);
    glow.addColorStop(0, 'rgba(34, 211, 238, 0.12)');
    glow.addColorStop(1, 'rgba(59, 130, 246, 0.04)');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    const spectrum = spectrumData;
    if (analyser && spectrum) {
      analyser.getByteFrequencyData(spectrum);
    }

    for (let index = 0; index < barCount; index += 1) {
      const x = index * (barWidth + gap);
      const base =
        spectrum && spectrum.length > 0
          ? spectrum[Math.floor((index / barCount) * spectrum.length)] / 255
          : 0;
      const idleWave = 0.18 + 0.14 * Math.sin((Date.now() / 320) + index * 0.55);
      const level = playing ? Math.max(0.08, base) : Math.max(0.06, idleWave);
      const barHeight = Math.max(10, level * (height - 12));
      const y = height - barHeight;
      context.fillStyle = gradient;
      context.beginPath();
      context.roundRect(x, y, barWidth, barHeight, 999);
      context.fill();
    }

    animationFrame = requestAnimationFrame(drawSpectrum);
  }

  async function ensureAudioGraph() {
    if (!audioElement) {
      return;
    }
    if (!audioContext) {
      audioContext = new AudioContext();
    }
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    if (!analyser) {
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.84;
      spectrumData = new Uint8Array(analyser.frequencyBinCount);
    }
    if (!mediaSource) {
      mediaSource = audioContext.createMediaElementSource(audioElement);
      mediaSource.connect(analyser);
      analyser.connect(audioContext.destination);
    }
    if (!animationFrame) {
      drawSpectrum();
    }
  }

  function handlePlay() {
    playing = true;
    void ensureAudioGraph();
  }

  function handlePause() {
    playing = false;
    if (!animationFrame) {
      drawSpectrum();
    }
  }

  onMount(() => {
    drawSpectrum();
    return () => {
      cancelLoop();
      mediaSource?.disconnect();
      analyser?.disconnect();
      if (audioContext && audioContext.state !== 'closed') {
        void audioContext.close();
      }
    };
  });
</script>

<div class="audio-preview-shell">
  <div class="audio-preview-hero">
    <div class="audio-preview-badge">
      <Disc3 size={22} strokeWidth={1.8} />
    </div>
    <div class="audio-preview-copy">
      <p class="audio-preview-kicker">
        <AudioLines size={14} strokeWidth={2} />
        Audio Preview
      </p>
      <h4 class="audio-preview-title" title={title}>{title}</h4>
      <p class="audio-preview-meta">{mimeType || 'audio'}</p>
    </div>
  </div>

  <div class="audio-preview-visual">
    <canvas bind:this={canvasElement} class="audio-preview-canvas" aria-hidden="true"></canvas>
  </div>

  <audio
    bind:this={audioElement}
    class="audio-preview-player"
    controls
    src={src}
    onplay={handlePlay}
    onpause={handlePause}
  ></audio>
</div>

<style>
  .audio-preview-shell {
    display: grid;
    gap: 1rem;
    min-height: 100%;
    align-content: start;
  }

  .audio-preview-hero {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.9rem;
    align-items: center;
    padding: 1rem;
    border-radius: 18px;
    border: 1px solid rgba(56, 189, 248, 0.14);
    background:
      radial-gradient(120% 140% at 0% 0%, rgba(34, 211, 238, 0.14), transparent 50%),
      linear-gradient(180deg, rgba(9, 20, 39, 0.96), rgba(7, 14, 28, 0.92));
  }

  .audio-preview-badge {
    width: 56px;
    height: 56px;
    border-radius: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: rgba(236, 254, 255, 0.94);
    background: linear-gradient(135deg, rgba(14, 165, 233, 0.28), rgba(59, 130, 246, 0.18));
    border: 1px solid rgba(125, 211, 252, 0.18);
    box-shadow: 0 18px 34px rgba(2, 6, 23, 0.22);
  }

  .audio-preview-copy {
    min-width: 0;
    display: grid;
    gap: 0.18rem;
  }

  .audio-preview-kicker,
  .audio-preview-meta {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: rgba(186, 230, 253, 0.72);
    font-size: 0.78rem;
  }

  .audio-preview-title {
    margin: 0;
    font-size: 1.1rem;
    color: rgba(248, 250, 252, 0.98);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .audio-preview-visual {
    position: relative;
    min-height: 240px;
    border-radius: 22px;
    overflow: hidden;
    border: 1px solid rgba(56, 189, 248, 0.12);
    background:
      radial-gradient(140% 140% at 0% 0%, rgba(34, 211, 238, 0.14), transparent 48%),
      radial-gradient(120% 120% at 100% 0%, rgba(59, 130, 246, 0.12), transparent 42%),
      linear-gradient(180deg, rgba(7, 15, 29, 0.98), rgba(5, 10, 20, 0.94));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 22px 42px rgba(2, 6, 23, 0.24);
  }

  .audio-preview-canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  .audio-preview-player {
    width: 100%;
    min-height: 52px;
    border-radius: 16px;
    background: rgba(9, 18, 33, 0.86);
  }
</style>

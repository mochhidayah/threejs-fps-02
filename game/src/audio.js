// Synthesized WebAudio only — oscillators plus one shared noise buffer, no assets,
// no network. Every method no-ops before unlock() and while muted. Master gain 0.5.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;

  function tone(freq, dur, type, vol, slide = 0, delay = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, cutoff, delay = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  const api = {
    get muted() { return muted; },
    set muted(v) { muted = !!v; },
    unlock() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      api.click();
    },
    shot(kind) {
      const p = { pistol: [220, 0.09], rifle: [160, 0.11], smg: [200, 0.06], dmr: [110, 0.18] }[kind] || [160, 0.11];
      noise(0.08, kind === 'dmr' ? 0.6 : 0.45, 1800);
      tone(p[0], p[1], 'square', 0.25, p[0] * 0.4);
    },
    reload() { noise(0.05, 0.25, 3000); noise(0.05, 0.25, 3000, 0.18); },
    dry() { tone(900, 0.03, 'square', 0.12); },
    hit() { tone(1400, 0.05, 'sine', 0.2); },
    kill() { tone(660, 0.07, 'square', 0.2); tone(880, 0.09, 'square', 0.2, 0, 0.07); },
    headshot() { tone(1800, 0.06, 'sine', 0.25); tone(2400, 0.08, 'sine', 0.2, 0, 0.05); },
    plant() { tone(520, 0.08, 'square', 0.2); tone(780, 0.12, 'square', 0.2, 0, 0.1); },
    beep() { tone(880, 0.07, 'square', 0.18); },
    explosion() { noise(0.9, 0.7, 400); tone(90, 0.8, 'sine', 0.5, 35); },
    roundWin() { tone(523, 0.1, 'square', 0.2); tone(659, 0.1, 'square', 0.2, 0, 0.09); tone(784, 0.16, 'square', 0.2, 0, 0.18); },
    roundLoss() { tone(392, 0.12, 'square', 0.2); tone(330, 0.12, 'square', 0.2, 0, 0.11); tone(262, 0.2, 'square', 0.2, 0, 0.22); },
    buy() { tone(1200, 0.05, 'sine', 0.2); tone(1600, 0.08, 'sine', 0.2, 0, 0.06); },
    click() { tone(1000, 0.03, 'square', 0.1); },
    flash() { noise(0.4, 0.4, 6000); tone(2500, 0.3, 'sine', 0.12, 1200); },
    step() { noise(0.04, 0.06, 500); },
  };
  return api;
}

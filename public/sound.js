// Casino sound effects, synthesized with the Web Audio API (no audio files).
// Usage: Sound.play('card'), Sound.toggle(). On iPhone, silent mode mutes these sounds.
(function () {
  let ctx = null, master = null, noiseBuf = null;
  let enabled = localStorage.getItem('pk_sound') !== '0';

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  // browsers only allow audio after a tap/click
  const unlock = () => { const c = init(); if (c && c.state === 'suspended') c.resume(); };
  ['pointerdown', 'keydown', 'touchend'].forEach((ev) => addEventListener(ev, unlock, { capture: true, passive: true }));

  const now = () => ctx.currentTime;
  function env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  function noise(t, dur, { type = 'bandpass', freq = 2500, q = 0.8, peak = 0.5, attack = 0.004 } = {}) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); env(g, t, attack, peak, dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.5); src.stop(t + attack + dur + 0.05);
  }
  function tone(t, freq, dur, { type = 'sine', peak = 0.3, attack = 0.005, slide = 0 } = {}) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain(); env(g, t, attack, peak, dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + attack + dur + 0.05);
  }
  function clink(t, base = 3400, peak = 0.16) {
    // ceramic chip: two inharmonic partials + a tiny click
    const f = base * (0.9 + Math.random() * 0.2);
    tone(t, f, 0.07, { type: 'sine', peak });
    tone(t, f * 1.47, 0.05, { type: 'sine', peak: peak * 0.6 });
    noise(t, 0.015, { type: 'highpass', freq: 5000, peak: peak * 0.8 });
  }

  const SOUNDS = {
    card(t) { noise(t, 0.07, { freq: 2200 + Math.random() * 800, q: 0.7, peak: 0.45 }); noise(t + 0.03, 0.03, { type: 'lowpass', freq: 900, peak: 0.25 }); },
    flip(t) { noise(t, 0.035, { type: 'highpass', freq: 2500, peak: 0.4 }); noise(t + 0.045, 0.05, { freq: 1800, peak: 0.35 }); },
    shuffle(t) { for (let i = 0; i < 14; i++) noise(t + i * 0.028 + Math.random() * 0.01, 0.03, { freq: 2600 + Math.random() * 1500, q: 1.2, peak: 0.22 }); noise(t + 0.43, 0.08, { type: 'lowpass', freq: 700, peak: 0.35 }); },
    chip(t) { clink(t); clink(t + 0.045, 3000, 0.11); },
    chips(t) { for (let i = 0; i < 5; i++) clink(t + i * 0.035 + Math.random() * 0.015, 2800 + Math.random() * 1200, 0.12); },
    pot(t) { for (let i = 0; i < 9; i++) clink(t + i * 0.03 + Math.random() * 0.02, 2600 + Math.random() * 1400, 0.1); },
    check(t) { tone(t, 140, 0.08, { peak: 0.5, slide: 0.6 }); noise(t, 0.03, { type: 'lowpass', freq: 600, peak: 0.4 }); tone(t + 0.12, 140, 0.08, { peak: 0.45, slide: 0.6 }); noise(t + 0.12, 0.03, { type: 'lowpass', freq: 600, peak: 0.35 }); },
    fold(t) { noise(t, 0.12, { freq: 1400, q: 0.5, peak: 0.25, attack: 0.03 }); },
    turn(t) { tone(t, 880, 0.35, { peak: 0.18 }); tone(t + 0.12, 1320, 0.45, { peak: 0.16 }); },
    click(t) { tone(t, 1800, 0.025, { type: 'triangle', peak: 0.08 }); },
    win(t) { [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.09, f, 0.32, { type: 'triangle', peak: 0.2 })); SOUNDS.pot(t + 0.1); },
    blackjack(t) { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(t + i * 0.07, f, 0.38, { type: 'triangle', peak: 0.2 })); for (let i = 0; i < 6; i++) tone(t + 0.45 + i * 0.05, 2093 + i * 220, 0.12, { peak: 0.06 }); SOUNDS.pot(t + 0.15); },
    lose(t) { tone(t, 330, 0.28, { type: 'triangle', peak: 0.18 }); tone(t + 0.2, 247, 0.45, { type: 'triangle', peak: 0.16, slide: 0.94 }); },
    push(t) { tone(t, 587, 0.25, { type: 'triangle', peak: 0.14 }); tone(t + 0.14, 587, 0.25, { type: 'triangle', peak: 0.1 }); },
    bust(t) { tone(t, 220, 0.4, { type: 'sawtooth', peak: 0.07, slide: 0.7 }); noise(t, 0.15, { type: 'lowpass', freq: 500, peak: 0.25 }); },
  };

  window.Sound = {
    get enabled() { return enabled; },
    play(name, delayMs = 0) {
      if (!enabled || !SOUNDS[name]) return;
      const c = init();
      if (!c) return;
      if (c.state === 'suspended') c.resume();
      try { SOUNDS[name](now() + 0.01 + delayMs / 1000); } catch (e) { /* ignore */ }
    },
    toggle() {
      enabled = !enabled;
      localStorage.setItem('pk_sound', enabled ? '1' : '0');
      if (enabled) this.play('click');
      return enabled;
    },
  };
})();

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
    master.gain.value = 0.42;
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
  function clink(t, base = 3000, peak = 0.1) {
    // ceramic chip: two inharmonic partials + a soft tick
    const f = base * (0.9 + Math.random() * 0.2);
    tone(t, f, 0.08, { type: 'sine', peak, attack: 0.003 });
    tone(t, f * 1.47, 0.05, { type: 'sine', peak: peak * 0.45, attack: 0.003 });
    noise(t, 0.02, { freq: 4000, q: 1, peak: peak * 0.5, attack: 0.003 });
  }

  const SOUNDS = {
    card(t) { noise(t, 0.09, { freq: 1700 + Math.random() * 500, q: 0.6, peak: 0.22, attack: 0.012 }); noise(t + 0.06, 0.05, { type: 'lowpass', freq: 600, peak: 0.12, attack: 0.008 }); },
    flip(t) { noise(t, 0.05, { freq: 2200, q: 0.7, peak: 0.18, attack: 0.008 }); noise(t + 0.05, 0.06, { freq: 1400, q: 0.6, peak: 0.16, attack: 0.008 }); },
    shuffle(t) { for (let i = 0; i < 16; i++) noise(t + i * 0.03 + Math.random() * 0.008, 0.035, { freq: 2000 + Math.random() * 900, q: 0.9, peak: 0.1, attack: 0.008 }); noise(t + 0.52, 0.09, { type: 'lowpass', freq: 500, peak: 0.16, attack: 0.01 }); },
    chip(t) { clink(t); clink(t + 0.045, 3000, 0.11); },
    chips(t) { for (let i = 0; i < 5; i++) clink(t + i * 0.035 + Math.random() * 0.015, 2800 + Math.random() * 1200, 0.12); },
    pot(t) { for (let i = 0; i < 9; i++) clink(t + i * 0.03 + Math.random() * 0.02, 2600 + Math.random() * 1400, 0.1); },
    check(t) { tone(t, 150, 0.09, { peak: 0.32, slide: 0.65, attack: 0.004 }); noise(t, 0.035, { type: 'lowpass', freq: 500, peak: 0.2, attack: 0.004 }); tone(t + 0.13, 150, 0.09, { peak: 0.28, slide: 0.65, attack: 0.004 }); noise(t + 0.13, 0.035, { type: 'lowpass', freq: 500, peak: 0.17, attack: 0.004 }); },
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

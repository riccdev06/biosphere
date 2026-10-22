// Ambient soundscape, synthesized live with the Web Audio API. Nothing is downloaded.
export class Ambience {
  constructor() { this.ctx = null; this.on = false; this.nextChirp = 0; }

  start() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination);
      // shared noise buffer
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      // rain: band-passed noise
      this.rain = this.noiseLayer('bandpass', 1400, 0.6);
      // wind: low-passed noise with a slow swell
      this.wind = this.noiseLayer('lowpass', 380, 0.7);
      const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
      lfo.frequency.value = 0.08; lfoGain.gain.value = 120; lfo.connect(lfoGain); lfoGain.connect(this.wind.filter.frequency); lfo.start();
      // crickets: a high tone chopped by a fast pulse
      const cr = ctx.createOscillator(); cr.type = 'triangle'; cr.frequency.value = 4400;
      const pulse = ctx.createOscillator(); pulse.type = 'square'; pulse.frequency.value = 28;
      const pulseGain = ctx.createGain(); pulseGain.gain.value = 0.5;
      const crAmp = ctx.createGain(); crAmp.gain.value = 0.5;
      pulse.connect(pulseGain); pulseGain.connect(crAmp.gain);
      this.cricket = ctx.createGain(); this.cricket.gain.value = 0;
      cr.connect(crAmp); crAmp.connect(this.cricket); this.cricket.connect(this.master);
      cr.start(); pulse.start();
    }
    this.ctx.resume();
    this.on = true;
    this.master.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.6);
    return true;
  }
  stop() {
    if (!this.ctx) return;
    this.on = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    setTimeout(() => { if (!this.on) this.ctx.suspend(); }, 1200);
  }
  noiseLayer(type, freq, q) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filter); filter.connect(gain); gain.connect(this.master); src.start();
    return { filter, gain };
  }
  chirp(t, pitch) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(pitch, t); o.frequency.exponentialRampToValueAtTime(pitch * (1.2 + Math.random() * 0.4), t + 0.07);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.1);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.12);
  }
  boom() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(60, t + 2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + 2.5);
  }

  // called a few times per second with the state of the world
  update(f, birdiness) {
    if (!this.on || !this.ctx || !f) return;
    const ctx = this.ctx, t = ctx.currentTime, ev = f.ev ? f.ev.type : '', dk = f.dark;
    const rain = ev === 'flood' ? 0.35 : f.season === 2 ? 0.06 : 0;
    const wind = ev === 'frost' ? 0.25 : ev === 'drought' ? 0.16 : f.season === 3 ? 0.12 : 0.03;
    this.rain.gain.gain.setTargetAtTime(rain, t, 1.2);
    this.wind.gain.gain.setTargetAtTime(wind, t, 1.5);
    const crickets = f.season === 3 || ev === 'frost' ? 0 : Math.max(0, dk - 0.3) * 0.05;
    this.cricket.gain.setTargetAtTime(crickets, t, 1.5);
    // birdsong in daylight, more with more flyers
    if (dk < 0.4 && f.season !== 3 && ev !== 'frost' && ev !== 'flood' && t > this.nextChirp) {
      const pitch = 2200 + Math.random() * 1800, n = 2 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++) this.chirp(t + i * 0.13, pitch * (1 + (Math.random() - .5) * 0.1));
      this.nextChirp = t + (1.2 + Math.random() * 3.5) / Math.max(0.3, birdiness);
    }
  }
}

// Generative sound: a filtered pad per form, a rising tone while charging,
// FM bells on release, and soft plucks when the pointer sweeps fast.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.voices = [];
    this.charge = null;
    this.lastPluck = 0;
    this.form = null;
  }

  build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.35;
    this.master.connect(comp).connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.gain.value = 0.75;
    this.dry.connect(this.master);

    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(4.2);
    this.send = ctx.createGain();
    this.send.gain.value = 0.6;
    this.send.connect(verb).connect(this.master);

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 420;
    this.padFilter.Q.value = 0.7;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.55;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.dry);
    this.padGain.connect(this.send);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 160;
    lfo.connect(lfoAmt).connect(this.padFilter.frequency);
    lfo.start();

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
    return true;
  }

  impulse(seconds) {
    const { ctx } = this;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const k = 0.9 - t * 0.75;
        lp += (Math.random() * 2 - 1 - lp) * k;
        d[i] = lp * Math.pow(1 - t, 2.6);
      }
    }
    return buf;
  }

  async toggle(form) {
    if (!this.ctx && !this.build()) return false;
    const t = this.ctx.currentTime;
    this.on = !this.on;
    if (this.on) {
      await this.ctx.resume();
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(0.9, t, 0.25);
      this.form = null;
      this.setForm(form);
      this.bell(mtof(form.scale[4]), 0.5, 0, 0.05);
      this.bell(mtof(form.scale[7]), 0.35, 0.15, 0.22);
    } else {
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(0, t, 0.15);
      this.chargeEnd(false);
    }
    return this.on;
  }

  suspend(hidden) {
    if (!this.ctx || !this.on) return;
    hidden ? this.ctx.suspend() : this.ctx.resume();
  }

  setForm(form) {
    if (!this.on || form === this.form) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const hadPad = !!this.form;
    this.form = form;
    for (const v of this.voices) {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, 0.9);
      v.oscs.forEach((o) => o.stop(t + 5));
    }
    this.voices = form.pad.map((m, i) => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.055 / (1 + i * 0.25), t, 1.4);
      gain.connect(this.padFilter);
      const oscs = [-7, 6].map((cents) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = cents + (Math.random() - 0.5) * 4;
        o.connect(gain);
        o.start(t);
        return o;
      });
      if (i === 0) {
        const sub = ctx.createOscillator();
        sub.frequency.value = mtof(m - 12);
        const sg = ctx.createGain();
        sg.gain.value = 1.6;
        sub.connect(sg).connect(gain);
        sub.start(t);
        oscs.push(sub);
      }
      return { gain, oscs };
    });
    if (hadPad) this.whoosh();
  }

  // Called every frame with how lively the scene is (0..1).
  setEnergy(e) {
    if (!this.on) return;
    const t = this.ctx.currentTime;
    this.padFilter.frequency.setTargetAtTime(380 + e * 2200, t, 0.25);
  }

  noteFromY(y) {
    const s = this.form.scale;
    return s[Math.max(0, Math.min(s.length - 1, Math.round((1 - y) * (s.length - 1))))];
  }

  bell(freq, vel, pan = 0, delay = 0, ratio = 3.5, decay = 0.9) {
    if (!this.on) return;
    const { ctx } = this;
    const t = ctx.currentTime + delay;
    const car = ctx.createOscillator();
    car.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * ratio;
    const modAmt = ctx.createGain();
    modAmt.gain.setValueAtTime(freq * 2.4 * vel, t);
    modAmt.gain.setTargetAtTime(0, t, decay * 0.35);
    mod.connect(modAmt).connect(car.frequency);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.16 * vel, t + 0.005);
    amp.gain.setTargetAtTime(0, t + 0.005, decay);
    const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pn.pan) pn.pan.value = pan;
    car.connect(amp).connect(pn);
    pn.connect(this.dry);
    pn.connect(this.send);
    const end = t + decay * 7;
    car.start(t);
    mod.start(t);
    car.stop(end);
    mod.stop(end);
  }

  noiseBurst({ type, from, to, q, peak, attack, release, dur }) {
    const { ctx } = this;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, t + attack, release);
    src.connect(f).connect(g);
    g.connect(this.dry);
    g.connect(this.send);
    src.start(t);
    src.stop(t + attack + release * 8);
  }

  whoosh() {
    if (!this.on) return;
    this.noiseBurst({ type: 'bandpass', from: 180, to: 2400, q: 1.2, peak: 0.22, attack: 0.5, release: 0.5, dur: 1.4 });
  }

  chargeStart() {
    if (!this.on || this.charge) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const root = mtof(this.form.pad[0] + 24);
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.dry);
    out.connect(this.send);
    const a = ctx.createOscillator();
    a.type = 'triangle';
    a.frequency.value = root;
    const b = ctx.createOscillator();
    b.frequency.value = root * 1.5;
    b.detune.value = 5;
    const bg = ctx.createGain();
    bg.gain.value = 0.5;
    a.connect(out);
    b.connect(bg).connect(out);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 4;
    bp.frequency.value = 300;
    const ng = ctx.createGain();
    ng.gain.value = 0;
    src.connect(bp).connect(ng).connect(this.dry);
    ng.connect(this.send);
    [a, b, src].forEach((n) => n.start(t));
    this.charge = { out, a, b, src, bp, ng, root };
  }

  chargeUpdate(k) {
    const c = this.charge;
    if (!c) return;
    const t = this.ctx.currentTime;
    c.out.gain.setTargetAtTime(0.02 + k * 0.07, t, 0.08);
    c.a.frequency.setTargetAtTime(c.root * (1 + k), t, 0.08);
    c.b.frequency.setTargetAtTime(c.root * 1.5 * (1 + k), t, 0.08);
    c.bp.frequency.setTargetAtTime(300 + k * 3200, t, 0.1);
    c.ng.gain.setTargetAtTime(k * 0.1, t, 0.1);
  }

  chargeEnd() {
    const c = this.charge;
    if (!c) return;
    this.charge = null;
    const t = this.ctx.currentTime;
    c.out.gain.cancelScheduledValues(t);
    c.out.gain.setTargetAtTime(0, t, 0.03);
    c.ng.gain.cancelScheduledValues(t);
    c.ng.gain.setTargetAtTime(0, t, 0.03);
    [c.a, c.b, c.src].forEach((n) => n.stop(t + 0.3));
  }

  release(k, x, y) {
    this.chargeEnd();
    if (!this.on) return;
    const s = this.form.scale;
    const start = s.indexOf(this.noteFromY(y));
    const count = 1 + Math.round(k * 5);
    const pan = x * 1.6 - 0.8;
    for (let i = 0; i < count; i++) {
      const m = s[Math.min(s.length - 1, start + i)] + (i > 3 ? 12 : 0);
      this.bell(mtof(m), 0.9 - i * 0.1, pan + (i % 2 ? 0.2 : -0.2), i * 0.055, 3.5, 0.7 + k * 0.6);
    }
    if (k > 0.25) {
      const { ctx } = this;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(32, t + 0.9);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5 * k, t + 0.01);
      g.gain.setTargetAtTime(0, t + 0.01, 0.35);
      o.connect(g).connect(this.dry);
      o.start(t);
      o.stop(t + 2.5);
      this.noiseBurst({ type: 'lowpass', from: 3000, to: 200, q: 0.5, peak: 0.25 * k, attack: 0.005, release: 0.35, dur: 1.2 });
    }
  }

  // Soft plucks when the pointer sweeps quickly across the field.
  sweep(speed, x, y, now) {
    if (!this.on || speed < 1.6 || now - this.lastPluck < 0.11) return;
    this.lastPluck = now;
    const v = Math.min(0.55, 0.12 + (speed - 1.6) * 0.06);
    this.bell(mtof(this.noteFromY(y)), v, x * 1.6 - 0.8, 0, 2, 0.45);
  }

  chime(form) {
    if (!this.on) return;
    this.bell(mtof(form.scale[2]), 0.45, -0.3, 0, 2, 0.8);
    this.bell(mtof(form.scale[5]), 0.35, 0.3, 0.09, 2, 0.8);
  }
}

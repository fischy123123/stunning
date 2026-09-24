import { getContext, createProgram, use, createTexture, createFramebuffer } from './gl.js';
import * as SH from './shaders.js';
import { FORMS } from './forms.js';
import { PALETTES, LINEAR } from './palettes.js';
import { perspective, lookAt, normalize, cross, add, scale, dot } from './math.js';
import { Sound } from './audio.js';
import { decodeImage, samplePhoto, thumbnail } from './photo.js';
import { createUI } from './ui.js';

const TRAILS = [
  { name: 'Dust', tau: 0 },
  { name: 'Mist', tau: 0.07 },
  { name: 'Silk', tau: 0.24 },
];
const FOV = (42 * Math.PI) / 180;

const query = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(pointer: coarse)').matches;
const canvas = document.getElementById('stage');

const ctx = getContext(canvas);
if (!ctx) {
  fail();
} else {
  try {
    boot(ctx);
  } catch (err) {
    console.error(err);
    fail();
  }
}

function fail() {
  document.getElementById('fallback').hidden = false;
  document.body.classList.add('failed');
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem('filament') || '{}');
  } catch {
    return {};
  }
}

function savePrefs(p) {
  try {
    localStorage.setItem('filament', JSON.stringify(p));
  } catch {
    /* storage unavailable: preferences just won't persist */
  }
}

function boot({ gl, float32 }) {
  gl.bindVertexArray(gl.createVertexArray());

  const P = {
    sim: createProgram(gl, SH.FULLSCREEN_VS, SH.SIM_FS, 'sim'),
    particles: createProgram(gl, SH.PARTICLE_VS, SH.PARTICLE_FS, 'particles'),
    fade: createProgram(gl, SH.FULLSCREEN_VS, SH.FADE_FS, 'fade'),
    down: createProgram(gl, SH.FULLSCREEN_VS, SH.DOWN_FS, 'down'),
    up: createProgram(gl, SH.FULLSCREEN_VS, SH.UP_FS, 'up'),
    composite: createProgram(gl, SH.FULLSCREEN_VS, SH.COMPOSITE_FS, 'composite'),
  };

  const prefs = loadPrefs();
  const clampIndex = (v, n, d) => (Number.isInteger(v) && v >= 0 && v < n ? v : d);
  const pinnedSize = [64, 128, 256, 512, 1024].includes(+query.get('n')) ? +query.get('n') : 0;

  const state = {
    time: 0,
    form: FORMS[clampIndex(prefs.form, FORMS.length, 0)].photo ? 0 : clampIndex(prefs.form, FORMS.length, 0),
    palette: clampIndex(prefs.palette, PALETTES.length, 0),
    trails: clampIndex(prefs.trails, TRAILS.length, 1),
    pal: null,
    palFrom: null,
    palT: 1,
    colorMix: [0.6, 0.3, 0.2],
    speedNorm: 2,
    maxDpr: 2,
    cam: {
      yaw: 0.5, pitch: 0.3, pitchUser: 0, dist: 9, zoom: 1,
      yawVel: 0, pitchVel: 0, px: 0, py: 0, kick: 0,
    },
    ptr: {
      ndc: [0, 0], prevNdc: [0, 0], world: [0, 0, 0], vel: [0, 0, 0],
      client: [innerWidth / 2, innerHeight / 2], inside: false, mouse: !touch, screenSpeed: 0,
    },
    holding: false,
    charge: 0,
    orbiting: false,
    multitouch: false,
    burst: null,
    nova: 0,
    shock: { x: 0.5, y: 0.5, r: 0, s: 0 },
    flash: 0,
    energy: 0,
    lastInput: 0,
    formAge: 0,
    photo: null,
    photoColors: true,
    photoMix: 0,
    photoTrue: 1,
  };
  state.pal = LINEAR[state.palette].map((c) => c.slice());
  state.colorMix = FORMS[state.form].color.slice();
  state.speedNorm = FORMS[state.form].speedNorm;
  state.cam.pitch = FORMS[state.form].pitch;

  // ---- simulation state (ping-pong float textures) -----------------------
  let sim = null;

  function seed(size, intro) {
    const n = size * size;
    const pos = new Float32Array(n * 4);
    const vel = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const d = [s * Math.cos(th), u, s * Math.sin(th)];
      const r = intro ? 0.03 * Math.cbrt(Math.random()) : 1.3 * Math.cbrt(Math.random());
      const sp = intro ? 1.2 + 3.4 * Math.random() ** 2 : 0;
      for (let k = 0; k < 3; k++) {
        pos[i * 4 + k] = d[k] * r;
        vel[i * 4 + k] = d[k] * sp;
      }
      pos[i * 4 + 3] = 1 + Math.random() * 8;
    }
    return { pos, vel };
  }

  function buildSim(size, intro) {
    if (sim) {
      sim.bufs.forEach((b) => {
        gl.deleteTexture(b.pos);
        gl.deleteTexture(b.vel);
        gl.deleteFramebuffer(b.fb);
      });
    }
    const data = seed(size, intro);
    const tryFormat = (internal) => {
      const bufs = [0, 1].map(() => {
        const pos = createTexture(gl, size, size, { internal, type: gl.FLOAT, filter: gl.NEAREST, data: data.pos });
        const vel = createTexture(gl, size, size, { internal, type: gl.FLOAT, filter: gl.NEAREST, data: data.vel });
        return { pos, vel, fb: createFramebuffer(gl, [pos, vel]) };
      });
      if (bufs.every((b) => b.fb)) return bufs;
      bufs.forEach((b) => { gl.deleteTexture(b.pos); gl.deleteTexture(b.vel); });
      return null;
    };
    const bufs = (float32 && tryFormat(gl.RGBA32F)) || tryFormat(gl.RGBA16F);
    if (!bufs) throw new Error('No renderable float format for the simulation');
    sim = { size, n: size * size, bufs, cur: 0 };
    ui.setCount(sim.n);
    if (state.photo) uploadPhoto();
  }

  // ---- screen targets ----------------------------------------------------
  let accum = null;
  let mips = [];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, state.maxDpr);
    const w = Math.max(2, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    if (accum && canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    if (accum) {
      gl.deleteTexture(accum.tex);
      gl.deleteFramebuffer(accum.fb);
      mips.forEach((m) => { gl.deleteTexture(m.tex); gl.deleteFramebuffer(m.fb); });
    }
    const target = (tw, th) => {
      const tex = createTexture(gl, tw, th, { internal: gl.RGBA16F, type: gl.HALF_FLOAT, filter: gl.LINEAR });
      const fb = createFramebuffer(gl, [tex]);
      if (!fb) throw new Error('RGBA16F render target unsupported');
      return { tex, fb, w: tw, h: th };
    };
    accum = target(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fb);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    mips = [];
    let mw = Math.max(1, w >> 1), mh = Math.max(1, h >> 1);
    do {
      mips.push(target(mw, mh));
      mw >>= 1;
      mh >>= 1;
    } while (mips.length < 7 && Math.min(mw, mh) >= 4);
  }

  // ---- UI + sound ----------------------------------------------------------
  const sound = new Sound();
  const ui = createUI({
    forms: FORMS,
    palettes: PALETTES,
    trails: TRAILS,
    touch,
    handlers: {
      form: (i) => { chooseForm(i); input(); },
      palette: (i) => { setPalette(i); input(); },
      photoColors: () => { setPhotoColors(true); input(); },
      photoFile: (file) => { takePhoto(file); input(); },
      trails: () => { cycleTrails(); input(); },
      sound: () => { toggleSound(); input(); },
      fullscreen: () => { toggleFullscreen(); input(); },
    },
  });

  const persist = () => savePrefs({ form: state.form, palette: state.palette, trails: state.trails });

  function setForm(i) {
    if (i === state.form) return;
    state.form = i;
    state.formAge = 0;
    state.nova = Math.max(state.nova, 0.35);
    ui.setForm(i);
    sound.setForm(FORMS[i]);
    persist();
  }

  // The photo form needs a picture; asking for it again while showing one picks a new one.
  function chooseForm(i) {
    if (FORMS[i].photo && (!state.photo || state.form === i)) ui.pickPhoto();
    else setForm(i);
  }

  function setPhotoColors(on) {
    state.photoColors = on;
    ui.setPhotoColors(on);
  }

  // ---- photo -----------------------------------------------------------------
  const photoTex = { target: null, color: null };
  const dummy = {
    target: createTexture(gl, 1, 1, { internal: gl.RGBA32F, type: gl.FLOAT, filter: gl.NEAREST, data: new Float32Array(4) }),
    color: createTexture(gl, 1, 1, { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST, data: new Uint8Array(4) }),
  };
  const photoIndex = FORMS.findIndex((f) => f.photo);

  function uploadPhoto() {
    const sample = samplePhoto(state.photo.source, sim.size);
    state.photo.sample = sample;
    if (photoTex.target) {
      gl.deleteTexture(photoTex.target);
      gl.deleteTexture(photoTex.color);
    }
    photoTex.target = createTexture(gl, sim.size, sim.size, { internal: gl.RGBA32F, type: gl.FLOAT, filter: gl.NEAREST, data: sample.targets });
    photoTex.color = createTexture(gl, sim.size, sim.size, { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST, data: sample.colors });
    const fmt = (v) => v.toLocaleString('en-US').replace(/,/g, '\u2009');
    FORMS[photoIndex].params = `${fmt(sample.cols)} × ${fmt(sample.rows)} points`;
    ui.setForm(state.form);
  }

  async function takePhoto(file) {
    if (file.type && !file.type.startsWith('image/')) {
      ui.toast('That file isn’t an image. Try a JPG, PNG or WebP.');
      return;
    }
    let source;
    try {
      source = await decodeImage(file);
    } catch {
      ui.toast('Couldn’t read that image. Try a JPG, PNG or WebP.');
      return;
    }
    state.photo = { source };
    uploadPhoto();
    ui.setPhoto(thumbnail(source, 96));
    setPhotoColors(true);
    if (state.form === photoIndex) {
      state.formAge = 0;
      state.nova = Math.max(state.nova, 0.6);
      sound.whoosh();
    } else {
      setForm(photoIndex);
    }
    sound.chime(FORMS[photoIndex]);
    ui.hintDone();
  }

  function setPalette(i) {
    if (FORMS[state.form].photo && state.photoColors) setPhotoColors(false);
    if (i === state.palette) return;
    state.palette = i;
    state.palFrom = state.pal.map((c) => c.slice());
    state.palT = 0;
    ui.setPalette(i);
    sound.chime(FORMS[state.form]);
    persist();
  }

  function cycleTrails() {
    state.trails = (state.trails + 1) % TRAILS.length;
    ui.setTrails(state.trails);
    persist();
  }

  async function toggleSound() {
    const on = await sound.toggle(FORMS[state.form]);
    ui.setSound(on);
  }

  function toggleFullscreen() {
    const req = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen?.();
    req?.catch?.(() => {});
  }

  function input() {
    state.lastInput = state.time;
  }

  // ---- camera ----------------------------------------------------------------
  const camera = { eye: [0, 0, 5], right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, -1], dist: 5, view: null, proj: null };

  function updateCamera(dt) {
    const c = state.cam;
    const form = FORMS[state.form];
    if (form.photo) {
      // Face the picture, sway a little to show its relief, drift back after an orbit.
      const front = Math.round(c.yaw / (Math.PI * 2)) * Math.PI * 2;
      const sway = reduced ? 0 : 0.2 * Math.sin(state.formAge * 0.25);
      c.yaw += (front + sway - c.yaw) * (1 - Math.exp(-dt * 0.8)) + c.yawVel * dt;
      c.pitchUser *= Math.exp(-dt * 0.8);
    } else {
      c.yaw += (reduced ? 0 : dt * 0.05) + c.yawVel * dt;
    }
    c.pitchUser += c.pitchVel * dt;
    c.yawVel *= Math.exp(-dt * 4);
    c.pitchVel *= Math.exp(-dt * 4);
    c.pitch += (form.pitch - c.pitch) * (1 - Math.exp(-dt * 1.2));
    const aspect = canvas.width / canvas.height;
    let goal = form.dist * c.zoom * Math.max(1, Math.pow(0.8 / aspect, 0.6));
    if (form.photo && state.photo) {
      const { W, H } = state.photo.sample;
      const t = Math.tan(FOV / 2);
      goal = 1.2 * c.zoom * Math.max(H / 2 / t, W / 2 / (t * aspect));
    }
    c.dist += (goal - c.dist) * (1 - Math.exp(-dt * (state.time < 3 ? 1.1 : 4)));
    const hover = state.ptr.mouse && state.ptr.inside && !reduced;
    c.px += ((hover ? state.ptr.ndc[0] * 0.1 : 0) - c.px) * (1 - Math.exp(-dt * 1.8));
    c.py += ((hover ? state.ptr.ndc[1] * 0.07 : 0) - c.py) * (1 - Math.exp(-dt * 1.8));
    c.kick *= Math.exp(-dt * 3.5);

    const yaw = c.yaw + c.px;
    const pitch = Math.max(-1.25, Math.min(1.35, c.pitch + c.pitchUser + c.py));
    const dist = c.dist * (1 - c.kick * 0.07);
    const eye = [dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw)];
    const back = normalize(eye);
    const right = normalize(cross([0, 1, 0], back));
    const up = cross(back, right);
    Object.assign(camera, {
      eye, right, up, fwd: scale(back, -1), dist,
      view: lookAt(eye, right, up, back),
      proj: perspective(FOV, canvas.width / canvas.height, 0.05, 60),
    });
  }

  function worldAt(ndc) {
    const t = Math.tan(FOV / 2);
    const aspect = canvas.width / canvas.height;
    const dir = normalize(add(add(camera.fwd, scale(camera.right, ndc[0] * t * aspect)), scale(camera.up, ndc[1] * t)));
    return add(camera.eye, scale(dir, camera.dist / dot(dir, camera.fwd)));
  }

  // ---- input -------------------------------------------------------------
  const pointers = new Map();

  function setPointer(e) {
    const r = canvas.getBoundingClientRect();
    state.ptr.client = [e.clientX, e.clientY];
    state.ptr.ndc = [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
    state.ptr.mouse = e.pointerType === 'mouse';
  }

  function beginHold() {
    state.holding = true;
    state.charge = 0;
    sound.chargeStart();
  }

  function cancelHold() {
    if (!state.holding) return;
    state.holding = false;
    state.charge = 0;
    sound.chargeEnd();
  }

  function release() {
    const k = holdLevel();
    state.holding = false;
    state.charge = 0;
    const uv = [(state.ptr.ndc[0] + 1) / 2, (state.ptr.ndc[1] + 1) / 2];
    state.burst = [...state.ptr.world, 0.25 + k * 1.5];
    if (!reduced) {
      state.shock = { x: uv[0], y: uv[1], r: 0, s: 0.2 + k * 0.8 };
      state.flash = 0.08 + k * 0.5;
      state.cam.kick = k;
    }
    state.energy = Math.max(state.energy, 0.35 + k * 0.65);
    sound.release(k, uv[0], uv[1]);
    ui.hintDone();
  }

  function nova() {
    state.nova = 2.2;
    if (!reduced) {
      state.shock = { x: 0.5, y: 0.5, r: 0, s: 1 };
      state.flash = 0.6;
      state.cam.kick = 1;
    }
    state.energy = 1;
    sound.release(1, 0.5, 0.35);
    ui.hintDone();
  }

  const holdLevel = () => (state.holding ? 0.06 + 0.94 * (1 - (1 - state.charge) ** 2) : 0);

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    input();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    setPointer(e);
    state.ptr.inside = true;
    if (e.pointerType === 'mouse') {
      if (e.button === 2 || (e.button === 0 && e.shiftKey)) state.orbiting = true;
      else if (e.button === 0) beginHold();
      return;
    }
    if (pointers.size >= 2) {
      cancelHold();
      state.multitouch = true;
      return;
    }
    beginHold();
  });

  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (state.multitouch && prev && pointers.size >= 2) {
      const pts = [...pointers.values()];
      const before = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      const now = [...pointers.values()];
      const after = Math.hypot(now[0][0] - now[1][0], now[0][1] - now[1][1]);
      const dx = (e.clientX - prev[0]) / 2;
      const dy = (e.clientY - prev[1]) / 2;
      state.cam.yawVel -= dx * 0.021;
      state.cam.pitchVel += dy * 0.016;
      if (before > 10 && after > 10) {
        state.cam.zoom = Math.max(0.4, Math.min(1.7, state.cam.zoom * (before / after)));
      }
      input();
      return;
    }
    if (prev) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (state.orbiting && prev) {
      state.cam.yawVel -= (e.clientX - prev[0]) * 0.021;
      state.cam.pitchVel += (e.clientY - prev[1]) * 0.016;
    }
    setPointer(e);
    state.ptr.inside = true;
    input();
  });

  const endPointer = (e) => {
    const had = pointers.delete(e.pointerId);
    if (e.pointerType === 'mouse') {
      if (state.orbiting && (e.button === 2 || e.button === 0)) state.orbiting = false;
      if (state.holding && e.button === 0) release();
      return;
    }
    if (!had) return;
    if (state.holding && pointers.size === 0 && !state.multitouch) {
      e.type === 'pointercancel' ? cancelHold() : release();
    }
    if (pointers.size === 0) {
      state.multitouch = false;
      state.ptr.inside = false;
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !state.holding) state.ptr.inside = false;
  });
  canvas.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    setPointer(e);
    state.ptr.prevNdc = state.ptr.ndc.slice();
    state.ptr.inside = true;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    state.cam.zoom = Math.max(0.4, Math.min(1.7, state.cam.zoom * Math.exp(d * 0.0012)));
    input();
  }, { passive: false });

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest?.('button')) return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= String(FORMS.length)) chooseForm(+k - 1);
    else if (k === 'c') setPalette((state.palette + (e.shiftKey ? PALETTES.length - 1 : 1)) % PALETTES.length);
    else if (k === 't') cycleTrails();
    else if (k === 'm') toggleSound();
    else if (k === 'f') toggleFullscreen();
    else if (k === 'h') ui.toggleHidden();
    else if (k === ' ') nova();
    else if (k === 'arrowleft' || k === 'arrowright') state.cam.yawVel += k === 'arrowleft' ? 1.2 : -1.2;
    else if (k === 'arrowup' || k === 'arrowdown') state.cam.pitchVel += k === 'arrowup' ? 0.8 : -0.8;
    else return;
    e.preventDefault();
    input();
  });

  document.addEventListener('visibilitychange', () => sound.suspend(document.hidden));
  addEventListener('blur', () => {
    cancelHold();
    state.orbiting = false;
    pointers.clear();
    state.multitouch = false;
  });
  addEventListener('resize', resize);

  // Photos can arrive by drag and drop or paste, as well as the picker.
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  let dragDepth = 0;
  addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (dragDepth++ === 0) ui.dropZone(true);
  });
  addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) ui.dropZone(false);
  });
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    ui.dropZone(false);
    const files = [...e.dataTransfer.files];
    const file = files.find((f) => f.type.startsWith('image/')) || files[0];
    if (file) { takePhoto(file); input(); }
  });
  addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (!file) return;
    e.preventDefault();
    takePhoto(file);
    input();
  });

  // ---- adaptive quality ------------------------------------------------------
  const perf = { samples: [], done: !!pinnedSize, steps: 0 };

  function checkPerf(raw) {
    if (perf.done || state.time < 1.5) return;
    perf.samples.push(raw);
    if (perf.samples.length < 90) return;
    const sorted = perf.samples.sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    perf.samples = [];
    if (median < 1 / 45) {
      perf.done = true;
      return;
    }
    perf.steps++;
    if (sim.size > 512) buildSim(512, false);
    else if (state.maxDpr > 1 && (window.devicePixelRatio || 1) > 1) { state.maxDpr = 1; resize(); }
    else if (sim.size > 256) buildSim(256, false);
    else perf.done = true;
    if (perf.steps >= 4) perf.done = true;
  }

  // ---- frame ---------------------------------------------------------------
  function update(dt) {
    state.time += dt;
    const form = FORMS[state.form];

    // Wander on our own after a long quiet spell.
    if (state.time - state.lastInput > 50) {
      state.lastInput = state.time - 20;
      let next = (state.form + 1) % FORMS.length;
      if (FORMS[next].photo && !state.photo) next = (next + 1) % FORMS.length;
      setForm(next);
    }

    updateCamera(dt);

    const p = state.ptr;
    const world = worldAt(p.ndc);
    const prevWorld = worldAt(p.prevNdc);
    const raw = scale([world[0] - prevWorld[0], world[1] - prevWorld[1], world[2] - prevWorld[2]], 1 / dt);
    p.vel = p.vel.map((v, i) => v + (raw[i] - v) * 0.35);
    const sSpeed = Math.hypot(p.ndc[0] - p.prevNdc[0], p.ndc[1] - p.prevNdc[1]) / 2 / dt;
    p.screenSpeed += (sSpeed - p.screenSpeed) * 0.4;
    p.world = world;
    p.prevNdc = p.ndc.slice();

    if (state.holding) state.charge = Math.min(1, state.charge + dt / 1.8);
    const hold = holdLevel();
    sound.chargeUpdate(hold);

    state.palT = Math.min(1, state.palT + dt / 0.9);
    const e = state.palT * state.palT * (3 - 2 * state.palT);
    const target = LINEAR[state.palette];
    state.pal = state.palFrom
      ? state.palFrom.map((c, i) => c.map((v, k) => v + (target[i][k] - v) * e))
      : target.map((c) => c.slice());
    const lerp = 1 - Math.exp(-dt * 2);
    state.colorMix = state.colorMix.map((v, i) => v + (form.color[i] - v) * lerp);
    state.speedNorm += (form.speedNorm - state.speedNorm) * lerp;
    state.formAge += dt;
    state.photoMix += ((form.photo && state.photo ? 1 : 0) - state.photoMix) * (1 - Math.exp(-dt * 1.5));
    state.photoTrue += ((state.photoColors ? 1 : 0) - state.photoTrue) * (1 - Math.exp(-dt * 3));

    const s = state.shock;
    if (s.s > 0) {
      s.r += dt * (0.8 + s.s * 0.5);
      s.s *= Math.exp(-dt * 1.7);
      if (s.s < 0.004) s.s = 0;
    }
    state.flash *= Math.exp(-dt * 5);

    const stir = p.mouse && p.inside && !state.holding && !state.orbiting ? Math.min(p.screenSpeed, 3) : 0;
    state.energy = Math.max(state.energy * Math.exp(-dt * 0.7), hold * 0.8, stir * 0.25);
    sound.setEnergy(state.energy);
    if (stir) sound.sweep(stir, (p.ndc[0] + 1) / 2, (p.ndc[1] + 1) / 2, state.time);

    ui.reticle(p.client[0], p.client[1], p.inside && (p.mouse || state.holding), hold);
  }

  const PARTICLE_SIZE = 0.0036;
  const PHOTO_LEVEL = 0.75;

  // Forms use a fixed brightness per particle. A photo is a known grid, so its
  // brightness is solved so the summed points land at PHOTO_LEVEL for white.
  function particleIntensity(density, H) {
    const base = 0.05 * FORMS[state.form].gain * Math.pow(density, 0.75);
    if (!state.photo || state.photoMix < 0.001) return base;
    const { W: pw, H: ph, cols, rows } = state.photo.sample;
    const ps = H / (2 * Math.tan(FOV / 2));
    const d = camera.dist;
    const rho = (cols * rows) / ((pw * ps / d) * (ph * ps / d));
    const px = PARTICLE_SIZE * Math.pow(density, 0.25) * ps / d;
    const size = Math.max(px, 1);
    const energy = Math.min(Math.max(px * px, 0.15), 6) / (size * size);
    const half = (size + 1) / 2;
    const photo = PHOTO_LEVEL / (energy * rho * 0.77 * half * half);
    return base + (photo - base) * state.photoMix;
  }

  function render(dt) {
    const form = FORMS[state.form];
    const p = state.ptr;
    const hold = holdLevel();
    const hover = p.mouse && p.inside && !state.holding && !state.orbiting;

    // 1. simulate
    const src = sim.bufs[sim.cur];
    const dst = sim.bufs[1 - sim.cur];
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, sim.size, sim.size);
    use(gl, P.sim, {
      uPos: src.pos,
      uVel: src.vel,
      uTime: state.time,
      uDt: dt,
      uForm: state.form,
      uFlowGain: 1 - hold * 0.88,
      uCurl: form.curl,
      uRespawn: form.respawn,
      uPointer: p.world,
      uPointerVel: p.vel,
      uViewDir: camera.fwd,
      uHover: hover ? 1 : 0,
      uHold: hold,
      uBurst: state.burst || [0, 0, 0, 0],
      uNova: state.nova,
      uImgTarget: photoTex.target || dummy.target,
      uFormAge: state.formAge,
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    sim.cur = 1 - sim.cur;
    state.burst = null;
    state.nova = 0;

    // 2. accumulate light with trailing decay
    const W = canvas.width, H = canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fb);
    gl.viewport(0, 0, W, H);
    const tau = TRAILS[state.trails].tau;
    const decay = tau > 0 ? Math.exp(-dt / tau) : 0;
    gl.enable(gl.BLEND);
    if (decay > 0) {
      gl.blendColor(0, 0, 0, decay);
      gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
      use(gl, P.fade, {});
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.blendFunc(gl.ONE, gl.ONE);
    const density = 1e6 / sim.n;
    use(gl, P.particles, {
      uPos: dst.pos,
      uVel: dst.vel,
      uProj: camera.proj,
      uView: camera.view,
      uTexW: sim.size,
      uPointScale: H / (2 * Math.tan(FOV / 2)),
      uSize: PARTICLE_SIZE * Math.pow(density, 0.25),
      uFocus: camera.dist,
      uAperture: 0.0028,
      uIntensity: particleIntensity(density, H) * (1 - decay),
      uRespawn: form.respawn,
      uSpeedNorm: state.speedNorm,
      uColorMix: state.colorMix,
      uPal: state.pal.flat(),
      uForm: state.form,
      uTime: state.time,
      uImgColor: photoTex.color || dummy.color,
      uPhotoMix: state.photo ? state.photoMix : 0,
      uPhotoTrue: state.photoTrue,
    });
    gl.drawArrays(gl.POINTS, 0, sim.n);

    // 3. bloom
    gl.disable(gl.BLEND);
    let from = accum;
    for (const m of mips) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, m.fb);
      gl.viewport(0, 0, m.w, m.h);
      use(gl, P.down, { uSrc: from.tex, uTexel: [1 / from.w, 1 / from.h] });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      from = m;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = mips.length - 1; i > 0; i--) {
      const m = mips[i - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, m.fb);
      gl.viewport(0, 0, m.w, m.h);
      use(gl, P.up, { uSrc: mips[i].tex, uTexel: [1 / mips[i].w, 1 / mips[i].h] });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);

    // 4. composite to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    const deep = state.pal[1];
    use(gl, P.composite, {
      uScene: accum.tex,
      uBloom: mips[0].tex,
      uRes: [W, H],
      uBloomStr: 0.16,
      uExposure: 1.35,
      uFlash: state.flash,
      uTime: state.time,
      uShock: [state.shock.x, state.shock.y, state.shock.r, state.shock.s],
      uGlow: [deep[0] * 0.025, deep[1] * 0.025, deep[2] * 0.025],
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---- start -----------------------------------------------------------------
  ui.setForm(state.form);
  ui.setPalette(state.palette);
  ui.setTrails(state.trails);
  ui.setSound(false);

  resize();
  const startSize = pinnedSize || (touch || Math.min(screen.width, screen.height) < 700 ? 512 : 1024);
  buildSim(startSize, true);
  state.shock = { x: 0.5, y: 0.5, r: 0, s: reduced ? 0 : 0.7 };
  state.flash = reduced ? 0 : 0.9;

  let last = performance.now();
  function frame(now) {
    const raw = Math.max(0.001, (now - last) / 1000);
    last = now;
    const dt = Math.min(raw, 1 / 30);
    resize();
    update(dt);
    render(dt);
    checkPerf(raw);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.__filament = { state, setForm, setPalette, nova, takePhoto };
}

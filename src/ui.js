// Dock, readouts, tooltip, reticle. Everything visual lives in style.css.

const ICONS = {
  trails: (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${[
    '<path d="M4 16c4-1 8-5 16-6"/>',
    '<path d="M4 12c5-1 9-4 13-8"/>',
    '<path d="M6 20c4 0 9-2 13-5"/>',
  ].slice(0, n + 1).join('')}</svg>`,
  sound: (on) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>${
    on ? '<path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a8 8 0 0 1 0 11"/>' : '<path d="M16 10l4 4M20 10l-4 4"/>'
  }</svg>`,
  full: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>`,
};

const $ = (id) => document.getElementById(id);

function project(paths, [yaw, pitch]) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const out = paths.map((pts) => pts.map(([x, y, z]) => {
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    const y1 = y * cp - z1 * sp;
    minX = Math.min(minX, x1); maxX = Math.max(maxX, x1);
    minY = Math.min(minY, y1); maxY = Math.max(maxY, y1);
    return [x1, y1];
  }));
  return { paths: out, minX, minY, maxX, maxY };
}

function drawThumb(canvas, proj, color) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const css = canvas.clientWidth || 26;
  const px = Math.round(css * dpr);
  if (canvas.width !== px) canvas.width = canvas.height = px;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, px, px);
  const pad = px * 0.08;
  const s = (px - pad * 2) / Math.max(proj.maxX - proj.minX, proj.maxY - proj.minY);
  const ox = px / 2 - ((proj.minX + proj.maxX) / 2) * s;
  const oy = px / 2 + ((proj.minY + proj.maxY) / 2) * s;
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = color;
  g.lineWidth = 0.55 * dpr;
  g.globalAlpha = 0.5;
  for (const pts of proj.paths) {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(ox + x * s, oy - y * s) : g.moveTo(ox + x * s, oy - y * s)));
    g.stroke();
  }
}

export function createUI({ forms, palettes, trails, handlers, touch }) {
  const root = document.documentElement;
  const tip = $('tip');
  const formWrap = $('forms');
  const palWrap = $('palettes');
  const btnTrails = $('btnTrails');
  const btnSound = $('btnSound');
  const btnFull = $('btnFull');
  const reticle = $('reticle');

  function attachTip(el, label, key) {
    const show = () => {
      tip.innerHTML = `${label()}<kbd>${key}</kbd>`;
      tip.classList.add('on');
      const r = el.getBoundingClientRect();
      const w = tip.offsetWidth;
      const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
      tip.style.transform = `translate(${x}px, ${r.top - tip.offsetHeight - 10}px)`;
    };
    const hide = () => tip.classList.remove('on');
    el.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && show());
    el.addEventListener('pointerleave', hide);
    el.addEventListener('focus', () => el.matches(':focus-visible') && show());
    el.addEventListener('blur', hide);
    el.addEventListener('click', () => tip.classList.contains('on') && requestAnimationFrame(show));
  }

  const thumbs = forms.map((f, i) => {
    const b = document.createElement('button');
    b.className = 'form';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', f.name);
    const c = document.createElement('canvas');
    b.appendChild(c);
    b.addEventListener('click', () => handlers.form(i));
    attachTip(b, () => f.name, i + 1);
    formWrap.appendChild(b);
    return { b, c, proj: project(f.thumb(), f.thumbView || [0.6, 0.35]) };
  });

  const swatches = palettes.map((p, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', p.name);
    b.style.setProperty('--g', `radial-gradient(circle at 34% 30%, ${p.stops[4]} 0%, ${p.stops[3]} 22%, ${p.stops[2]} 48%, ${p.stops[1]} 74%, ${p.stops[0]} 100%)`);
    b.addEventListener('click', () => handlers.palette(i));
    attachTip(b, () => p.name, 'C');
    palWrap.appendChild(b);
    return b;
  });

  let trailMode = 0;
  btnTrails.addEventListener('click', handlers.trails);
  attachTip(btnTrails, () => `Trails · ${trails[trailMode].name}`, 'T');
  btnSound.addEventListener('click', handlers.sound);
  attachTip(btnSound, () => (btnSound.getAttribute('aria-pressed') === 'true' ? 'Sound on' : 'Sound off'), 'M');
  if (document.fullscreenEnabled) {
    btnFull.innerHTML = ICONS.full;
    btnFull.addEventListener('click', handlers.fullscreen);
    attachTip(btnFull, () => 'Fullscreen', 'F');
  } else {
    btnFull.hidden = true;
  }

  if (touch) $('hintSub').textContent = 'two fingers to orbit and zoom';

  // Fade the chrome when the mouse rests; bring it back on any movement.
  let idleTimer = 0;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    if (!touch) idleTimer = setTimeout(() => {
      if (!document.querySelector('.dock:hover')) document.body.classList.add('idle');
    }, 3200);
  };
  addEventListener('pointermove', wake, { passive: true });
  addEventListener('keydown', wake);
  wake();

  let hintGone = false;

  return {
    setForm(i) {
      thumbs.forEach(({ b }, j) => b.setAttribute('aria-checked', String(i === j)));
      $('formName').textContent = forms[i].name;
      $('formParams').textContent = forms[i].params;
    },
    setPalette(i) {
      swatches.forEach((b, j) => b.setAttribute('aria-checked', String(i === j)));
      const p = palettes[i];
      root.style.setProperty('--accent', p.stops[3]);
      root.style.setProperty('--accent-deep', p.stops[1]);
      thumbs.forEach(({ c, proj }) => drawThumb(c, proj, p.stops[3]));
    },
    setTrails(i) {
      trailMode = i;
      btnTrails.innerHTML = ICONS.trails(i);
      btnTrails.setAttribute('aria-label', `Trails: ${trails[i].name}`);
    },
    setSound(on) {
      btnSound.innerHTML = ICONS.sound(on);
      btnSound.setAttribute('aria-pressed', String(on));
    },
    setCount(n) {
      $('count').textContent = n.toLocaleString('en-US').replace(/,/g, ' ');
    },
    hintDone() {
      if (hintGone) return;
      hintGone = true;
      setTimeout(() => $('hint').classList.add('gone'), 2500);
    },
    toggleHidden() {
      document.body.classList.toggle('bare');
    },
    reticle(x, y, visible, k) {
      reticle.style.transform = `translate(${x}px, ${y}px)`;
      reticle.classList.toggle('on', visible);
      reticle.style.setProperty('--k', k.toFixed(3));
    },
  };
}

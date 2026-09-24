// Dock, readouts, tooltip, reticle, photo intake. Everything visual lives in style.css.

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
const dprOf = () => Math.min(window.devicePixelRatio || 1, 2);

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

function prepare(canvas) {
  const px = Math.round((canvas.clientWidth || 26) * dprOf());
  if (canvas.width !== px) canvas.width = canvas.height = px;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, px, px);
  return { g, px };
}

function drawThumb(canvas, proj, color) {
  const { g, px } = prepare(canvas);
  const pad = px * 0.08;
  const s = (px - pad * 2) / Math.max(proj.maxX - proj.minX, proj.maxY - proj.minY);
  const ox = px / 2 - ((proj.minX + proj.maxX) / 2) * s;
  const oy = px / 2 + ((proj.minY + proj.maxY) / 2) * s;
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = color;
  g.lineWidth = 0.55 * dprOf();
  g.globalAlpha = 0.5;
  for (const pts of proj.paths) {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(ox + x * s, oy - y * s) : g.moveTo(ox + x * s, oy - y * s)));
    g.stroke();
  }
}

// A small framed landscape until a photo arrives, then the photo itself.
function drawPhotoThumb(canvas, thumb, color) {
  const { g, px } = prepare(canvas);
  const u = px / 26;
  if (thumb) {
    g.save();
    g.beginPath();
    g.arc(px / 2, px / 2, px * 0.44, 0, Math.PI * 2);
    g.clip();
    g.drawImage(thumb, 0, 0, px, px);
    g.restore();
    return;
  }
  g.strokeStyle = color;
  g.lineWidth = 1.1 * u;
  g.lineJoin = g.lineCap = 'round';
  g.globalAlpha = 0.85;
  g.beginPath();
  if (g.roundRect) g.roundRect(4 * u, 6 * u, 18 * u, 14 * u, 2.5 * u);
  else g.rect(4 * u, 6 * u, 18 * u, 14 * u);
  g.moveTo(5 * u, 18 * u);
  g.lineTo(10.5 * u, 12.5 * u);
  g.lineTo(14 * u, 16 * u);
  g.lineTo(16.5 * u, 13.5 * u);
  g.lineTo(21 * u, 18 * u);
  g.stroke();
  g.beginPath();
  g.arc(16.5 * u, 10 * u, 1.6 * u, 0, Math.PI * 2);
  g.stroke();
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
  const picker = $('photoPick');

  const ui = { form: 0, palette: 0, photo: null, photoColors: true };

  function attachTip(el, label, key) {
    const show = () => {
      tip.innerHTML = key ? `${label()}<kbd>${key}</kbd>` : label();
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

  const photoLabel = (i) => (!ui.photo ? 'Add a photo' : ui.form === i ? 'Choose another' : 'Photo');

  const thumbs = forms.map((f, i) => {
    const b = document.createElement('button');
    b.className = 'form';
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', f.name);
    const c = document.createElement('canvas');
    b.appendChild(c);
    b.addEventListener('click', () => handlers.form(i));
    attachTip(b, () => (f.photo ? photoLabel(i) : f.name), i + 1);
    formWrap.appendChild(b);
    return { b, c, f, proj: f.thumb ? project(f.thumb(), f.thumbView || [0.6, 0.35]) : null };
  });

  const photoSwatch = document.createElement('button');
  photoSwatch.className = 'swatch photo';
  photoSwatch.type = 'button';
  photoSwatch.hidden = true;
  photoSwatch.setAttribute('role', 'radio');
  photoSwatch.setAttribute('aria-label', 'Photo colors');
  photoSwatch.addEventListener('click', handlers.photoColors);
  attachTip(photoSwatch, () => 'Photo colors', '');
  palWrap.appendChild(photoSwatch);

  const swatches = palettes.map((p, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', p.name);
    b.style.setProperty('--g', `radial-gradient(circle at 34% 30%, ${p.stops[4]} 0%, ${p.stops[3]} 22%, ${p.stops[2]} 48%, ${p.stops[1]} 74%, ${p.stops[0]} 100%)`);
    b.addEventListener('click', () => handlers.palette(i));
    attachTip(b, () => p.name, 'C');
    palWrap.appendChild(b);
    return b;
  });

  function refreshSwatches() {
    const photoForm = !!forms[ui.form].photo && !!ui.photo;
    const photoOn = photoForm && ui.photoColors;
    photoSwatch.hidden = !photoForm;
    photoSwatch.setAttribute('aria-checked', String(photoOn));
    swatches.forEach((b, j) => b.setAttribute('aria-checked', String(!photoOn && ui.palette === j)));
  }

  function refreshThumbs() {
    const color = palettes[ui.palette].stops[3];
    thumbs.forEach(({ c, f, proj }) => (f.photo ? drawPhotoThumb(c, ui.photo, color) : drawThumb(c, proj, color)));
  }

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

  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (file) handlers.photoFile(file);
  });

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
  let toastTimer = 0;

  return {
    setForm(i) {
      ui.form = i;
      thumbs.forEach(({ b }, j) => b.setAttribute('aria-checked', String(i === j)));
      $('formName').textContent = forms[i].name;
      $('formParams').textContent = forms[i].params;
      refreshSwatches();
    },
    setPalette(i) {
      ui.palette = i;
      const p = palettes[i];
      root.style.setProperty('--accent', p.stops[3]);
      root.style.setProperty('--accent-deep', p.stops[1]);
      refreshSwatches();
      refreshThumbs();
    },
    setPhoto(thumb) {
      ui.photo = thumb;
      photoSwatch.style.setProperty('--g', `url("${thumb.toDataURL('image/jpeg', 0.85)}") center / cover no-repeat`);
      refreshSwatches();
      refreshThumbs();
    },
    setPhotoColors(on) {
      ui.photoColors = on;
      refreshSwatches();
    },
    pickPhoto() {
      picker.click();
    },
    dropZone(on) {
      $('drop').classList.toggle('on', on);
    },
    toast(message) {
      const el = $('toast');
      el.textContent = message;
      el.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('on'), 3800);
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

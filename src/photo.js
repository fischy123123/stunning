// Turns a picture into particle targets (a lit relief) and per-particle colors.

const LONG_SIDE = 3.2;

export async function decodeImage(blob) {
  let img;
  try {
    img = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    img = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const el = new Image();
      el.onload = () => { URL.revokeObjectURL(url); resolve(el); };
      el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
      el.src = url;
    });
  }
  const w = img.width, h = img.height;
  if (!w || !h) throw new Error('empty image');
  const s = Math.min(1, 2048 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  img.close?.();
  return c;
}

// One particle per sample on a cols x rows grid that matches the photo's shape.
// Particle i lives at texel (i % size, i / size) of the simulation textures.
export function samplePhoto(src, size) {
  const n = size * size;
  const aspect = src.width / src.height;
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * aspect))));
  const rows = Math.max(1, Math.floor(n / cols));
  const c = document.createElement('canvas');
  c.width = cols;
  c.height = rows;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, cols, rows);
  const px = g.getImageData(0, 0, cols, rows).data;

  const W = aspect >= 1 ? LONG_SIDE : LONG_SIDE * aspect;
  const H = aspect >= 1 ? LONG_SIDE / aspect : LONG_SIDE;
  const targets = new Float32Array(n * 4);
  const colors = new Uint8Array(n * 4);
  const used = cols * rows;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (i >= used) {
      targets[o] = (Math.random() - 0.5) * W;
      targets[o + 1] = (Math.random() - 0.5) * H;
      continue;
    }
    const x = i % cols;
    const y = (i / cols) | 0;
    const a = px[o + 3] / 255;
    const r = px[o] * a, gr = px[o + 1] * a, b = px[o + 2] * a;
    const lum = (0.2126 * r + 0.7152 * gr + 0.0722 * b) / 255;
    targets[o] = ((x + Math.random()) / cols - 0.5) * W;
    targets[o + 1] = (0.5 - (y + Math.random()) / rows) * H;
    targets[o + 2] = (lum - 0.4) * 0.28 + (Math.random() - 0.5) * 0.012;
    targets[o + 3] = 1;
    colors[o] = r;
    colors[o + 1] = gr;
    colors[o + 2] = b;
    colors[o + 3] = 255;
  }
  return { targets, colors, cols, rows, W, H };
}

export function thumbnail(src, px) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const s = Math.min(src.width, src.height);
  c.getContext('2d').drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, px, px);
  return c;
}

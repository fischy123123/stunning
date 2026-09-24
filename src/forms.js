// Each form is a flow field the particles follow. The shader owns the physics;
// this file holds the settings, the sound of each form, and CPU copies of the
// fields that draw the little thumbnails in the dock.

const TAU = Math.PI * 2;

function integrate(field, start, h, steps, skip) {
  const pts = [];
  let p = start.slice();
  for (let i = 0; i < steps; i++) {
    const d = field(p);
    p = [p[0] + d[0] * h, p[1] + d[1] * h, p[2] + d[2] * h];
    if (i >= skip && i % 2 === 0) pts.push(p);
  }
  return [pts];
}

const aizawa = ([x, y, z]) => [
  (z - 0.7) * x - 3.5 * y,
  3.5 * x + (z - 0.7) * y,
  0.6 + 0.95 * z - (z * z * z) / 3 - (x * x + y * y) * (1 + 0.25 * z) + 0.1 * z * x * x * x,
];
const halvorsen = ([x, y, z]) => [
  -1.89 * x - 4 * y - 4 * z - y * y,
  -1.89 * y - 4 * z - 4 * x - z * z,
  -1.89 * z - 4 * x - 4 * y - x * x,
];
const lorenz = ([x, y, z]) => [10 * (y - x), x * (28 - z) - y, x * y - (8 / 3) * z];

const swapYZ = (paths) => paths.map((pts) => pts.map(([x, y, z]) => [x, z, y]));

function knotPath() {
  const pts = [];
  for (let i = 0; i <= 720; i++) {
    const a = (i / 720) * TAU;
    const r = 1 + 0.42 * Math.cos(5 * a);
    pts.push([r * Math.cos(2 * a), r * Math.sin(2 * a), 0.42 * Math.sin(5 * a)]);
  }
  return [pts];
}

function galaxyPaths() {
  const paths = [];
  for (let arm = 0; arm < 2; arm++) {
    for (const off of [-0.5, -0.25, 0, 0.25, 0.5]) {
      const pts = [];
      for (let i = 0; i <= 90; i++) {
        const r = 0.06 + (i / 90) * 1.3;
        const th = arm * Math.PI + r * 3.4 + off * (0.35 + 0.5 / (r * 2 + 0.4)) * 0.6;
        pts.push([Math.cos(th) * r, 0, Math.sin(th) * r]);
      }
      paths.push(pts);
    }
  }
  return paths;
}

function nebulaPaths() {
  const paths = [];
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 9; k++) {
    const ax = rnd() * TAU, ay = rnd() * TAU, ph = rnd() * TAU;
    const pts = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * TAU;
      const r = 0.8 + 0.28 * Math.sin(3 * a + ph) + 0.12 * Math.sin(7 * a + k);
      let x = Math.cos(a) * r, y = Math.sin(a) * r * 0.6, z = Math.sin(2 * a + ph) * 0.3;
      [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
      [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
      pts.push([x, y, z]);
    }
    paths.push(pts);
  }
  return paths;
}

export const FORMS = [
  {
    name: 'Aizawa',
    params: 'a .95  b .7  c .6  d 3.5  e .25  f .1',
    respawn: 1, curl: 0.012, gain: 1, pitch: 0.32, dist: 5.7,
    color: [0.62, 0.28, 0.22], speedNorm: 2.2,
    pad: [38, 45, 52, 54, 61],
    scale: [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86],
    thumb: () => swapYZ(integrate(aizawa, [0.1, 0, 0], 0.01, 9000, 400)),
  },
  {
    name: 'Halvorsen',
    params: 'a 1.89',
    respawn: 1, curl: 0.02, gain: 1, pitch: 0.22, dist: 4.8,
    color: [0.6, 0.3, 0.22], speedNorm: 2.4,
    pad: [34, 41, 48, 50, 57],
    scale: [70, 72, 74, 77, 79, 82, 84, 86, 89, 91],
    thumb: () => integrate(halvorsen, [1, 0, 0], 0.006, 9000, 600)
      .map((pts) => pts.map(([x, y, z]) => {
        const a = [x + 2.58, y + 2.58, z + 2.58];
        return [
          (a[0] - a[1]) * 0.70710678,
          (a[0] + a[1] - 2 * a[2]) * 0.40824829,
          (a[0] + a[1] + a[2]) * 0.57735027,
        ];
      })),
    thumbView: [0, 0],
  },
  {
    name: 'Lorenz',
    params: 'σ 10  ρ 28  β 8/3',
    respawn: 1, curl: 0.02, gain: 0.9, pitch: 0.16, dist: 5.6,
    color: [0.7, 0.1, 0.22], speedNorm: 3.2,
    pad: [42, 49, 56, 57, 61],
    scale: [66, 69, 71, 73, 76, 78, 81, 83, 85, 88],
    thumb: () => swapYZ(integrate(lorenz, [1, 1, 1], 0.004, 7000, 300)),
    thumbView: [0.2, 0.1],
  },
  {
    name: 'Nebula',
    params: 'curl ∇×ψ  simplex',
    respawn: 0, curl: 0, gain: 0.8, pitch: 0.3, dist: 5.4,
    color: [0.5, 0.3, 0.35], speedNorm: 1.3,
    pad: [39, 46, 53, 55, 62],
    scale: [63, 65, 67, 70, 72, 75, 77, 79, 82, 84],
    thumb: nebulaPaths,
  },
  {
    name: 'Galaxy',
    params: 'arms 2  wind 3.4  bulge .14',
    respawn: 0, curl: 0.03, gain: 0.4, pitch: 0.78, dist: 5.2,
    color: [0.15, 0.75, 0.15], speedNorm: 1.8,
    pad: [33, 40, 47, 52, 56],
    scale: [69, 71, 73, 76, 78, 81, 83, 85, 88, 90],
    thumb: galaxyPaths,
    thumbView: [0.3, 1.0],
  },
  {
    name: 'Knot',
    params: 'torus knot  p 2  q 5',
    respawn: 0, curl: 0.03, gain: 0.7, pitch: 0.2, dist: 5.4,
    color: [0.2, 0.65, 0.2], speedNorm: 1.2,
    pad: [36, 43, 50, 54, 59],
    scale: [60, 62, 64, 66, 67, 71, 72, 74, 76, 79],
    thumb: knotPath,
    thumbView: [0.35, 0.3],
  },
  {
    name: 'Photo',
    photo: true,
    params: '',
    respawn: 0, curl: 0, gain: 1, pitch: 0.02, dist: 4.9,
    color: [0.3, 0.4, 0.3], speedNorm: 1.5,
    pad: [43, 50, 57, 59, 66],
    scale: [67, 69, 71, 74, 76, 79, 81, 83, 86, 88],
    thumb: null,
  },
];

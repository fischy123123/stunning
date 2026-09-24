// Five-stop ramps from the deepest glow to the hottest core.
export const PALETTES = [
  { name: 'Aurora', stops: ['#062a3a', '#0f8f8a', '#52e3b0', '#9d8cff', '#fff0fb'] },
  { name: 'Ember', stops: ['#3a0710', '#b0241c', '#ff6a1a', '#ffbf57', '#fff5da'] },
  { name: 'Glacier', stops: ['#06124a', '#1d44f0', '#27b4ff', '#a6efff', '#ffffff'] },
  { name: 'Orchid', stops: ['#2a0642', '#7a1ea8', '#e0409a', '#ff9e7a', '#ffeccb'] },
  { name: 'Silver', stops: ['#161a2a', '#474e6a', '#98a1c2', '#d9ddef', '#ffffff'] },
];

export function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2));
}

export const LINEAR = PALETTES.map((p) => p.stops.map(hexToLinear));

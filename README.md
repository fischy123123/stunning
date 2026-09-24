# Filament

A million particles of light, simulated on the GPU, flowing through strange attractors and other shapes.
Press and hold to pull them into a vortex. Let go to scatter them.

## Run

No build step is needed to develop. Serve the folder and open it:

```sh
npm run dev        # http://localhost:5173
```

To get one self-contained HTML file you can share or host anywhere:

```sh
npm install
npm run build      # dist/filament.html
```

## Controls

| Input | Action |
| --- | --- |
| Press, hold, release | Gather, then burst |
| Move the mouse | Stir |
| Right-drag, or Shift-drag | Orbit |
| Scroll, or pinch | Zoom |
| Two-finger drag | Orbit (touch) |
| `1`–`6` | Aizawa, Halvorsen, Lorenz, Nebula, Galaxy, Knot |
| `C` / `Shift+C` | Next / previous palette |
| `T` | Trails: dust, mist, silk |
| `M` | Sound |
| `Space` | Supernova |
| `H` | Hide the interface |
| `F` | Fullscreen |

## How it works

- Particle positions and velocities live in float textures and are updated by a fragment shader (`src/shaders.js`, `SIM_FS`).
  Each form is a flow field: the ODE of an attractor, curl noise, or a spring toward a moving target.
- Particles are drawn as additive points with depth-of-field sizing into a half-float buffer. That buffer fades each frame to leave trails.
- A downsample/upsample bloom chain, a shockwave refraction ring, chromatic fringe and ACES tone mapping finish the frame.
- Sound comes from Web Audio (`src/audio.js`): a detuned-saw pad per form, a rising tone while charging, FM bells on release.
- It starts at 1,048,576 particles on desktop and 262,144 on phones, and steps down if the frame rate drops.
  Add `?n=256` to the URL to force a size (64–1024 per side).

Requires WebGL2 with `EXT_color_buffer_float` (every current desktop and mobile browser).

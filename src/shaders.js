const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

const HASH = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
`;

// Simplex noise with analytic gradient (Gustavson / Ashima Arts, MIT).
const NOISE = `
vec3 mod289(vec3 x) { return x - floor(x * (1. / 289.)) * 289.; }
vec4 mod289(vec4 x) { return x - floor(x * (1. / 289.)) * 289.; }
vec4 permute(vec4 x) { return mod289(((x * 34.) + 1.) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - .85373472095314 * r; }

vec3 snoiseGrad(vec3 v) {
  const vec2 C = vec2(1. / 6., 1. / 3.);
  const vec4 D = vec4(0., .5, 1., 2.);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1. - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0., i1.z, i2.z, 1.))
          + i.y + vec4(0., i1.y, i2.y, 1.))
          + i.x + vec4(0., i1.x, i2.x, 1.));
  float n_ = .142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49. * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7. * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1. - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2. + 1.;
  vec4 s1 = floor(b1) * 2. + 1.;
  vec4 sh = -step(h, vec4(0.));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 t = m2 * m * pdotx;
  vec3 grad = -8. * (t.x * x0 + t.y * x1 + t.z * x2 + t.w * x3);
  grad += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  return grad * 42.;
}

vec3 curl(vec3 p) {
  vec3 a = snoiseGrad(p);
  vec3 b = snoiseGrad(p + vec3(31.416, -47.853, 12.679));
  vec3 c = snoiseGrad(p + vec3(-233.145, -113.408, -185.31));
  return vec3(c.y - b.z, a.z - c.x, b.x - a.y);
}
`;

export const FULLSCREEN_VS = HEAD + `
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

// ---------------------------------------------------------------------------
// Simulation: one fragment per particle. Position.w = life, velocity.w = speed.
// Velocity holds only the "free" momentum from gestures; the form's flow field
// is added on top each step, so particles always drift home once kicks decay.
// ---------------------------------------------------------------------------
export const SIM_FS = HEAD + HASH + NOISE + `
uniform sampler2D uPos;
uniform sampler2D uVel;
uniform float uTime;
uniform float uDt;
uniform int uForm;
uniform float uFlowGain;
uniform float uCurl;
uniform float uRespawn;
uniform vec3 uPointer;
uniform vec3 uPointerVel;
uniform vec3 uViewDir;
uniform float uHover;
uniform float uHold;
uniform vec4 uBurst;
uniform float uNova;

layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;

// Aizawa: world = (x, z - .67, y) * 1.1
vec3 aizawa(vec3 w) {
  vec3 a = vec3(w.x, w.z, w.y) / 1.1 + vec3(0., 0., .67);
  vec3 d = vec3(
    (a.z - .7) * a.x - 3.5 * a.y,
    3.5 * a.x + (a.z - .7) * a.y,
    .6 + .95 * a.z - a.z * a.z * a.z / 3. - (a.x * a.x + a.y * a.y) * (1. + .25 * a.z) + .1 * a.z * a.x * a.x * a.x);
  return vec3(d.x, d.z, d.y) * 1.1 * .5;
}

// Halvorsen, rotated so its three-fold axis (1,1,1) faces +z.
const mat3 HB = mat3(
  .70710678, -.70710678, 0.,
  .40824829, .40824829, -.81649658,
  .57735027, .57735027, .57735027);
vec3 halvorsen(vec3 w) {
  vec3 a = HB * (w / .1) - 2.58;
  vec3 d = vec3(
    -1.89 * a.x - 4. * a.y - 4. * a.z - a.y * a.y,
    -1.89 * a.y - 4. * a.z - 4. * a.x - a.z * a.z,
    -1.89 * a.z - 4. * a.x - 4. * a.y - a.x * a.x);
  vec3 v = (d * HB) * .1 * .3;
  return mix(v, -w * 1.6, smoothstep(1.7, 2.3, length(w)));
}

// Lorenz: world = (x, z - 24.3, y) * .055
vec3 lorenz(vec3 w) {
  vec3 a = vec3(w.x, w.z, w.y) / .055 + vec3(0., 0., 24.3);
  vec3 d = vec3(10. * (a.y - a.x), a.x * (28. - a.z) - a.y, a.x * a.y - 8. / 3. * a.z);
  return vec3(d.x, d.z, d.y) * .055 * .25;
}

vec3 nebula(vec3 p, float t) {
  vec3 v = curl(p * .62 + vec3(0., t * .05, t * .02)) * .42;
  v += vec3(-p.z, 0., p.x) * .16;
  v -= p * smoothstep(.9, 2., length(p)) * 1.1;
  return v;
}

// Two logarithmic arms; particles cluster tightly around each arm's spine.
vec3 galaxyAt(vec2 id, float t) {
  vec3 h = hash32(id * 1.37 + 11.1);
  vec3 k = hash32(id * .73 + 5.3);
  if (k.x < .14) {
    float r = pow(h.x, 1.6) * .36;
    float phi = h.y * 6.2831853 - t * .5;
    float ct = h.z * 2. - 1.;
    float st = sqrt(1. - ct * ct);
    return vec3(cos(phi) * st * r, ct * r * .6, sin(phi) * st * r);
  }
  float r = .06 - log(1. - h.x * .985) * .34;
  float arm = floor(h.z * 2.);
  float off = k.y * 2. - 1.;
  float scatter = sign(off) * pow(abs(off), 3.) * 1.3 * (.35 + .5 / (r * 2. + .4));
  float th = arm * 3.14159265 + r * 3.4 + scatter - t * .12;
  float rr = r * (1. + (h.y - .5) * .18 + .03 * sin(t * .7 + k.z * 6.2831853));
  float thick = .05 * exp(-r * 1.4) + .012;
  float y = (k.z + hash12(id * 2.1 + 1.7) - 1.) * thick * 2.;
  return vec3(cos(th) * rr, y, sin(th) * rr);
}

vec3 knotC(float s) {
  float a = s * 6.2831853;
  float r = 1. + .42 * cos(5. * a);
  return vec3(r * cos(2. * a), r * sin(2. * a), .42 * sin(5. * a)) * .92;
}

vec3 knotAt(vec2 id, float t) {
  vec3 h = hash32(id * 1.91 + 3.7);
  float h4 = hash12(id * 1.13 + 8.1);
  float s = fract(h.x + t * (.01 + .02 * h4));
  vec3 C = knotC(s);
  vec3 T = normalize(knotC(s + .001) - knotC(s - .001));
  vec3 N = normalize(cross(T, vec3(0., 0., 1.)));
  vec3 B = cross(T, N);
  float th = h.y * 6.2831853 + t * .7;
  float rad = h4 < .12 ? .06 + .32 * h.z * h.z : .07 * sqrt(h.z);
  return C + (N * cos(th) + B * sin(th)) * rad;
}

vec3 flow(vec3 p, vec2 id, float t) {
  if (uForm == 0) return aizawa(p);
  if (uForm == 1) return halvorsen(p);
  if (uForm == 2) return lorenz(p);
  if (uForm == 3) return nebula(p, t);
  const float e = 1. / 30.;
  if (uForm == 4) {
    vec3 a = galaxyAt(id, t);
    return (a - p) * 2.6 + (galaxyAt(id, t + e) - a) / e;
  }
  vec3 a = knotAt(id, t);
  return (a - p) * 2.6 + (knotAt(id, t + e) - a) / e;
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPos, c, 0);
  vec4 V = texelFetch(uVel, c, 0);
  vec2 id = vec2(c);
  float seed = hash12(id);
  vec3 p = P.xyz;
  vec3 v = V.xyz;
  float life = P.w;
  float dt = uDt;

  vec3 toPtr = uPointer - p;
  float r = length(toPtr) + 1e-4;

  // Gravity well while the pointer is held: pull + swirl around the view axis.
  if (uHold > 0.) {
    float g = min((1.2 + 7. * uHold) / (r * r + .08), 60.);
    v += toPtr / r * g * dt;
    vec3 sw = cross(uViewDir, toPtr);
    v += sw / (length(sw) + 1e-4) * g * .55 * dt;
    v *= exp(-dt * mix(.4, 3.5, exp(-r * r * 6.)));
  }

  // Stirring while hovering.
  if (uHover > 0.) {
    float fall = exp(-r * r / .16);
    v += (uPointerVel * 1.8 + cross(uViewDir, -toPtr) * 1.6) * fall * dt * 3.;
  }

  if (uBurst.w > 0.) {
    vec3 d = p - uBurst.xyz;
    float rb = length(d) + 1e-3;
    v += d / rb * uBurst.w * (.55 + .9 * seed) / (rb * .8 + .3);
  }
  if (uNova > 0.) {
    v += normalize(p + vec3(1e-4)) * uNova * (.35 + seed);
  }

  float gain = uFlowGain / (1. + length(v) * .6);
  vec3 f = flow(p, id, uTime);
  if (uCurl > 0.) f += curl(p * 1.4 + uTime * .08) * uCurl;
  f *= gain;
  float fl = length(f);
  if (fl > 4.) f *= 4. / fl;

  v *= exp(-dt * 1.1);
  float pr = length(p);
  v -= p * smoothstep(3.5, 6., pr) * dt * 3.;
  p += (f + v) * dt;
  float speed = length(f + v);

  life -= dt;
  bool broken = !(length(p) < 50.);
  if (life < 0. || broken) {
    life = mix(3., 9., hash12(id + fract(uTime * 1.7) * 83.));
    if (uRespawn > .5 || broken) {
      vec3 h = hash32(id + fract(uTime) * 97.);
      vec4 o = texture(uPos, h.xy);
      p = o.xyz + (hash32(id * 1.7 + uTime) - .5) * .03;
      if (!(length(p) < 50.)) p = (h - .5) * .5;
      v = vec3(0.);
    }
  }

  oPos = vec4(p, life);
  oVel = vec4(v, speed);
}`;

// ---------------------------------------------------------------------------
// Particles: points pulled straight from the simulation textures.
// ---------------------------------------------------------------------------
export const PARTICLE_VS = HEAD + HASH + `
uniform sampler2D uPos;
uniform sampler2D uVel;
uniform mat4 uProj;
uniform mat4 uView;
uniform int uTexW;
uniform float uPointScale;
uniform float uSize;
uniform float uFocus;
uniform float uAperture;
uniform float uIntensity;
uniform float uRespawn;
uniform float uSpeedNorm;
uniform vec3 uColorMix;
uniform vec3 uPal[5];
uniform int uForm;
uniform float uTime;

out vec3 vCol;
out float vSize;

vec3 palette(float t) {
  t = clamp(t, 0., 1.) * 4.;
  int i = int(min(floor(t), 3.));
  return mix(uPal[i], uPal[i + 1], t - float(i));
}

// Where a particle sits within its form's structure, 0..1 (mirrors SIM_FS).
float structTone(vec2 id, vec3 p) {
  if (uForm == 4) {
    vec3 h = hash32(id * 1.37 + 11.1);
    vec3 k = hash32(id * .73 + 5.3);
    if (k.x < .14) return 1.;
    float r = .06 - log(1. - h.x * .985) * .34;
    return exp(-r * 1.8) * .75 + (1. - abs(k.y * 2. - 1.)) * .3;
  }
  if (uForm == 5) {
    vec3 h = hash32(id * 1.91 + 3.7);
    float h4 = hash12(id * 1.13 + 8.1);
    float s = fract(h.x + uTime * (.01 + .02 * h4));
    return .5 + .5 * sin(s * 12.566 - uTime * .5);
  }
  return exp(-dot(p, p) * 1.6);
}

void main() {
  ivec2 c = ivec2(gl_VertexID % uTexW, gl_VertexID / uTexW);
  vec4 P = texelFetch(uPos, c, 0);
  vec4 V = texelFetch(uVel, c, 0);
  float seed = hash12(vec2(c));
  vec4 vp = uView * vec4(P.xyz, 1.);
  gl_Position = uProj * vp;
  float z = max(-vp.z, .05);

  float star = step(.9965, seed);
  float px = uSize * (1. + star * 1.6) * uPointScale / z;
  float coc = abs(z - uFocus) * uAperture * uPointScale / z;
  float size = clamp(sqrt(px * px + coc * coc), 1., 22.);
  gl_PointSize = size + 1.;
  vSize = size;

  float t = uColorMix.x * V.w / uSpeedNorm
          + uColorMix.y * structTone(vec2(c), P.xyz)
          + uColorMix.z * seed;
  float energy = clamp(px * px, .15, 6.) / (size * size);
  float a = uIntensity * energy * (1. + star * 4.);
  a *= mix(1., smoothstep(0., .6, P.w), uRespawn);
  vCol = palette(t) * a;
}`;

export const PARTICLE_FS = HEAD + `
in vec3 vCol;
in float vSize;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord * 2. - 1.;
  float r2 = dot(d, d);
  if (r2 > 1.) discard;
  float gauss = exp(-r2 * 4.);
  float disc = smoothstep(1., .72, sqrt(r2)) * .55;
  float k = mix(gauss, disc, smoothstep(4., 12., vSize));
  o = vec4(vCol * k, 1.);
}`;

export const FADE_FS = HEAD + `
out vec4 o;
void main() { o = vec4(0.); }`;

// ---------------------------------------------------------------------------
// Bloom: 13-tap downsample chain, tent-filter upsample (additive).
// ---------------------------------------------------------------------------
export const DOWN_FS = HEAD + `
uniform sampler2D uSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 o;
vec3 s(vec2 off) { return texture(uSrc, vUv + uTexel * off).rgb; }
void main() {
  vec3 c = s(vec2(0.)) * .125;
  c += (s(vec2(-2., 2.)) + s(vec2(2., 2.)) + s(vec2(-2., -2.)) + s(vec2(2., -2.))) * .03125;
  c += (s(vec2(0., 2.)) + s(vec2(-2., 0.)) + s(vec2(2., 0.)) + s(vec2(0., -2.))) * .0625;
  c += (s(vec2(-1., 1.)) + s(vec2(1., 1.)) + s(vec2(-1., -1.)) + s(vec2(1., -1.))) * .125;
  o = vec4(c, 1.);
}`;

export const UP_FS = HEAD + `
uniform sampler2D uSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 o;
vec3 s(vec2 off) { return texture(uSrc, vUv + uTexel * off).rgb; }
void main() {
  vec3 c = s(vec2(0.)) * 4.;
  c += (s(vec2(-1., 0.)) + s(vec2(1., 0.)) + s(vec2(0., 1.)) + s(vec2(0., -1.))) * 2.;
  c += s(vec2(-1., -1.)) + s(vec2(1., -1.)) + s(vec2(-1., 1.)) + s(vec2(1., 1.));
  o = vec4(c / 16., 1.);
}`;

// ---------------------------------------------------------------------------
// Composite: shockwave refraction, chromatic fringe, tone map, grain.
// ---------------------------------------------------------------------------
export const COMPOSITE_FS = HEAD + HASH + `
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform float uBloomStr;
uniform float uExposure;
uniform float uFlash;
uniform float uTime;
uniform vec4 uShock;
uniform vec3 uGlow;
in vec2 vUv;
out vec4 o;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.);
}

vec3 sampleAt(vec2 uv) {
  return texture(uScene, uv).rgb + texture(uBloom, uv).rgb * uBloomStr;
}

void main() {
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 uv = vUv;

  if (uShock.w > 0.) {
    vec2 d = (uv - uShock.xy) * asp;
    float dist = length(d);
    float x = dist - uShock.z;
    float prof = x * exp(-x * x * 180.) * .6;
    uv -= d / max(dist, 1e-3) * prof * uShock.w / asp;
  }

  vec2 cc = (uv - .5) * asp;
  float r2 = dot(cc, cc);
  vec2 ca = (uv - .5) * (.0025 + uShock.w * .012) * (.4 + r2);
  vec3 col = vec3(sampleAt(uv - ca).r, sampleAt(uv).g, sampleAt(uv + ca).b);

  col += uGlow * (1. - smoothstep(0., 1.15, sqrt(r2))) * .5;
  col *= uExposure * (1. + uFlash);
  col = aces(col);
  col *= mix(1., smoothstep(1.3, .25, sqrt(r2)), .6);
  col = pow(col, vec3(1. / 2.2));
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.3) * 517.) - .5) * (2.5 / 255.);
  o = vec4(col, 1.);
}`;

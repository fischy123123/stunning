// Thin WebGL2 helpers: context, programs with auto uniforms, textures, framebuffers.

export function getContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;
  const f32 = gl.getExtension('EXT_color_buffer_float');
  const f16 = f32 || gl.getExtension('EXT_color_buffer_half_float');
  if (!f16) return null;
  return { gl, float32: !!f32 };
}

function compileShader(gl, type, src, name) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`${name} ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader:\n${log}`);
  }
  return s;
}

export function createProgram(gl, vsSrc, fsSrc, name) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vsSrc, name));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, name));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`${name} link: ${gl.getProgramInfoLog(p)}`);
  }
  const uniforms = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name.replace(/\[0\]$/, '')] = {
      loc: gl.getUniformLocation(p, info.name),
      type: info.type,
      size: info.size,
    };
  }
  return { program: p, uniforms };
}

// Bind a program and set uniforms by name; samplers get texture units in order.
export function use(gl, prog, values) {
  gl.useProgram(prog.program);
  let unit = 0;
  for (const key in values) {
    const u = prog.uniforms[key];
    if (!u) continue;
    const v = values[key];
    switch (u.type) {
      case gl.FLOAT: u.size > 1 ? gl.uniform1fv(u.loc, v) : gl.uniform1f(u.loc, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
      case gl.INT:
      case gl.BOOL: gl.uniform1i(u.loc, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
      case gl.SAMPLER_2D:
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, v);
        gl.uniform1i(u.loc, unit++);
        break;
    }
  }
}

export function createTexture(gl, w, h, { internal, type, filter, data = null }) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, data);
  return t;
}

export function createFramebuffer(gl, textures) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  textures.forEach((t, i) => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
  });
  gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    gl.deleteFramebuffer(fb);
    return null;
  }
  return fb;
}

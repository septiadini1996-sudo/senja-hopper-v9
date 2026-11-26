// A compact WebGL2 engine written for this game: matrix math, a flat-shaded
// lit shader with warm fog, a glittering sea shader and a gradient sky dome.
// No libraries — a few hundred lines, everything vendored as our own source.
export const M4 = {
  ident() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); },
  persp(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
    return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
  },
  lookAt(eye, ctr, up) {
    const z = norm3(sub3(eye, ctr)), x = norm3(cross3(up, z)), y = cross3(z, x);
    return new Float32Array([x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
      -dot3(x,eye), -dot3(y,eye), -dot3(z,eye), 1]);
  },
  mul(a, b) { // a*b, column-major
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k*4+r] * b[c*4+k];
      o[c*4+r] = s;
    }
    return o;
  },
  compose(px, py, pz, rx, ry, rz, s) {
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    const m = new Float32Array([
      cy*cz, cx*sz + sx*sy*cz, sx*sz - cx*sy*cz, 0,
      -cy*sz, cx*cz - sx*sy*sz, sx*cz + cx*sy*sz, 0,
      sy, -sx*cy, cx*cy, 0,
      px, py, pz, 1]);
    if (s !== undefined && s !== 1) { for (let i = 0; i < 11; i++) if (i !== 3 && i !== 7) m[i] *= s; m[15] = 1; }
    return m;
  },
};
export function sub3(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
export function cross3(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
export function dot3(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
export function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; }

// Geometry builder: non-indexed triangles with baked face normals (the
// low-poly look) and per-vertex colours.
export class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  tri(a, b, c, color) {
    const n = norm3(cross3(sub3(b, a), sub3(c, a)));
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(color[0], color[1], color[2]); }
  }
  quad(a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); }
  box(cx, cy, cz, w, h, d, color, shade = {}) {
    const x0 = cx-w/2, x1 = cx+w/2, y0 = cy-h/2, y1 = cy+h/2, z0 = cz-d/2, z1 = cz+d/2;
    const T = shade.top || color, B = shade.bottom || color, S = color;
    this.quad([x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0], T); // top
    this.quad([x0,y0,z1],[x0,y0,z0],[x1,y0,z0],[x1,y0,z1], B); // bottom
    this.quad([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1], S); // front (+z)
    this.quad([x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0], S); // back
    this.quad([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0], S); // left
    this.quad([x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1], S); // right
  }
  // A tapered hull section: box whose top face is scaled by k around centre.
  frustum(cx, cy, cz, w, h, d, kTop, color) {
    const x0 = cx-w/2, x1 = cx+w/2, y0 = cy-h/2, y1 = cy+h/2, z0 = cz-d/2, z1 = cz+d/2;
    const tx0 = cx-w*kTop/2, tx1 = cx+w*kTop/2, tz0 = cz-d*kTop/2, tz1 = cz+d*kTop/2;
    this.quad([tx0,y1,tz0],[tx0,y1,tz1],[tx1,y1,tz1],[tx1,y1,tz0], color);
    this.quad([x0,y0,z1],[x0,y0,z0],[x1,y0,z0],[x1,y0,z1], color);
    this.quad([x0,y0,z1],[x1,y0,z1],[tx1,y1,tz1],[tx0,y1,tz1], color);
    this.quad([x1,y0,z0],[x0,y0,z0],[tx0,y1,tz0],[tx1,y1,tz0], color);
    this.quad([x0,y0,z0],[x0,y0,z1],[tx0,y1,tz1],[tx0,y1,tz0], color);
    this.quad([x1,y0,z1],[x1,y0,z0],[tx1,y1,tz0],[tx1,y1,tz1], color);
  }
  cone(cx, cy, cz, r, h, seg, color) { // apex up, base at cy
    for (let i = 0; i < seg; i++) {
      const a0 = (i/seg)*Math.PI*2, a1 = ((i+1)/seg)*Math.PI*2;
      const p0 = [cx+Math.cos(a0)*r, cy, cz+Math.sin(a0)*r];
      const p1 = [cx+Math.cos(a1)*r, cy, cz+Math.sin(a1)*r];
      this.tri(p0, p1, [cx, cy+h, cz], color);
    }
  }
  disc(cx, cy, cz, r, seg, color, up = true) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i/seg)*Math.PI*2, a1 = ((i+1)/seg)*Math.PI*2;
      const p0 = [cx+Math.cos(a0)*r, cy, cz+Math.sin(a0)*r];
      const p1 = [cx+Math.cos(a1)*r, cy, cz+Math.sin(a1)*r];
      // Winding chosen so the baked normal points +Y for an up disc (the
      // first version pointed it down and beaches/shadows lit from below).
      if (up) this.tri([cx,cy,cz], p1, p0, color); else this.tri([cx,cy,cz], p0, p1, color);
    }
  }
  torus(cx, cy, cz, R, tube, segR, segT, color) {
    const pt = (i, j) => {
      const u = (i/segR)*Math.PI*2, v = (j/segT)*Math.PI*2;
      return [cx + (R + tube*Math.cos(v))*Math.cos(u), cy + tube*Math.sin(v), cz + (R + tube*Math.cos(v))*Math.sin(u)];
    };
    for (let i = 0; i < segR; i++) for (let j = 0; j < segT; j++) {
      this.quad(pt(i,j), pt(i+1,j), pt(i+1,j+1), pt(i,j+1), color);
    }
  }
}

const LIT_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec3 aCol;
uniform mat4 uMVP; uniform mat4 uModel; uniform mat4 uView;
out vec3 vNor; out vec3 vCol; out float vDepth;
void main(){ vNor = mat3(uModel) * aNor; vCol = aCol;
  vec4 wp = uModel * vec4(aPos, 1.0);
  vDepth = -(uView * wp).z; // true view-space depth, so fog gathers with distance
  gl_Position = uMVP * vec4(aPos, 1.0); }`;
const LIT_FS = `#version 300 es
precision mediump float;
uniform vec3 uSun; uniform vec3 uFog; uniform float uFogD; uniform float uAlpha;
in vec3 vNor; in vec3 vCol; in float vDepth; out vec4 o;
void main(){ vec3 n = normalize(vNor);
  float diff = max(dot(n, uSun), 0.0);
  vec3 amb = mix(vec3(0.36,0.24,0.30), vec3(0.55,0.48,0.44), n.y * 0.5 + 0.5);
  vec3 c = vCol * (amb + vec3(1.0,0.82,0.62) * diff * 0.85);
  float f = 1.0 - exp(-uFogD * uFogD * vDepth * vDepth);
  o = vec4(mix(c, uFog, clamp(f,0.0,1.0)), uAlpha); }`;
const SEA_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uMVP; uniform vec3 uOrigin;
out vec3 vWorld;
void main(){ vec3 w = aPos + uOrigin; vWorld = w; gl_Position = uMVP * vec4(w, 1.0); }`;
const SEA_FS = `#version 300 es
precision mediump float;
uniform vec3 uSun; uniform vec3 uCam; uniform float uTime; uniform vec3 uFog; uniform float uFogD;
in vec3 vWorld; out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec3 V = normalize(uCam - vWorld);
  float dist = length(uCam - vWorld);
  vec3 deep = vec3(0.05, 0.23, 0.33); vec3 lift = vec3(0.13, 0.45, 0.55);
  vec3 c = mix(lift, deep, clamp(dist / 900.0, 0.0, 1.0));
  // Sun glitter: sparkle cells that shimmer, gathered into a streak under the
  // sun. The cells are world-sized, so the surface streams past under the
  // plane and its scale reads against altitude; sparkle fades with range so
  // the far sea stays calm instead of aliasing into confetti.
  vec2 cell = floor(vWorld.xz * 0.9);
  float tw = hash(cell + floor(uTime * 2.7));
  float sparkle = step(0.965, tw) * exp(-dist / 620.0);
  vec3 toP = normalize(vWorld - uCam);
  float streak = pow(max(dot(toP.xz, normalize(uSun.xz)), 0.0), 18.0);
  c += vec3(1.0, 0.75, 0.42) * sparkle * (0.25 + streak * 1.6);
  float fres = pow(1.0 - max(V.y, 0.0), 2.0);
  c += vec3(0.98, 0.55, 0.30) * fres * 0.35; // sunset sheen at grazing angles
  float f = 1.0 - exp(-uFogD * uFogD * dist * dist);
  o = vec4(mix(c, uFog, clamp(f, 0.0, 1.0)), 1.0); }`;
const SKY_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uMVP;
out vec3 vDir;
void main(){ vDir = aPos; vec4 p = uMVP * vec4(aPos, 1.0); gl_Position = p.xyww; }`;
const SKY_FS = `#version 300 es
precision mediump float;
uniform vec3 uSun;
in vec3 vDir; out vec4 o;
void main(){ vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.08, 1.0);
  vec3 c = mix(vec3(1.0, 0.62, 0.34), vec3(0.98, 0.78, 0.52), smoothstep(0.0, 0.22, h));
  c = mix(c, vec3(0.36, 0.42, 0.66), smoothstep(0.18, 0.75, h));
  float sun = pow(max(dot(d, uSun), 0.0), 220.0);
  float halo = pow(max(dot(d, uSun), 0.0), 7.0);
  c += vec3(1.0, 0.83, 0.55) * sun * 1.4 + vec3(1.0, 0.6, 0.3) * halo * 0.28;
  o = vec4(c, 1.0); }`;

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) return null;
  try { return buildRenderer(canvas, gl); }
  catch (e) { console.error('renderer init failed:', e); return null; }
}

function buildRenderer(canvas, gl) {
  function program(vs, fs) {
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error('shader compile failed: ' + gl.getShaderInfoLog(s));
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('program link failed: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }
  const lit = program(LIT_VS, LIT_FS), sea = program(SEA_VS, SEA_FS), sky = program(SKY_VS, SKY_FS);
  const SUN = norm3([-0.35, 0.42, -0.84]); // low sun, ahead-left of the route
  // Fog is a gradient, not a wall: at 1 km the destination still reads at
  // ~75% strength, so islands and the strip grow out of the haze on approach.
  // Rain thickens it (setFog) — visibility is a weather readout, not a mood.
  const FOG = [0.96, 0.62, 0.42];
  let FOGD = 0.00052;

  function makeMesh(builder) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    // Interleave pos/nor/col.
    const n = builder.pos.length / 3;
    const arr = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
      arr.set(builder.pos.slice(i*3, i*3+3), i*9);
      arr.set(builder.nor.slice(i*3, i*3+3), i*9+3);
      arr.set(builder.col.slice(i*3, i*3+3), i*9+6);
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
    return { vao, count: n };
  }
  function makeRawMesh(positions) { // positions only (sea / sky)
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    return { vao, count: positions.length / 3 };
  }
  let view = M4.ident(), proj = M4.ident(), camPos = [0, 10, 30];
  function setCamera(v, p, pos) { view = v; proj = p; camPos = pos; }
  function draw(mesh, model, alpha = 1) {
    gl.useProgram(lit);
    gl.uniformMatrix4fv(gl.getUniformLocation(lit, 'uMVP'), false, M4.mul(proj, M4.mul(view, model)));
    gl.uniformMatrix4fv(gl.getUniformLocation(lit, 'uModel'), false, model);
    gl.uniformMatrix4fv(gl.getUniformLocation(lit, 'uView'), false, view);
    gl.uniform3fv(gl.getUniformLocation(lit, 'uSun'), SUN);
    gl.uniform3fv(gl.getUniformLocation(lit, 'uFog'), FOG);
    gl.uniform1f(gl.getUniformLocation(lit, 'uFogD'), FOGD);
    gl.uniform1f(gl.getUniformLocation(lit, 'uAlpha'), alpha);
    if (alpha < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    if (alpha < 1) { gl.disable(gl.BLEND); gl.depthMask(true); }
  }
  function drawSea(mesh, origin, time) {
    gl.useProgram(sea);
    gl.uniformMatrix4fv(gl.getUniformLocation(sea, 'uMVP'), false, M4.mul(proj, view));
    gl.uniform3fv(gl.getUniformLocation(sea, 'uOrigin'), origin);
    gl.uniform3fv(gl.getUniformLocation(sea, 'uSun'), SUN);
    gl.uniform3fv(gl.getUniformLocation(sea, 'uCam'), camPos);
    gl.uniform1f(gl.getUniformLocation(sea, 'uTime'), time);
    gl.uniform3fv(gl.getUniformLocation(sea, 'uFog'), FOG);
    gl.uniform1f(gl.getUniformLocation(sea, 'uFogD'), FOGD);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
  function drawSky(mesh) {
    gl.useProgram(sky);
    const v = new Float32Array(view); v[12] = 0; v[13] = 0; v[14] = 0; // rotation only
    gl.uniformMatrix4fv(gl.getUniformLocation(sky, 'uMVP'), false, M4.mul(proj, v));
    gl.uniform3fv(gl.getUniformLocation(sky, 'uSun'), SUN);
    gl.bindVertexArray(mesh.vao);
    // The dome is written at depth 1.0 (p.xyww), which a LESS depth test would
    // reject against the cleared buffer — draw it with the test off, first.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }
  function begin() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
  }
  return { gl, canvas, makeMesh, makeRawMesh, setCamera, draw, drawSea, drawSky, begin, SUN,
    setFog(d) { FOGD = d; }, getFog() { return FOGD; } };
}

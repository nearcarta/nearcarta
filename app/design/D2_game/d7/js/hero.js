// D7 hero background: slow contour lines (like depth lines on a harbour chart) drawn in one WebGL fragment shader.
// Our own shader. The idea of a shader background came from reactbits.dev; no code was copied.
// Pauses when offscreen or the tab is hidden, draws one still frame under prefers-reduced-motion,
// falls back to CSS when WebGL is missing, and lowers its resolution if frames run slow.
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uT; uniform vec2 uM; uniform float uFrz;
uniform vec3 uRipC; uniform vec3 uRipCol; uniform float uRipT;
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec2 g2(vec2 p){ float a=h21(p)*6.2831853; return vec2(cos(a),sin(a)); }
float gn(vec2 p){ vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  return mix(mix(dot(g2(i),f),dot(g2(i+vec2(1,0)),f-vec2(1,0)),u.x),mix(dot(g2(i+vec2(0,1)),f-vec2(0,1)),dot(g2(i+1.),f-1.),u.x),u.y); }
float fbm(vec2 p){ float s=0.,a=.55; for(int i=0;i<4;i++){ s+=a*gn(p); p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,1.7); a*=.5; } return s; }
void main(){
  float asp=uRes.x/uRes.y; vec2 uv=gl_FragCoord.xy/uRes.y; vec2 m=uM*vec2(asp,1.);
  vec2 q=uv*1.35 + (m-vec2(asp*.5,.5))*.04;
  float t=uT*.035;
  float h=fbm(q+vec2(t,t*.6)) + .45*fbm(q*.55-vec2(t*.7,-t*.4)+4.);
  float k=h*16.;
  float w=fwidth(k);
  float d=abs(fract(k)-.5);
  float line=1.-smoothstep(.5-w*1.1,.5,d);
  float maj=smoothstep(.5-w*.45,.5-w*.2,abs(fract(k*.25)-.5));
  float gl=exp(-2.4*distance(uv,m));
  float top=smoothstep(1.4,0.,distance(uv,vec2(asp*.78,1.05)));
  vec3 navy=vec3(.027,.039,.102), deep=vec3(.067,.082,.169);
  vec3 c=mix(navy,deep,top*.9);
  vec3 ink=mix(vec3(.49,.74,1.),vec3(.66,.85,1.),uFrz);
  c+=ink*line*(.035+.22*gl+.05*top);
  c+=ink*maj*line*(.04+.18*gl);
  c+=vec3(0.,.57,.99)*(.10*gl+.06*top)*(1.-uFrz*.4);
  // event ripple (allowed = mint, refused = coral)
  if(uRipT>=0.){ float rd=distance(uv,uRipC.xy*vec2(asp,1.)); float R=uRipT*.9; float ring=exp(-pow((rd-R)*18.,2.))*(1.-uRipT);
    c+=uRipCol*ring*.55; c+=uRipCol*line*exp(-rd*3.)*(1.-uRipT)*.6; }
  vec2 vv=gl_FragCoord.xy/uRes-.5; c*=1.-dot(vv,vv)*.55;
  c+=(h21(gl_FragCoord.xy+fract(uT)*100.)-.5)*.012;
  gl_FragColor=vec4(c,1.);
}`;
const VERT = `attribute vec2 p; void main(){ gl_Position=vec4(p,0.,1.); }`;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function hero(canvas, opts = {}) {
  const state = { scale: opts.scale ?? Math.min(devicePixelRatio || 1, 1.5) * .75, t: opts.t0 ?? 8, mx: .72, my: .78, tx: .72, ty: .78, frz: 0, frzGoal: 0, rip: -1, ripC: [.5, .5], ripCol: [0, .92, .59], running: false, visible: true, frames: 0, slow: 0, manual: !!opts.manual };
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: !!opts.manual });
  if (!gl || !gl.getExtension('OES_standard_derivatives')) { canvas.classList.add('d7-hero--static'); return { static: true, pulse() {}, freeze() {}, render() {}, destroy() {} }; }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, '#extension GL_OES_standard_derivatives : enable\n' + FRAG)); gl.linkProgram(pr); gl.useProgram(pr);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(pr, n); const u = { res: U('uRes'), t: U('uT'), m: U('uM'), frz: U('uFrz'), ripC: U('uRipC'), ripCol: U('uRipCol'), ripT: U('uRipT') };
  function size() { const r = canvas.getBoundingClientRect(); const w = Math.max(2, Math.round(r.width * state.scale)), h = Math.max(2, Math.round(r.height * state.scale)); if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); } }
  function draw() { size(); state.mx += (state.tx - state.mx) * .04; state.my += (state.ty - state.my) * .04; state.frz += (state.frzGoal - state.frz) * .05;
    gl.uniform2f(u.res, canvas.width, canvas.height); gl.uniform1f(u.t, state.t); gl.uniform2f(u.m, state.mx, state.my); gl.uniform1f(u.frz, state.frz);
    gl.uniform3f(u.ripC, state.ripC[0], state.ripC[1], 0); gl.uniform3f(u.ripCol, ...state.ripCol); gl.uniform1f(u.ripT, state.rip); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  let last = 0, raf = 0, acc = 0, n = 0;
  function loop(now) { raf = 0; if (!state.running) return; const dt = Math.min(.05, (now - (last || now)) / 1000); last = now; step(dt);
    acc += dt; n++; if (n === 40) { const avg = acc / n; if (avg > 1 / 40 && state.scale > .4) { state.scale *= .8; } acc = 0; n = 0; }
    raf = requestAnimationFrame(loop); }
  function step(dt) { state.t += dt; if (state.rip >= 0) { state.rip += dt * .9; if (state.rip >= 1) state.rip = -1; } draw(); state.frames++; }
  function start() { if (state.manual || state.running || reduced() || !state.visible || document.hidden) return; state.running = true; last = 0; raf = requestAnimationFrame(loop); }
  function stop() { state.running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  const io = new IntersectionObserver(([e]) => { state.visible = e.isIntersecting; state.visible ? start() : stop(); }, { threshold: 0 }); io.observe(canvas);
  const vis = () => document.hidden ? stop() : start(); document.addEventListener('visibilitychange', vis);
  const mv = e => { const r = canvas.getBoundingClientRect(); state.tx = (e.clientX - r.left) / r.width; state.ty = 1 - (e.clientY - r.top) / r.height; };
  if (matchMedia('(pointer:fine)').matches) addEventListener('pointermove', mv, { passive: true });
  const mq = matchMedia('(prefers-reduced-motion: reduce)'); mq.addEventListener?.('change', () => { reduced() ? (stop(), draw()) : start(); });
  draw(); start();
  return {
    get fps() { return state.frames; }, state,
    // kind: 'allowed' | 'refused' | 'freeze'; x,y in 0..1 (y up)
    pulse(kind = 'allowed', x = .5, y = .5) { state.ripC = [x, y]; state.ripCol = kind === 'refused' ? [1, .42, .42] : kind === 'freeze' ? [.66, .85, 1] : [0, .92, .59]; state.rip = 0; if (!state.running) draw(); },
    freeze(on = true) { state.frzGoal = on ? 1 : 0; if (!state.running) { state.frz = state.frzGoal; draw(); } },
    advance(sec, fps = 30) { for (let i = 0; i < Math.round(sec * fps); i++) step(1 / fps); },
    render: draw,
    destroy() { stop(); io.disconnect(); document.removeEventListener('visibilitychange', vis); removeEventListener('pointermove', mv); }
  };
}

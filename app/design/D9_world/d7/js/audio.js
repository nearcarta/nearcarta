// D7 audio, built on howler.js 2.2.4 (MIT). howler is fetched lazily on the first pointerdown or keydown.
// Sound starts muted until the user interacts (browser autoplay policy); the mute choice is saved in localStorage.
// Every sound comes as ogg (Vorbis) first with mp3 as fallback, preload:false, and is fetched the first time it plays.
// While a sound effect plays, the music ducks.
const SFX = { click: [.5], hover: [.18], allowed: [.7], refuse: [.8], freeze: [.75], swap: [.55], send: [.55], 'step-a': [.22], 'step-b': [.22], water: [.35] };
const FILE = { click: 'ui-click', hover: 'ui-hover' };
export function audio({ base, howler, music = 'music-ambient', musicVol = .32, duckTo = .1 } = {}) {
  base = base.replace(/\/?$/, '/');
  const LS = 'd7.sound';
  let wantOn = localStorage.getItem(LS) !== 'off';
  let unlocked = false, H = null, loading = null, mus = null, cache = {}, lastHover = 0, duckN = 0, duckTimer = 0;
  const listeners = new Set();
  const emit = () => listeners.forEach(f => f(api.on));
  function load() { if (H) return Promise.resolve(H); if (loading) return loading; loading = new Promise((res, rej) => { if (window.Howl) return res(H = window); const s = document.createElement('script'); s.src = howler; s.async = true; s.onload = () => res(H = window); s.onerror = rej; document.head.appendChild(s); }); return loading; }
  const src = n => [`${base}${FILE[n] || n}.ogg`, `${base}${FILE[n] || n}.mp3`];
  function get(n) { return cache[n] ||= new H.Howl({ src: src(n), volume: (SFX[n] || [.5])[0], preload: true, html5: false }); }
  function startMusic() { if (!music || !api.on) return; if (!mus) mus = new H.Howl({ src: src(music), loop: true, volume: 0, html5: false }); if (!mus.playing()) { mus.play(); } mus.fade(mus.volume(), musicVol, 1600); }
  function duck(ms) { if (!mus) return; duckN++; mus.fade(mus.volume(), duckTo, 120); clearTimeout(duckTimer); duckTimer = setTimeout(() => { duckN = 0; if (api.on && mus) mus.fade(mus.volume(), musicVol, 900); }, ms); }
  function unlock(e) { if (unlocked) return; unlocked = true; const viaBtn = e?.target?.closest?.('.d7-sound'); removeEventListener('pointerdown', unlock, true); removeEventListener('keydown', unlock, true); if (wantOn && !viaBtn) load().then(() => { emit(); startMusic(); }); }
  addEventListener('pointerdown', unlock, true); addEventListener('keydown', unlock, true);
  const api = {
    get on() { return wantOn && unlocked; },
    play(n, { rate = 1, duckMs = 0 } = {}) {
      if (!api.on || !H) return;
      if (n === 'hover') { const t = performance.now(); if (t - lastHover < 90) return; lastHover = t; }
      const h = get(n); const id = h.play(); if (rate !== 1) h.rate(rate, id);
      if (duckMs || /allowed|refuse|freeze|water/.test(n)) duck(duckMs || 1400);
    },
    toggle(force) { wantOn = force ?? !wantOn; localStorage.setItem(LS, wantOn ? 'on' : 'off'); unlocked = true;
      if (wantOn) load().then(() => { H.Howler.mute(false); startMusic(); emit(); }); else { if (H) { mus?.fade(mus.volume(), 0, 250); setTimeout(() => !wantOn && H.Howler.mute(true), 260); } emit(); } },
    onChange(f) { listeners.add(f); f(api.on); return () => listeners.delete(f); },
    // a mute button: aria-pressed=true means sound is on
    button(el) { el.classList.add('d7-sound'); el.setAttribute('type', 'button');
      el.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" fill-opacity=".18"/><path class="wave" d="M15.5 9.2a4 4 0 010 5.6"/><path class="wave" d="M18 6.8a7.5 7.5 0 010 10.4"/><path class="x" d="M16 9.5l5 5M21 9.5l-5 5"/></svg><span class="eq"><i></i><i></i><i></i></span>`;
      const sync = on => { el.setAttribute('aria-pressed', on ? 'true' : 'false'); el.setAttribute('aria-label', on ? 'Sound on. Click to mute' : 'Sound off. Click to turn on'); el.title = on ? 'Mute' : 'Sound'; };
      api.onChange(sync); el.addEventListener('click', e => { e.stopPropagation(); api.toggle(el.getAttribute('aria-pressed') !== 'true'); }); return el; },
  };
  return api;
}

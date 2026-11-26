// All sound is synthesized with WebAudio — no files, no network. The context
// is created lazily on the first user gesture; every entry point is guarded
// so a headless browser or a denied context never throws.
export function createAudio(getSettings) {
  let ctx = null, master = null, musicGain = null, sfxGain = null;
  let engineNodes = null, musicTimer = null, musicStep = 0;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.connect(master);
      sfxGain = ctx.createGain(); sfxGain.connect(master);
      applyLevels();
      return true;
    } catch { return false; }
  }
  function applyLevels() {
    if (!ctx) return;
    const s = getSettings();
    master.gain.value = s.master ? 0.9 : 0;
    musicGain.gain.value = (s.music / 5) * 0.5;
    sfxGain.gain.value = (s.sfx / 5) * 0.9;
  }
  function tone(dest, freq, t0, dur, type, vol, slideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  // Tropical loop: a warm pentatonic figure over a soft two-chord pad.
  const MELODY = [523.25, 587.33, 659.25, 783.99, 659.25, 587.33, 523.25, 440];
  const PAD = [[261.63, 329.63, 392], [220, 261.63, 329.63]];
  function scheduleMusic(flightVariant) {
    if (!ctx) return;
    const s = getSettings();
    if (!s.master || s.music === 0) return;
    const t0 = ctx.currentTime + 0.05;
    const bar = Math.floor(musicStep / 8);
    for (const f of PAD[bar % 2]) tone(musicGain, f, t0, 1.7, 'triangle', 0.05);
    const note = MELODY[musicStep % 8];
    tone(musicGain, note, t0, 0.34, 'sine', 0.11);
    if (flightVariant && musicStep % 2 === 0) tone(musicGain, note * 2, t0 + 0.21, 0.18, 'sine', 0.04);
    musicStep++;
  }
  function startMusic(flightVariant) {
    if (!ensure()) return;
    stopMusic();
    scheduleMusic(flightVariant);
    musicTimer = setInterval(() => scheduleMusic(flightVariant), 215);
  }
  function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }
  function engineStart() {
    if (!ensure() || engineNodes) return;
    try {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o2.type = 'square';
      f.type = 'lowpass'; f.frequency.value = 420;
      g.gain.value = 0;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(sfxGain);
      o.start(); o2.start();
      engineNodes = { o, o2, g, f };
    } catch { engineNodes = null; }
  }
  function engineSet(throttle, speedNorm) {
    if (!engineNodes || !ctx) return;
    const t = ctx.currentTime;
    const rpm = 55 + throttle * 95 + speedNorm * 22;
    engineNodes.o.frequency.setTargetAtTime(rpm, t, 0.08);
    engineNodes.o2.frequency.setTargetAtTime(rpm * 1.5 + 3, t, 0.08);
    engineNodes.f.frequency.setTargetAtTime(320 + throttle * 700, t, 0.1);
    const s = getSettings();
    engineNodes.g.gain.setTargetAtTime(s.master ? 0.028 + throttle * 0.05 : 0, t, 0.1);
  }
  function engineStop() {
    if (!engineNodes || !ctx) return;
    try { engineNodes.o.stop(); engineNodes.o2.stop(); } catch { /* already stopped */ }
    engineNodes = null;
  }
  function blip(kind) {
    if (!ensure()) return;
    const s = getSettings();
    if (!s.master || s.sfx === 0) return;
    const t0 = ctx.currentTime + 0.02;
    if (kind === 'click') tone(sfxGain, 660, t0, 0.07, 'sine', 0.12);
    else if (kind === 'ring') { tone(sfxGain, 1318, t0, 0.16, 'sine', 0.16); tone(sfxGain, 1760, t0 + 0.07, 0.22, 'sine', 0.12); }
    else if (kind === 'stamp') { tone(sfxGain, 196, t0, 0.14, 'square', 0.2, 60); tone(sfxGain, 880, t0 + 0.1, 0.2, 'sine', 0.1); }
    else if (kind === 'splash') tone(sfxGain, 320, t0, 0.4, 'sawtooth', 0.08, 70);
    else if (kind === 'warn') tone(sfxGain, 440, t0, 0.12, 'square', 0.07);
    else if (kind === 'stall') { tone(sfxGain, 233, t0, 0.16, 'square', 0.10); tone(sfxGain, 233, t0 + 0.22, 0.16, 'square', 0.10); }
    else if (kind === 'coin') { tone(sfxGain, 988, t0, 0.1, 'sine', 0.12); tone(sfxGain, 1319, t0 + 0.08, 0.18, 'sine', 0.12); }
  }
  return { ensure, applyLevels, startMusic, stopMusic, engineStart, engineSet, engineStop, blip,
           hasContext: () => !!ctx };
}

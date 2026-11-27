// All sound is synthesized with WebAudio — no files, no network. The context
// is created lazily on the first user gesture; every entry point is guarded
// so a headless browser or a denied context never throws.
//
// v13 grows the set into a small soundscape: a context-aware cheerful
// music loop (bright by day, calm at night, tense in a storm), wind and
// rain loops tied to the flight, a firmness-scaled touchdown thud, and
// the airport radio — a band-limited formant voice that mumbles real
// transmissions at speech rhythm under their printed text.
//
// v14 teaches the radio to actually speak: where the platform offers
// speech synthesis, transmissions are spoken words (the choice and the
// pacing live in radio.js, as pure logic); the formant voice remains as
// the automatic fallback wherever synthesis is missing or fails.
import { radioEngine, radioSpeechParams, estimateSpeechSeconds } from './radio.js';
export function createAudio(getSettings) {
  let ctx = null, master = null, musicGain = null, sfxGain = null, radioGain = null;
  let engineNodes = null, windNodes = null, rainNodes = null;
  let musicTimer = null, musicStep = 0, musicMode = 'day';
  let noiseBuf = null;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.connect(master);
      sfxGain = ctx.createGain(); sfxGain.connect(master);
      radioGain = ctx.createGain(); radioGain.connect(master);
      applyLevels();
      primeSpeechVoices();
      return true;
    } catch { return false; }
  }
  function applyLevels() {
    if (!ctx) return;
    const s = getSettings();
    master.gain.value = s.master ? 0.9 : 0;
    musicGain.gain.value = (s.music / 5) * 0.5;
    sfxGain.gain.value = (s.sfx / 5) * 0.9;
    if (radioGain) radioGain.gain.value = ((s.radio ?? 4) / 5) * 0.9;
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
  function getNoise() {
    if (noiseBuf) return noiseBuf;
    const len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  function noiseHit(t0, dur, vol, freq, type = 'bandpass') {
    try {
      const src = ctx.createBufferSource(); src.buffer = getNoise(); src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(sfxGain);
      src.start(t0); src.stop(t0 + dur + 0.05);
    } catch { /* noise is garnish */ }
  }

  // ---- the music (v13): one cheerful loop, four weathers of mood ----
  // A bright marimba-ish pentatonic by day and in flight; at night the
  // same family slower, lower and sparser; in a storm it turns minor
  // and pulses. A step sequencer over a few oscillators — pennies of CPU.
  const MUSIC = {
    day:    { step: 215, vol: 0.11, mel: [523.25, 587.33, 659.25, 783.99, 880.00, 783.99, 659.25, 587.33], pad: [[261.63, 329.63, 392.00], [293.66, 369.99, 440.00], [349.23, 440.00, 523.25], [392.00, 493.88, 587.33]], sparkle: true },
    flight: { step: 215, vol: 0.11, mel: [523.25, 587.33, 659.25, 783.99, 659.25, 587.33, 523.25, 440.00], pad: [[261.63, 329.63, 392.00], [220.00, 261.63, 329.63]], sparkle: true },
    night:  { step: 335, vol: 0.065, mel: [392.00, 440.00, 523.25, 587.33, 523.25, 440.00, 392.00, 329.63], pad: [[196.00, 246.94, 293.66], [174.61, 220.00, 261.63]], sparkle: false },
    storm:  { step: 172, vol: 0.10, mel: [440.00, 523.25, 493.88, 440.00, 392.00, 440.00, 349.23, 392.00], pad: [[220.00, 261.63, 311.13], [196.00, 233.08, 293.66]], sparkle: false, pulse: true },
  };
  function scheduleMusic() {
    if (!ctx) return;
    const s = getSettings();
    if (!s.master || s.music === 0) return;
    const cfg = MUSIC[musicMode] || MUSIC.day;
    const t0 = ctx.currentTime + 0.05;
    const bar = Math.floor(musicStep / 8);
    if (musicStep % 8 === 0) for (const f of cfg.pad[bar % cfg.pad.length]) tone(musicGain, f, t0, cfg.step * 8 / 1000 * 0.95, 'triangle', 0.045);
    const note = cfg.mel[musicStep % 8];
    // Marimba-ish: a sine ping with a triangle partial, quick decay.
    tone(musicGain, note, t0, 0.30, 'sine', cfg.vol);
    tone(musicGain, note * 2, t0, 0.10, 'triangle', cfg.vol * 0.25);
    if (cfg.sparkle && musicStep % 2 === 0) tone(musicGain, note * 2, t0 + cfg.step / 1000, 0.16, 'sine', 0.035);
    if (cfg.pulse && musicStep % 4 === 2) tone(musicGain, 110, t0, 0.22, 'sine', 0.09);
    musicStep++;
  }
  function startMusic(mode) {
    if (!ensure()) return;
    const m = mode === true ? 'flight' : mode === false || !mode ? 'day' : mode;
    if (musicTimer && m === musicMode) return; // already playing this mood
    stopMusic();
    musicMode = m;
    musicStep = 0;
    scheduleMusic();
    musicTimer = setInterval(scheduleMusic, (MUSIC[m] || MUSIC.day).step);
  }
  function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }
  // Short motifs over the loop: a rising delivery jingle, a falling
  // crash sting. Played on the music bus so the music toggle rules them.
  function jingle(kind) {
    if (!ensure()) return;
    const s = getSettings();
    if (!s.master || s.music === 0) return;
    const t0 = ctx.currentTime + 0.03;
    if (kind === 'win') [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => tone(musicGain, f, t0 + i * 0.09, 0.30, 'triangle', 0.13));
    else if (kind === 'lose') [392.00, 329.63, 261.63, 196.00].forEach((f, i) => tone(musicGain, f, t0 + i * 0.17, 0.34, 'triangle', 0.10));
  }

  // ---- flight loops: engine (v9), wind and rain (v13) ----
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
  function loopStart(kind) {
    if (!ensure()) return null;
    try {
      const src = ctx.createBufferSource(); src.buffer = getNoise(); src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = kind === 'wind' ? 'bandpass' : 'lowpass';
      f.frequency.value = kind === 'wind' ? 500 : 1600; f.Q.value = 0.6;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(sfxGain);
      src.start();
      return { src, f, g };
    } catch { return null; }
  }
  function windStart() { if (!windNodes) windNodes = loopStart('wind'); }
  function windSet(speedNorm) {
    if (!windNodes || !ctx) return;
    const t = ctx.currentTime, s = getSettings();
    const v = Math.pow(Math.max(0, Math.min(1, speedNorm)), 1.6);
    windNodes.g.gain.setTargetAtTime(s.master && s.sfx > 0 ? v * 0.13 : 0, t, 0.15);
    windNodes.f.frequency.setTargetAtTime(350 + v * 750, t, 0.2);
  }
  function windStop() { if (windNodes) { try { windNodes.src.stop(); } catch { /* done */ } windNodes = null; } }
  function rainStart() { if (!rainNodes) rainNodes = loopStart('rain'); }
  function rainSet(level) {
    if (!rainNodes || !ctx) return;
    const s = getSettings();
    rainNodes.g.gain.setTargetAtTime(s.master && s.sfx > 0 ? Math.max(0, Math.min(1, level)) * 0.075 : 0, ctx.currentTime, 0.3);
  }
  function rainStop() { if (rainNodes) { try { rainNodes.src.stop(); } catch { /* done */ } rainNodes = null; } }

  function blip(kind, v = 0.5) {
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
    else if (kind === 'switch') { tone(sfxGain, 520, t0, 0.08, 'sine', 0.10); tone(sfxGain, 780, t0 + 0.07, 0.12, 'sine', 0.10); }
    else if (kind === 'thud') { // touchdown: a low thump scaled by firmness
      tone(sfxGain, 92, t0, 0.22, 'sine', 0.10 + v * 0.22, 42);
      noiseHit(t0, 0.10, 0.03 + v * 0.06, 300, 'lowpass');
    } else if (kind === 'gun') { // the patrol's nose guns: a short crack and a mechanical clack
      noiseHit(t0, 0.09, 0.16, 1600, 'highpass');
      tone(sfxGain, 190, t0, 0.08, 'square', 0.10, 70);
    } else if (kind === 'hit') { // a drone going down: a crack, then its little engine dies in a fall
      tone(sfxGain, 720, t0, 0.10, 'sawtooth', 0.14, 140);
      noiseHit(t0, 0.28, 0.12, 700, 'lowpass');
    } else if (kind === 'boom') { // the explosion: a deep crack and a long rumble
      tone(sfxGain, 120, t0, 0.85, 'sawtooth', 0.30, 30);
      tone(sfxGain, 64, t0, 1.1, 'sine', 0.32, 26);
      noiseHit(t0, 0.55, 0.20, 900, 'lowpass');
      noiseHit(t0 + 0.05, 1.3, 0.10, 220, 'lowpass');
    }
  }

  // ---- spoken radio (v14) ----
  // The voice list loads asynchronously on most platforms (and starts
  // empty on iOS until the first getVoices), so it is warmed at context
  // creation and refreshed whenever the platform announces new voices.
  let speechVoices = [];
  function primeSpeechVoices() {
    try {
      const g = typeof window !== 'undefined' ? window : null;
      if (!g || radioEngine(g) !== 'tts') return;
      const load = () => { try { speechVoices = g.speechSynthesis.getVoices() || []; } catch { /* keep the last list */ } };
      load();
      if (typeof g.speechSynthesis.addEventListener === 'function') g.speechSynthesis.addEventListener('voiceschanged', load);
    } catch { /* speech is garnish */ }
  }
  function pickSpeechVoice(want) {
    if (!speechVoices.length) return null;
    const starts = p => speechVoices.find(v => (v.lang || '').toLowerCase().startsWith(p));
    return starts(want + '-') || starts(want) || (want === 'id' ? starts('en') : null) || null;
  }
  // Speak one transmission. Returns the seconds the channel stays busy,
  // or 0 when speech failed — the caller then falls back to the formant
  // voice, so a speechless platform sounds exactly like v13.
  function speakRadio(text, speaker, s) {
    try {
      const g = typeof window !== 'undefined' ? window : null;
      if (!g || radioEngine(g) !== 'tts') return 0;
      const { pitch, rate } = radioSpeechParams(speaker);
      // The channel still clicks open first: squelch and a call beep on
      // the radio bus, as the formant voice always had.
      if (ctx) {
        const t0 = ctx.currentTime + 0.03;
        noiseHit(t0, 0.05, 0.05, 2400);
        tone(radioGain, 1250, t0 + 0.06, 0.05, 'sine', 0.05);
      }
      const synth = g.speechSynthesis;
      synth.cancel(); // one voice on the channel at a time
      const u = new g.SpeechSynthesisUtterance(String(text));
      const id = s.lang === 'id';
      u.lang = id ? 'id-ID' : 'en-US';
      const v = pickSpeechVoice(id ? 'id' : 'en');
      if (v) u.voice = v;
      u.pitch = pitch; u.rate = rate;
      u.volume = Math.max(0, Math.min(1, (s.radio ?? 4) / 5));
      synth.speak(u);
      return estimateSpeechSeconds(text, rate) + 0.3;
    } catch { return 0; }
  }
  // Silence the spoken channel at once (pause, quit, a new flight): a
  // tower left mid-sentence over the pause menu helps nobody.
  function radioStop() {
    try {
      const g = typeof window !== 'undefined' ? window : null;
      if (g && g.speechSynthesis) g.speechSynthesis.cancel();
    } catch { /* nothing to stop */ }
  }

  // The radio's mouth, chosen per transmission (v14): real speech where
  // the platform offers it, the v13 formant voice everywhere else. The
  // printed strip is identical either way; only the sound changes.
  function radioVoice(text, speaker) {
    if (!ensure()) return 0;
    const s = getSettings();
    if (!s.master || (s.radio ?? 4) === 0) return 0;
    const spoken = speakRadio(text, speaker, s);
    if (spoken > 0) return spoken;
    return formantVoice(text, speaker);
  }

  // ---- the airport radio, formant fallback (v13) ----
  // A transmission is a squelch click, a call beep, then a voice: a
  // sawtooth run through two formant band-passes, chopped into syllables
  // at speech rhythm with a speaker's pitch and a sentence contour, all
  // band-limited like a real airband set and dusted with static. It is
  // honestly a voice-LIKE mumble — the printed strip carries the words;
  // the sound carries the radio. Returns the utterance's seconds so the
  // caller can pace the queue.
  function syllables(text) {
    const words = String(text).replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    const out = [];
    for (const w of words) {
      const groups = w.match(/[^aeiouy]*[aeiouy]+[^aeiouy]*/gi) || [w];
      for (const gpart of groups) out.push({ n: gpart.length, end: false });
      out.push({ gap: true });
    }
    if (out.length) out[out.length - 1].end = true;
    return out;
  }
  function formantVoice(text, speaker) {
    if (!ensure()) return 0;
    const s = getSettings();
    if (!s.master || (s.radio ?? 4) === 0) return 0;
    const t0 = ctx.currentTime + 0.03;
    // Squelch + beep open every transmission.
    noiseHit(t0, 0.05, 0.05, 2400);
    tone(radioGain, 1250, t0 + 0.06, 0.05, 'sine', 0.05);
    const base = speaker === 'pilot' ? 168 : speaker === 'boat' ? 138 : 116;
    const syl = syllables(text);
    let t = t0 + 0.18, seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // A bed of static under the whole utterance.
    try {
      const src = ctx.createBufferSource(); src.buffer = getNoise(); src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.4;
      const g = ctx.createGain(); g.gain.value = 0.012;
      src.connect(f); f.connect(g); g.connect(radioGain);
      src.start(t); src.stop(t + syl.length * 0.13 + 0.3);
    } catch { /* static is garnish */ }
    syl.forEach((sy, i) => {
      if (sy.gap) { t += 0.055; return; }
      const dur = 0.075 + Math.min(sy.n, 5) * 0.012 + rnd() * 0.02;
      const frac = i / Math.max(1, syl.length - 1);
      const contour = sy.end ? 0.84 : 1 + Math.sin(frac * Math.PI) * 0.10 + (rnd() - 0.5) * 0.09;
      const f0 = base * contour;
      try {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(f0 * (0.94 + rnd() * 0.1), t);
        const bp1 = ctx.createBiquadFilter(); bp1.type = 'bandpass'; bp1.frequency.value = 480 + rnd() * 260; bp1.Q.value = 2.2;
        const bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 1350 + rnd() * 500; bp2.Q.value = 3.0;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.014);
        g.gain.setValueAtTime(0.16, t + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(bp1); bp1.connect(g); o.connect(bp2); bp2.connect(g); g.connect(radioGain);
        o.start(t); o.stop(t + dur + 0.03);
      } catch { /* one syllable lost, the transmission survives */ }
      t += dur + 0.018;
    });
    noiseHit(t + 0.04, 0.05, 0.04, 2400); // squelch tail
    return (t - t0) + 0.25;
  }

  return { ensure, applyLevels, startMusic, stopMusic, jingle,
           engineStart, engineSet, engineStop, windStart, windSet, windStop,
           rainStart, rainSet, rainStop, blip, radioVoice, radioStop,
           hasContext: () => !!ctx };
}

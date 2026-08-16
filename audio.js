// audio.js — generative campfire soundscape for faller
//
// 1. Drone: subtle low D minor pad (the fire's "breath")
// 2. Wind: pink noise through a slowly-modulated lowpass
// 3. Crackles: Tone.NoiseSynth triggered at random intervals (the main
//    "wood burning" texture — highpassed short bursts with random pan)
// 4. Occasional pops: bigger resonant crackle every 8-15s
//
// Uses window.Tone global (loaded via classic <script> in index.html),
// matching the pattern used in the other 00-simplest projects.

const Tone = window.Tone;
const {
  Volume, Limiter, Reverb, Filter, LFO, Gain, Noise, NoiseSynth,
  Oscillator, PolySynth, Synth, Loop, Frequency, getTransport, start, now, getContext,
  Panner3D
} = Tone;

// ── AudioContext unlock ──
// Tone.js v14 creates its Transport (and a ConstantSourceNode inside it) the
// moment the module is imported — *before* the user has interacted with the
// page. Chrome blocks the createConstantSource() call and logs:
//
//   "The AudioContext was not allowed to start. It must be resumed (or
//    created) after a user gesture on the page."
//
// The official fix is to resume the context on the first user gesture. We do
// it in a single-shot listener that captures *any* first interaction
// (click/touch/keypress) and resumes the Tone.js context if it's still
// suspended. Tone.js's own start() does the same thing, but the warning fires
// during module init (before start() ever runs), so we need this bridge.
let unlocked = false;
function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  try {
    const ctx = getContext && getContext().rawContext;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().then(() => {
        console.log('[audio] AudioContext resumed by user gesture');
      }).catch(err => {
        console.warn('[audio] could not resume AudioContext:', err);
      });
    }
  } catch (e) {
    console.warn('[audio] unlock failed:', e);
  }
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
  window.removeEventListener('touchstart', unlockAudio);
}
window.addEventListener('pointerdown', unlockAudio, { capture: true, once: true });
window.addEventListener('keydown', unlockAudio, { capture: true, once: true });
window.addEventListener('touchstart', unlockAudio, { capture: true, once: true });


let started = false;
let crackleTimer = null;
let popTimer = null;
let woodTimer = null;
// Module-scope refs to gain nodes we modulate reactively. These are
// reassigned in buildAudioGraph(); tickIntensity() reads them each frame.
let droneGainRef = null;
let emberGainRef = null;
let crackleDryGainRef = null;
let crackleWetGainRef = null;
let crackleThickGainRef = null;
let intensityRAF = 0;

// ── Graph node registry ──
// We hold references to every Tone.js node created in buildAudioGraph() so we
// can .dispose() them when the user toggles audio off. Without this, toggling
// audio off only paused the Transport; the OscillatorNodes / Noise / LFOs /
// Filters stayed alive and accumulated on every re-toggle, eventually
// starving the AudioContext and producing no audible output.
let graphNodes = [];

function register(node) {
  if (node) graphNodes.push(node);
  return node;
}

function disposeAudioGraph() {
  // Stop the scheduled timers first so no new triggers fire mid-dispose
  if (crackleTimer) { clearTimeout(crackleTimer); crackleTimer = null; }
  if (popTimer) { clearTimeout(popTimer); popTimer = null; }
  if (woodTimer) { clearTimeout(woodTimer); woodTimer = null; }
  // Stop the reactive intensity loop too — its RAF keeps references alive.
  if (intensityRAF) { cancelAnimationFrame(intensityRAF); intensityRAF = 0; }
  // Dispose every node we created, in reverse order (children before parents)
  for (let i = graphNodes.length - 1; i >= 0; i--) {
    try {
      graphNodes[i].dispose();
    } catch (e) {
      // Some Tone.js nodes throw if already disposed — ignore those
    }
  }
  graphNodes = [];
  // Clear reactive refs so tickIntensity() doesn't try to write to disposed nodes.
  droneGainRef = null;
  emberGainRef = null;
  crackleDryGainRef = null;
  crackleWetGainRef = null;
  crackleThickGainRef = null;
}

function buildAudioGraph() {
  graphNodes = []; // reset on each (re-)build

  const masterVolume = register(new Volume(-22).toDestination());
  const limiter = register(new Limiter(-3).connect(masterVolume));

  const reverb = register(new Reverb({
    decay: 8,
    preDelay: 0.05,
    wet: 0.6
  }));
  reverb.connect(limiter);

  // ─── 1. Drone (low D minor pad — fire's breath) ────────────────────────
  const droneGain = register(new Gain(0.35).connect(reverb));
  droneGainRef = droneGain;
  const droneFreqs = [
    Frequency('D2').toFrequency(),
    Frequency('F2').toFrequency(),
    Frequency('A1').toFrequency()
  ];
  droneFreqs.forEach((freq, i) => {
    const osc = register(new Oscillator({
      frequency: freq,
      type: 'sawtooth',
      detune: [-7, 4, -12][i]
    }).connect(droneGain));
    osc.start();
    register(osc); // also tracked for dispose
  });

  // ─── 2. Wind (pink noise + slowly modulated lowpass) ──────────────────
  const windNoise = register(new Noise('pink').start());
  const windLFO = register(new LFO(0.08, 150, 450).start());
  const windFilter = register(new Filter(300, 'lowpass').connect(reverb));
  windLFO.connect(windFilter.frequency);
  const windGain = register(new Gain(0.18).connect(windFilter));
  windNoise.connect(windGain);

  // ─── 3. Crackles (the main fire texture — 3 profiles) ──────────────────
  //  Real wood fires don't make one crackle sound — they crack, pop, and
  //  hiss. Three NoiseSynths with different envelopes + filter shapes:
  //    - dry   : very short, white noise, highpassed (sharp twigs snapping)
  //    - wet   : longer, pink noise, bandpass (resinous pops with body)
  //    - thick : long decay, brown noise, lowpass (wet logs settling)
  const crackleDry = register(new NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 }
  }));
  const crackleDryFilter = register(new Filter(2500, 'highpass').connect(reverb));
  const crackleDryGain = register(new Gain(0.4).connect(crackleDryFilter));
  crackleDryGainRef = crackleDryGain;
  crackleDry.connect(crackleDryGain);

  const crackleWet = register(new NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 }
  }));
  const crackleWetFilter = register(new Filter(900, 'bandpass').connect(reverb));
  crackleWetFilter.Q.value = 1.5;
  const crackleWetGain = register(new Gain(0.32).connect(crackleWetFilter));
  crackleWetGainRef = crackleWetGain;
  crackleWet.connect(crackleWetGain);

  const crackleThick = register(new NoiseSynth({
    noise: { type: 'brown' },
    envelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.08 }
  }));
  const crackleThickFilter = register(new Filter(600, 'lowpass').connect(reverb));
  const crackleThickGain = register(new Gain(0.22).connect(crackleThickFilter));
  crackleThickGainRef = crackleThickGain;
  crackleThick.connect(crackleThickGain);

  const cracklePool = [
    { synth: crackleDry, gain: crackleDryGain, weight: 0.55, minDur: 0.01, maxDur: 0.06, volMin: 0.25, volMax: 0.7 },
    { synth: crackleWet, gain: crackleWetGain, weight: 0.30, minDur: 0.05, maxDur: 0.15, volMin: 0.30, volMax: 0.8 },
    { synth: crackleThick, gain: crackleThickGain, weight: 0.15, minDur: 0.08, maxDur: 0.25, volMin: 0.35, volMax: 0.9 },
  ];
  let crackleCumWeights = [];
  {
    let acc = 0;
    for (const c of cracklePool) { acc += c.weight; crackleCumWeights.push(acc); }
  }
  function pickCrackle() {
    const r = Math.random() * crackleCumWeights[crackleCumWeights.length - 1];
    for (let i = 0; i < crackleCumWeights.length; i++) {
      if (r <= crackleCumWeights[i]) return cracklePool[i];
    }
    return cracklePool[cracklePool.length - 1];
  }

  function scheduleCrackle() {
    const nextDelay = 25 + Math.random() * 150;
    crackleTimer = setTimeout(() => {
      const c = pickCrackle();
      const dur = c.minDur + Math.random() * (c.maxDur - c.minDur);
      const vol = c.volMin + Math.random() * (c.volMax - c.volMin);
      c.gain.gain.value = vol;
      c.synth.triggerAttackRelease(dur, now());
      scheduleCrackle();
    }, nextDelay);
  }
  scheduleCrackle();

  // ─── 4. Occasional pops (bigger resonant crackle, 3D spatial) ─────────
  //  Uses Panner3D with HRTF panning model so the listener perceives the pop
  //  coming from a real point in 3D space, not just left/right. Position is
  //  randomised in a ring around the listener each time.
  function schedulePop() {
    const nextDelay = 8000 + Math.random() * 7000;
    popTimer = setTimeout(() => {
      const popSynth = new NoiseSynth({
        noise: { type: 'pink' },
        envelope: {
          attack: 0.002,
          decay: 0.15,
          sustain: 0,
          release: 0.1
        }
      });
      const popFilter = new Filter(800, 'bandpass').connect(reverb);
      const popPanner = new Panner3D({
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: 2,
        maxDistance: 12,
        rolloffFactor: 1.2,
        positionX: 0, positionY: 0, positionZ: 0,
      }).connect(popFilter);
      // Random position on a ring around the listener (radius ~3m, y = ground level).
      const angle = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 3.5;
      popPanner.positionX.value = Math.cos(angle) * r;
      popPanner.positionY.value = 0.2 + Math.random() * 0.4;
      popPanner.positionZ.value = Math.sin(angle) * r;
      popSynth.connect(popPanner);
      popSynth.triggerAttackRelease(0.15, now());
      setTimeout(() => {
        popSynth.dispose();
        popFilter.dispose();
        popPanner.dispose();
      }, 800);
      schedulePop();
    }, nextDelay);
  }
  schedulePop();

  // ─── 5. Ember bed (continuous soft hiss) ───────────────────────────────
  //  Hot coals make a constant "shhhhh" that's the substrate under everything.
  //  Pink noise through a bandpass around 3kHz, very low volume, no envelope.
  const emberNoise = register(new Noise('pink').start());
  const emberFilter = register(new Filter(3000, 'bandpass').connect(reverb));
  emberFilter.Q.value = 1.8;
  const emberLFO = register(new LFO(0.3, 0.10, 0.22).start());
  const emberGain = register(new Gain(0.12).connect(emberFilter));
  emberGainRef = emberGain;
  emberLFO.connect(emberGain.gain);
  emberNoise.connect(emberGain);

  // ─── 6. Wood resonance (occasional mid-frequency creak) ───────────────
  //  Logs settling under their own weight make a longer "creak" with body.
  //  Pink noise + bandpass around 350Hz, slower envelope than a crackle.
  const woodSynth = register(new NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.005, decay: 0.45, sustain: 0, release: 0.15 }
  }));
  const woodFilter = register(new Filter(350, 'bandpass').connect(reverb));
  woodFilter.Q.value = 1.2;
  const woodGain = register(new Gain(0.18).connect(woodFilter));
  woodSynth.connect(woodGain);

  function scheduleWood() {
    const nextDelay = 4000 + Math.random() * 8000;
    woodTimer = setTimeout(() => {
      const dur = 0.25 + Math.random() * 0.35;
      const vol = 0.4 + Math.random() * 0.5;
      woodGain.gain.value = vol;
      woodSynth.triggerAttackRelease(dur, now());
      scheduleWood();
    }, nextDelay);
  }
  scheduleWood();
}

// ── Reactive audio API ──
// The render loop can call setFireIntensity(0..1) to modulate volume of the
// drone + crackle layers. When the dancers are still, the fire "settles";
// when they move fast, the fire rages. If the API is never called, defaults
// to a calm fire (~0.35) so the sound is pleasant out of the box.
let fireIntensity = 0.35;
let fireIntensitySmoothed = 0.35;
let fireIntensityTarget = 0.35;
function tickIntensity() {
  // Exponential smoothing toward target so volume changes don't click.
  fireIntensitySmoothed += (fireIntensityTarget - fireIntensitySmoothed) * 0.06;
  // Modulate drone gain (was 0.35) — fireIntensity in [0,1] scales [0.18, 0.65].
  if (droneGainRef) droneGainRef.gain.value = 0.18 + fireIntensitySmoothed * 0.47;
  // Modulate ember bed — quiet at low intensity, fuller hiss at high.
  if (emberGainRef) emberGainRef.gain.value = 0.08 + fireIntensitySmoothed * 0.18;
  // Modulate crackle layers: dry layer scales [0.2, 0.55], wet [0.15, 0.45], thick [0.10, 0.35].
  if (crackleDryGainRef) crackleDryGainRef.gain.value = 0.20 + fireIntensitySmoothed * 0.35;
  if (crackleWetGainRef) crackleWetGainRef.gain.value = 0.15 + fireIntensitySmoothed * 0.30;
  if (crackleThickGainRef) crackleThickGainRef.gain.value = 0.10 + fireIntensitySmoothed * 0.25;
  intensityRAF = requestAnimationFrame(tickIntensity);
}
export function setFireIntensity(value) {
  // Clamp to [0, 1] so callers don't blow up the mix.
  fireIntensityTarget = Math.max(0, Math.min(1, value));
  if (!intensityRAF) intensityRAF = requestAnimationFrame(tickIntensity);
}
// Expose on window so non-module scripts (or simple dynamic imports) can
// call it without having to plumb the named export. fuego-avatar.html uses
// this from the render loop.
if (typeof window !== 'undefined') window.setFireIntensity = setFireIntensity;
export function getFireIntensity() {
  return fireIntensityTarget;
}

export async function toggleAudio() {
  if (!started) {
    // ── ON ──
    // Resume the AudioContext first (in case Chrome auto-suspended it after
    // the user toggled us off, or after the tab was backgrounded). This MUST
    // happen inside a user gesture, which the slider click provides.
    try {
      const ctx = getContext && getContext().rawContext;
      if (ctx && ctx.state !== 'running') {
        await ctx.resume();
      }
    } catch (e) {
      console.warn('[audio] could not resume context on toggle on:', e);
    }
    await start();
    buildAudioGraph();
    getTransport().start();
    started = true;
    console.log('[audio] started, ctx state:', getContext().rawContext.state);
    return true;
  } else {
    // ── OFF ──
    // Stop the transport, dispose every node we created (so the Oscillators
    // shut down and the AudioContext can release their slots), then suspend
    // the context so Chrome can reclaim resources. Without dispose() the old
    // nodes linger and the next on-cycle would stack a second graph on top,
    // eventually producing no sound.
    try {
      getTransport().pause();
      getTransport().cancel();
      disposeAudioGraph();
      const ctx = getContext && getContext().rawContext;
      if (ctx && ctx.state === 'running') {
        await ctx.suspend();
        console.log('[audio] stopped, ctx state:', ctx.state);
      }
    } catch (e) {
      console.warn('[audio] error during toggle off:', e);
    }
    started = false;
    return false;
  }
}

export function isPlaying() {
  return started;
}

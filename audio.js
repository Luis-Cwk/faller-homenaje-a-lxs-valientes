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
  Oscillator, PolySynth, Synth, Loop, Frequency, getTransport, start, now, getContext
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
  // Dispose every node we created, in reverse order (children before parents)
  for (let i = graphNodes.length - 1; i >= 0; i--) {
    try {
      graphNodes[i].dispose();
    } catch (e) {
      // Some Tone.js nodes throw if already disposed — ignore those
    }
  }
  graphNodes = [];
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

  // ─── 3. Crackles (the main fire texture) ──────────────────────────────
  const crackleSynth = register(new NoiseSynth({
    noise: { type: 'white' },
    envelope: {
      attack: 0.001,
      decay: 0.04,
      sustain: 0,
      release: 0.02
    }
  }));
  const crackleFilter = register(new Filter(2500, 'highpass').connect(reverb));
  const crackleGain = register(new Gain(0.4).connect(crackleFilter));
  const { Panner } = Tone;
  const cracklePanner = register(new Panner(0).connect(crackleGain));
  crackleSynth.connect(cracklePanner);

  function scheduleCrackle() {
    const nextDelay = 30 + Math.random() * 170;
    crackleTimer = setTimeout(() => {
      const dur = 0.01 + Math.random() * 0.07;
      const vol = 0.3 + Math.random() * 0.7;
      const pan = (Math.random() - 0.5) * 1.6;
      cracklePanner.pan.value = pan;
      crackleGain.gain.value = vol;
      crackleSynth.triggerAttackRelease(dur, now());
      scheduleCrackle();
    }, nextDelay);
  }
  scheduleCrackle();

  // ─── 4. Occasional pops (bigger resonant crackle) ─────────────────────
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
      const popPanner = new Panner(0).connect(popFilter);
      popSynth.connect(popPanner);
      popPanner.pan.value = (Math.random() - 0.5) * 1.4;
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

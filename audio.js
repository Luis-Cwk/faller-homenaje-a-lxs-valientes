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
  Oscillator, PolySynth, Synth, Loop, Frequency, getTransport, start, now
} = Tone;

let started = false;
let crackleTimer = null;
let popTimer = null;

function buildAudioGraph() {
  const masterVolume = new Volume(-22).toDestination();
  const limiter = new Limiter(-3).connect(masterVolume);

  const reverb = new Reverb({
    decay: 8,
    preDelay: 0.05,
    wet: 0.6
  });
  reverb.connect(limiter);

  // ─── 1. Drone (low D minor pad — fire's breath) ────────────────────────
  const droneGain = new Gain(0.35).connect(reverb);
  const droneFreqs = [
    Frequency('D2').toFrequency(),
    Frequency('F2').toFrequency(),
    Frequency('A1').toFrequency()
  ];
  droneFreqs.forEach((freq, i) => {
    const osc = new Oscillator({
      frequency: freq,
      type: 'sawtooth',
      detune: [-7, 4, -12][i]
    }).connect(droneGain);
    osc.start();
  });

  // ─── 2. Wind (pink noise + slowly modulated lowpass) ──────────────────
  const windNoise = new Noise('pink').start();
  const windLFO = new LFO(0.08, 150, 450).start();
  const windFilter = new Filter(300, 'lowpass').connect(reverb);
  windLFO.connect(windFilter.frequency);
  const windGain = new Gain(0.18).connect(windFilter);
  windNoise.connect(windGain);

  // ─── 3. Crackles (the main fire texture) ──────────────────────────────
  // Pre-build one NoiseSynth and trigger it repeatedly at random intervals.
  // Each trigger is a short, high-passed burst with random pan and gain.
  const crackleSynth = new NoiseSynth({
    noise: { type: 'white' },
    envelope: {
      attack: 0.001,
      decay: 0.04,
      sustain: 0,
      release: 0.02
    }
  });
  const crackleFilter = new Filter(2500, 'highpass').connect(reverb);
  const crackleGain = new Gain(0.4).connect(crackleFilter);
  // Use ChannelMerger-style pan via Panner if available; Tone v14 uses Panner.
  const { Panner } = Tone;
  const cracklePanner = new Panner(0).connect(crackleGain);
  crackleSynth.connect(cracklePanner);

  function scheduleCrackle() {
    // Random delay 30-200ms
    const nextDelay = 30 + Math.random() * 170;
    crackleTimer = setTimeout(() => {
      const dur = 0.01 + Math.random() * 0.07;
      const vol = 0.3 + Math.random() * 0.7;
      const pan = (Math.random() - 0.5) * 1.6; // -0.8..0.8
      cracklePanner.pan.value = pan;
      crackleGain.gain.value = vol;
      crackleSynth.triggerAttackRelease(dur, now());
      scheduleCrackle();
    }, nextDelay);
  }
  scheduleCrackle();

  // ─── 4. Occasional pops (bigger resonant crackle) ─────────────────────
  function schedulePop() {
    const nextDelay = 8000 + Math.random() * 7000; // 8-15s
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
      // Dispose after the sound has played out to avoid leak
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
    await start();
    buildAudioGraph();
    getTransport().start();
    started = true;
    return true;
  } else {
    getTransport().pause();
    // Stop crackle/pop loops
    if (crackleTimer) { clearTimeout(crackleTimer); crackleTimer = null; }
    if (popTimer) { clearTimeout(popTimer); popTimer = null; }
    started = false;
    return false;
  }
}

export function isPlaying() {
  return started;
}

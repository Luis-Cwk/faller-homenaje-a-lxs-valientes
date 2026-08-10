// audio.js — Tim Hecker inspired generative drone + arpeggio for faller
// Drone: 3 detuned saws + sine sub -> distortion -> lowpass (LFO) -> reverb
// Arpeggio: random pentatonic notes every 4-8s -> reverb
// Master: low volume + limiter

import Tone from 'tone';
const {
  Volume, Limiter, Reverb, Filter, LFO, Distortion, Gain, Oscillator,
  PolySynth, Synth, Loop, Frequency, getTransport, start
} = Tone;

let started = false;
let masterVolume, limiter;

function buildAudioGraph() {
  masterVolume = new Volume(-18).toDestination();
  limiter = new Limiter(-3).connect(masterVolume);

  const reverb = new Reverb({
    decay: 18,
    preDelay: 0.4,
    wet: 0.85
  });
  reverb.connect(limiter);
  // Reverb generates its impulse response async — wait for it before playing.
  reverb.generate();

  // Drone cluster — 3 detuned saw oscillators + sine sub
  const droneFilter = new Filter(420, 'lowpass').connect(reverb);
  const droneLFO = new LFO(0.07, 250, 900).connect(droneFilter.frequency);
  droneLFO.start();

  const distortion = new Distortion({
    distortion: 0.55,
    oversample: '4x',
    wet: 0.6
  }).connect(droneFilter);

  const droneGain = new Gain(0.6).connect(distortion);

  // Slight detune cents for the "wall of sound" feel
  const detunes = [-12, 0, 11, -7];
  const types = ['sawtooth', 'sawtooth', 'sawtooth', 'sine'];
  // Root cluster in D minor pentatonic spread
  const droneFreqs = [
    Frequency('D2').toFrequency(),
    Frequency('F2').toFrequency(),
    Frequency('A2').toFrequency(),
    Frequency('D1').toFrequency()
  ];

  droneFreqs.forEach((freq, i) => {
    const osc = new Oscillator({
      frequency: freq,
      type: types[i],
      detune: detunes[i]
    }).connect(droneGain);
    osc.start();
  });

  // Arpeggio — random pentatonic notes, sparse
  const arpSynth = new PolySynth(Synth, {
    oscillator: { type: 'triangle' },
    envelope: {
      attack: 1.2,
      decay: 2.0,
      sustain: 0.3,
      release: 4.5
    }
  }).connect(reverb);
  arpSynth.volume.value = -10;

  // D minor pentatonic: D, F, G, A, C
  const pentatonic = ['D4', 'F4', 'G4', 'A4', 'C5', 'D5', 'F5', 'A5', 'C6'];
  const arpLoop = new Loop((time) => {
    const note = pentatonic[(Math.random() * pentatonic.length) | 0];
    const dur = ['4n', '2n', '1n', '8n'][(Math.random() * 4) | 0];
    // Only play ~70% of the time so it breathes
    if (Math.random() > 0.3) {
      arpSynth.triggerAttackRelease(note, dur, time);
    }
  }, '2n');
  arpLoop.start(0);
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
    started = false;
    return false;
  }
}

export function isPlaying() {
  return started;
}

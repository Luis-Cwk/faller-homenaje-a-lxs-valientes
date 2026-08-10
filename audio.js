// audio.js — Tim Hecker inspired generative drone + arpegio for faller
// Drone: 3 detuned saws + sine sub -> distortion -> lowpass (LFO) -> reverb
// Arpegio: random pentatonic notes every 4-8s -> reverb
// Master: low volume + limiter

import * as Tone from 'tone';

let started = false;
let drone, arpSynth, arpLoop;
const masterVolume = new Tone.Volume(-18).toDestination();
const limiter = new Tone.Limiter(-3).connect(masterVolume);

function buildAudioGraph() {
  const reverb = new Tone.Reverb({
    decay: 18,
    preDelay: 0.4,
    wet: 0.85
  });
  reverb.connect(limiter);

  // Drone cluster — 3 detuned saw oscillators + sine sub
  const droneFilter = new Tone.Filter(420, 'lowpass').connect(reverb);
  const droneLFO = new Tone.LFO(0.07, 250, 900).connect(droneFilter.frequency);
  droneLFO.start();

  const distortion = new Tone.Distortion({
    distortion: 0.55,
    oversample: '4x',
    wet: 0.6
  }).connect(droneFilter);

  const droneGain = new Tone.Gain(0.6).connect(distortion);

  // Slight detune cents for the "wall of sound" feel
  const detunes = [-12, 0, 11, -7];
  const types = ['sawtooth', 'sawtooth', 'sawtooth', 'sine'];
  // Root cluster in D minor pentatonic spread
  const droneFreqs = [
    Tone.Frequency('D2').toFrequency(),
    Tone.Frequency('F2').toFrequency(),
    Tone.Frequency('A2').toFrequency(),
    Tone.Frequency('D1').toFrequency()
  ];

  droneFreqs.forEach((freq, i) => {
    const osc = new Tone.Oscillator({
      frequency: freq,
      type: types[i],
      detune: detunes[i]
    }).connect(droneGain);
    osc.start();
  });

  drone = { filter: droneFilter, lfo: droneLFO, distortion, gain: droneGain };

  // Arpegio — random pentatonic notes, sparse
  arpSynth = new Tone.PolySynth(Tone.Synth, {
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
  let arpStep = 0;
  arpLoop = new Tone.Loop((time) => {
    const note = pentatonic[(Math.random() * pentatonic.length) | 0];
    const dur = ['4n', '2n', '1n', '8n'][(Math.random() * 4) | 0];
    // Only play ~70% of the time so it breathes
    if (Math.random() > 0.3) {
      arpSynth.triggerAttackRelease(note, dur, time);
    }
    arpStep++;
  }, '2n');
  arpLoop.start(0);
}

export async function toggleAudio() {
  if (!started) {
    await Tone.start();
    buildAudioGraph();
    Tone.getTransport().start();
    started = true;
    return true;
  } else {
    Tone.getTransport().pause();
    started = false;
    return false;
  }
}

export function isPlaying() {
  return started;
}

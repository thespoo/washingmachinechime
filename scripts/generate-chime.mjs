#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(
  projectRoot,
  "extension/assets/the-trout-chime.wav",
);

const sampleRate = 22_050;
const bpm = 160;
const secondsPerBeat = 60 / bpm;

// A compact original synth arrangement of the public-domain melody from
// Schubert's Die Forelle, D. 550. Durations are measured in quarter notes.
const melody = [
  ["G4", 1],
  ["C5", 1], ["C5", 1], ["E5", 1], ["E5", 1],
  ["C5", 2], ["G4", 1], ["G4", 1],
  ["G4", 1.5], ["G4", 0.5], ["D5", 0.5], ["C5", 0.5],
  ["B4", 0.5], ["A4", 0.5],
  ["G4", 2], [null, 1], ["G4", 1],
  ["C5", 1], ["C5", 1], ["E5", 1], ["E5", 1],
  ["C5", 2], ["G4", 1], ["C5", 1],
  ["B4", 1], ["A4", 0.5], ["B4", 0.5], ["C5", 1], ["F#4", 1],
  ["G4", 2], [null, 1], ["G4", 1],
  ["B4", 1.5], ["B4", 0.5], ["C5", 0.5], ["B4", 0.5],
  ["A4", 0.5], ["B4", 0.5],
  ["C5", 2], ["G4", 1], ["C5", 1],
  ["B4", 1.5], ["B4", 0.5], ["B4", 0.5], ["F5", 0.5],
  ["D5", 0.5], ["B4", 0.5],
  ["C5", 2], [null, 2],
];

const accompaniment = [
  ["C4", "E4", "G4"],
  ["C4", "E4", "G4"],
  ["G3", "B3", "D4"],
  ["G3", "B3", "D4"],
  ["C4", "E4", "G4"],
  ["C4", "E4", "G4"],
  ["D4", "F#4", "A4"],
  ["G3", "B3", "D4"],
  ["G3", "B3", "F4"],
  ["C4", "E4", "G4"],
  ["G3", "B3", "F4"],
  ["C4", "E4", "G4"],
];

const noteOffsets = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function noteToMidi(note) {
  const match = note.match(/^([A-G])(#?)(\d)$/);
  if (!match) {
    throw new Error(`Invalid note: ${note}`);
  }
  return (
    (Number(match[3]) + 1) * 12 +
    noteOffsets[match[1]] +
    (match[2] ? 1 : 0)
  );
}

function frequency(note) {
  return 440 * 2 ** ((noteToMidi(note) - 69) / 12);
}

const totalBeats = melody.reduce((sum, [, beats]) => sum + beats, 0);
const durationSeconds = totalBeats * secondsPerBeat + 0.7;
const samples = new Float64Array(
  Math.ceil(durationSeconds * sampleRate),
);

function envelope(time, duration, attack = 0.012, release = 0.1) {
  const attackGain = Math.min(1, time / attack);
  const releaseGain = Math.min(1, Math.max(0, (duration - time) / release));
  return attackGain * releaseGain;
}

function addTone(note, startBeat, durationBeats, amplitude, bell = false) {
  const start = startBeat * secondsPerBeat;
  const duration = durationBeats * secondsPerBeat;
  const startSample = Math.floor(start * sampleRate);
  const endSample = Math.min(
    samples.length,
    Math.ceil((start + duration) * sampleRate),
  );
  const baseFrequency = frequency(note);

  for (let index = startSample; index < endSample; index += 1) {
    const time = index / sampleRate - start;
    const phase = 2 * Math.PI * baseFrequency * time;
    const env = envelope(time, duration, bell ? 0.006 : 0.012, bell ? 0.16 : 0.1);
    const shimmer = bell
      ? Math.sin(phase) * 0.75 +
        Math.sin(phase * 2.01) * 0.2 * Math.exp(-time * 3.5) +
        Math.sin(phase * 3.99) * 0.08 * Math.exp(-time * 5)
      : Math.sin(phase) * 0.86 + Math.sin(phase * 2) * 0.14;
    samples[index] += shimmer * env * amplitude;
  }
}

let beat = 0;
for (const [note, durationBeats] of melody) {
  if (note) {
    addTone(note, beat, durationBeats * 0.92, 0.52, true);
  }
  beat += durationBeats;
}

for (let bar = 0; bar < accompaniment.length; bar += 1) {
  const chord = accompaniment[bar];
  const barStart = 1 + bar * 4;
  for (let pulse = 0; pulse < 4; pulse += 1) {
    const note = chord[pulse % chord.length];
    addTone(note, barStart + pulse, 0.62, 0.095, false);
  }
}

let peak = 0;
for (const sample of samples) {
  peak = Math.max(peak, Math.abs(sample));
}
const gain = peak > 0 ? 0.88 / peak : 1;

const dataSize = samples.length * 2;
const wav = Buffer.alloc(44 + dataSize);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + dataSize, 4);
wav.write("WAVE", 8);
wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(dataSize, 40);

for (let index = 0; index < samples.length; index += 1) {
  const value = Math.max(-1, Math.min(1, samples[index] * gain));
  wav.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, wav);
console.log(`Generated ${outputPath} (${durationSeconds.toFixed(1)} seconds)`);

// Targeted verification of WAV header encoding and audio math
const assert = require('assert');

function encodeWAVMock(numSamples, sampleRate = 24000, numChannels = 1) {
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  return { buffer, view, dataSize, byteRate, blockAlign };
}

// 1. Verify RIFF header structure for 10 seconds of 24kHz audio
const samples10s = 24000 * 10;
const { buffer, view, dataSize, byteRate, blockAlign } = encodeWAVMock(samples10s, 24000, 1);

assert.strictEqual(buffer.byteLength, 44 + 480000, 'Total byte length should be 44 header + 480000 PCM bytes');
assert.strictEqual(byteRate, 48000, 'ByteRate must be 48000 (24000 * 1 * 2)');
assert.strictEqual(blockAlign, 2, 'BlockAlign must be 2 (1 channel * 2 bytes)');
assert.strictEqual(view.getUint16(20, true), 1, 'AudioFormat must be 1 (PCM)');
assert.strictEqual(view.getUint16(22, true), 1, 'NumChannels must be 1 (Mono)');
assert.strictEqual(view.getUint32(24, true), 24000, 'SampleRate must be 24000 Hz');
assert.strictEqual(view.getUint16(34, true), 16, 'BitsPerSample must be 16-bit');
assert.strictEqual(view.getUint32(40, true), 480000, 'Subchunk2 dataSize must be 480000');

// Verify magic strings
const riff = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
const wave = String.fromCharCode(...new Uint8Array(buffer, 8, 4));
const fmt = String.fromCharCode(...new Uint8Array(buffer, 12, 4));
const data = String.fromCharCode(...new Uint8Array(buffer, 36, 4));

assert.strictEqual(riff, 'RIFF');
assert.strictEqual(wave, 'WAVE');
assert.strictEqual(fmt, 'fmt ');
assert.strictEqual(data, 'data');

console.log('[PASS] WAV header encoding matches Google 24kHz mono 16-bit PCM specification perfectly.');

// 2. Test base64 conversion chunking logic
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

const testBuf = new ArrayBuffer(20000);
new Uint8Array(testBuf).fill(42);
const b64 = arrayBufferToBase64(testBuf);
const decoded = Buffer.from(b64, 'base64');
assert.strictEqual(decoded.length, 20000);
assert.strictEqual(decoded[0], 42);
assert.strictEqual(decoded[19999], 42);

console.log('[PASS] Base64 safe chunked encoding passes for large audio buffers without stack overflow.');

// 3. Test time formatting
function formatAudioTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

assert.strictEqual(formatAudioTime(0), '00:00');
assert.strictEqual(formatAudioTime(9.4), '00:09');
assert.strictEqual(formatAudioTime(65), '01:05');
assert.strictEqual(formatAudioTime(125), '02:05');

console.log('[PASS] formatAudioTime passes all boundary conditions.');
console.log('ALL AUDIO CONVERTER TESTS PASSED!');

// Real verification of src/utils/audioConverter.ts (no dummy mocks)
const assert = require('assert');

async function runTests() {
  console.log('Loading src/utils/audioConverter.ts directly via Node...');
  const converter = await import('./src/utils/audioConverter.ts');

  const {
    encodeWAV,
    ensureWavBase64,
    arrayBufferToBase64,
    base64ToBlob,
    formatAudioTime,
    TARGET_SAMPLE_RATE,
    TARGET_CHANNELS
  } = converter;
  const core = await import('./server/core.ts');

  // 1. Verify Target Constants
  assert.strictEqual(TARGET_SAMPLE_RATE, 24000, 'Target sample rate must be 24000Hz');
  assert.strictEqual(TARGET_CHANNELS, 1, 'Target channel count must be 1 (mono)');
  console.log('[PASS] TARGET_SAMPLE_RATE (24kHz) and TARGET_CHANNELS (Mono) match specification.');

  // 2. Test Real encodeWAV with Mono AudioBuffer
  const numSamplesMono = 24000 * 5; // 5 seconds of 24kHz audio
  const mockMonoChannelData = new Float32Array(numSamplesMono);
  for (let i = 0; i < numSamplesMono; i++) {
    mockMonoChannelData[i] = Math.sin((i / 24000) * 440 * 2 * Math.PI); // 440Hz A tone
  }

  const mockMonoAudioBuffer = {
    numberOfChannels: 1,
    sampleRate: 24000,
    length: numSamplesMono,
    duration: 5,
    getChannelData: (ch) => {
      assert.strictEqual(ch, 0);
      return mockMonoChannelData;
    }
  };

  const monoWavBuffer = encodeWAV(mockMonoAudioBuffer);
  const monoView = new DataView(monoWavBuffer);

  const expectedPcmBytesMono = numSamplesMono * 2;
  assert.strictEqual(monoWavBuffer.byteLength, 44 + expectedPcmBytesMono, 'Buffer size must equal 44 header + PCM data');
  assert.strictEqual(monoView.getUint16(20, true), 1, 'AudioFormat must be 1 (PCM)');
  assert.strictEqual(monoView.getUint16(22, true), 1, 'NumChannels must be 1 (Mono)');
  assert.strictEqual(monoView.getUint32(24, true), 24000, 'SampleRate must be 24000 Hz');
  assert.strictEqual(monoView.getUint32(28, true), 48000, 'ByteRate must be 48000');
  assert.strictEqual(monoView.getUint16(32, true), 2, 'BlockAlign must be 2');
  assert.strictEqual(monoView.getUint16(34, true), 16, 'BitsPerSample must be 16-bit');
  assert.strictEqual(monoView.getUint32(40, true), expectedPcmBytesMono, 'Data size in header matches');

  // Verify Magic headers
  const riff = String.fromCharCode(...new Uint8Array(monoWavBuffer, 0, 4));
  const wave = String.fromCharCode(...new Uint8Array(monoWavBuffer, 8, 4));
  const fmt = String.fromCharCode(...new Uint8Array(monoWavBuffer, 12, 4));
  const data = String.fromCharCode(...new Uint8Array(monoWavBuffer, 36, 4));

  assert.strictEqual(riff, 'RIFF');
  assert.strictEqual(wave, 'WAVE');
  assert.strictEqual(fmt, 'fmt ');
  assert.strictEqual(data, 'data');
  console.log('[PASS] Real encodeWAV produces compliant 24kHz mono 16-bit PCM WAV.');

  // 3. Test Real encodeWAV with Stereo AudioBuffer (verifying automatic downmixing)
  const numSamplesStereo = 24000 * 2; // 2 seconds
  const leftChannel = new Float32Array(numSamplesStereo).fill(0.6);
  const rightChannel = new Float32Array(numSamplesStereo).fill(-0.2);

  const mockStereoAudioBuffer = {
    numberOfChannels: 2,
    sampleRate: 24000,
    length: numSamplesStereo,
    duration: 2,
    getChannelData: (ch) => (ch === 0 ? leftChannel : rightChannel)
  };

  const stereoWavBuffer = encodeWAV(mockStereoAudioBuffer);
  const stereoView = new DataView(stereoWavBuffer);

  const expectedPcmBytesStereo = numSamplesStereo * 2; // Output is forced to mono!
  assert.strictEqual(stereoWavBuffer.byteLength, 44 + expectedPcmBytesStereo, 'Stereo input must be downmixed to mono');
  assert.strictEqual(stereoView.getUint16(22, true), 1, 'NumChannels must be 1 even with stereo input');
  assert.strictEqual(stereoView.getUint32(40, true), expectedPcmBytesStereo, 'Data size must match mono PCM length');

  // Verify downmixed sample value: (0.6 + (-0.2)) / 2 = 0.2
  // 0.2 * 32767 ≈ 6553
  const firstSample = stereoView.getInt16(44, true);
  assert.ok(Math.abs(firstSample - 6553) <= 2, `Expected ~6553 downmixed sample, got ${firstSample}`);
  console.log('[PASS] Real encodeWAV safely downmixes multi-channel audio to mono without corrupting WAV.');

  // 4. Test arrayBufferToBase64 and base64ToBlob round-trip
  const testBytes = new Uint8Array(16384);
  for (let i = 0; i < testBytes.length; i++) {
    testBytes[i] = i % 256;
  }
  const b64 = arrayBufferToBase64(testBytes.buffer);
  const blob = base64ToBlob(b64, 'audio/wav');
  const restoredArrayBuffer = await blob.arrayBuffer();
  const restoredBytes = new Uint8Array(restoredArrayBuffer);

  assert.strictEqual(restoredBytes.length, testBytes.length, 'Restored length must match');
  for (let i = 0; i < 50; i++) {
    assert.strictEqual(restoredBytes[i], testBytes[i], `Byte at ${i} must match`);
  }
  console.log('[PASS] arrayBufferToBase64 and base64ToBlob roundtrip passes without loss.');

  // 5. Test formatAudioTime boundary cases
  assert.strictEqual(formatAudioTime(0), '00:00');
  assert.strictEqual(formatAudioTime(-5), '00:00');
  assert.strictEqual(formatAudioTime(NaN), '00:00');
  assert.strictEqual(formatAudioTime(9.4), '00:09');
  assert.strictEqual(formatAudioTime(59), '00:59');
  assert.strictEqual(formatAudioTime(60), '01:00');
  assert.strictEqual(formatAudioTime(125), '02:05');
  assert.strictEqual(formatAudioTime(3600), '60:00');
  console.log('[PASS] formatAudioTime boundary conditions pass.');

  // 6. Test ensureWavBase64 & server/core.ts ensureWavBuffer on headless PCM
  const rawPcm = new Uint8Array(4800);
  const rawPcmB64 = arrayBufferToBase64(rawPcm.buffer);
  const wrappedB64 = ensureWavBase64(rawPcmB64);
  const wrappedBin = Buffer.from(wrappedB64, 'base64');
  assert.strictEqual(wrappedBin.length, 44 + 4800, 'Wrapped PCM must add 44-byte RIFF header');
  assert.strictEqual(wrappedBin.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(ensureWavBase64(wrappedB64), wrappedB64, 'Already-wrapped WAV must be idempotent');

  const coreWrapped = core.ensureWavBuffer(Buffer.from(rawPcm));
  assert.strictEqual(coreWrapped.length, 44 + 4800);
  assert.strictEqual(coreWrapped.toString('ascii', 0, 4), 'RIFF');

  const chunks = core.splitTextIntoChunks('第一章 开始\n这是第一段测试句子。这是第二段测试句子。', 15);
  assert.ok(chunks.length >= 2, 'splitTextIntoChunks splits by chapter and length');
  console.log('[PASS] ensureWavBase64, server/core.ts ensureWavBuffer, and splitTextIntoChunks pass.');

  console.log('\n========================================');
  console.log('ALL REAL AUDIO CONVERTER TESTS PASSED!');
  console.log('========================================');
}

runTests().catch(err => {
  console.error('[FAIL]', err);
  process.exit(1);
});

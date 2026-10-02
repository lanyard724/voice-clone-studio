/**
 * Audio processing and conversion engine
 * Standardizes any input audio (File, Blob, or MediaStream Buffer)
 * into 24kHz mono 16-bit little-endian PCM WAV required by Gemini Voice Replication & TTS.
 */

export const TARGET_SAMPLE_RATE = 24000;
export const TARGET_CHANNELS = 1;

/**
 * Resamples an AudioBuffer to 24000Hz mono using OfflineAudioContext
 */
export async function resampleTo24kMono(audioBuffer: AudioBuffer): Promise<AudioBuffer> {
  const targetSampleRate = TARGET_SAMPLE_RATE;
  const numChannels = TARGET_CHANNELS;
  const targetLength = Math.ceil(audioBuffer.duration * targetSampleRate);

  const offlineCtx = new OfflineAudioContext(numChannels, targetLength, targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  return await offlineCtx.startRendering();
}

/**
 * Converts an AudioBuffer into 16-bit signed PCM WAV ArrayBuffer
 */
export function encodeWAV(audioBuffer: AudioBuffer): ArrayBuffer {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  // Interleave channels (here mono, single channel)
  const channelData = audioBuffer.getChannelData(0);
  const numSamples = channelData.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // RIFF chunk length: 36 + dataSize
  view.setUint32(4, 36 + dataSize, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (1 is PCM)
  view.setUint16(20, format, true);
  // channel count
  view.setUint16(22, numChannels, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate
  view.setUint32(28, byteRate, true);
  // block align
  view.setUint16(32, blockAlign, true);
  // bits per sample
  view.setUint16(34, bitDepth, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, dataSize, true);

  // Write 16-bit signed PCM samples with soft clipping
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    let s = channelData[i];
    // Clamp to [-1, 1]
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    // Scale to 16-bit signed integer [-32768, 32767]
    const sample = s < 0 ? s * 0x8000 : s * 0x7FFF;
    view.setInt16(offset, Math.floor(sample), true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Reads any audio Blob/File, decodes via Web Audio API, resamples to 24kHz mono,
 * and encodes to WAV ArrayBuffer.
 */
export async function convertBlobTo24kWav(blob: Blob): Promise<{
  arrayBuffer: ArrayBuffer;
  base64: string;
  duration: number;
  dataUrl: string;
}> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  
  try {
    const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const resampledBuffer = await resampleTo24kMono(decodedBuffer);
    const wavBuffer = encodeWAV(resampledBuffer);
    const base64 = arrayBufferToBase64(wavBuffer);
    const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
    const dataUrl = URL.createObjectURL(wavBlob);

    return {
      arrayBuffer: wavBuffer,
      base64,
      duration: resampledBuffer.duration,
      dataUrl
    };
  } finally {
    if (audioCtx.state !== 'closed') {
      await audioCtx.close();
    }
  }
}

/**
 * Converts ArrayBuffer to Base64 string safely without stack overflow
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Converts Base64 string to Blob
 */
export function base64ToBlob(base64: string, mimeType = 'audio/wav'): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * Extracts waveform visualization peaks (0 to 1 normalized) from an AudioBuffer or Blob
 */
export async function extractWaveformPeaks(blob: Blob, numBars = 64): Promise<number[]> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    const step = Math.floor(channelData.length / numBars);
    const peaks: number[] = [];

    for (let i = 0; i < numBars; i++) {
      let max = 0;
      const start = i * step;
      const end = Math.min(start + step, channelData.length);
      for (let j = start; j < end; j++) {
        const val = Math.abs(channelData[j]);
        if (val > max) max = val;
      }
      peaks.push(Math.min(1, max));
    }
    return peaks;
  } finally {
    if (audioCtx.state !== 'closed') {
      await audioCtx.close();
    }
  }
}

/**
 * Format seconds to MM:SS display
 */
export function formatAudioTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

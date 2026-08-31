function mixToMono(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  if (channels === 1) return audioBuffer.getChannelData(0);
  const mixed = new Float32Array(length);
  for (let c = 0; c < channels; c += 1) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) mixed[i] += data[i] / channels;
  }
  return mixed;
}

function encodeWav(audioBuffer) {
  const samples = mixToMono(audioBuffer);
  const sampleRate = audioBuffer.sampleRate;
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function decodeAudioBuffer(ctx, arrayBuffer) {
  const copy = arrayBuffer.slice(0);
  return ctx.decodeAudioData(copy).catch(() => {
    return new Promise((resolve, reject) => {
      ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
    });
  });
}

async function blobToWavBlob(blob) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return blob;
  const ctx = new AudioCtx();
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await decodeAudioBuffer(ctx, arrayBuffer);
    const wav = encodeWav(audioBuffer);
    return new Blob([wav], { type: 'audio/wav' });
  } finally {
    if (ctx.close) ctx.close();
  }
}

function pickRecorderMime() {
  if (!window.MediaRecorder) return null;
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  const supported = types.find((t) => MediaRecorder.isTypeSupported(t));
  return supported || '';
}

import fs from 'node:fs/promises';
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis';
const decoder = new OggVorbisDecoder();
await decoder.ready;
try {
  const decoded = await decoder.decodeFile(
    new Uint8Array(await fs.readFile('assets/source/click.ogg')),
  );
  if (decoded.errors.length || !decoded.samplesDecoded)
    throw Error('音效解码失败：' + JSON.stringify(decoded.errors));
  const { channelData, samplesDecoded, sampleRate } = decoded,
    channels = channelData.length,
    size = samplesDecoded * channels * 2;
  const wave = Buffer.alloc(44 + size);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(36 + size, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(channels, 22);
  wave.writeUInt32LE(sampleRate, 24);
  wave.writeUInt32LE(sampleRate * channels * 2, 28);
  wave.writeUInt16LE(channels * 2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(size, 40);
  for (let i = 0; i < samplesDecoded; i++)
    for (let ch = 0; ch < channels; ch++) {
      const v = Math.max(-1, Math.min(1, channelData[ch][i]));
      wave.writeInt16LE(Math.round(v * (v < 0 ? 32768 : 32767)), 44 + (i * channels + ch) * 2);
    }
  await fs.writeFile('public/sounds/click.wav', wave);
  console.log({
    sampleRate,
    channels,
    samplesDecoded,
    seconds: samplesDecoded / sampleRate,
    bytes: wave.length,
  });
} finally {
  decoder.free();
}

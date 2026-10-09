import pLimit from 'p-limit';

const limit = pLimit(2);

// Default to 'EXAVITQu4vr4xnSDxMaL' (Sarah - Reassuring Naturalist, premade voice supported on all free/paid tiers)
const PREMADE_FALLBACK_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

/**
 * Generates a valid 16-bit PCM WAV audio buffer in pure TypeScript/JavaScript.
 */
export function generateFallbackChimeWav(frequency: number = 528, durationSeconds: number = 3.0): Buffer {
  const sampleRate = 22050;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataByteSize = numSamples * numChannels * (bitsPerSample / 8);
  const totalBufferSize = 44 + dataByteSize;

  const buffer = Buffer.alloc(totalBufferSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataByteSize, 4);
  buffer.write('WAVE', 8);

  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  buffer.write('data', 36);
  buffer.writeUInt32LE(dataByteSize, 40);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 1.5) * Math.sin(Math.min(1, t * 20) * (Math.PI / 2));
    const wave =
      0.6 * Math.sin(2 * Math.PI * frequency * t) +
      0.3 * Math.sin(2 * Math.PI * frequency * 1.5 * t) +
      0.1 * Math.sin(2 * Math.PI * frequency * 2 * t);

    const sample = Math.max(-1, Math.min(1, wave * envelope));
    const intSample = Math.round(sample * 32767);
    buffer.writeInt16LE(intSample, offset);
    offset += 2;
  }

  return buffer;
}

/**
 * Synthesizes speech using ElevenLabs API or falls back to lightweight WAV chime.
 * Explicitly returns Promise<Buffer>.
 */
export async function synthesizeAudio(
  text: string,
  _waypointId: string = 'wp',
  index: number = 0
): Promise<Buffer> {
  const rawKey = process.env.ELEVENLABS_API_KEY;
  const apiKey = rawKey ? rawKey.replace(/^["']|["']$/g, '').trim() : '';

  if (apiKey && apiKey.length > 5) {
    try {
      const audioBuffer = await limit(async () => {
        let voiceId = (process.env.ELEVENLABS_VOICE_ID || PREMADE_FALLBACK_VOICE_ID)
          .replace(/^["']|["']$/g, '')
          .trim();

        console.log(`[ElevenLabs API] Synthesizing speech with voice "${voiceId}"...`);

        let response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg'
          },
          body: JSON.stringify({
            text: text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.8
            }
          })
        });

        // If library voice returned 402 Payment Required (e.g. Free accounts), auto-retry with premade voice
        if (response.status === 402 && voiceId !== PREMADE_FALLBACK_VOICE_ID) {
          console.warn(
            `[ElevenLabs API] Voice "${voiceId}" requires paid plan (HTTP 402). Retrying with premade voice "${PREMADE_FALLBACK_VOICE_ID}"...`
          );
          voiceId = PREMADE_FALLBACK_VOICE_ID;
          response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
              'xi-api-key': apiKey,
              'Content-Type': 'application/json',
              Accept: 'audio/mpeg'
            },
            body: JSON.stringify({
              text: text,
              model_id: 'eleven_multilingual_v2',
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.8
              }
            })
          });
        }

        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const buf = Buffer.from(arrayBuffer);
          console.log(`[ElevenLabs API] ✓ Successfully generated ${buf.byteLength} bytes of MP3 audio!`);
          return buf;
        } else {
          const errorDetails = await response.text();
          console.warn(`[ElevenLabs API Warning: HTTP ${response.status}] ${errorDetails}`);
          return null;
        }
      });

      if (audioBuffer) {
        return audioBuffer;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[ElevenLabs API Error]', message, 'Falling back to chime audio.');
    }
  } else {
    console.log('[ElevenLabs API] No ELEVENLABS_API_KEY detected. Using chime audio fallback.');
  }

  const chimePitches = [528, 594, 660, 792, 880, 1056];
  const pitch = chimePitches[index % chimePitches.length] ?? 528;
  return generateFallbackChimeWav(pitch, 3.2);
}

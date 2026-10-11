import fs from 'fs';
import path from 'path';
import archiver from '../server/node_modules/archiver/index.js';

// Ensure client/public/trails exists
const outputDir = path.resolve(process.cwd(), 'client/public/trails');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Read ElevenLabs API key if available
let apiKey = '';
try {
  const envContent = fs.readFileSync('server/.env', 'utf8');
  const match = envContent.match(/ELEVENLABS_API_KEY=(.*)/);
  if (match) apiKey = match[1].replace(/^["']|["']$/g, '').trim();
} catch (e) {
  console.log('No .env found, will use fallback chime');
}

function generateFallbackChimeWav(frequency = 528, durationSeconds = 3.0) {
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

async function synthesizeSpeech(text, fallbackFreq) {
  if (apiKey && apiKey.length > 10) {
    try {
      console.log(`[ElevenLabs] Synthesizing speech: "${text.slice(0, 35)}..."`);
      const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL', {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg'
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.8 }
        })
      });
      if (res.ok) {
        const ab = await res.arrayBuffer();
        return { buffer: Buffer.from(ab), isMp3: true };
      }
      console.warn(`[ElevenLabs] API returned ${res.status}, using pleasant chime`);
    } catch (err) {
      console.warn('[ElevenLabs] Fetch failed, using pleasant chime');
    }
  }
  return { buffer: generateFallbackChimeWav(fallbackFreq, 3.5), isMp3: false };
}

async function createTrailZip(manifest, audioItems, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`✓ Created: ${zipPath} (${archive.pointer()} total bytes)`);
      resolve();
    });
    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    const manifestJson = JSON.stringify(manifest, null, 2);
    archive.append(manifestJson, { name: 'manifest.json' });
    archive.append(manifestJson, { name: 'trail_manifest.json' });

    for (const item of audioItems) {
      archive.append(item.buffer, { name: item.path });
    }

    archive.finalize();
  });
}

async function buildAll() {
  console.log('--- Generating Red Fort Trail Bundle ---');
  const rfAudio1 = await synthesizeSpeech(
    'Welcome to the Lahori Gate, the grand ceremonial entrance of the Red Fort. Built of vibrant red sandstone under Shah Jahan in 1648, these imposing battlements once guarded the imperial Mughal capital of Shahjahanabad.',
    528
  );
  const rfAudio2 = await synthesizeSpeech(
    "Step into Chhatta Chowk, Delhi's historic seventeenth-century covered market. Inspired by Persian bazaars in Isfahan, royal merchants once gathered under these vaulted arches trading luxurious silks, velvets, and precious jewels.",
    660
  );

  const redFortManifest = {
    trail_id: 'red-fort',
    trail_name: 'Red Fort Quick Tour',
    generated_at: new Date().toISOString(),
    total_distance_km: 0.35,
    waypoints: [
      {
        id: 'wp_lahori_gate',
        name: 'Lahori Gate Entrance',
        lat: 28.65586,
        lon: 77.23851,
        trigger_radius_meters: 40,
        audio_file: rfAudio1.isMp3 ? 'audio/wp_lahori_gate.mp3' : 'audio/wp_lahori_gate.wav',
        transcript:
          'Welcome to the Lahori Gate, the grand ceremonial entrance of the Red Fort. Built of vibrant red sandstone under Shah Jahan in 1648, these imposing battlements once guarded the imperial Mughal capital of Shahjahanabad.',
        cooldown_seconds: 600
      },
      {
        id: 'wp_chhatta_chowk',
        name: 'Chhatta Chowk Covered Bazaar',
        lat: 28.6562,
        lon: 77.24102,
        trigger_radius_meters: 40,
        audio_file: rfAudio2.isMp3 ? 'audio/wp_chhatta_chowk.mp3' : 'audio/wp_chhatta_chowk.wav',
        transcript:
          "Step into Chhatta Chowk, Delhi's historic seventeenth-century covered market. Inspired by Persian bazaars in Isfahan, royal merchants once gathered under these vaulted arches trading luxurious silks, velvets, and precious jewels.",
        cooldown_seconds: 600
      }
    ]
  };

  await createTrailZip(
    redFortManifest,
    [
      { path: redFortManifest.waypoints[0].audio_file, buffer: rfAudio1.buffer },
      { path: redFortManifest.waypoints[1].audio_file, buffer: rfAudio2.buffer }
    ],
    path.join(outputDir, 'red-fort.zip')
  );

  console.log("--- Generating Humayun's Tomb Trail Bundle ---");
  const htAudio1 = await synthesizeSpeech(
    'Before you stands the octagonal tomb of noble Isa Khan Niyazi, completed in 1547. Adorned with sunken arched recesses and glazed tiles, this exquisite pre-Mughal monument predates the main imperial complex.',
    440
  );
  const htAudio2 = await synthesizeSpeech(
    "Entering the monumental West Gate portal, you overlook India's first classical Mughal charbagh garden. Built by Empress Bega Begum, this four-quadrant paradise garden directly inspired the architecture of the Taj Mahal.",
    587
  );

  const humayunManifest = {
    trail_id: 'humayuns-tomb',
    trail_name: "Humayun's Tomb Garden",
    generated_at: new Date().toISOString(),
    total_distance_km: 0.4,
    waypoints: [
      {
        id: 'wp_isa_khan_tomb',
        name: 'Isa Khan Octagonal Tomb',
        lat: 28.59212,
        lon: 77.24823,
        trigger_radius_meters: 40,
        audio_file: htAudio1.isMp3 ? 'audio/wp_isa_khan_tomb.mp3' : 'audio/wp_isa_khan_tomb.wav',
        transcript:
          'Before you stands the octagonal tomb of noble Isa Khan Niyazi, completed in 1547. Adorned with sunken arched recesses and glazed tiles, this exquisite pre-Mughal monument predates the main imperial complex.',
        cooldown_seconds: 600
      },
      {
        id: 'wp_west_gate_portal',
        name: 'West Gate Garden Portal',
        lat: 28.5933,
        lon: 77.24945,
        trigger_radius_meters: 40,
        audio_file: htAudio2.isMp3 ? 'audio/wp_west_gate_portal.mp3' : 'audio/wp_west_gate_portal.wav',
        transcript:
          "Entering the monumental West Gate portal, you overlook India's first classical Mughal charbagh garden. Built by Empress Bega Begum, this four-quadrant paradise garden directly inspired the architecture of the Taj Mahal.",
        cooldown_seconds: 600
      }
    ]
  };

  await createTrailZip(
    humayunManifest,
    [
      { path: humayunManifest.waypoints[0].audio_file, buffer: htAudio1.buffer },
      { path: humayunManifest.waypoints[1].audio_file, buffer: htAudio2.buffer }
    ],
    path.join(outputDir, 'humayuns-tomb.zip')
  );

  // Also copy to client/dist/trails if client/dist exists
  const distTrails = path.resolve(process.cwd(), 'client/dist/trails');
  if (fs.existsSync(path.resolve(process.cwd(), 'client/dist'))) {
    if (!fs.existsSync(distTrails)) {
      fs.mkdirSync(distTrails, { recursive: true });
    }
    fs.copyFileSync(path.join(outputDir, 'red-fort.zip'), path.join(distTrails, 'red-fort.zip'));
    fs.copyFileSync(path.join(outputDir, 'humayuns-tomb.zip'), path.join(distTrails, 'humayuns-tomb.zip'));
    console.log('✓ Synced to client/dist/trails/');
  }

  console.log('✅ Done! Both sample trail bundles generated successfully.');
}

buildAll().catch((err) => {
  console.error('Failed to generate bundles:', err);
  process.exit(1);
});

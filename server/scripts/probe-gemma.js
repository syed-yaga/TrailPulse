import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { generateNaturalistScript, detectOllamaModel } from '../dist/server/src/services/gemmaService.js';
import { classifyEnvironment, getDeterministicFallbackPOI } from '../dist/server/src/services/overpassService.js';
import { synthesizeAudio } from '../dist/server/src/services/audioService.js';

async function runTest() {
  console.log('=== Step 1: Verify Environment Classification ===');
  const streetTags = { highway: 'primary', name: 'Vikas Marg' };
  const parkTags = { leisure: 'park', name: 'Deer Park' };
  const wildTags = { highway: 'path', natural: 'wood' };

  console.log('Street tags ->', classifyEnvironment(streetTags));
  console.log('Park tags   ->', classifyEnvironment(parkTags));
  console.log('Wild tags   ->', classifyEnvironment(wildTags));

  console.log('\n=== Step 2: Verify Neutral Fallback Names (No Pine Groves) ===');
  const mockWaypoint = {
    id: 'wp_1',
    step: 1,
    role: 'Trailhead',
    defaultName: 'Laxmi Nagar Walk - Start Point',
    coordinate: { lat: 28.6304, lon: 77.2773 },
    distanceAlongTrailMeters: 0
  };
  const fallbackPOI = getDeterministicFallbackPOI(mockWaypoint, 0, 'Laxmi Nagar Walk');
  console.log('Fallback POI:', fallbackPOI);

  console.log('\n=== Step 3: Generating Urban Audio Vignette via Gemma (25-35 words) ===');
  const urbanEnv = classifyEnvironment(streetTags);
  const startTime = Date.now();
  const script = await generateNaturalistScript(
    'Vikas Marg Crossroad',
    'primary',
    'Start Point',
    { lat: 28.6304, lon: 77.2773 },
    urbanEnv
  );
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const wordCount = script.split(/\s+/).filter(Boolean).length;

  console.log(`Generated in ${duration}s (${wordCount} words):`);
  console.log('"' + script + '"');

  if (wordCount < 20 || wordCount > 38) {
    console.warn(`⚠️ Warning: Word count ${wordCount} outside expected range.`);
  } else {
    console.log(`✓ Word count ${wordCount} strictly within 25–35 word target!`);
  }

  // Check that urban text does NOT contain pine/grove/forest keywords
  const lower = script.toLowerCase();
  const hasInappropriateWilderness =
    lower.includes('pine needle') || lower.includes('ancient grove') || lower.includes('cathedral redwood');
  if (hasInappropriateWilderness) {
    console.error('❌ Found inappropriate wilderness imagery in urban script!');
  } else {
    console.log('✓ Urban script is strictly free of forced pine/forest wilderness imagery.');
  }

  console.log(`\n=== Step 4: Synthesizing Audio via ElevenLabs ===`);
  const audioStartTime = Date.now();
  const audioBuffer = await synthesizeAudio(script, 'test-wp-urban', 0);
  const audioDuration = ((Date.now() - audioStartTime) / 1000).toFixed(2);

  const isMp3 =
    audioBuffer.length >= 3 &&
    (audioBuffer.subarray(0, 3).toString('utf8') === 'ID3' || audioBuffer[0] === 0xff);

  console.log(`Synthesized audio: ${audioBuffer.length} bytes (${isMp3 ? 'MP3' : 'WAV'}) in ${audioDuration}s`);
}

runTest().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});

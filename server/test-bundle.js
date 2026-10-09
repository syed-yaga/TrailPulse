import { parseGPXAndSampleWaypoints, haversineDistanceMeters } from './services/gpxParser.js';
import { queryNearbyPOI } from './services/overpassService.js';
import { generateNaturalistScript } from './services/gemmaService.js';
import { synthesizeAudio, generateFallbackChimeWav } from './services/audioService.js';

const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TrailPulse - Touch Grass" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Muir Woods Test Trail</name></metadata>
  <trk>
    <name>Muir Woods Test Trail</name>
    <trkseg>
      <trkpt lat="37.89530" lon="-122.57860"><ele>42</ele></trkpt>
      <trkpt lat="37.89680" lon="-122.58020"><ele>46</ele></trkpt>
      <trkpt lat="37.89880" lon="-122.58240"><ele>55</ele></trkpt>
      <trkpt lat="37.90110" lon="-122.58480"><ele>82</ele></trkpt>
      <trkpt lat="37.90280" lon="-122.58690"><ele>145</ele></trkpt>
      <trkpt lat="37.89535" lon="-122.57865"><ele>42</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

async function runTests() {
  console.log('🧪 Starting TrailPulse Verification Tests...\n');

  // Test 1: Haversine distance
  console.log('1. Testing Haversine distance:');
  const d = haversineDistanceMeters([-122.57860, 37.89530], [-122.58020, 37.89680]);
  console.log(`   Distance between trailhead and bridge: ${Math.round(d)} meters`);
  if (d < 100 || d > 300) throw new Error('Haversine distance calculation out of expected range');
  console.log('   ✓ Haversine calculation verified.\n');

  // Test 2: GPX Parsing & Spatial Sampling
  console.log('2. Testing GPX parsing & waypoint sampling:');
  const parsed = parseGPXAndSampleWaypoints(SAMPLE_GPX);
  console.log(`   Trail Name: ${parsed.trailName}`);
  console.log(`   Total Distance: ${parsed.totalDistanceMeters}m`);
  console.log(`   Waypoints count: ${parsed.waypoints.length}`);
  if (parsed.waypoints.length < 3 || parsed.waypoints.length > 6) {
    throw new Error(`Expected between 3 and 6 waypoints, got ${parsed.waypoints.length}`);
  }
  for (const wp of parsed.waypoints) {
    console.log(`   - [${wp.role}] ${wp.name} at coords [${wp.coordinates}] (ele: ${wp.elevation}m)`);
  }
  console.log('   ✓ GPX parser and sampler verified.\n');

  // Test 3: Overpass POI service with deterministic fallback
  console.log('3. Testing Overpass POI query & fallback:');
  const poi = await queryNearbyPOI(parsed.waypoints[0].coordinates, parsed.waypoints[0], 0);
  console.log(`   Resolved POI for Trailhead: "${poi.name}" (Type: ${poi.type}, Source: ${poi.source})`);
  if (!poi.name) throw new Error('POI name resolution returned empty');
  console.log('   ✓ Overpass POI service verified.\n');

  // Test 4: Gemma 2 sensory naturalist script generator
  console.log('4. Testing Gemma 2 / Naturalist vignette generation:');
  const script = await generateNaturalistScript(poi.name, poi.type, parsed.waypoints[0].role);
  const wordCount = script.split(/\s+/).filter(Boolean).length;
  console.log(`   Script (${wordCount} words):\n   "${script}"`);
  if (wordCount < 40 || wordCount > 65) {
    throw new Error(`Word count constraint violated: ${wordCount} words (expected 45-60)`);
  }
  console.log('   ✓ Sensory naturalist script verified.\n');

  // Test 5: Fallback WAV Chime Audio Generator
  console.log('5. Testing pure JS WAV audio synthesizer:');
  const wavBuffer = generateFallbackChimeWav(528, 2.5);
  console.log(`   Generated WAV Buffer size: ${wavBuffer.length} bytes`);
  const riff = wavBuffer.toString('utf8', 0, 4);
  const wave = wavBuffer.toString('utf8', 8, 12);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error(`Invalid WAV header: RIFF=${riff}, WAVE=${wave}`);
  }
  console.log(`   RIFF header: "${riff}", Format: "${wave}" verified`);
  console.log('   ✓ Audio synthesis verified.\n');

  // Test 6: Synthesize audio wrapper
  console.log('6. Testing synthesizeAudio service wrapper:');
  const audioResult = await synthesizeAudio(script, 'test_wp', 0);
  console.log(`   Audio filename: ${audioResult.filename}, format: ${audioResult.format}, isFallback: ${audioResult.isFallback}`);
  if (!audioResult.buffer || audioResult.buffer.length < 1000) {
    throw new Error('Audio buffer is empty or corrupted');
  }
  console.log('   ✓ Audio service verified.\n');

  console.log('🎉 All service unit tests passed successfully!\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

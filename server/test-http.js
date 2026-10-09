async function testHttpEndpoints() {
  console.log('🌐 Testing Express HTTP Endpoints on http://localhost:3000...\n');

  // 1. Test GET /api/health
  const healthRes = await fetch('http://localhost:3000/api/health');
  if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
  const healthJson = await healthRes.json();
  console.log('1. Health check response:', healthJson);
  console.log('   ✓ Health endpoint OK.\n');

  // 2. Test GET / (SPA index.html)
  const rootRes = await fetch('http://localhost:3000/');
  if (!rootRes.ok) throw new Error(`SPA index.html failed: ${rootRes.status}`);
  const rootHtml = await rootRes.text();
  if (!rootHtml.includes('TrailPulse')) throw new Error('SPA index.html does not contain TrailPulse');
  console.log(`2. SPA index.html returned (${rootHtml.length} bytes). Contains "TrailPulse".`);
  console.log('   ✓ SPA static file serving OK.\n');

  // 3. Test POST /api/trail/bundle
  const sampleGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TrailPulse - Touch Grass" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Redwood Creek Loop</name></metadata>
  <trk>
    <name>Redwood Creek Loop</name>
    <trkseg>
      <trkpt lat="37.89530" lon="-122.57860"><ele>42</ele></trkpt>
      <trkpt lat="37.89680" lon="-122.58020"><ele>46</ele></trkpt>
      <trkpt lat="37.89880" lon="-122.58240"><ele>55</ele></trkpt>
      <trkpt lat="37.90110" lon="-122.58480"><ele>82</ele></trkpt>
      <trkpt lat="37.89535" lon="-122.57865"><ele>42</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

  console.log('3. Testing POST /api/trail/bundle...');
  const bundleRes = await fetch('http://localhost:3000/api/trail/bundle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ gpx: sampleGpx })
  });

  if (!bundleRes.ok) {
    const errText = await bundleRes.text();
    throw new Error(`Bundle generation failed: ${bundleRes.status} - ${errText}`);
  }

  const contentType = bundleRes.headers.get('content-type');
  const trailNameHeader = decodeURIComponent(bundleRes.headers.get('x-trail-name') || '');
  console.log(`   Response Content-Type: ${contentType}`);
  console.log(`   Trail Name Header: "${trailNameHeader}"`);

  const zipBuffer = await bundleRes.arrayBuffer();
  console.log(`   Received ZIP archive: ${zipBuffer.byteLength} bytes`);

  // Verify ZIP magic bytes (PK\x03\x04)
  const bytes = new Uint8Array(zipBuffer);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error('Downloaded buffer is not a valid ZIP archive (missing PK signature)');
  }
  console.log('   ✓ ZIP archive PK magic bytes verified.');

  console.log('\n🎉 ALL HTTP ENDPOINTS VERIFIED & WORKING PERFECTLY!');
}

testHttpEndpoints().catch((err) => {
  console.error('❌ HTTP verification failed:', err);
  process.exit(1);
});

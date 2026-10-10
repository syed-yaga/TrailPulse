import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import archiver from 'archiver';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import type { TrailManifest, WaypointTrigger } from '../../shared/types.js';
import { parseGPXAndSampleWaypoints } from './services/gpxParser.js';
import { queryNearbyPOI } from './services/overpassService.js';
import { generateNaturalistScript } from './services/gemmaService.js';
import { synthesizeAudio } from './services/audioService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from current directory or relative server/root paths
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const PORT: number = Number(process.env.PORT) || 3000;

// Resolve client static bundle directory across production builds and relative paths
export function resolveClientDist(): string {
  const candidates = [
    path.resolve(process.cwd(), 'client/dist'),
    path.resolve(__dirname, '../../../../client/dist'), // from server/dist/server/src
    path.resolve(__dirname, '../../../client/dist'),   // from server/dist/src
    path.resolve(__dirname, '../../client/dist'),      // standard relative
    path.resolve(__dirname, '../../public'),           // server/public
    path.resolve(process.cwd(), 'server/public'),
    path.resolve(process.cwd(), 'public')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }

  return path.resolve(process.cwd(), 'client/dist');
}

const clientDist = resolveClientDist();
const app = express();

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

app.get('/api/health', (_req: Request, res: Response): void => {
  res.json({
    status: 'healthy',
    service: 'TrailPulse Orchestrator (TypeScript)',
    timestamp: new Date().toISOString(),
    elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
    gemmaEndpoint: process.env.GEMMA_API_URL || 'http://localhost:11434/api/generate'
  });
});

interface BundleRequestBody {
  gpx?: string;
}

app.post(
  '/api/trail/bundle',
  upload.single('gpx'),
  async (req: Request<unknown, unknown, BundleRequestBody>, res: Response): Promise<void> => {
    console.log('[TrailPulse] Received bundle generation request...');

    try {
      let gpxContent = '';
      const multerFile: Express.Multer.File | undefined = req.file;

      if (multerFile && multerFile.buffer) {
        gpxContent = multerFile.buffer.toString('utf8');
      } else if (req.body && typeof req.body.gpx === 'string') {
        gpxContent = req.body.gpx;
      }

      if (!gpxContent || gpxContent.trim().length === 0) {
        res.status(400).json({
          error: 'No GPX data provided. Upload a .gpx file or pass raw GPX in the request body.'
        });
        return;
      }

      console.log('[TrailPulse] Step 1: Parsing GPX and extracting key waypoints...');
      const parsed = parseGPXAndSampleWaypoints(gpxContent);
      console.log(
        `[TrailPulse] Parsed "${parsed.trailName}": ${parsed.totalDistanceKm}km with ${parsed.sampledWaypoints.length} stops.`
      );

      const waypointsList: WaypointTrigger[] = [];
      const audioBuffers: Array<{ filename: string; buffer: Buffer }> = [];

      for (let i = 0; i < parsed.sampledWaypoints.length; i++) {
        const wp = parsed.sampledWaypoints[i];
        console.log(`[TrailPulse] Processing waypoint ${i + 1}/${parsed.sampledWaypoints.length}: "${wp.defaultName}"`);

        const poi = await queryNearbyPOI(wp.coordinate, wp, i, parsed.trailName);
        const landmarkName = poi.name || wp.defaultName;

        console.log(`[TrailPulse] Generating walking vignette for "${landmarkName}" (env: "${poi.environmentContext || 'default'}")...`);
        const script = await generateNaturalistScript(
          landmarkName,
          poi.type,
          wp.role,
          wp.coordinate,
          poi.environmentContext
        );

        console.log(`[TrailPulse] Synthesizing audio for "${landmarkName}"...`);
        const audioBuffer: Buffer = await synthesizeAudio(script, wp.id, i);

        // Detect audio format from buffer header: MP3 starts with ID3 or 0xFF, otherwise WAV
        const isMp3 =
          audioBuffer.length >= 3 &&
          (audioBuffer.subarray(0, 3).toString('utf8') === 'ID3' || audioBuffer[0] === 0xff);
        const ext = isMp3 ? 'mp3' : 'wav';
        const audioFilePath = `audio/${wp.id}.${ext}`;

        const trigger: WaypointTrigger = {
          id: wp.id,
          name: landmarkName,
          lat: wp.coordinate.lat,
          lon: wp.coordinate.lon,
          trigger_radius_meters: 40,
          audio_file: audioFilePath,
          transcript: script,
          cooldown_seconds: 600
        };

        waypointsList.push(trigger);
        audioBuffers.push({
          filename: audioFilePath,
          buffer: audioBuffer
        });
      }

      const manifest: TrailManifest = {
        trail_id: `trail_${Date.now()}`,
        trail_name: parsed.trailName,
        generated_at: new Date().toISOString(),
        total_distance_km: parsed.totalDistanceKm,
        waypoints: waypointsList
      };

      console.log('[TrailPulse] Step 3: Compiling trail_bundle.zip and streaming to client...');

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="trail_bundle.zip"');
      res.setHeader('X-Trail-Name', encodeURIComponent(parsed.trailName));

      const archive = archiver('zip', {
        zlib: { level: 8 }
      });

      archive.on('error', (err: unknown) => {
        console.error('[Archiver Error]', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to archive trail bundle.' });
        }
      });

      archive.pipe(res);

      archive.append(JSON.stringify(manifest, null, 2), { name: 'trail_manifest.json' });

      for (const item of audioBuffers) {
        archive.append(item.buffer, { name: item.filename });
      }

      await archive.finalize();
      console.log('[TrailPulse] Bundle stream finalized successfully.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal error creating trail bundle.';
      console.error('[TrailPulse Bundle Error]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    }
  }
);

// Dedicated 404 handler for unrecognized /api routes so they NEVER return HTML
app.all('/api/*', (req: Request, res: Response): void => {
  res.status(404).json({
    error: `API route not found: ${req.method} ${req.path}`,
    status: 404
  });
});

// Wildcard SPA route fallback (serves index.html for non-API routes)
app.get('*', (req: Request, res: Response, next): void => {
  if (req.path.startsWith('/api')) {
    return next();
  }

  const indexHtmlPath = path.join(clientDist, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    res.sendFile(indexHtmlPath);
  } else {
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>TrailPulse API Server (TypeScript)</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: system-ui, sans-serif; background: #0f2d1e; color: #f0fdf4; padding: 2rem; }
            h1 { color: #4ade80; }
            code { background: #1b3b2b; padding: 0.2rem 0.5rem; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h1>🌲 TrailPulse API Server Running</h1>
          <p>The Express backend is live on port <code>${PORT}</code>.</p>
          <p>Client build not found at <code>${clientDist}</code>. Run <code>npm run build</code> to generate the client bundle.</p>
        </body>
      </html>
    `);
  }
});

app.listen(PORT, async (): Promise<void> => {
  console.log(`🌲 TrailPulse server is listening on http://localhost:${PORT}`);

  // Pre-flight Ollama health check
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const modelNames = (data.models || []).map((m) => m.name);
      console.log(`[Ollama] Connected to local Ollama daemon. Available models: [${modelNames.join(', ')}]`);
    } else {
      console.warn(`[Ollama] Warning: No local Ollama daemon found at 127.0.0.1:11434 (HTTP ${res.status}). Start it with 'ollama serve'.`);
    }
  } catch (_err) {
    console.warn(`[Ollama] Warning: No local Ollama daemon found at 127.0.0.1:11434. Start it with 'ollama serve'.`);
  }
});

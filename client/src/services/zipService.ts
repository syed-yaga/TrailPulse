import { unzipSync, strFromU8 } from 'fflate';
import { get, set, del, keys } from 'idb-keyval';
import type { TrailManifest, WaypointTrigger } from '../../../shared/types';

const MANIFEST_KEY: string = 'trailpulse:active_manifest';
const AUDIO_KEY_PREFIX: string = 'trailpulse:audio:';

export interface UnpackedBundleResult {
  manifest: TrailManifest;
  audioBlobs: Map<string, Blob>;
}

/**
 * Unpacks a trail_bundle.zip in RAM, caches the manifest and audio Blobs into IndexedDB,
 * and explicitly returns Promise<{ manifest: TrailManifest; audioBlobs: Map<string, Blob> }>.
 */
export async function unpackAndStoreBundle(
  zipBuffer: ArrayBuffer | Uint8Array
): Promise<UnpackedBundleResult> {
  const bytes = zipBuffer instanceof Uint8Array ? zipBuffer : new Uint8Array(zipBuffer);
  const unzipped = unzipSync(bytes);

  // 1. Locate and parse trail_manifest.json
  const manifestFile = unzipped['trail_manifest.json'];
  if (!manifestFile) {
    throw new Error('Invalid bundle: missing trail_manifest.json in archive');
  }

  const manifestJsonString = strFromU8(manifestFile);
  const manifest = JSON.parse(manifestJsonString) as TrailManifest;

  // 2. Clear old cached audio files
  await clearCachedTour();

  // 3. Store audio files into IndexedDB & construct Map
  const audioBlobs = new Map<string, Blob>();

  for (const wp of manifest.waypoints as WaypointTrigger[]) {
    const audioFilePath = wp.audio_file; // e.g. "audio/wp_1.mp3" or "audio/wp_1.wav"
    const audioBytes = unzipped[audioFilePath];

    if (audioBytes) {
      const isMp3 = audioFilePath.endsWith('.mp3');
      const mimeType = isMp3 ? 'audio/mpeg' : 'audio/wav';
      const audioBlob = new Blob([audioBytes], { type: mimeType });

      const storageKey = `${AUDIO_KEY_PREFIX}${wp.id}`;
      await set(storageKey, audioBlob);
      await set(wp.audio_file, audioBlob);
      audioBlobs.set(wp.id, audioBlob);
      audioBlobs.set(wp.audio_file, audioBlob);
    } else {
      console.warn(`[ZipService] Warning: Audio file "${audioFilePath}" not found in zip archive.`);
    }
  }

  // 4. Save active manifest
  await set(MANIFEST_KEY, manifest);

  return { manifest, audioBlobs };
}

/**
 * Retrieves the stored audio Blob for a given waypoint ID from IndexedDB.
 */
export async function getStoredAudioBlob(key: string): Promise<Blob | null> {
  const directBlob = await get<Blob>(key);
  if (directBlob instanceof Blob) return directBlob;
  const storageKey = `${AUDIO_KEY_PREFIX}${key}`;
  const prefixedBlob = await get<Blob>(storageKey);
  return prefixedBlob instanceof Blob ? prefixedBlob : null;
}

/**
 * Retrieves the active cached trail manifest from IndexedDB, if present.
 */
export async function getCachedManifest(): Promise<TrailManifest | null> {
  const manifest = await get<TrailManifest>(MANIFEST_KEY);
  return manifest || null;
}

/**
 * Clears all cached audio Blobs and the active manifest from IndexedDB.
 */
export async function clearCachedTour(): Promise<void> {
  try {
    const allKeys = await keys();
    for (const key of allKeys) {
      if (typeof key === 'string' && (key.startsWith(AUDIO_KEY_PREFIX) || key === MANIFEST_KEY)) {
        await del(key);
      }
    }
  } catch (err: unknown) {
    console.error('[ZipService] Error clearing tour cache:', err);
  }
}

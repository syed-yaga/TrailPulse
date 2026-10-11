import { unzipSync, strFromU8 } from "fflate";
import { get, set, del, keys } from "idb-keyval";
import type { TrailManifest, WaypointTrigger } from "../../../shared/types";

const MANIFEST_KEY: string = "trailpulse:active_manifest";
const AUDIO_KEY_PREFIX: string = "trailpulse:audio:";

export interface UnpackedBundleResult {
  manifest: TrailManifest;
  audioBlobs: Map<string, Blob>;
}

export async function unpackAndStoreBundle(
  zipBuffer: ArrayBuffer | Uint8Array,
): Promise<UnpackedBundleResult> {
  const bytes =
    zipBuffer instanceof Uint8Array ? zipBuffer : new Uint8Array(zipBuffer);
  const unzipped = unzipSync(bytes);

  const manifestFile =
    unzipped["manifest.json"] || unzipped["trail_manifest.json"];
  if (!manifestFile) {
    throw new Error("Invalid bundle: missing manifest.json in archive");
  }

  const manifestJsonString = strFromU8(manifestFile);
  const manifest = JSON.parse(manifestJsonString) as TrailManifest;

  await clearCachedTour();

  const audioBlobs = new Map<string, Blob>();

  for (const wp of manifest.waypoints as WaypointTrigger[]) {
    const audioFilePath = wp.audio_file;
    const audioBytes = unzipped[audioFilePath];

    if (audioBytes) {
      const isMp3 = audioFilePath.endsWith(".mp3");
      const mimeType = isMp3 ? "audio/mpeg" : "audio/wav";
      const audioBlob = new Blob([audioBytes], { type: mimeType });

      await saveAudioBlob(wp.id, wp.audio_file, audioBlob);
      audioBlobs.set(wp.id, audioBlob);
      audioBlobs.set(wp.audio_file, audioBlob);
    } else {
      console.warn(
        `[ZipService] Warning: Audio file "${audioFilePath}" not found in zip archive.`,
      );
    }
  }

  await saveCachedManifest(manifest);

  return { manifest, audioBlobs };
}

export async function saveAudioBlob(
  id: string,
  audioFile: string,
  blob: Blob,
): Promise<void> {
  const storageKey = `${AUDIO_KEY_PREFIX}${id}`;
  await set(storageKey, blob);
  if (audioFile) {
    await set(audioFile, blob);
  }
}

export async function saveCachedManifest(
  manifest: TrailManifest,
): Promise<void> {
  await set(MANIFEST_KEY, manifest);
}

export async function getStoredAudioBlob(key: string): Promise<Blob | null> {
  const directBlob = await get<Blob>(key);
  if (directBlob instanceof Blob) return directBlob;
  const storageKey = `${AUDIO_KEY_PREFIX}${key}`;
  const prefixedBlob = await get<Blob>(storageKey);
  return prefixedBlob instanceof Blob ? prefixedBlob : null;
}

export async function getCachedManifest(): Promise<TrailManifest | null> {
  const manifest = await get<TrailManifest>(MANIFEST_KEY);
  return manifest || null;
}

export async function clearCachedTour(): Promise<void> {
  try {
    const allKeys = await keys();
    for (const key of allKeys) {
      if (
        typeof key === "string" &&
        (key.startsWith(AUDIO_KEY_PREFIX) || key === MANIFEST_KEY)
      ) {
        await del(key);
      }
    }
  } catch (err: unknown) {
    console.error("[ZipService] Error clearing tour cache:", err);
  }
}

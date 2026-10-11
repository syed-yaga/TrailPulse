import JSZip from "jszip";
import type { TrailManifest, WaypointTrigger } from "../../../shared/types";
import {
  clearCachedTour,
  saveAudioBlob,
  saveCachedManifest,
} from "./zipService";

export interface UnpackBundleOptions {
  onProgress?: (stage: string, percent: number) => void;
}

export type TrailManifestWithBlobs = TrailManifest & {
  audioBlobs?: Map<string, Blob>;
};

export async function unpackTrailBundle(
  file: File,
  options?: UnpackBundleOptions,
): Promise<TrailManifestWithBlobs> {
  const { onProgress } = options || {};

  // 1. Validate file extension or MIME type
  const isZip =
    file.name.toLowerCase().endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed";

  if (!isZip) {
    throw new Error("Please select a valid .zip tour bundle.");
  }

  onProgress?.("Reading archive in browser...", 25);

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err: unknown) {
    throw new Error(
      `Failed to read ZIP archive: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3. Locate manifest.json (or trail_manifest.json as fallback)
  const manifestFile =
    zip.file("manifest.json") || zip.file("trail_manifest.json");
  if (!manifestFile) {
    throw new Error("Invalid bundle: manifest.json not found in archive.");
  }

  onProgress?.("Parsing trail manifest...", 50);

  let rawJson: string;
  try {
    rawJson = await manifestFile.async("text");
  } catch (err: unknown) {
    throw new Error(
      `Failed to read manifest.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let manifest: TrailManifest;
  try {
    manifest = JSON.parse(rawJson) as TrailManifest;
  } catch (err: unknown) {
    throw new Error(
      `Invalid JSON format in manifest: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const rawWaypoints = (manifest.waypoints ||
    (manifest as any).stops ||
    []) as Array<any>;
  if (!Array.isArray(rawWaypoints) || rawWaypoints.length === 0) {
    throw new Error(
      "Invalid bundle: manifest contains no waypoints or audio triggers.",
    );
  }

  await clearCachedTour();

  onProgress?.("Caching audio tracks into offline storage...", 75);

  const audioBlobs = new Map<string, Blob>();

  for (let i = 0; i < rawWaypoints.length; i++) {
    const wp = rawWaypoints[i];
    const wpId = wp.id || `wp_${i + 1}`;
    const specifiedAudio = wp.audio_file || wp.audioFile || wp.audio;

    let audioEntry: JSZip.JSZipObject | null = null;
    if (specifiedAudio) {
      audioEntry =
        zip.file(specifiedAudio) ||
        zip.file(specifiedAudio.replace(/^audio\//, "")) ||
        zip.file(`audio/${specifiedAudio}`);
    }

    if (!audioEntry) {
      audioEntry =
        zip.file(`audio/${wpId}.mp3`) ||
        zip.file(`${wpId}.mp3`) ||
        zip.file(`audio/${wpId}.wav`) ||
        zip.file(`${wpId}.wav`);
    }

    if (!audioEntry) {
      const matchingFiles = zip.file(
        new RegExp(`${wpId}\\.(mp3|wav|ogg|m4a)$`, "i"),
      );
      if (matchingFiles.length > 0) {
        audioEntry = matchingFiles[0];
      }
    }

    if (audioEntry) {
      const isMp3 = audioEntry.name.toLowerCase().endsWith(".mp3");
      const isWav = audioEntry.name.toLowerCase().endsWith(".wav");
      const mimeType = isMp3 ? "audio/mpeg" : isWav ? "audio/wav" : "audio/mp4";

      const audioBlob = await audioEntry.async("blob");
      const typedBlob = new Blob([audioBlob], { type: mimeType });

      await saveAudioBlob(wpId, specifiedAudio || audioEntry.name, typedBlob);
      audioBlobs.set(wpId, typedBlob);
      if (specifiedAudio) {
        audioBlobs.set(specifiedAudio, typedBlob);
      }
      audioBlobs.set(audioEntry.name, typedBlob);
    } else {
      console.warn(
        `[BundleImporter] Warning: Audio file not found for waypoint "${wp.name || wpId}".`,
      );
    }
  }

  const normalizedManifest: TrailManifestWithBlobs = {
    trail_id: manifest.trail_id || `trail_${Date.now()}`,
    trail_name:
      manifest.trail_name ||
      (manifest as any).trailName ||
      file.name.replace(/\.zip$/i, ""),
    generated_at:
      manifest.generated_at ||
      (manifest as any).generatedAt ||
      new Date().toISOString(),
    total_distance_km:
      manifest.total_distance_km ?? (manifest as any).totalDistanceKm ?? 0,
    waypoints: rawWaypoints.map(
      (wp, idx): WaypointTrigger => ({
        id: wp.id || `wp_${idx + 1}`,
        name: wp.name || `Waypoint ${idx + 1}`,
        lat: wp.lat ?? wp.latitude,
        lon: wp.lon ?? wp.longitude,
        trigger_radius_meters: Math.max(
          wp.trigger_radius_meters ?? wp.triggerRadiusMeters ?? 40,
          40,
        ),
        audio_file:
          wp.audio_file ||
          wp.audioFile ||
          `audio/${wp.id || `wp_${idx + 1}`}.mp3`,
        transcript: wp.transcript || wp.description || "",
        cooldown_seconds: wp.cooldown_seconds ?? wp.cooldownSeconds ?? 600,
      }),
    ),
    audioBlobs,
  };

  await saveCachedManifest(normalizedManifest);

  onProgress?.("Bundle ready! You can now start hiking offline.", 100);

  return normalizedManifest;
}

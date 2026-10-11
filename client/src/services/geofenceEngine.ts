import type {
  Coordinate,
  TrailManifest,
  WaypointTrigger,
} from "../../../shared/types";
import { getStoredAudioBlob } from "./zipService";

/**
 * Calculates Haversine distance in meters between two latitude/longitude points.
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export interface SpatialEngineOptions {
  defaultTriggerRadius?: number;
  cooldownMs?: number;
}

export interface TrailSpatialState {
  currentPosition: Coordinate | null;
  accuracyMeters: number | null;
  targetWaypoint: WaypointTrigger | null;
  distanceToTargetMeters: number | null;
  nearestWaypoint: WaypointTrigger | null;
  distanceToNearestMeters: number | null;
  triggerRadiusMeters: number;
  isTriggered: boolean;
  isPlaying: boolean;
  currentPlayingWaypoint: WaypointTrigger | null;
  lastTriggerTimes: Map<string, number>;
  visitedWaypointIds: Set<string>;
  isTargetCompleted: boolean;
  isSimulating: boolean;
}

export type StateListener = (state: TrailSpatialState) => void;

export class TrailSpatialEngine {
  private manifest: TrailManifest;
  private options: Required<SpatialEngineOptions>;
  private audioElement: HTMLAudioElement;
  private watchId: number | null = null;
  private currentPosition: Coordinate | null = null;
  private accuracyMeters: number | null = null;
  private lastTriggerTimes: Map<string, number> = new Map();
  private visitedWaypointIds: Set<string> = new Set();
  private isPlaying: boolean = false;
  private currentPlayingWaypoint: WaypointTrigger | null = null;
  private isSimulating: boolean = false;
  private listeners: Set<StateListener> = new Set();
  private currentAudioUrl: string | null = null;

  constructor(manifest: TrailManifest, options: SpatialEngineOptions = {}) {
    this.manifest = manifest;
    this.options = {
      defaultTriggerRadius: options.defaultTriggerRadius ?? 40,
      cooldownMs: options.cooldownMs ?? 600_000,
    };

    this.audioElement = new Audio();
    this.audioElement.preload = "auto";

    this.setupAudioListeners();
    this.setupMediaSessionHandlers();
  }

  public subscribe(callback: StateListener): () => void {
    this.listeners.add(callback);
    callback(this.getState());
    return () => this.listeners.delete(callback);
  }

  public getState(): TrailSpatialState {
    const targetInfo = this.getActiveTargetWaypoint();
    const targetWp = targetInfo ? targetInfo.waypoint : null;
    const distanceToTarget =
      targetInfo && this.currentPosition ? targetInfo.distance : null;

    const rawRadius = targetWp
      ? (targetWp.trigger_radius_meters ??
        (targetWp as any).radius ??
        this.options.defaultTriggerRadius)
      : this.options.defaultTriggerRadius;
    const triggerRadiusMeters = Math.max(rawRadius, 40);

    const isInsideRadius = !!(
      targetWp &&
      distanceToTarget !== null &&
      distanceToTarget <= triggerRadiusMeters &&
      !this.visitedWaypointIds.has(targetWp.id)
    );

    const isAllCompleted =
      this.manifest.waypoints.length > 0 &&
      this.manifest.waypoints.every((w) => this.visitedWaypointIds.has(w.id));

    return {
      currentPosition: this.currentPosition,
      accuracyMeters: this.accuracyMeters,
      targetWaypoint: targetWp,
      distanceToTargetMeters: distanceToTarget,
      nearestWaypoint: targetWp,
      distanceToNearestMeters: distanceToTarget,
      triggerRadiusMeters,
      isTriggered: isInsideRadius,
      isPlaying: this.isPlaying,
      currentPlayingWaypoint: this.currentPlayingWaypoint,
      lastTriggerTimes: new Map(this.lastTriggerTimes),
      visitedWaypointIds: new Set(this.visitedWaypointIds),
      isTargetCompleted: isAllCompleted,
      isSimulating: this.isSimulating,
    };
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err: unknown) {
        console.error("[TrailSpatialEngine] Listener error:", err);
      }
    }
  }

  private setupAudioListeners(): void {
    this.audioElement.addEventListener("play", () => {
      this.isPlaying = true;
      this.notify();
    });

    this.audioElement.addEventListener("pause", () => {
      this.isPlaying = false;
      this.notify();
    });

    this.audioElement.addEventListener("ended", () => {
      this.isPlaying = false;
      this.currentPlayingWaypoint = null;
      if (this.currentAudioUrl) {
        URL.revokeObjectURL(this.currentAudioUrl);
        this.currentAudioUrl = null;
      }
      this.notify();
    });

    this.audioElement.addEventListener("error", (e: Event) => {
      console.error("[TrailSpatialEngine] Audio playback error:", e);
      this.isPlaying = false;
      this.currentPlayingWaypoint = null;
      this.notify();
    });
  }

  private setupMediaSessionHandlers(): void {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", () => {
        this.audioElement.play().catch(console.error);
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        this.audioElement.pause();
      });
      try {
        navigator.mediaSession.setActionHandler("stop", () => {
          this.audioElement.pause();
          this.audioElement.currentTime = 0;
          this.isPlaying = false;
          this.currentPlayingWaypoint = null;
          this.notify();
        });
      } catch {}
    }
  }

  public unlockAudio(): void {
    try {
      const silentDataUri =
        "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
      this.audioElement.src = silentDataUri;
      const playPromise = this.audioElement.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            this.audioElement.pause();
            this.audioElement.currentTime = 0;
          })
          .catch((err) => {
            console.warn("[TrailSpatialEngine] Audio unlock note:", err);
          });
      }
    } catch (e) {
      console.warn("[TrailSpatialEngine] Error unlocking audio:", e);
    }
  }

  public startTracking(): void {
    this.isSimulating = false;
    this.unlockAudio();

    if (!("geolocation" in navigator)) {
      console.warn("[TrailSpatialEngine] Geolocation API not available.");
      return;
    }

    if (this.watchId !== null) return;

    this.watchId = navigator.geolocation.watchPosition(
      (position: GeolocationPosition) => {
        if (this.isSimulating) return;

        this.currentPosition = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          elevation:
            position.coords.altitude !== null
              ? position.coords.altitude
              : undefined,
        };
        this.accuracyMeters = Math.round(position.coords.accuracy);

        void this.checkGeofences();
        this.notify();
      },
      (error: GeolocationPositionError) => {
        console.warn(
          `[TrailSpatialEngine] Geolocation error (${error.code}): ${error.message}`,
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 10000,
      },
    );
  }

  public resumeSatelliteGPS(): void {
    this.isSimulating = false;
    this.notify();
  }

  public stopTracking(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  public simulatePosition(
    lat: number,
    lon: number,
    accuracy: number = 4,
  ): void {
    this.isSimulating = true;
    this.currentPosition = { lat, lon };
    this.accuracyMeters = accuracy;
    void this.checkGeofences();
    this.notify();
  }

  public getActiveTargetWaypoint(): {
    waypoint: WaypointTrigger;
    distance: number;
  } | null {
    if (!this.manifest.waypoints || this.manifest.waypoints.length === 0) {
      return null;
    }

    const unvisited = this.manifest.waypoints.filter(
      (wp) => !this.visitedWaypointIds.has(wp.id),
    );
    const target = unvisited.length > 0 ? unvisited[0] : null;

    if (!target) {
      return null;
    }

    const distance = this.currentPosition
      ? calculateDistanceMeters(
          this.currentPosition.lat,
          this.currentPosition.lon,
          target.lat,
          target.lon,
        )
      : 0;

    return { waypoint: target, distance };
  }

  public getNearestWaypoint(): {
    waypoint: WaypointTrigger;
    distance: number;
  } | null {
    return this.getActiveTargetWaypoint();
  }

  public getVisitedWaypointIds(): Set<string> {
    return new Set(this.visitedWaypointIds);
  }

  public markWaypointVisited(waypointId: string): void {
    this.visitedWaypointIds.add(waypointId);
    this.notify();
  }

  public resetVisited(): void {
    this.visitedWaypointIds.clear();
    this.lastTriggerTimes.clear();
    this.notify();
  }

  public async checkGeofences(): Promise<void> {
    if (!this.currentPosition || !this.manifest.waypoints) return;
    if (this.isPlaying) return;

    const now = Date.now();

    const unvisited = this.manifest.waypoints.filter(
      (wp) => !this.visitedWaypointIds.has(wp.id),
    );

    for (const wp of unvisited) {
      const distance = calculateDistanceMeters(
        this.currentPosition.lat,
        this.currentPosition.lon,
        wp.lat,
        wp.lon,
      );

      const rawRadius =
        wp.trigger_radius_meters ??
        (wp as any).radius ??
        this.options.defaultTriggerRadius;
      const radius = Math.max(rawRadius, 40);
      const cooldownMs = (wp.cooldown_seconds ?? 600) * 1000;
      const lastTrigger = this.lastTriggerTimes.get(wp.id) ?? 0;

      if (distance <= radius && now - lastTrigger > cooldownMs) {
        console.log(
          `[TrailSpatialEngine] Triggering "${wp.name}" (${distance}m <= ${radius}m threshold)`,
        );
        this.visitedWaypointIds.add(wp.id);
        this.lastTriggerTimes.set(wp.id, now);
        await this.playWaypointAudio(wp);
        break;
      }
    }
  }

  public async playWaypointAudio(waypoint: WaypointTrigger): Promise<void> {
    try {
      this.visitedWaypointIds.add(waypoint.id);
      this.lastTriggerTimes.set(waypoint.id, Date.now());

      let audioBlob = await getStoredAudioBlob(waypoint.id);
      if (!audioBlob && waypoint.audio_file) {
        audioBlob = await getStoredAudioBlob(waypoint.audio_file);
      }

      if (!audioBlob) {
        console.warn(
          `[TrailSpatialEngine] No cached audio for waypoint ${waypoint.id}`,
        );
        return;
      }

      if (this.currentAudioUrl) {
        URL.revokeObjectURL(this.currentAudioUrl);
      }

      this.currentAudioUrl = URL.createObjectURL(audioBlob);
      this.audioElement.src = this.currentAudioUrl;
      this.currentPlayingWaypoint = waypoint;

      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: waypoint.name,
          artist: this.manifest.trail_name || "TrailPulse",
          album: "TrailPulse Outdoors",
          artwork: [
            {
              src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="%234ade80"><circle cx="48" cy="48" r="44" fill="%230f2d1e"/><path d="M48 24 L28 64 L48 56 L68 64 Z" fill="%234ade80"/></svg>',
              sizes: "96x96",
              type: "image/svg+xml",
            },
          ],
        });
        navigator.mediaSession.playbackState = "playing";
      }

      await this.audioElement.play();
      this.isPlaying = true;
      this.notify();
    } catch (err: unknown) {
      console.error("[TrailSpatialEngine] Audio playback error:", err);
      this.isPlaying = false;
      this.currentPlayingWaypoint = null;
      this.notify();
    }
  }

  public async testAudio(targetWaypoint?: WaypointTrigger): Promise<void> {
    const target =
      targetWaypoint ||
      this.getActiveTargetWaypoint()?.waypoint ||
      this.manifest.waypoints[0];
    if (target) {
      await this.playWaypointAudio(target);
    }
  }

  public stopAudio(): void {
    this.audioElement.pause();
    this.audioElement.currentTime = 0;
    this.isPlaying = false;
    this.currentPlayingWaypoint = null;
    this.notify();
  }

  public destroy(): void {
    this.stopTracking();
    this.stopAudio();
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }
    this.listeners.clear();
  }
}

export { TrailSpatialEngine as GeofenceEngine };

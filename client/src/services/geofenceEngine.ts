import type { Coordinate, TrailManifest, WaypointTrigger } from '../../../shared/types';
import { getStoredAudioBlob } from './zipService';

/**
 * Calculates Haversine distance in meters between two latitude/longitude points.
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
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
  nearestWaypoint: WaypointTrigger | null;
  distanceToNearestMeters: number | null;
  isPlaying: boolean;
  currentPlayingWaypoint: WaypointTrigger | null;
  lastTriggerTimes: Map<string, number>;
  isSimulating: boolean;
}

export type StateListener = (state: TrailSpatialState) => void;

/**
 * TrailSpatialEngine
 * Manages satellite GPS tracking, proximity geofence checking, and MediaSession audio playback.
 */
export class TrailSpatialEngine {
  private manifest: TrailManifest;
  private options: Required<SpatialEngineOptions>;
  private audioElement: HTMLAudioElement;
  private watchId: number | null = null;
  private currentPosition: Coordinate | null = null;
  private accuracyMeters: number | null = null;
  private lastTriggerTimes: Map<string, number> = new Map();
  private isPlaying: boolean = false;
  private currentPlayingWaypoint: WaypointTrigger | null = null;
  private isSimulating: boolean = false;
  private listeners: Set<StateListener> = new Set();
  private currentAudioUrl: string | null = null;

  constructor(manifest: TrailManifest, options: SpatialEngineOptions = {}) {
    this.manifest = manifest;
    this.options = {
      defaultTriggerRadius: options.defaultTriggerRadius ?? 25,
      cooldownMs: options.cooldownMs ?? 600_000
    };

    this.audioElement = new Audio();
    this.audioElement.preload = 'auto';

    this.setupAudioListeners();
    this.setupMediaSessionHandlers();
  }

  public subscribe(callback: StateListener): () => void {
    this.listeners.add(callback);
    callback(this.getState());
    return () => this.listeners.delete(callback);
  }

  public getState(): TrailSpatialState {
    const nearest = this.getNearestWaypoint();
    return {
      currentPosition: this.currentPosition,
      accuracyMeters: this.accuracyMeters,
      nearestWaypoint: nearest ? nearest.waypoint : null,
      distanceToNearestMeters: nearest ? nearest.distance : null,
      isPlaying: this.isPlaying,
      currentPlayingWaypoint: this.currentPlayingWaypoint,
      lastTriggerTimes: new Map(this.lastTriggerTimes),
      isSimulating: this.isSimulating
    };
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err: unknown) {
        console.error('[TrailSpatialEngine] Listener error:', err);
      }
    }
  }

  private setupAudioListeners(): void {
    this.audioElement.addEventListener('play', () => {
      this.isPlaying = true;
      this.notify();
    });

    this.audioElement.addEventListener('pause', () => {
      this.isPlaying = false;
      this.notify();
    });

    this.audioElement.addEventListener('ended', () => {
      this.isPlaying = false;
      this.currentPlayingWaypoint = null;
      if (this.currentAudioUrl) {
        URL.revokeObjectURL(this.currentAudioUrl);
        this.currentAudioUrl = null;
      }
      this.notify();
    });

    this.audioElement.addEventListener('error', (e: Event) => {
      console.error('[TrailSpatialEngine] Audio playback error:', e);
      this.isPlaying = false;
      this.currentPlayingWaypoint = null;
      this.notify();
    });
  }

  private setupMediaSessionHandlers(): void {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        this.audioElement.play().catch(console.error);
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        this.audioElement.pause();
      });
      try {
        navigator.mediaSession.setActionHandler('stop', () => {
          this.audioElement.pause();
          this.audioElement.currentTime = 0;
          this.isPlaying = false;
          this.currentPlayingWaypoint = null;
          this.notify();
        });
      } catch {
        // Not all platforms support 'stop'
      }
    }
  }

  public unlockAudio(): void {
    const silentBlob = new Blob(
      [new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00])],
      { type: 'audio/mpeg' }
    );
    const silentUrl = URL.createObjectURL(silentBlob);
    const audio = new Audio(silentUrl);
    audio
      .play()
      .then(() => {
        audio.pause();
        URL.revokeObjectURL(silentUrl);
      })
      .catch(() => {});
  }

  public startTracking(): void {
    this.unlockAudio();

    if (!('geolocation' in navigator)) {
      console.warn('[TrailSpatialEngine] Geolocation API not available.');
      return;
    }

    if (this.watchId !== null) return;

    this.watchId = navigator.geolocation.watchPosition(
      (position: GeolocationPosition) => {
        if (this.isSimulating) return;

        this.currentPosition = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          elevation: position.coords.altitude !== null ? position.coords.altitude : undefined
        };
        this.accuracyMeters = Math.round(position.coords.accuracy);

        void this.checkGeofences();
        this.notify();
      },
      (error: GeolocationPositionError) => {
        console.warn(`[TrailSpatialEngine] Geolocation error (${error.code}): ${error.message}`);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 10000
      }
    );
  }

  public stopTracking(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  public simulatePosition(lat: number, lon: number, accuracy: number = 4): void {
    this.isSimulating = true;
    this.currentPosition = { lat, lon };
    this.accuracyMeters = accuracy;
    void this.checkGeofences();
    this.notify();
  }

  public getNearestWaypoint(): { waypoint: WaypointTrigger; distance: number } | null {
    if (!this.currentPosition || !this.manifest.waypoints || this.manifest.waypoints.length === 0) {
      return null;
    }

    let nearest: WaypointTrigger | null = null;
    let minDistance = Infinity;

    for (const wp of this.manifest.waypoints) {
      const dist = calculateDistanceMeters(
        this.currentPosition.lat,
        this.currentPosition.lon,
        wp.lat,
        wp.lon
      );
      if (dist < minDistance) {
        minDistance = dist;
        nearest = wp;
      }
    }

    return nearest ? { waypoint: nearest, distance: minDistance } : null;
  }

  public async checkGeofences(): Promise<void> {
    if (!this.currentPosition || !this.manifest.waypoints) return;
    if (this.isPlaying) return;

    const now = Date.now();

    for (const wp of this.manifest.waypoints) {
      const distance = calculateDistanceMeters(
        this.currentPosition.lat,
        this.currentPosition.lon,
        wp.lat,
        wp.lon
      );

      const radius = wp.trigger_radius_meters ?? this.options.defaultTriggerRadius;
      const cooldownMs = (wp.cooldown_seconds ?? 600) * 1000;
      const lastTrigger = this.lastTriggerTimes.get(wp.id) ?? 0;

      if (distance <= radius && now - lastTrigger > cooldownMs) {
        console.log(`[TrailSpatialEngine] Triggering "${wp.name}" (${distance}m <= ${radius}m)`);
        this.lastTriggerTimes.set(wp.id, now);
        await this.playWaypointAudio(wp);
        break;
      }
    }
  }

  public async playWaypointAudio(waypoint: WaypointTrigger): Promise<void> {
    try {
      const audioBlob = await getStoredAudioBlob(waypoint.id);
      if (!audioBlob) {
        console.warn(`[TrailSpatialEngine] No cached audio for waypoint ${waypoint.id}`);
        return;
      }

      if (this.currentAudioUrl) {
        URL.revokeObjectURL(this.currentAudioUrl);
      }

      this.currentAudioUrl = URL.createObjectURL(audioBlob);
      this.audioElement.src = this.currentAudioUrl;
      this.currentPlayingWaypoint = waypoint;

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: waypoint.name,
          artist: this.manifest.trail_name || 'TrailPulse',
          album: 'TrailPulse Outdoors',
          artwork: [
            {
              src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="%234ade80"><circle cx="48" cy="48" r="44" fill="%230f2d1e"/><path d="M48 24 L28 64 L48 56 L68 64 Z" fill="%234ade80"/></svg>',
              sizes: '96x96',
              type: 'image/svg+xml'
            }
          ]
        });
        navigator.mediaSession.playbackState = 'playing';
      }

      await this.audioElement.play();
      this.isPlaying = true;
      this.notify();
    } catch (err: unknown) {
      console.error('[TrailSpatialEngine] Audio playback error:', err);
      this.isPlaying = false;
      this.currentPlayingWaypoint = null;
      this.notify();
    }
  }

  public async testAudio(targetWaypoint?: WaypointTrigger): Promise<void> {
    const target = targetWaypoint || this.manifest.waypoints[0];
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

// Backward-compatible alias
export { TrailSpatialEngine as GeofenceEngine };

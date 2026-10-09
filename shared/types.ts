export interface Coordinate {
  lat: number;
  lon: number;
  elevation?: number;
}

export interface WaypointTrigger {
  id: string;
  name: string;
  lat: number;
  lon: number;
  trigger_radius_meters: number;
  audio_file: string; // e.g., "audio/wp_1.mp3"
  transcript: string;
  cooldown_seconds: number;
  lastPlayedAt?: number;
}

export interface TrailManifest {
  trail_id: string;
  trail_name: string;
  generated_at: string;
  total_distance_km: number;
  waypoints: WaypointTrigger[];
}

export interface POIResult {
  name: string;
  type: string;
  lat: number;
  lon: number;
  environmentContext?: string;
}

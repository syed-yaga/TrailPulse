import type { Coordinate, POIResult } from "../../../shared/types.js";
import type { SampledWaypointCoordinate } from "./gpxParser.js";

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

const OVERPASS_ENDPOINTS: string[] = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export function classifyEnvironment(
  tags: Record<string, string> = {},
  fallbackHint: string = "",
): string {
  const highway = tags.highway?.toLowerCase();
  const leisure = tags.leisure?.toLowerCase();
  const amenity = tags.amenity?.toLowerCase();
  const shop = tags.shop?.toLowerCase();
  const building = tags.building?.toLowerCase();
  const natural = tags.natural?.toLowerCase();
  const waterway = tags.waterway?.toLowerCase();
  const landuse = tags.landuse?.toLowerCase();

  if (
    (leisure &&
      [
        "park",
        "garden",
        "pitch",
        "playground",
        "recreation_ground",
        "nature_reserve",
      ].includes(leisure)) ||
    (landuse &&
      ["village_green", "recreation_ground", "grass", "meadow"].includes(
        landuse,
      )) ||
    (amenity && ["park", "community_centre"].includes(amenity))
  ) {
    return "Community park, grass lawn, tree canopy";
  }

  if (
    shop ||
    (highway &&
      [
        "primary",
        "secondary",
        "tertiary",
        "residential",
        "living_street",
        "pedestrian",
        "service",
        "unclassified",
        "trunk",
        "footway",
        "cycleway",
      ].includes(highway)) ||
    (amenity &&
      [
        "marketplace",
        "cafe",
        "restaurant",
        "fast_food",
        "bank",
        "pharmacy",
        "school",
        "hospital",
        "place_of_worship",
        "bus_station",
        "parking",
      ].includes(amenity)) ||
    building
  ) {
    return "Urban streetscape, paved road, bustling local lane";
  }

  if (
    waterway ||
    (natural && ["water", "bay", "wetland", "beach"].includes(natural))
  ) {
    return "Waterfront pathway, open water canal, breezy embankment";
  }

  if (
    (highway && ["path", "track", "bridleway", "steps"].includes(highway)) ||
    (natural &&
      [
        "wood",
        "tree",
        "peak",
        "cliff",
        "ridge",
        "scrub",
        "heath",
        "rock",
        "fell",
      ].includes(natural))
  ) {
    return "Open terrain, natural trail, hillside";
  }

  const hint = fallbackHint.toLowerCase();
  if (
    hint.includes("park") ||
    hint.includes("garden") ||
    hint.includes("lawn") ||
    hint.includes("maidan")
  ) {
    return "Community park, grass lawn, tree canopy";
  }

  if (
    hint.includes("marg") ||
    hint.includes("road") ||
    hint.includes("street") ||
    hint.includes("lane") ||
    hint.includes("nagar") ||
    hint.includes("bazaar") ||
    hint.includes("market") ||
    hint.includes("colony") ||
    hint.includes("avenue") ||
    hint.includes("ave") ||
    hint.includes("blvd") ||
    hint.includes("drive")
  ) {
    return "Urban streetscape, paved road, bustling local lane";
  }

  if (
    hint.includes("trail") ||
    hint.includes("ridge") ||
    hint.includes("summit") ||
    hint.includes("peak") ||
    hint.includes("mountain") ||
    hint.includes("canyon")
  ) {
    return "Open terrain, natural trail, hillside";
  }

  return "Local pathway, open neighborhood walkway";
}

function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, " ");
}

export function getDeterministicFallbackPOI(
  waypoint: SampledWaypointCoordinate,
  index: number,
  trackName: string = "Route",
): POIResult {
  const cleanTrackName = trackName || "Route";
  const name =
    waypoint.defaultName || `${cleanTrackName} - Waypoint ${index + 1}`;
  const envContext = classifyEnvironment(
    {},
    `${cleanTrackName} ${waypoint.defaultName}`,
  );

  return {
    name,
    type: (waypoint.role || "waypoint").toLowerCase(),
    lat: waypoint.coordinate.lat,
    lon: waypoint.coordinate.lon,
    environmentContext: envContext,
  };
}

export async function queryNearbyPOI(
  coord: Coordinate,
  waypoint: SampledWaypointCoordinate,
  index: number,
  trackName: string = "Route",
): Promise<POIResult> {
  const { lat, lon } = coord;
  const radiusMeters = 350;

  const query = `[out:json][timeout:6];(
    node(around:${radiusMeters},${lat},${lon})["highway"];
    node(around:${radiusMeters},${lat},${lon})["leisure"];
    node(around:${radiusMeters},${lat},${lon})["amenity"];
    node(around:${radiusMeters},${lat},${lon})["shop"];
    node(around:${radiusMeters},${lat},${lon})["tourism"];
    node(around:${radiusMeters},${lat},${lon})["natural"];
    way(around:${radiusMeters},${lat},${lon})["highway"];
    way(around:${radiusMeters},${lat},${lon})["leisure"];
    way(around:${radiusMeters},${lat},${lon})["amenity"];
    way(around:${radiusMeters},${lat},${lon})["natural"];
    way(around:${radiusMeters},${lat},${lon})["waterway"];
  );out center tags 10;`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = (await response.json()) as OverpassResponse;
        if (data && Array.isArray(data.elements) && data.elements.length > 0) {
          const namedElement = data.elements.find(
            (el) => el.tags && (el.tags.name || el.tags["name:en"]),
          );
          const element = namedElement || data.elements[0];

          if (element && element.tags) {
            const rawName = element.tags.name || element.tags["name:en"];
            const tags = element.tags;

            let title = rawName;
            let type = "pathway";

            if (tags.highway) type = tags.highway;
            else if (tags.amenity) type = tags.amenity;
            else if (tags.leisure) type = tags.leisure;
            else if (tags.shop) type = tags.shop;
            else if (tags.natural) type = tags.natural;
            else if (tags.tourism) type = tags.tourism;

            if (!title) {
              if (tags.highway) {
                title = `${capitalize(tags.highway)} Walkway`;
              } else if (tags.leisure) {
                title = `${capitalize(tags.leisure)} Space`;
              } else if (tags.amenity) {
                title = `${capitalize(tags.amenity)} Area`;
              } else if (tags.shop) {
                title = `Local ${capitalize(tags.shop)} Store`;
              } else if (tags.natural) {
                title = `${capitalize(tags.natural)} Landmark`;
              } else {
                title =
                  waypoint.defaultName ||
                  `${trackName} - Waypoint ${index + 1}`;
              }
            }

            const envContext = classifyEnvironment(
              tags,
              `${trackName} ${title}`,
            );
            const poiLat = element.lat || element.center?.lat || lat;
            const poiLon = element.lon || element.center?.lon || lon;

            return {
              name: title,
              type,
              lat: poiLat,
              lon: poiLon,
              environmentContext: envContext,
            };
          }
        }
      }
    } catch {
    } finally {
      clearTimeout(timeout);
    }
  }

  return getDeterministicFallbackPOI(waypoint, index, trackName);
}

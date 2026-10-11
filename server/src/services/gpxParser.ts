import { DOMParser } from "@xmldom/xmldom";
import * as toGeoJSON from "@tmcw/togeojson";
import type { Coordinate } from "../../../shared/types.js";

export interface SampledWaypointCoordinate {
  id: string;
  step: number;
  role: "Trailhead" | "Terminus" | "Peak" | "Valley" | "Waypoint";
  defaultName: string;
  coordinate: Coordinate;
  distanceAlongTrailMeters: number;
}

export interface ParsedTrailResult {
  trailName: string;
  totalDistanceKm: number;
  totalDistanceMeters: number;
  allCoordinates: Coordinate[];
  sampledWaypoints: SampledWaypointCoordinate[];
}

export function haversineDistanceMeters(
  coord1: [number, number],
  coord2: [number, number],
): number {
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;

  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function extractCoordinateTuples(
  raw: unknown,
): Array<[number, number, number | undefined]> {
  const result: Array<[number, number, number | undefined]> = [];

  function traverse(item: unknown): void {
    if (!Array.isArray(item)) return;

    if (
      item.length >= 2 &&
      typeof item[0] === "number" &&
      typeof item[1] === "number"
    ) {
      const lon = item[0] as number;
      const lat = item[1] as number;
      const ele = typeof item[2] === "number" ? (item[2] as number) : undefined;
      result.push([lon, lat, ele]);
    } else {
      for (const sub of item) {
        traverse(sub);
      }
    }
  }

  traverse(raw);
  return result;
}

export function parseGPXAndSampleWaypoints(
  gpxXmlString: string,
): ParsedTrailResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxXmlString, "application/xml");
  const geojson = toGeoJSON.gpx(doc);

  let trailName = "Walking Route";
  const nameNodes = doc.getElementsByTagName("name");
  if (nameNodes && nameNodes.length > 0 && nameNodes[0]?.textContent) {
    trailName = nameNodes[0].textContent.trim();
  }

  const rawTuples: Array<[number, number, number | undefined]> = [];
  for (const feature of geojson.features) {
    if (feature.geometry && feature.geometry.coordinates) {
      const extracted = extractCoordinateTuples(feature.geometry.coordinates);
      rawTuples.push(...extracted);
    }
  }

  if (rawTuples.length < 2) {
    throw new Error(
      "GPX contains insufficient track points (minimum 2 required).",
    );
  }

  const allCoordinates: Coordinate[] = rawTuples.map(
    ([lon, lat, elevation]) => ({
      lat,
      lon,
      elevation,
    }),
  );

  const cumulativeDistances: number[] = [0];
  let totalDistanceMeters = 0;
  let minEle = Infinity;
  let maxEle = -Infinity;
  let minEleIdx = 0;
  let maxEleIdx = 0;
  let hasElevation = false;

  for (let i = 0; i < rawTuples.length; i++) {
    const pt = rawTuples[i];
    const ele = pt[2];

    if (ele !== undefined && !isNaN(ele)) {
      hasElevation = true;
      if (ele < minEle) {
        minEle = ele;
        minEleIdx = i;
      }
      if (ele > maxEle) {
        maxEle = ele;
        maxEleIdx = i;
      }
    }

    if (i > 0) {
      const prevCoord: [number, number] = [
        rawTuples[i - 1][0],
        rawTuples[i - 1][1],
      ];
      const currCoord: [number, number] = [rawTuples[i][0], rawTuples[i][1]];
      const segDist = haversineDistanceMeters(prevCoord, currCoord);
      totalDistanceMeters += segDist;
      cumulativeDistances.push(totalDistanceMeters);
    }
  }

  const candidateIndices = new Set<number>();
  candidateIndices.add(0);
  candidateIndices.add(rawTuples.length - 1);

  if (hasElevation && maxEleIdx !== 0 && maxEleIdx !== rawTuples.length - 1) {
    candidateIndices.add(maxEleIdx);
  }
  if (
    hasElevation &&
    minEleIdx !== 0 &&
    minEleIdx !== rawTuples.length - 1 &&
    minEleIdx !== maxEleIdx
  ) {
    candidateIndices.add(minEleIdx);
  }

  const targetFractions = [0.25, 0.5, 0.75];
  for (const frac of targetFractions) {
    const targetDist = totalDistanceMeters * frac;
    let bestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < cumulativeDistances.length; i++) {
      const diff = Math.abs(cumulativeDistances[i] - targetDist);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }
    candidateIndices.add(bestIdx);
  }

  const sortedIndices = Array.from(candidateIndices).sort((a, b) => a - b);
  const minSeparationMeters = Math.min(150, totalDistanceMeters / 6);
  const selectedIndices: number[] = [sortedIndices[0]];

  for (let i = 1; i < sortedIndices.length; i++) {
    const currentIdx = sortedIndices[i];
    const prevSelectedIdx = selectedIndices[selectedIndices.length - 1];
    const distBetween = Math.abs(
      cumulativeDistances[currentIdx] - cumulativeDistances[prevSelectedIdx],
    );

    if (
      distBetween >= minSeparationMeters ||
      currentIdx === rawTuples.length - 1
    ) {
      if (
        currentIdx === rawTuples.length - 1 &&
        distBetween < minSeparationMeters &&
        selectedIndices.length > 1
      ) {
        selectedIndices[selectedIndices.length - 1] = currentIdx;
      } else {
        selectedIndices.push(currentIdx);
      }
    }
  }

  let finalIndices = selectedIndices;
  if (finalIndices.length > 6) {
    const start = finalIndices[0];
    const end = finalIndices[finalIndices.length - 1];
    const middle = finalIndices.slice(1, -1);
    const step = middle.length / 4;
    const pickedMiddle: number[] = [];
    for (let s = 0; s < 4; s++) {
      pickedMiddle.push(middle[Math.floor(s * step)]);
    }
    finalIndices = [start, ...new Set(pickedMiddle), end].sort((a, b) => a - b);
  }

  if (finalIndices.length < 3 && rawTuples.length > 2) {
    const midIdx = Math.floor(rawTuples.length / 2);
    finalIndices.splice(1, 0, midIdx);
  }

  const sampledWaypoints: SampledWaypointCoordinate[] = finalIndices.map(
    (idx, stepIndex) => {
      const tuple = rawTuples[idx];
      const lon = tuple[0];
      const lat = tuple[1];
      const ele = tuple[2] !== undefined ? Math.round(tuple[2]) : undefined;
      const distanceMeters = Math.round(cumulativeDistances[idx]);

      let role: "Trailhead" | "Terminus" | "Peak" | "Valley" | "Waypoint" =
        "Waypoint";
      let defaultName = `${trailName} - Waypoint ${stepIndex + 1}`;

      if (idx === 0) {
        role = "Trailhead";
        defaultName = `${trailName} - Start Point`;
      } else if (idx === rawTuples.length - 1) {
        role = "Terminus";
        defaultName = `${trailName} - End Point`;
      } else if (idx === maxEleIdx && hasElevation && maxEle - minEle > 35) {
        role = "Peak";
        defaultName = `${trailName} - Elevated View (${ele}m)`;
      } else if (idx === minEleIdx && hasElevation && maxEle - minEle > 35) {
        role = "Valley";
        defaultName = `${trailName} - Dip (${ele}m)`;
      } else {
        defaultName = `${trailName} - Waypoint ${stepIndex + 1}`;
      }

      return {
        id: `wp_${stepIndex + 1}`,
        step: stepIndex + 1,
        role,
        defaultName,
        coordinate: { lat, lon, elevation: ele },
        distanceAlongTrailMeters: distanceMeters,
      };
    },
  );

  return {
    trailName,
    totalDistanceKm: Number((totalDistanceMeters / 1000).toFixed(2)),
    totalDistanceMeters: Math.round(totalDistanceMeters),
    allCoordinates,
    sampledWaypoints,
  };
}

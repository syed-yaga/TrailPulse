declare module '@tmcw/togeojson' {
  export interface GeoJsonGeometry {
    type: string;
    coordinates: unknown;
  }

  export interface GeoJsonFeature {
    type: 'Feature';
    geometry: GeoJsonGeometry;
    properties?: Record<string, unknown>;
  }

  export interface GeoJsonFeatureCollection {
    type: 'FeatureCollection';
    features: GeoJsonFeature[];
  }

  export type GeoJsonObject = GeoJsonFeatureCollection | GeoJsonFeature;

  export function gpx(doc: unknown): GeoJsonFeatureCollection;
}

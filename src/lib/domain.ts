export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type MapBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type Review = {
  id: string;
  author: string;
  score: number;
  body: string;
  time: string;
};

export type HelpRequest = {
  id: string;
  body: string;
  time: string;
  status: "active" | "resolved";
};

export type ToiletSource = "user" | "osm" | string;

export type Toilet = {
  id: string;
  name: string;
  regionName: string;
  location: string;
  floor: string;
  isOpen: boolean;
  hasPaper: boolean;
  isClean: boolean;
  accessibility: boolean;
  rating: number;
  reviewCount: number;
  lastUpdated: string;
  note: string;
  source?: ToiletSource;
  sourceLicense?: string | null;
  sourceAttribution?: string | null;
  sourceStatus?: "active" | "needs_verification" | string;
  lastImportedAt?: string | null;
  latitude: number | null;
  longitude: number | null;
  regionCenter: Coordinates | null;
  reviews: Review[];
  helpRequests: HelpRequest[];
};

export type ToiletSummary = Pick<
  Toilet,
  | "id"
  | "name"
  | "regionName"
  | "location"
  | "floor"
  | "isOpen"
  | "hasPaper"
  | "isClean"
  | "accessibility"
  | "rating"
  | "reviewCount"
  | "lastUpdated"
  | "source"
  | "sourceStatus"
  | "latitude"
  | "longitude"
  | "regionCenter"
> & {
  activeHelpRequestCount: number;
};

export type NewToiletForm = {
  name: string;
  location: string;
  floor: string;
  isOpen: boolean;
  hasPaper: boolean;
  isClean: boolean;
  accessibility: boolean;
  latitude: string;
  longitude: string;
};

export type DataSource = "supabase" | "error";

export function parseCoordinate(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function hasValidCoordinates(toilet: Pick<Toilet, "latitude" | "longitude">) {
  return isValidCoordinate(toilet.latitude, toilet.longitude);
}

export function isValidCoordinate(latitude: unknown, longitude: unknown) {
  const lat = Number(latitude);
  const lon = Number(longitude);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

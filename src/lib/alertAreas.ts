// T1.9W: shared types, limits and map helpers for the alert areas screen (app/alert-areas.tsx).
// The API calls stay in the screen; this file only holds data that both the list and the editor use.

export type Point = { latitude: number; longitude: number };
export type AreaMode = "CIRCLE" | "POLYGON";
export type Area = {
  id: string;
  name: string;
  area_type?: AreaMode;
  latitude: number | null;
  longitude: number | null;
  radius_m: number | null;
  boundary_points?: Point[];
  category_keys: string[];
  all_categories: boolean;
  push_enabled: boolean;
  active: boolean;
  source_type?: "SAVED" | "CURRENT_LOCATION";
  expires_at?: string | null;
  location_updated_at?: string | null;
};

// How many saved areas a user can follow. The server enforces the same limit
// (WATCH_AREA_LIMIT_REACHED); the "Varsle meg der jeg er" area does not count.
export const MAX_SAVED_AREAS = 3;

// One radius list for the whole screen. The server accepts all of these for saved areas,
// but only 1 km and up for the position alert, so that list is derived from this one.
export const RADII = [250, 500, 1000, 3000, 5000, 10000];
export const CURRENT_LOCATION_RADII = RADII.filter((value) => value >= 1000);
export const DEFAULT_SAVED_RADIUS = 1000;
export const DEFAULT_CURRENT_RADIUS = 3000;

// Expiry choices for the position alert, in hours. 0 = until the user turns it off.
export const EXPIRIES = [24, 72, 168, 0];
// T1.9AA: "Varsle meg der jeg er" stays on until the user turns it off, unless they pick a period.
export const DEFAULT_EXPIRY_HOURS = 0;

export const CATEGORIES = ["PETS", "JEWELRY", "ELECTRONICS", "KEYS", "BAGS", "CLOTHING", "SPORTS", "TRANSPORT"] as const;
export const CATEGORY_LABEL_KEYS = {
  PETS: "alertAreas.category.pets",
  JEWELRY: "alertAreas.category.jewelry",
  ELECTRONICS: "alertAreas.category.electronics",
  KEYS: "alertAreas.category.keys",
  BAGS: "alertAreas.category.bags",
  CLOTHING: "alertAreas.category.clothing",
  SPORTS: "alertAreas.category.sports",
  TRANSPORT: "alertAreas.category.transport",
} as const;

export const DEFAULT_CENTER: Point = { latitude: 59.9139, longitude: 10.7522 };

// Saved areas get a colour by their place in the list, so the dot in the list matches the map.
export const AREA_COLORS = ["#2563EB", "#7C3AED", "#EA580C"];
export const CURRENT_LOCATION_COLOR = "#16A34A";
export const areaColor = (index: number) => AREA_COLORS[index % AREA_COLORS.length];

export const isCurrentLocationArea = (area: Area) => area.source_type === "CURRENT_LOCATION";

export const validPoint = (value: any): value is Point =>
  value != null &&
  value.latitude != null &&
  value.longitude != null &&
  Number.isFinite(Number(value.latitude)) &&
  Number.isFinite(Number(value.longitude));

export const areaCenter = (area: Area): Point | null =>
  validPoint({ latitude: area.latitude, longitude: area.longitude })
    ? { latitude: Number(area.latitude), longitude: Number(area.longitude) }
    : null;

export const circleBounds = (center: Point, radiusMeters: number): Point[] => {
  const latitudeOffset = radiusMeters / 111_320;
  const longitudeScale = Math.max(0.15, Math.cos((center.latitude * Math.PI) / 180));
  const longitudeOffset = radiusMeters / (111_320 * longitudeScale);
  return [
    { latitude: center.latitude + latitudeOffset, longitude: center.longitude },
    { latitude: center.latitude - latitudeOffset, longitude: center.longitude },
    { latitude: center.latitude, longitude: center.longitude + longitudeOffset },
    { latitude: center.latitude, longitude: center.longitude - longitudeOffset },
  ];
};

// Points that frame an area on the map (polygon corners, or the edges of the circle).
export const areaBounds = (area: Area): Point[] => {
  const polygon = (area.boundary_points || []).filter(validPoint);
  if (area.area_type === "POLYGON" && polygon.length >= 3) return polygon;
  const center = areaCenter(area);
  return center ? circleBounds(center, area.radius_m || DEFAULT_SAVED_RADIUS) : [];
};

// Maps the time left on the position alert back to one of the expiry choices.
export const expiryChoiceFor = (expiresAt?: string | null) => {
  if (!expiresAt) return 0;
  const hoursLeft = Math.max(1, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3600000));
  return hoursLeft <= 24 ? 24 : hoursLeft <= 72 ? 72 : 168;
};

export type CurrentSettings = {
  radius: number;
  expiryHours: number;
  allCategories: boolean;
  categories: string[];
};

export const DEFAULT_CURRENT_SETTINGS: CurrentSettings = {
  radius: DEFAULT_CURRENT_RADIUS,
  expiryHours: DEFAULT_EXPIRY_HOURS,
  allCategories: true,
  categories: [],
};

export const currentSettingsFrom = (area: Area | null): CurrentSettings =>
  area
    ? {
        radius: Number(area.radius_m || DEFAULT_CURRENT_RADIUS),
        expiryHours: expiryChoiceFor(area.expires_at),
        allCategories: area.all_categories !== false,
        categories: area.category_keys || [],
      }
    : DEFAULT_CURRENT_SETTINGS;

export const sameSettings = (a: CurrentSettings, b: CurrentSettings) =>
  a.radius === b.radius &&
  a.expiryHours === b.expiryHours &&
  a.allCategories === b.allCategories &&
  [...a.categories].sort().join(",") === [...b.categories].sort().join(",");

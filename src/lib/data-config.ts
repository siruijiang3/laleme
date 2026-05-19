export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type SupabaseUrlValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

const officialOsmTileHosts = new Set([
  "tile.openstreetmap.org",
  "a.tile.openstreetmap.org",
  "b.tile.openstreetmap.org",
  "c.tile.openstreetmap.org",
]);

export function validateSupabasePublicUrl(
  value = process.env.NEXT_PUBLIC_SUPABASE_URL,
): SupabaseUrlValidation {
  const rawValue = value?.trim();

  if (!rawValue) {
    return {
      ok: false,
      reason: "缺少 NEXT_PUBLIC_SUPABASE_URL。",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    return {
      ok: false,
      reason: "NEXT_PUBLIC_SUPABASE_URL 不是有效 URL。",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: "NEXT_PUBLIC_SUPABASE_URL 必须使用 https://。",
    };
  }

  if (!parsed.hostname.endsWith(".supabase.co")) {
    return {
      ok: false,
      reason: "NEXT_PUBLIC_SUPABASE_URL 必须指向 Hosted Supabase（*.supabase.co）。",
    };
  }

  if (isLocalOrPrivateHostname(parsed.hostname)) {
    return {
      ok: false,
      reason: "生产环境不能使用 localhost、127.0.0.1 或局域网 Supabase 地址。",
    };
  }

  return { ok: true, url: parsed };
}

export function validateMapStyleUrl(value = process.env.NEXT_PUBLIC_MAP_STYLE_URL) {
  const rawValue = value?.trim();

  if (!rawValue) {
    return "缺少 NEXT_PUBLIC_MAP_STYLE_URL。生产版本必须配置真实 MapLibre style JSON URL。";
  }

  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    return "NEXT_PUBLIC_MAP_STYLE_URL 不是有效 URL。";
  }

  if (parsed.protocol !== "https:") {
    return "NEXT_PUBLIC_MAP_STYLE_URL 必须使用 https://。";
  }

  if (officialOsmTileHosts.has(parsed.hostname)) {
    return "不要把 OpenStreetMap 官方 tile server 当作生产底图 CDN。";
  }

  return null;
}

export function readDefaultMapCenter(): Coordinates {
  const latitude = Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_LATITUDE);
  const longitude = Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_LONGITUDE);

  if (isValidCoordinate(latitude, longitude)) {
    return { latitude, longitude };
  }

  return { latitude: 22.3193, longitude: 114.1694 };
}

export function validateDefaultMapCenter() {
  const latitude = Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_LATITUDE);
  const longitude = Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_LONGITUDE);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return "缺少 NEXT_PUBLIC_DEFAULT_MAP_LATITUDE / NEXT_PUBLIC_DEFAULT_MAP_LONGITUDE。";
  }

  if (!isValidCoordinate(latitude, longitude)) {
    return "默认地图中心坐标超出有效经纬度范围。";
  }

  return null;
}

export function getPublicRuntimeConfigIssue() {
  const supabaseValidation = validateSupabasePublicUrl();
  if (!supabaseValidation.ok) {
    return supabaseValidation.reason;
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) {
    return "缺少 NEXT_PUBLIC_SUPABASE_ANON_KEY。";
  }

  return validateMapStyleUrl() ?? validateDefaultMapCenter();
}

export function isLocalOrPrivateHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();

  if (
    normalizedHostname === "localhost" ||
    normalizedHostname === "0.0.0.0" ||
    normalizedHostname === "::1" ||
    normalizedHostname.endsWith(".local")
  ) {
    return true;
  }

  const parts = normalizedHostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function isValidCoordinate(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

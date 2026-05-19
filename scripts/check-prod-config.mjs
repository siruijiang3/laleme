#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const officialOsmTileHosts = new Set([
  "tile.openstreetmap.org",
  "a.tile.openstreetmap.org",
  "b.tile.openstreetmap.org",
  "c.tile.openstreetmap.org",
]);

await loadLocalEnv();

const failures = [];
const warnings = [];

const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const adminToken = process.env.ADMIN_TOKEN?.trim();
const mapStyleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim();
const defaultLatitude = process.env.NEXT_PUBLIC_DEFAULT_MAP_LATITUDE?.trim();
const defaultLongitude = process.env.NEXT_PUBLIC_DEFAULT_MAP_LONGITUDE?.trim();
const geofabrikIds = process.env.OSM_GEOFABRIK_IDS?.trim();
const geofabrikUrls = process.env.OSM_GEOFABRIK_URLS?.trim();

if (!publicUrl) {
  failures.push("NEXT_PUBLIC_SUPABASE_URL is required in production.");
} else {
  const validation = validateHostedSupabaseUrl(publicUrl);
  if (!validation.valid) {
    failures.push(validation.reason);
  }
}

if (!anonKey) {
  failures.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is required in production.");
}

if (!serviceRoleKey) {
  failures.push("SUPABASE_SERVICE_ROLE_KEY is required for production API, admin, and OSM sync.");
}

if (!adminToken) {
  failures.push("ADMIN_TOKEN is required for production admin operations.");
}

if (!mapStyleUrl) {
  failures.push("NEXT_PUBLIC_MAP_STYLE_URL is required in production.");
} else {
  const validation = validateMapStyleUrl(mapStyleUrl);
  if (!validation.valid) {
    failures.push(validation.reason);
  }
}

const centerValidation = validateDefaultMapCenter(defaultLatitude, defaultLongitude);
if (!centerValidation.valid) {
  failures.push(centerValidation.reason);
}

if (!geofabrikIds && !geofabrikUrls) {
  warnings.push("OSM_GEOFABRIK_IDS or OSM_GEOFABRIK_URLS is missing. Scheduled global OSM sync needs targets.");
}

for (const warning of warnings) {
  console.warn(`warning: ${warning}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`error: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Production config check passed.");
}

async function loadLocalEnv() {
  for (const fileName of [".env.production.local", ".env"]) {
    const filePath = resolve(process.cwd(), fileName);
    let content = "";

    try {
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = unquoteEnvValue(trimmed.slice(separatorIndex + 1).trim());

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function validateHostedSupabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return {
      valid: false,
      reason: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL.",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      reason: "NEXT_PUBLIC_SUPABASE_URL must use https:// in production.",
    };
  }

  if (!parsed.hostname.endsWith(".supabase.co")) {
    return {
      valid: false,
      reason: "NEXT_PUBLIC_SUPABASE_URL must point to Hosted Supabase (*.supabase.co).",
    };
  }

  if (isLocalOrPrivateHostname(parsed.hostname)) {
    return {
      valid: false,
      reason: "NEXT_PUBLIC_SUPABASE_URL cannot be localhost, 127.0.0.1, or a LAN address in production.",
    };
  }

  return { valid: true };
}

function validateMapStyleUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return {
      valid: false,
      reason: "NEXT_PUBLIC_MAP_STYLE_URL must be a valid URL.",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      reason: "NEXT_PUBLIC_MAP_STYLE_URL must use https:// in production.",
    };
  }

  if (officialOsmTileHosts.has(parsed.hostname)) {
    return {
      valid: false,
      reason: "Do not use the official OpenStreetMap tile server as production CDN.",
    };
  }

  return { valid: true };
}

function validateDefaultMapCenter(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      valid: false,
      reason: "NEXT_PUBLIC_DEFAULT_MAP_LATITUDE and NEXT_PUBLIC_DEFAULT_MAP_LONGITUDE are required.",
    };
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return {
      valid: false,
      reason: "Default map center must be valid latitude/longitude.",
    };
  }

  return { valid: true };
}

function isLocalOrPrivateHostname(hostname) {
  const normalized = hostname.toLowerCase();

  if (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  const parts = normalized.split(".").map((part) => Number(part));
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

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

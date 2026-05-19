#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const OSM_LICENSE = "ODbL-1.0";
const OSM_ATTRIBUTION = "OpenStreetMap contributors";
const DEFAULT_GEOFABRIK_INDEX_URL = "https://download.geofabrik.de/index-v1.json";
const DEFAULT_CACHE_DIR = ".data/osm";
const DEFAULT_BATCH_SIZE = 500;

async function main() {
  await loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  await ensureCommand("osmium", "Install osmium-tool first: brew install osmium-tool");
  const supabase = options.dryRun ? null : createSupabaseClient();
  const extracts = await resolveExtracts(options);
  await mkdir(options.cacheDir, { recursive: true });

  let totalImported = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalDeleted = 0;
  let totalProtected = 0;
  let totalStale = 0;
  const startedAt = new Date();

  for (const extract of extracts) {
    const runId = options.dryRun ? null : await createSyncRun(supabase, extract);

    try {
      const pbfPath = await downloadExtract(extract, options);
      const filteredPath = await filterToilets(pbfPath, options);
      const geojsonSeqPath = await exportGeoJsonSeq(filteredPath, options);
      const toilets = await readToiletFeatures(geojsonSeqPath, extract, options.limit);
      totalImported += toilets.length;

      if (options.dryRun) {
        printExtractSummary({
          dryRun: true,
          extract,
          importedCount: toilets.length,
          insertedCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          deletedCount: 0,
          protectedCount: 0,
          staleCount: 0,
          finalized: false,
        });
        continue;
      }

      const importResult = await importBatches(supabase, toilets, extract, options.batchSize);
      const lifecycleResult = options.limit
        ? skippedLifecycleFinalization()
        : await finalizeOsmSync(supabase, toilets, extract);
      totalInserted += importResult.insertedCount;
      totalUpdated += importResult.updatedCount;
      totalSkipped += importResult.skippedCount;
      totalDeleted += lifecycleResult.deletedCount;
      totalProtected += lifecycleResult.protectedCount;
      totalStale += lifecycleResult.staleCount;

      if (runId) {
        await finishSyncRun(supabase, runId, {
          status: "succeeded",
          importedCount: toilets.length,
          insertedCount: importResult.insertedCount,
          updatedCount: importResult.updatedCount,
          skippedCount: importResult.skippedCount,
          deletedCount: lifecycleResult.deletedCount,
          protectedCount: lifecycleResult.protectedCount,
          staleCount: lifecycleResult.staleCount,
        });
      }

      printExtractSummary({
        dryRun: false,
        extract,
        importedCount: toilets.length,
        insertedCount: importResult.insertedCount,
        updatedCount: importResult.updatedCount,
        skippedCount: importResult.skippedCount,
        deletedCount: lifecycleResult.deletedCount,
        protectedCount: lifecycleResult.protectedCount,
        staleCount: lifecycleResult.staleCount,
        finalized: lifecycleResult.finalized,
      });
    } catch (error) {
      if (runId) {
        await finishSyncRun(supabase, runId, {
          status: "failed",
          errorMessage: formatError(error),
        });
      }

      throw error;
    }
  }

  const durationSeconds = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
  console.log(
    [
      options.dryRun ? "Geofabrik OSM toilet dry run completed." : "Geofabrik OSM toilet sync completed.",
      `extracts=${extracts.length}`,
      `imported=${totalImported}`,
      `inserted=${totalInserted}`,
      `updated=${totalUpdated}`,
      `skipped=${totalSkipped}`,
      `deleted=${totalDeleted}`,
      `protected=${totalProtected}`,
      `stale=${totalStale}`,
      `duration_seconds=${durationSeconds}`,
    ].join("\n"),
  );
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
      const rawValue = trimmed.slice(separatorIndex + 1).trim();

      if (!key || process.env[key] !== undefined) {
        continue;
      }

      process.env[key] = unquoteEnvValue(rawValue);
    }
  }
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

function parseArgs(args) {
  const options = {
    geofabrikIds: parseList(process.env.OSM_GEOFABRIK_IDS),
    geofabrikUrls: parseList(process.env.OSM_GEOFABRIK_URLS),
    geofabrikIndexUrl: process.env.OSM_GEOFABRIK_INDEX_URL || DEFAULT_GEOFABRIK_INDEX_URL,
    cacheDir: resolve(process.cwd(), process.env.OSM_CACHE_DIR || DEFAULT_CACHE_DIR),
    batchSize: parsePositiveInteger(process.env.OSM_BATCH_SIZE) ?? DEFAULT_BATCH_SIZE,
    limit: parsePositiveInteger(process.env.OSM_IMPORT_LIMIT),
    dryRun: false,
    refresh: false,
    allGeofabrik: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--refresh") {
      options.refresh = true;
      continue;
    }

    if (arg === "--all-geofabrik") {
      options.allGeofabrik = true;
      continue;
    }

    const [key, value] = arg.split("=", 2);

    if (key === "--geofabrik-id") {
      options.geofabrikIds.push(...parseList(value));
    } else if (key === "--geofabrik-url") {
      options.geofabrikUrls.push(...parseList(value));
    } else if (key === "--geofabrik-index-url") {
      options.geofabrikIndexUrl = value;
    } else if (key === "--cache-dir") {
      options.cacheDir = resolve(process.cwd(), value);
    } else if (key === "--batch-size") {
      options.batchSize = parsePositiveInteger(value) ?? options.batchSize;
    } else if (key === "--limit") {
      options.limit = parsePositiveInteger(value);
    } else if (key === "--bbox" || key === "--region" || key === "--radius-km") {
      throw new Error("Overpass bbox/region sync has been removed. Use --geofabrik-id or --all-geofabrik.");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.help && !options.allGeofabrik && options.geofabrikIds.length === 0 && options.geofabrikUrls.length === 0) {
    throw new Error("Provide --geofabrik-id=monaco, --geofabrik-url=https://..., or --all-geofabrik.");
  }

  return options;
}

async function resolveExtracts(options) {
  const extracts = [];

  if (options.geofabrikUrls.length > 0) {
    extracts.push(
      ...options.geofabrikUrls.map((url) => ({
        id: extractIdFromUrl(url),
        name: extractIdFromUrl(url),
        pbfUrl: url,
        center: null,
      })),
    );
  }

  if (options.allGeofabrik || options.geofabrikIds.length > 0) {
    const index = await fetchJson(options.geofabrikIndexUrl);
    const features = Array.isArray(index.features) ? index.features : [];
    const parentIds = new Set(
      features
        .map((feature) => feature.properties?.parent)
        .filter((parent) => typeof parent === "string" && parent),
    );
    const byId = new Map(
      features
        .filter((feature) => feature.properties?.urls?.pbf)
        .map((feature) => [feature.properties.id, feature]),
    );

    const selectedFeatures = options.allGeofabrik
      ? features.filter(
          (feature) =>
            feature.properties?.urls?.pbf &&
            feature.properties?.id &&
            !parentIds.has(feature.properties.id),
        )
      : options.geofabrikIds.map((id) => {
          const feature = byId.get(id);
          if (!feature) {
            throw new Error(`Geofabrik extract not found in index: ${id}`);
          }

          return feature;
        });

    extracts.push(...selectedFeatures.map(featureToExtract));
  }

  return uniqueExtracts(extracts);
}

function featureToExtract(feature) {
  const properties = feature.properties ?? {};
  const center = featureCenter(feature);

  return {
    id: properties.id,
    name: properties.name ?? properties.id,
    pbfUrl: properties.urls.pbf,
    center,
  };
}

function featureCenter(feature) {
  const coordinates = [];
  collectCoordinates(feature.geometry?.coordinates, coordinates);

  if (coordinates.length === 0) {
    return null;
  }

  const latitudes = coordinates.map((coordinate) => coordinate[1]);
  const longitudes = coordinates.map((coordinate) => coordinate[0]);
  return {
    latitude: roundCoordinate((Math.min(...latitudes) + Math.max(...latitudes)) / 2),
    longitude: roundCoordinate((Math.min(...longitudes) + Math.max(...longitudes)) / 2),
  };
}

function collectCoordinates(value, output) {
  if (!Array.isArray(value)) {
    return;
  }

  if (typeof value[0] === "number" && typeof value[1] === "number") {
    output.push(value);
    return;
  }

  for (const item of value) {
    collectCoordinates(item, output);
  }
}

async function downloadExtract(extract, options) {
  const fileName = basename(new URL(extract.pbfUrl).pathname);
  const pbfPath = join(options.cacheDir, fileName);

  if (!options.refresh && (await fileExists(pbfPath))) {
    return pbfPath;
  }

  console.log(`Downloading ${extract.id} from ${extract.pbfUrl}`);
  const response = await fetch(extract.pbfUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${extract.id}: ${response.status} ${response.statusText}`);
  }

  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createWriteStream(pbfPath);
    response.body.pipeTo(
      new WritableStream({
        write(chunk) {
          stream.write(Buffer.from(chunk));
        },
        close() {
          stream.end(resolvePromise);
        },
        abort(error) {
          stream.destroy(error);
          rejectPromise(error);
        },
      }),
    ).catch(rejectPromise);
  });

  return pbfPath;
}

async function filterToilets(pbfPath, options) {
  const filteredPath = pbfPath.replace(/\.osm\.pbf$/, ".toilets.osm.pbf");
  await runCommand("osmium", [
    "tags-filter",
    "--overwrite",
    "-o",
    filteredPath,
    pbfPath,
    "n/amenity=toilets",
    "w/amenity=toilets",
    "r/amenity=toilets",
  ]);

  return filteredPath;
}

async function exportGeoJsonSeq(filteredPath) {
  const geojsonSeqPath = filteredPath.replace(/\.osm\.pbf$/, ".geojsonseq");
  await runCommand("osmium", [
    "export",
    "--overwrite",
    "--add-unique-id=type_id",
    "-f",
    "geojsonseq",
    "-o",
    geojsonSeqPath,
    filteredPath,
  ]);

  return geojsonSeqPath;
}

async function readToiletFeatures(geojsonSeqPath, extract, limit) {
  const content = await readFile(geojsonSeqPath, "utf8");
  const toilets = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.replace(/^\u001e/, "").trim();
    if (!trimmed) {
      continue;
    }

    const feature = JSON.parse(trimmed);
    const toilet = normalizeFeature(feature, extract);
    if (!toilet) {
      continue;
    }

    toilets.push(toilet);
    if (limit && toilets.length >= limit) {
      break;
    }
  }

  return toilets;
}

function normalizeFeature(feature, extract) {
  const coordinates = readFeatureCoordinates(feature);
  const identity = readOsmIdentity(feature);
  const tags = feature.properties && typeof feature.properties === "object" ? feature.properties : {};

  if (!coordinates || !identity || tags.amenity !== "toilets") {
    return null;
  }

  return {
    osmType: identity.osmType,
    osmId: identity.osmId,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    tags,
    name: buildToiletName(identity.osmType, identity.osmId, tags),
    floor: readTag(tags, "level") || "未确认",
    direction: buildDirection(tags),
    placeName: buildPlaceName(tags, extract),
    isAccessible: tags.wheelchair === "yes",
  };
}

function readFeatureCoordinates(feature) {
  const geometry = feature.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return null;
  }

  const coordinate = firstCoordinate(geometry.coordinates);
  if (!coordinate) {
    return null;
  }

  const [longitude, latitude] = coordinate;
  if (!isValidCoordinate(latitude, longitude)) {
    return null;
  }

  return {
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
  };
}

function firstCoordinate(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  if (typeof value[0] === "number" && typeof value[1] === "number") {
    return value;
  }

  return firstCoordinate(value[0]);
}

function readOsmIdentity(feature) {
  const candidates = [
    feature.id,
    feature.properties?.["@id"],
    feature.properties?.id,
    feature.properties?.osm_id,
  ];

  for (const candidate of candidates) {
    const identity = parseOsmIdentity(candidate);
    if (identity) {
      return identity;
    }
  }

  return null;
}

function parseOsmIdentity(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return { osmType: "node", osmId: value };
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  const slashMatch = /^(node|way|relation)\/(\d+)$/.exec(trimmed);
  if (slashMatch) {
    return { osmType: slashMatch[1], osmId: Number(slashMatch[2]) };
  }

  const compactMatch = /^([nwr])(\d+)$/.exec(trimmed);
  if (compactMatch) {
    const typeByPrefix = { n: "node", w: "way", r: "relation" };
    return { osmType: typeByPrefix[compactMatch[1]], osmId: Number(compactMatch[2]) };
  }

  return null;
}

async function importBatches(supabase, toilets, extract, batchSize) {
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (let index = 0; index < toilets.length; index += batchSize) {
    const batch = toilets.slice(index, index + batchSize);
    const { data, error } = await supabase.rpc("import_osm_toilets", {
      items: batch,
      import_region_slug: geofabrikRegionSlug(extract.id),
      import_region_name: `OSM ${extract.name}`,
      import_region_description: `Geofabrik extract ${extract.id} 导入的 OpenStreetMap 公共厕所。`,
      import_region_center_latitude: extract.center?.latitude ?? null,
      import_region_center_longitude: extract.center?.longitude ?? null,
    });

    if (error) {
      throw error;
    }

    insertedCount += Number(data?.insertedCount ?? 0);
    updatedCount += Number(data?.updatedCount ?? 0);
    skippedCount += Number(data?.skippedCount ?? 0);
  }

  return { insertedCount, updatedCount, skippedCount };
}

async function finalizeOsmSync(supabase, toilets, extract) {
  const { data, error } = await supabase.rpc("finalize_osm_toilet_sync", {
    import_region_slug: geofabrikRegionSlug(extract.id),
    current_osm_identities: currentOsmIdentities(toilets),
  });

  if (error) {
    throw error;
  }

  return {
    deletedCount: Number(data?.deletedCount ?? 0),
    protectedCount: Number(data?.protectedCount ?? 0),
    staleCount: Number(data?.staleCount ?? 0),
    finalized: true,
  };
}

function currentOsmIdentities(toilets) {
  const seen = new Set();
  const identities = [];

  for (const toilet of toilets) {
    const key = `${toilet.osmType}:${toilet.osmId}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    identities.push({
      osmType: toilet.osmType,
      osmId: toilet.osmId,
    });
  }

  return identities;
}

function skippedLifecycleFinalization() {
  console.warn(
    "Skipping OSM lifecycle finalization because --limit is set. Limited imports cannot safely detect deleted OSM toilets.",
  );

  return {
    deletedCount: 0,
    protectedCount: 0,
    staleCount: 0,
    finalized: false,
  };
}

async function createSyncRun(supabase, extract) {
  const { data, error } = await supabase
    .from("osm_sync_runs")
    .insert({
      region_slug: geofabrikRegionSlug(extract.id),
      bbox: {
        geofabrikId: extract.id,
        source: "geofabrik",
      },
      source_url: extract.pbfUrl,
      status: "running",
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id;
}

async function finishSyncRun(supabase, runId, patch) {
  const { error } = await supabase
    .from("osm_sync_runs")
    .update({
      imported_count: patch.importedCount ?? undefined,
      inserted_count: patch.insertedCount ?? undefined,
      updated_count: patch.updatedCount ?? undefined,
      skipped_count: patch.skippedCount ?? undefined,
      deleted_count: patch.deletedCount ?? undefined,
      protected_count: patch.protectedCount ?? undefined,
      stale_count: patch.staleCount ?? undefined,
      status: patch.status,
      error_message: patch.errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) {
    throw error;
  }
}

function createSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  validateHostedSupabaseUrl(supabaseUrl);
  if (!serviceRoleKey?.trim()) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function validateHostedSupabaseUrl(value) {
  if (!value) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Supabase URL is invalid.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Production OSM sync requires https:// Hosted Supabase URL.");
  }

  if (!parsed.hostname.endsWith(".supabase.co")) {
    throw new Error("Production OSM sync requires Hosted Supabase (*.supabase.co).");
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function ensureCommand(command, hint) {
  try {
    await runCommand(command, ["--version"], { quiet: true });
  } catch {
    throw new Error(`${command} is not installed. ${hint}`);
  }
}

async function runCommand(command, args, options = {}) {
  if (!options.quiet) {
    console.log([command, ...args].join(" "));
  }

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: options.quiet ? "ignore" : "inherit",
    });

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${command} exited with ${code}`));
    });
  });
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function buildToiletName(osmType, osmId, tags) {
  const name =
    readTag(tags, "name:zh-Hans") ||
    readTag(tags, "name:zh-Hant") ||
    readTag(tags, "name:zh") ||
    readTag(tags, "name") ||
    readTag(tags, "toilets:name");

  if (name) {
    return name;
  }

  const operator = readTag(tags, "operator");
  if (operator) {
    return `${operator}公共厕所`;
  }

  return `OSM 公共厕所 ${osmType}/${osmId}`;
}

function buildPlaceName(tags, extract) {
  return (
    readTag(tags, "addr:full") ||
    joinParts([readTag(tags, "addr:street"), readTag(tags, "addr:housenumber")]) ||
    readTag(tags, "operator") ||
    readTag(tags, "building") ||
    readTag(tags, "name") ||
    `OpenStreetMap ${extract.name}`
  );
}

function buildDirection(tags) {
  return (
    readTag(tags, "description:zh") ||
    readTag(tags, "description") ||
    readTag(tags, "toilets:position") ||
    readTag(tags, "indoor") ||
    null
  );
}

function readTag(tags, key) {
  const value = tags[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function joinParts(parts) {
  const value = parts.filter(Boolean).join(" ").trim();
  return value || null;
}

function parseList(value) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function uniqueExtracts(extracts) {
  const seen = new Set();
  return extracts.filter((extract) => {
    const key = extract.pbfUrl;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function extractIdFromUrl(url) {
  const fileName = basename(new URL(url).pathname).replace(/-latest\.osm\.pbf$/, "");
  return fileName.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
}

function geofabrikRegionSlug(id) {
  return `osm-${id}`.replace(/[^a-z0-9-]+/gi, "-").toLowerCase().slice(0, 60);
}

function isValidCoordinate(latitude, longitude) {
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

function roundCoordinate(value) {
  return Number(Number(value).toFixed(6));
}

function printExtractSummary({
  dryRun,
  extract,
  importedCount,
  insertedCount,
  updatedCount,
  skippedCount,
  deletedCount,
  protectedCount,
  staleCount,
  finalized,
}) {
  console.log(
    [
      dryRun ? "Extract dry run completed." : "Extract sync completed.",
      `extract=${extract.id}`,
      `imported=${importedCount}`,
      `inserted=${insertedCount}`,
      `updated=${updatedCount}`,
      `skipped=${skippedCount}`,
      `deleted=${deletedCount}`,
      `protected=${protectedCount}`,
      `stale=${staleCount}`,
      `finalized=${finalized ? "yes" : "no"}`,
    ].join("\n"),
  );
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    return JSON.stringify(error);
  }

  return String(error);
}

function printHelp() {
  console.log(`
Usage:
  npm run osm:sync:dry -- --geofabrik-id=monaco --limit=20
  npm run osm:sync -- --geofabrik-id=hong-kong
  npm run osm:sync -- --geofabrik-id=monaco,hong-kong
  npm run osm:sync -- --all-geofabrik

Options:
  --geofabrik-id=<id>       Geofabrik index id, comma-separated allowed.
  --geofabrik-url=<url>     Direct .osm.pbf URL, comma-separated allowed.
  --all-geofabrik           Import leaf extracts from the Geofabrik index.
  --refresh                 Re-download cached extracts.
  --cache-dir=<path>        Defaults to .data/osm.
  --batch-size=<number>     Defaults to ${DEFAULT_BATCH_SIZE}.
  --limit=<number>          Limit parsed toilets per extract, useful for dry runs.

Environment:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL must be https://*.supabase.co
  SUPABASE_SERVICE_ROLE_KEY
  OSM_GEOFABRIK_IDS optional
  OSM_GEOFABRIK_URLS optional
  OSM_GEOFABRIK_INDEX_URL optional
  OSM_CACHE_DIR optional

Notes:
  This importer uses Geofabrik/OSM extracts and osmium.
  It imports only OpenStreetMap amenity=toilets.
  It does not call Overpass and does not use commercial POI providers.
`);
}

main().catch(async (error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});

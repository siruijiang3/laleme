#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

async function main() {
  await loadLocalEnv();
  const supabase = createSupabaseClient();
  const suffix = `${Date.now()}`;
  const regionSlug = `qa-osm-lifecycle-${suffix}`;
  const regionName = `QA OSM lifecycle ${suffix}`;
  const baseOsmId = 900_000_000_000 + (Date.now() % 1_000_000_000);
  const identities = {
    removedWithoutUserRecords: { osmType: "node", osmId: baseOsmId + 1 },
    removedWithUserRecords: { osmType: "way", osmId: baseOsmId + 2 },
    removedWithUserCorrections: { osmType: "node", osmId: baseOsmId + 3 },
    newlyAdded: { osmType: "node", osmId: baseOsmId + 4 },
  };

  await cleanupQaRegions(supabase);

  try {
    const firstImport = await importOsmToilets(supabase, regionSlug, regionName, [
      buildOsmToilet(identities.removedWithoutUserRecords, suffix, "A"),
      buildOsmToilet(identities.removedWithUserRecords, suffix, "B"),
      buildOsmToilet(identities.removedWithUserCorrections, suffix, "D"),
    ]);
    assert.equal(firstImport.insertedCount, 3, "first import should insert OSM A, B and D");

    await finalizeOsmSync(supabase, regionSlug, [
      identities.removedWithoutUserRecords,
      identities.removedWithUserRecords,
      identities.removedWithUserCorrections,
    ]);

    const protectedToilet = await findToiletByOsmIdentity(
      supabase,
      identities.removedWithUserRecords,
    );
    assert.ok(protectedToilet, "protected OSM toilet B should exist after first import");

    const correctedToilet = await findToiletByOsmIdentity(
      supabase,
      identities.removedWithUserCorrections,
    );
    assert.ok(correctedToilet, "corrected OSM toilet D should exist after first import");

    await insertStatusUpdate(supabase, protectedToilet.id);
    await updateUserCorrections(supabase, correctedToilet.id, suffix);
    const userToiletId = await insertUserContributedToilet(supabase, regionSlug, suffix);

    const correctionRefreshImport = await importOsmToilets(supabase, regionSlug, regionName, [
      buildOsmToilet(identities.removedWithUserCorrections, suffix, "E"),
    ]);
    assert.equal(
      correctionRefreshImport.insertedCount,
      0,
      "re-importing corrected OSM D should not create a duplicate",
    );

    const correctedAfterRefresh = await findToiletByOsmIdentity(
      supabase,
      identities.removedWithUserCorrections,
    );
    assert.equal(
      correctedAfterRefresh?.display_name,
      `QA corrected display ${suffix}`,
      "OSM re-import should not overwrite display_name correction",
    );

    const secondImport = await importOsmToilets(supabase, regionSlug, regionName, [
      buildOsmToilet(identities.newlyAdded, suffix, "C"),
    ]);
    assert.equal(secondImport.insertedCount, 1, "second import should insert new OSM C");

    const finalizeResult = await finalizeOsmSync(supabase, regionSlug, [
      identities.newlyAdded,
    ]);
    assert.equal(finalizeResult.deletedCount, 1, "stale OSM A should be deleted");
    assert.equal(finalizeResult.protectedCount, 2, "stale OSM B and D should be protected");
    assert.equal(finalizeResult.staleCount, 3, "stale total should include deleted and protected");

    const deletedToilet = await findToiletByOsmIdentity(
      supabase,
      identities.removedWithoutUserRecords,
    );
    assert.equal(deletedToilet, null, "OSM A should not remain in toilets");

    const stillProtectedToilet = await findToiletByOsmIdentity(
      supabase,
      identities.removedWithUserRecords,
    );
    assert.ok(stillProtectedToilet, "OSM B should remain because it has user status");
    assert.equal(
      stillProtectedToilet.source_status,
      "needs_verification",
      "OSM B should be marked needs_verification",
    );
    assert.ok(
      stillProtectedToilet.source_missing_since,
      "OSM B should record source_missing_since",
    );

    const stillCorrectedToilet = await findToiletByOsmIdentity(
      supabase,
      identities.removedWithUserCorrections,
    );
    assert.ok(
      stillCorrectedToilet,
      "OSM D should remain because it has user correction fields",
    );
    assert.equal(
      stillCorrectedToilet.source_status,
      "needs_verification",
      "OSM D should be marked needs_verification",
    );
    assert.equal(
      stillCorrectedToilet.display_name,
      `QA corrected display ${suffix}`,
      "OSM D user correction should not be overwritten",
    );

    const newlyAddedToilet = await findToiletByOsmIdentity(supabase, identities.newlyAdded);
    assert.ok(newlyAddedToilet, "OSM C should exist after second import");
    assert.equal(newlyAddedToilet.source_status, "active", "OSM C should be active");

    const userToilet = await findToiletById(supabase, userToiletId);
    assert.ok(userToilet, "user contributed toilet should remain");
    assert.equal(userToilet.source, "user", "user contributed toilet source should remain user");
    assert.equal(userToilet.osm_type, null, "user contributed toilet must not get osm_type");
    assert.equal(userToilet.osm_id, null, "user contributed toilet must not get osm_id");

    console.log(
      JSON.stringify(
        {
          ok: true,
          regionSlug,
          firstImport,
          correctionRefreshImport,
          secondImport,
          finalizeResult,
          assertions: [
            "OSM新增会插入",
            "OSM重复导入不会覆盖用户名称/地点/楼层修正",
            "OSM删除且无用户记录会删除",
            "OSM删除但有用户状态会保留并标记待验证",
            "OSM删除但有用户名称/地点/楼层修正会保留并标记待验证",
            "用户自行贡献厕所不会被OSM覆盖",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await cleanupQaRegions(supabase);
  }
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

  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
    throw new Error("Lifecycle verification requires Hosted Supabase (*.supabase.co).");
  }
}

async function importOsmToilets(supabase, regionSlug, regionName, items) {
  const { data, error } = await supabase.rpc("import_osm_toilets", {
    items,
    import_region_slug: regionSlug,
    import_region_name: regionName,
    import_region_description: "QA region for OSM lifecycle verification.",
    import_region_center_latitude: 22.314,
    import_region_center_longitude: 114.192,
  });

  if (error) {
    throw error;
  }

  return {
    insertedCount: Number(data?.insertedCount ?? 0),
    updatedCount: Number(data?.updatedCount ?? 0),
    skippedCount: Number(data?.skippedCount ?? 0),
  };
}

async function finalizeOsmSync(supabase, regionSlug, identities) {
  const { data, error } = await supabase.rpc("finalize_osm_toilet_sync", {
    import_region_slug: regionSlug,
    current_osm_identities: identities,
  });

  if (error) {
    throw error;
  }

  return {
    currentCount: Number(data?.currentCount ?? 0),
    deletedCount: Number(data?.deletedCount ?? 0),
    protectedCount: Number(data?.protectedCount ?? 0),
    staleCount: Number(data?.staleCount ?? 0),
  };
}

function buildOsmToilet(identity, suffix, label) {
  return {
    osmType: identity.osmType,
    osmId: identity.osmId,
    latitude: 22.314 + label.charCodeAt(0) / 1_000_000,
    longitude: 114.192 + label.charCodeAt(0) / 1_000_000,
    tags: {
      amenity: "toilets",
      name: `QA OSM ${label} ${suffix}`,
    },
    name: `QA OSM ${label} ${suffix}`,
    floor: `QA-${label}`,
    direction: "Lifecycle verification",
    placeName: `QA OSM place ${label} ${suffix}`,
    isAccessible: false,
  };
}

async function findToiletByOsmIdentity(supabase, identity) {
  const { data, error } = await supabase
    .from("toilets")
    .select(
      "id, source, source_status, source_missing_since, osm_type, osm_id, display_name, user_place_name, user_floor, user_direction",
    )
    .eq("osm_type", identity.osmType)
    .eq("osm_id", identity.osmId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function findToiletById(supabase, toiletId) {
  const { data, error } = await supabase
    .from("toilets")
    .select("id, source, source_status, source_missing_since, osm_type, osm_id")
    .eq("id", toiletId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function updateUserCorrections(supabase, toiletId, suffix) {
  const { error } = await supabase
    .from("toilets")
    .update({
      display_name: `QA corrected display ${suffix}`,
      user_place_name: `QA corrected place ${suffix}`,
      user_floor: "QA corrected floor",
      user_direction: "QA corrected direction",
    })
    .eq("id", toiletId);

  if (error) {
    throw error;
  }
}

async function insertStatusUpdate(supabase, toiletId) {
  const { error } = await supabase.from("toilet_status_updates").insert({
    toilet_id: toiletId,
    is_open: true,
    has_paper: true,
    is_clean: true,
    source: "qa-lifecycle",
  });

  if (error) {
    throw error;
  }
}

async function insertUserContributedToilet(supabase, regionSlug, suffix) {
  const { data: region, error: regionError } = await supabase
    .from("regions")
    .select("id")
    .eq("slug", regionSlug)
    .single();

  if (regionError || !region) {
    throw regionError ?? new Error("QA region missing.");
  }

  const { data: place, error: placeError } = await supabase
    .from("places")
    .insert({
      region_id: region.id,
      name: `QA user place ${suffix}`,
      place_type: "user_contributed",
      latitude: 22.3145,
      longitude: 114.1925,
    })
    .select("id")
    .single();

  if (placeError || !place) {
    throw placeError ?? new Error("QA user place insert failed.");
  }

  const { data: toilet, error: toiletError } = await supabase
    .from("toilets")
    .insert({
      place_id: place.id,
      name: `QA user toilet ${suffix}`,
      floor: "QA-user",
      direction: "Lifecycle verification",
      latitude: 22.3145,
      longitude: 114.1925,
      is_accessible: false,
      notes: "QA user contributed toilet.",
      source: "user",
    })
    .select("id")
    .single();

  if (toiletError || !toilet) {
    throw toiletError ?? new Error("QA user toilet insert failed.");
  }

  return toilet.id;
}

async function cleanupQaRegions(supabase) {
  const { error } = await supabase.from("regions").delete().like("slug", "qa-osm-lifecycle-%");
  if (error) {
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : JSON.stringify(error));
  process.exitCode = 1;
});

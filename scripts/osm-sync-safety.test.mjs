import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCapacityGuard, parseDatabaseBytes, downloadVerified } from './osm-sync-safety.mjs';
import { importAndFinalize, readToiletFeatures, selectUsFeatures, parseArgs } from './sync-osm-toilets.mjs';

const metric = (bytes) => `pg_database_size_bytes{service_type="postgresql",datname="postgres"} ${bytes}\npg_database_size_bytes{datname="template0"} 7500000\npg_database_size_bytes{datname="template1"} 7500000\n`;
const guard = (fetchImpl, extras = {}) => createCapacityGuard({ url: 'https://test-project.supabase.co', key: 'test-only-not-a-credential', maxBytes: 450_000_000, fetchImpl, ...extras });
const extract = { id: 'us/california', name: 'California' };
const options = { batchSize: 1 };
const rows = [{ osmType: 'node', osmId: 1 }, { osmType: 'way', osmId: 2 }];

// All mutations below use in-memory stubs, never a Supabase client.
function database(failBatch = 0, skipped = false) {
  const stored = new Set(); const calls = []; let batches = 0;
  return { stored, calls, async rpc(name, args) {
    calls.push(name);
    if (name === 'finalize_osm_toilet_sync') return { data: {}, error: null };
    if (++batches === failBatch) return { error: new Error('simulated failure') };
    let insertedCount = 0;
    for (const row of args.items) { const id = `${row.osmType}/${row.osmId}`; if (!stored.has(id)) insertedCount++; stored.add(id); }
    return { data: { insertedCount, updatedCount: args.items.length - insertedCount, skippedCount: skipped ? 1 : 0 } };
  } };
}

test('metrics sum includes templates and rejects missing, duplicate, NaN, or zero samples', () => {
  assert.equal(parseDatabaseBytes(metric(40_000_000)), 55_000_000);
  for (const bad of ['', 'pg_database_size_mb 40', metric(NaN), metric(0), metric(40) + metric(40)]) assert.throws(() => parseDatabaseBytes(bad));
});

test('capacity reserves 10 MB, fails before a write and handles unavailable/stale metrics', async () => {
  await assert.rejects(guard(async () => new Response(metric(425_000_000)))(), /Capacity stop/);
  await assert.rejects(guard(async () => new Response('', { status: 403 }))(), /HTTP 403/);
  await assert.rejects(guard(async () => { throw new Error('network'); })(), /unavailable/);
  await assert.rejects(guard(async () => new Response(metric(1), { headers: { age: '61' } }))(), /stale/);
  await assert.rejects(guard(async () => new Response('garbage'))(), /missing/);
});

test('unchanged metrics retain reservations for recent writes', async () => {
  let time = 0;
  const check = guard(async () => new Response(metric(424_980_000)), { now: () => time });
  await check([rows[0]]); await check([rows[1]]);
  await assert.rejects(check([rows[0]]), /Capacity stop/);
  time = 120_001;
  await check([rows[0]]);
});

test('batch failure or capacity stop never finalizes a partial region', async () => {
  const failed = database(2);
  await assert.rejects(importAndFinalize(failed, rows, extract, options), /simulated/);
  assert.deepEqual(failed.calls, ['import_osm_toilets', 'import_osm_toilets']);
  const stopped = database(); let checks = 0;
  await assert.rejects(importAndFinalize(stopped, rows, extract, options, async () => { if (++checks === 2) throw new Error('capacity'); }), /capacity/);
  assert.deepEqual(stopped.calls, ['import_osm_toilets']);
  const skipped = database(0, true);
  await assert.rejects(importAndFinalize(skipped, rows, extract, options), /skipped/);
  assert.equal(skipped.calls.includes('finalize_osm_toilet_sync'), false);
});

test('successful rerun is idempotent; limited and empty runs do not finalize', async () => {
  const db = database();
  await importAndFinalize(db, rows, extract, options);
  const rerun = await importAndFinalize(db, rows, extract, options);
  assert.equal(db.stored.size, 2); assert.equal(rerun.importResult.insertedCount, 0);
  assert.equal(rerun.importResult.updatedCount, 2);
  const limited = database();
  await importAndFinalize(limited, rows, extract, { ...options, limit: 2 });
  assert.equal(limited.calls.includes('finalize_osm_toilet_sync'), false);
  await assert.rejects(importAndFinalize(limited, [], extract, options), /Empty/);
});

test('downloads are atomic and interrupted, short, or invalid files never replace a valid cache', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'osm-download-test-')); const path = join(dir, 'region.osm.pbf');
  try {
    await writeFile(path, 'old');
    const broken = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.error(new Error('interrupted')); } });
    await assert.rejects(downloadVerified('https://example.org/extract', path, { fetchImpl: async () => new Response(broken) }));
    assert.equal(await readFile(path, 'utf8'), 'old');
    await assert.rejects(stat(`${path}.part`), { code: 'ENOENT' });
    await assert.rejects(downloadVerified('https://example.org/extract', path, { fetchImpl: async () => new Response('short', { headers: { 'content-length': '100' } }) }), /Incomplete/);
    await assert.rejects(downloadVerified('https://example.org/extract', path, { fetchImpl: async () => new Response('bad pbf'), validate: async () => { throw new Error('bad format'); } }), /bad format/);
    assert.equal(await readFile(path, 'utf8'), 'old');
    await downloadVerified('https://example.org/extract', path, { fetchImpl: async () => new Response('valid') });
    assert.equal(await readFile(path, 'utf8'), 'valid');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('features deduplicate OSM identity before batches and reject non-toilet objects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'osm-features-test-')); const path = join(dir, 'features.geojsonseq');
  const feature = { id: 'n1', geometry: { type: 'Point', coordinates: [-120, 35] }, properties: { amenity: 'toilets' } };
  try {
    await writeFile(path, [feature, feature, { ...feature, id: 'n2', properties: { amenity: 'bench' } }].map(JSON.stringify).join('\n'));
    assert.equal((await readToiletFeatures(path, extract)).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('US selector uses slash IDs, excludes nested California extracts, fails closed on index changes', () => {
  const ids = ['us/california', ...Array.from({ length: 52 }, (_, i) => `us/region-${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + i % 26)}`)];
  const features = ids.map(id => ({ properties: { id, urls: { pbf: `https://download.geofabrik.de/north-america/${id}-latest.osm.pbf` } } }));
  assert.equal(selectUsFeatures([...features, { properties: { id: 'norcal' } }])[0].properties.id, 'us/california');
  assert.throws(() => selectUsFeatures(features.slice(1)), /Expected 53/);
});

test('US selection cannot inherit Chinese regions or omit the capacity guard', () => {
  const ids = process.env.OSM_GEOFABRIK_IDS; const urls = process.env.OSM_GEOFABRIK_URLS;
  try {
    process.env.OSM_GEOFABRIK_IDS = 'china'; process.env.OSM_GEOFABRIK_URLS = '';
    assert.throws(() => parseArgs(['--us', '--max-database-bytes=450000000']), /cannot be mixed/);
    process.env.OSM_GEOFABRIK_IDS = '';
    assert.throws(() => parseArgs(['--us']), /requires/);
    assert.equal(parseArgs(['--us', '--max-database-bytes=450000000']).maxDatabaseBytes, 450000000);
    assert.throws(() => parseArgs(['--us', '--max-database-bytes=NaN']), /integer/);
  } finally {
    if (ids === undefined) delete process.env.OSM_GEOFABRIK_IDS; else process.env.OSM_GEOFABRIK_IDS = ids;
    if (urls === undefined) delete process.env.OSM_GEOFABRIK_URLS; else process.env.OSM_GEOFABRIK_URLS = urls;
  }
});

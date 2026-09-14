import { createWriteStream } from 'node:fs';
import { rename, stat, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const CAPACITY_RESERVE_BYTES = 10_000_000;

export function parseDatabaseBytes(text) {
  const sizes = new Map();
  for (const line of text.split('\n')) {
    if (!line.startsWith('pg_database_size_bytes{')) continue;
    const match = /^pg_database_size_bytes\{([^}]+)\}\s+(\S+)(?:\s+\d+)?$/.exec(line);
    const name = match?.[1].match(/(?:^|,)datname="([^"]+)"(?:,|$)/)?.[1];
    const value = Number(match?.[2]);
    if (!name || !Number.isFinite(value) || value <= 0 || sizes.has(name)) {
      throw new Error('Invalid or duplicate database size metric. Stopping without further imports.');
    }
    sizes.set(name, value);
  }
  if (!sizes.has('postgres')) throw new Error('Database size metric missing. Stopping without further imports.');
  return [...sizes.values()].reduce((sum, size) => sum + size, 0);
}

export function createCapacityGuard({ url, key, maxBytes, fetchImpl = fetch, now = Date.now }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= CAPACITY_RESERVE_BYTES) {
    throw new Error('Database capacity limit must exceed the 10000000 byte reserve.');
  }
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co') || parsed.username || parsed.password) {
    throw new Error('Metrics require a Hosted Supabase URL.');
  }
  if (!key?.trim()) throw new Error('Missing service role key for capacity check.');
  const reservations = [];
  let lastLogged;
  return async function checkCapacity(batch = []) {
    let response;
    try {
      response = await fetchImpl(new URL('/customer/v1/privileged/metrics', parsed), {
        headers: { Authorization: `Basic ${Buffer.from(`username:${key}`).toString('base64')}`, 'Cache-Control': 'no-cache' },
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error('Database metrics unavailable. Stopping without further imports.');
    }
    if (!response.ok) throw new Error(`Database metrics HTTP ${response.status}. Stopping without further imports.`);
    if (Number(response.headers.get('age') || 0) > 60) throw new Error('Database metrics are stale. Stopping imports.');
    const used = parseDatabaseBytes(await response.text());
    // Metrics refresh approximately once per minute. Budget recent writes for two
    // minutes as well as the next batch, instead of trusting an unchanged sample.
    const time = now();
    while (reservations.length && reservations[0].time < time - 120_000) reservations.shift();
    const nextBytes = batch.reduce((sum, row) => sum + Math.max(8192, Buffer.byteLength(JSON.stringify(row)) * 4), 0);
    const pending = reservations.reduce((sum, item) => sum + item.bytes, 0);
    if (used + pending + nextBytes + CAPACITY_RESERVE_BYTES >= maxBytes) {
      throw new Error(`Capacity stop: database=${used} pending=${pending} next_batch=${nextBytes} reserve=${CAPACITY_RESERVE_BYTES} limit=${maxBytes} bytes. No automatic upgrade.`);
    }
    if (nextBytes) reservations.push({ time, bytes: nextBytes });
    if (used !== lastLogged) {
      console.log(`Database capacity: used_bytes=${used} limit_bytes=${maxBytes} reserve_bytes=${CAPACITY_RESERVE_BYTES}`);
      lastLogged = used;
    }
    return used;
  };
}

export async function downloadVerified(url, destination, { fetchImpl = fetch, validate = async () => {} } = {}) {
  const partial = `${destination}.part`;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(30 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`Extract download HTTP ${response.status}.`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    const size = (await stat(partial)).size;
    const expected = response.headers.get('content-length');
    if (!size || (expected !== null && Number(expected) !== size)) throw new Error('Incomplete extract download.');
    await validate(partial);
    await rename(partial, destination);
  } finally {
    await unlink(partial).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

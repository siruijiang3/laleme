-- Add a minimal OpenStreetMap import surface for amenity=toilets.
-- OSM rows are a data baseline only. User status, paper state, reviews,
-- requests, reports, floor/direction, and local hints must remain separate.

alter table public.toilets
  add column if not exists osm_type text,
  add column if not exists osm_id bigint,
  add column if not exists source text not null default 'user',
  add column if not exists source_license text,
  add column if not exists source_attribution text,
  add column if not exists source_tags jsonb not null default '{}'::jsonb,
  add column if not exists source_status text not null default 'active',
  add column if not exists last_imported_at timestamptz,
  add column if not exists source_missing_since timestamptz;

alter table public.toilets
  drop constraint if exists toilets_osm_identity_pair_check;

alter table public.toilets
  add constraint toilets_osm_identity_pair_check check (
    (osm_type is null and osm_id is null)
    or (
      osm_type in ('node', 'way', 'relation')
      and osm_id is not null
    )
  );

alter table public.toilets
  drop constraint if exists toilets_source_status_check;

alter table public.toilets
  add constraint toilets_source_status_check check (
    source_status in ('active', 'needs_verification')
  );

alter table public.toilets
  drop constraint if exists toilets_source_check;

alter table public.toilets
  add constraint toilets_source_check check (
    source in ('user', 'seed', 'osm')
  );

alter table public.toilets
  drop constraint if exists toilets_osm_identity_unique;

alter table public.toilets
  add constraint toilets_osm_identity_unique unique (osm_type, osm_id);

create index if not exists toilets_source_idx on public.toilets(source);
create index if not exists toilets_last_imported_at_idx
  on public.toilets(last_imported_at desc)
  where source = 'osm';
create index if not exists toilets_source_status_idx
  on public.toilets(source_status)
  where source = 'osm';

create table if not exists public.osm_sync_runs (
  id bigint generated always as identity primary key,
  region_slug text,
  bbox jsonb not null,
  overpass_url text not null,
  status text not null default 'running',
  imported_count integer not null default 0,
  updated_count integer not null default 0,
  inserted_count integer not null default 0,
  skipped_count integer not null default 0,
  stale_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint osm_sync_runs_status_check check (
    status in ('running', 'succeeded', 'failed')
  )
);

create index if not exists osm_sync_runs_started_at_idx
  on public.osm_sync_runs(started_at desc);

alter table public.osm_sync_runs enable row level security;

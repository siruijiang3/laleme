-- Store LaLeMe user corrections separately from OSM source fields.
-- OSM sync may update source name/tags/coordinates, but must not overwrite these fields.

alter table public.toilets
  add column if not exists display_name text,
  add column if not exists user_place_name text,
  add column if not exists user_floor text,
  add column if not exists user_direction text;

create or replace function public.finalize_osm_toilet_sync(
  import_region_slug text,
  current_osm_identities jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer := 0;
  deleted_count integer := 0;
  protected_count integer := 0;
begin
  if import_region_slug is null or btrim(import_region_slug) = '' then
    raise exception 'import_region_slug is required';
  end if;

  if jsonb_typeof(current_osm_identities) is distinct from 'array' then
    raise exception 'current_osm_identities must be a JSON array';
  end if;

  drop table if exists pg_temp.current_osm_identities;
  create temp table pg_temp.current_osm_identities (
    osm_type text not null,
    osm_id bigint not null,
    primary key (osm_type, osm_id)
  ) on commit drop;

  insert into pg_temp.current_osm_identities (osm_type, osm_id)
  select
    identity_item->>'osmType',
    nullif(identity_item->>'osmId', '')::bigint
  from jsonb_array_elements(current_osm_identities) as identity_item
  where identity_item->>'osmType' in ('node', 'way', 'relation')
    and nullif(identity_item->>'osmId', '') is not null
  on conflict do nothing;

  get diagnostics current_count = row_count;

  drop table if exists pg_temp.stale_osm_toilets;
  create temp table pg_temp.stale_osm_toilets (
    toilet_id bigint primary key,
    has_user_records boolean not null
  ) on commit drop;

  insert into pg_temp.stale_osm_toilets (toilet_id, has_user_records)
  select
    stale_toilet.id,
    (
      nullif(btrim(coalesce(stale_toilet.display_name, '')), '') is not null
      or nullif(btrim(coalesce(stale_toilet.user_place_name, '')), '') is not null
      or nullif(btrim(coalesce(stale_toilet.user_floor, '')), '') is not null
      or nullif(btrim(coalesce(stale_toilet.user_direction, '')), '') is not null
      or exists (
        select 1
        from public.toilet_status_updates as status_update
        where status_update.toilet_id = stale_toilet.id
      )
      or exists (
        select 1
        from public.toilet_reviews as review
        where review.toilet_id = stale_toilet.id
      )
      or exists (
        select 1
        from public.paper_requests as paper_request
        where paper_request.toilet_id = stale_toilet.id
      )
      or exists (
        select 1
        from public.reports as report
        where report.toilet_id = stale_toilet.id
      )
    )
  from public.toilets as stale_toilet
  join public.places as place
    on place.id = stale_toilet.place_id
  join public.regions as region
    on region.id = place.region_id
  where stale_toilet.source = 'osm'
    and region.slug = import_region_slug
    and not exists (
      select 1
      from pg_temp.current_osm_identities as current_identity
      where current_identity.osm_type = stale_toilet.osm_type
        and current_identity.osm_id = stale_toilet.osm_id
    );

  update public.toilets as protected_toilet
  set
    source_status = 'needs_verification',
    source_missing_since = coalesce(protected_toilet.source_missing_since, now()),
    updated_at = now()
  where protected_toilet.id in (
    select stale.toilet_id
    from pg_temp.stale_osm_toilets as stale
    where stale.has_user_records
  );
  get diagnostics protected_count = row_count;

  delete from public.toilets as deleted_toilet
  where deleted_toilet.id in (
    select stale.toilet_id
    from pg_temp.stale_osm_toilets as stale
    where not stale.has_user_records
  );
  get diagnostics deleted_count = row_count;

  delete from public.places as orphan_place
  using public.regions as region
  where orphan_place.region_id = region.id
    and region.slug = import_region_slug
    and orphan_place.place_type = 'osm_import'
    and not exists (
      select 1
      from public.toilets as toilet
      where toilet.place_id = orphan_place.id
    );

  return jsonb_build_object(
    'currentCount', current_count,
    'deletedCount', deleted_count,
    'protectedCount', protected_count,
    'staleCount', deleted_count + protected_count
  );
end;
$$;

grant execute on function public.finalize_osm_toilet_sync(text, jsonb) to service_role;

notify pgrst, 'reload schema';

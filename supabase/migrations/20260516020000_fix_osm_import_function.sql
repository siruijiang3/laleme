-- Fix OSM import RPC variable names so Postgres does not confuse PL/pgSQL
-- variables with table columns such as places.region_id.

create or replace function public.import_osm_toilets(
  items jsonb,
  import_region_slug text,
  import_region_name text,
  import_region_description text,
  import_region_center_latitude numeric,
  import_region_center_longitude numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  target_region_id bigint;
  target_place_id bigint;
  matched_toilet_id bigint;
  conflicting_toilet_id bigint;
  inserted_count integer := 0;
  updated_count integer := 0;
  skipped_count integer := 0;
  item_osm_type text;
  item_osm_id bigint;
  item_name text;
  item_place_name text;
  item_floor text;
  item_direction text;
  item_latitude numeric;
  item_longitude numeric;
  item_is_accessible boolean;
begin
  if jsonb_typeof(items) is distinct from 'array' then
    raise exception 'items must be a JSON array';
  end if;

  insert into public.regions (
    slug,
    name,
    description,
    center_latitude,
    center_longitude,
    updated_at
  )
  values (
    import_region_slug,
    import_region_name,
    import_region_description,
    import_region_center_latitude,
    import_region_center_longitude,
    now()
  )
  on conflict (slug) do update
    set
      name = excluded.name,
      description = excluded.description,
      center_latitude = excluded.center_latitude,
      center_longitude = excluded.center_longitude,
      updated_at = now()
  returning id into target_region_id;

  for item in select * from jsonb_array_elements(items)
  loop
    item_osm_type := item->>'osmType';
    item_osm_id := nullif(item->>'osmId', '')::bigint;
    item_latitude := nullif(item->>'latitude', '')::numeric;
    item_longitude := nullif(item->>'longitude', '')::numeric;

    if item_osm_type not in ('node', 'way', 'relation')
      or item_osm_id is null
      or item_latitude is null
      or item_longitude is null
      or item_latitude < -90
      or item_latitude > 90
      or item_longitude < -180
      or item_longitude > 180
    then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    item_name := coalesce(nullif(item->>'name', ''), 'OSM 公共厕所 ' || item_osm_type || '/' || item_osm_id);
    item_place_name := coalesce(nullif(item->>'placeName', ''), 'OpenStreetMap 导入点位');
    item_floor := coalesce(nullif(item->>'floor', ''), '未确认');
    item_direction := nullif(item->>'direction', '');
    item_is_accessible := coalesce((item->>'isAccessible')::boolean, false);

    select public.toilets.id into matched_toilet_id
    from public.toilets
    where public.toilets.osm_type = item_osm_type
      and public.toilets.osm_id = item_osm_id
    limit 1;

    if matched_toilet_id is not null then
      update public.toilets
      set
        name = case
          when exists (
            select 1
            from public.toilets as conflicting_toilet
            where conflicting_toilet.place_id = public.toilets.place_id
              and conflicting_toilet.name = item_name
              and conflicting_toilet.floor = item_floor
              and conflicting_toilet.id <> matched_toilet_id
          )
            then item_name || ' (' || item_osm_type || '/' || item_osm_id || ')'
          else item_name
        end,
        latitude = item_latitude,
        longitude = item_longitude,
        source = 'osm',
        source_license = 'ODbL-1.0',
        source_attribution = 'OpenStreetMap contributors',
        source_tags = coalesce(item->'tags', '{}'::jsonb),
        source_status = 'active',
        last_imported_at = now(),
        source_missing_since = null,
        updated_at = now()
      where public.toilets.id = matched_toilet_id;

      updated_count := updated_count + 1;
      continue;
    end if;

    insert into public.places (
      region_id,
      name,
      place_type,
      latitude,
      longitude,
      updated_at
    )
    values (
      target_region_id,
      item_place_name,
      'osm_import',
      item_latitude,
      item_longitude,
      now()
    )
    on conflict on constraint places_region_name_unique do update
      set
        latitude = coalesce(public.places.latitude, excluded.latitude),
        longitude = coalesce(public.places.longitude, excluded.longitude),
        updated_at = now()
    returning id into target_place_id;

    conflicting_toilet_id := null;
    select public.toilets.id into conflicting_toilet_id
    from public.toilets
    where public.toilets.place_id = target_place_id
      and public.toilets.name = item_name
      and public.toilets.floor = item_floor
    limit 1;

    if conflicting_toilet_id is not null then
      item_name := item_name || ' (' || item_osm_type || '/' || item_osm_id || ')';
    end if;

    insert into public.toilets (
      place_id,
      name,
      floor,
      direction,
      latitude,
      longitude,
      is_accessible,
      notes,
      osm_type,
      osm_id,
      source,
      source_license,
      source_attribution,
      source_tags,
      source_status,
      last_imported_at,
      source_missing_since
    )
    values (
      target_place_id,
      item_name,
      item_floor,
      item_direction,
      item_latitude,
      item_longitude,
      item_is_accessible,
      'OpenStreetMap amenity=toilets 导入点位，等待用户确认状态。',
      item_osm_type,
      item_osm_id,
      'osm',
      'ODbL-1.0',
      'OpenStreetMap contributors',
      coalesce(item->'tags', '{}'::jsonb),
      'active',
      now(),
      null
    );

    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object(
    'insertedCount', inserted_count,
    'updatedCount', updated_count,
    'skippedCount', skipped_count
  );
end;
$$;

grant execute on function public.import_osm_toilets(
  jsonb,
  text,
  text,
  text,
  numeric,
  numeric
) to service_role;

notify pgrst, 'reload schema';

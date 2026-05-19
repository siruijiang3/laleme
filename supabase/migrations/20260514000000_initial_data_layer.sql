-- LaLeMe initial Supabase/Postgres data layer.
-- This schema keeps anonymous MVP contribution flows possible while preserving
-- a clear path to stricter auth and moderation later.

create table if not exists public.regions (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null unique,
  description text,
  center_latitude numeric(9, 6),
  center_longitude numeric(9, 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regions_slug_format_check check (slug ~ '^[a-z0-9-]+$'),
  constraint regions_center_latitude_check check (
    center_latitude is null or center_latitude between -90 and 90
  ),
  constraint regions_center_longitude_check check (
    center_longitude is null or center_longitude between -180 and 180
  )
);

create table if not exists public.places (
  id bigint generated always as identity primary key,
  region_id bigint not null references public.regions(id) on delete cascade,
  name text not null,
  place_type text not null default 'public_area',
  address text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint places_region_name_unique unique (region_id, name),
  constraint places_latitude_check check (latitude is null or latitude between -90 and 90),
  constraint places_longitude_check check (longitude is null or longitude between -180 and 180)
);

create table if not exists public.toilets (
  id bigint generated always as identity primary key,
  place_id bigint not null references public.places(id) on delete cascade,
  name text not null,
  floor text not null default '未填写',
  direction text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  map_x numeric(5, 2) not null default 50,
  map_y numeric(5, 2) not null default 50,
  is_accessible boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint toilets_place_name_floor_unique unique (place_id, name, floor),
  constraint toilets_latitude_check check (latitude is null or latitude between -90 and 90),
  constraint toilets_longitude_check check (longitude is null or longitude between -180 and 180),
  constraint toilets_map_x_check check (map_x between 0 and 100),
  constraint toilets_map_y_check check (map_y between 0 and 100)
);

create table if not exists public.toilet_status_updates (
  id bigint generated always as identity primary key,
  toilet_id bigint not null references public.toilets(id) on delete cascade,
  is_open boolean not null,
  has_paper boolean not null,
  is_clean boolean not null,
  source text not null default 'anonymous',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.toilet_reviews (
  id bigint generated always as identity primary key,
  toilet_id bigint not null references public.toilets(id) on delete cascade,
  rating smallint not null,
  body text not null,
  author_name text not null default '匿名用户',
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  constraint toilet_reviews_rating_check check (rating between 1 and 5),
  constraint toilet_reviews_body_length_check check (char_length(body) between 1 and 800)
);

create table if not exists public.paper_requests (
  id bigint generated always as identity primary key,
  toilet_id bigint not null references public.toilets(id) on delete cascade,
  body text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint paper_requests_status_check check (status in ('active', 'resolved')),
  constraint paper_requests_body_length_check check (char_length(body) between 1 and 500)
);

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  toilet_id bigint references public.toilets(id) on delete cascade,
  toilet_review_id bigint references public.toilet_reviews(id) on delete cascade,
  paper_request_id bigint references public.paper_requests(id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint reports_status_check check (status in ('open', 'reviewed', 'resolved', 'dismissed')),
  constraint reports_reason_length_check check (char_length(reason) between 1 and 120),
  constraint reports_single_target_check check (
    num_nonnulls(toilet_id, toilet_review_id, paper_request_id) = 1
  )
);

create index if not exists places_region_id_idx on public.places(region_id);
create index if not exists toilets_place_id_idx on public.toilets(place_id);
create index if not exists toilets_map_position_idx on public.toilets(place_id, map_x, map_y);
create index if not exists toilet_status_updates_toilet_created_idx
  on public.toilet_status_updates(toilet_id, created_at desc);
create index if not exists toilet_reviews_toilet_created_idx
  on public.toilet_reviews(toilet_id, created_at desc)
  where is_hidden = false;
create index if not exists paper_requests_toilet_status_created_idx
  on public.paper_requests(toilet_id, status, created_at desc);
create index if not exists reports_toilet_id_idx on public.reports(toilet_id);
create index if not exists reports_toilet_review_id_idx on public.reports(toilet_review_id);
create index if not exists reports_paper_request_id_idx on public.reports(paper_request_id);

alter table public.regions enable row level security;
alter table public.places enable row level security;
alter table public.toilets enable row level security;
alter table public.toilet_status_updates enable row level security;
alter table public.toilet_reviews enable row level security;
alter table public.paper_requests enable row level security;
alter table public.reports enable row level security;

drop policy if exists "public_read_regions" on public.regions;
create policy "public_read_regions"
  on public.regions for select
  to anon, authenticated
  using (true);

drop policy if exists "public_read_places" on public.places;
create policy "public_read_places"
  on public.places for select
  to anon, authenticated
  using (true);

drop policy if exists "public_insert_places" on public.places;
create policy "public_insert_places"
  on public.places for insert
  to anon, authenticated
  with check (true);

drop policy if exists "public_read_toilets" on public.toilets;
create policy "public_read_toilets"
  on public.toilets for select
  to anon, authenticated
  using (true);

drop policy if exists "public_insert_toilets" on public.toilets;
create policy "public_insert_toilets"
  on public.toilets for insert
  to anon, authenticated
  with check (true);

drop policy if exists "public_read_status_updates" on public.toilet_status_updates;
create policy "public_read_status_updates"
  on public.toilet_status_updates for select
  to anon, authenticated
  using (true);

drop policy if exists "public_insert_status_updates" on public.toilet_status_updates;
create policy "public_insert_status_updates"
  on public.toilet_status_updates for insert
  to anon, authenticated
  with check (true);

drop policy if exists "public_read_reviews" on public.toilet_reviews;
create policy "public_read_reviews"
  on public.toilet_reviews for select
  to anon, authenticated
  using (is_hidden = false);

drop policy if exists "public_insert_reviews" on public.toilet_reviews;
create policy "public_insert_reviews"
  on public.toilet_reviews for insert
  to anon, authenticated
  with check (is_hidden = false);

drop policy if exists "public_read_paper_requests" on public.paper_requests;
create policy "public_read_paper_requests"
  on public.paper_requests for select
  to anon, authenticated
  using (true);

drop policy if exists "public_insert_paper_requests" on public.paper_requests;
create policy "public_insert_paper_requests"
  on public.paper_requests for insert
  to anon, authenticated
  with check (status = 'active');

drop policy if exists "public_update_paper_requests" on public.paper_requests;
create policy "public_update_paper_requests"
  on public.paper_requests for update
  to anon, authenticated
  using (true)
  with check (status in ('active', 'resolved'));

drop policy if exists "public_insert_reports" on public.reports;
create policy "public_insert_reports"
  on public.reports for insert
  to anon, authenticated
  with check (status = 'open');

grant usage on schema public to anon, authenticated;

grant select on
  public.regions,
  public.places,
  public.toilets,
  public.toilet_status_updates,
  public.toilet_reviews,
  public.paper_requests
to anon, authenticated;

grant insert on
  public.places,
  public.toilets,
  public.toilet_status_updates,
  public.toilet_reviews,
  public.paper_requests,
  public.reports
to anon, authenticated;

grant update (status, resolved_at) on public.paper_requests to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

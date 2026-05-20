-- Prepare LaLeMe for public source code and an explicit open-data API.
-- Browser clients must not use Supabase anon access to read or write raw tables.
-- The Web app and public data API go through Next.js server routes with service role access.

update public.toilets
set
  source = coalesce(source, 'user'),
  source_license = coalesce(source_license, 'ODbL-1.0'),
  source_attribution = coalesce(
    source_attribution,
    case
      when source = 'osm' then 'OpenStreetMap contributors'
      else 'LaLeMe contributors'
    end
  ),
  source_status = coalesce(source_status, 'active'),
  updated_at = now()
where source_license is null
   or source_attribution is null
   or source_status is null
   or source is null;

drop policy if exists "public_read_regions" on public.regions;
drop policy if exists "public_read_places" on public.places;
drop policy if exists "public_insert_places" on public.places;
drop policy if exists "public_read_toilets" on public.toilets;
drop policy if exists "public_insert_toilets" on public.toilets;
drop policy if exists "public_read_status_updates" on public.toilet_status_updates;
drop policy if exists "public_insert_status_updates" on public.toilet_status_updates;
drop policy if exists "public_read_reviews" on public.toilet_reviews;
drop policy if exists "public_insert_reviews" on public.toilet_reviews;
drop policy if exists "public_read_paper_requests" on public.paper_requests;
drop policy if exists "public_insert_paper_requests" on public.paper_requests;
drop policy if exists "public_update_paper_requests" on public.paper_requests;
drop policy if exists "public_insert_reports" on public.reports;

revoke select, insert, update, delete on
  public.regions,
  public.places,
  public.toilets,
  public.toilet_status_updates,
  public.toilet_reviews,
  public.paper_requests,
  public.reports,
  public.osm_sync_runs
from anon, authenticated;

revoke usage, select on all sequences in schema public from anon, authenticated;

comment on table public.toilets is
  'Production toilet records. Raw table access is server-only; public data is exposed through /api/public/toilets.';

notify pgrst, 'reload schema';

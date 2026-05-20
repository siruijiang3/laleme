-- Lightweight summary views for viewport map reads.
-- These views avoid loading review bodies and paper request bodies for every map point.

create or replace view public.toilet_latest_status_summary as
select distinct on (toilet_id)
  toilet_id,
  is_open,
  has_paper,
  is_clean,
  created_at as updated_at
from public.toilet_status_updates
order by toilet_id, created_at desc, id desc;

create or replace view public.toilet_rating_summary as
select
  toilet_id,
  round(avg(rating)::numeric, 1) as average_rating,
  count(*)::integer as review_count
from public.toilet_reviews
where is_hidden = false
group by toilet_id;

create or replace view public.toilet_active_help_summary as
select
  toilet_id,
  count(*)::integer as active_help_request_count
from public.paper_requests
where status = 'active'
group by toilet_id;

comment on view public.toilet_latest_status_summary is
  'Latest status per toilet for lightweight viewport reads.';

comment on view public.toilet_rating_summary is
  'Rating average and count per toilet without review body text.';

comment on view public.toilet_active_help_summary is
  'Active paper request counts per toilet without request body text.';

revoke all on
  public.toilet_latest_status_summary,
  public.toilet_rating_summary,
  public.toilet_active_help_summary
from anon, authenticated;

notify pgrst, 'reload schema';

-- Allow server-side service role API routes to read lightweight summary views.
-- Browser anon/authenticated access remains revoked.

grant select on
  public.toilet_latest_status_summary,
  public.toilet_rating_summary,
  public.toilet_active_help_summary
to service_role;

notify pgrst, 'reload schema';

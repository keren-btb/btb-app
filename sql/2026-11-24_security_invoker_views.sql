-- 2026-11-24 — applied by Claude with Keren's OK. Booking-page views now follow normal access rules
-- (security_invoker) instead of bypassing them; the public can read only these columns, only current rows.
-- Trigger functions can no longer be called directly through the API (triggers still run as normal).
revoke select on public.staff_free_times from anon;
grant select (staff_id, scope, day_of_week, free_date, start_time, end_time) on public.staff_free_times to anon;
create policy free_times_anon_read on public.staff_free_times for select to anon using (scope = 'usual' or free_date >= current_date - 1);
alter view public.public_staff_free_times set (security_invoker = on);
revoke select on public.staff_free_day_overrides from anon;
grant select (staff_id, free_date) on public.staff_free_day_overrides to anon;
create policy free_day_overrides_anon_read on public.staff_free_day_overrides for select to anon using (free_date >= current_date - 1);
alter view public.public_staff_free_day_overrides set (security_invoker = on);
grant select (can_reset) on public.staff_game_training to anon;
alter view public.public_staff_can_reset set (security_invoker = on);
revoke execute on function public.check_online_booking_clash() from anon, authenticated, public;
revoke execute on function public.trigger_booking_request_new() from anon, authenticated, public;

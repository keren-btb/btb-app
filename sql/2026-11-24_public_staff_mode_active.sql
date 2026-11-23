-- 2026-11-24 — let the public booking page know who is inactive (so people who have left are never offered)
-- Run once in Supabase > SQL Editor. Adds one yes/no column ("active") to the public_staff_mode view.
-- Nothing else about a staff member becomes visible. The booking page works before and after this is run.

grant select (active) on public.staff to anon;

create or replace view public.public_staff_mode with (security_invoker = on) as
  select id as staff_id, availability_mode, active
  from public.staff;

grant select on public.public_staff_mode to anon, authenticated;

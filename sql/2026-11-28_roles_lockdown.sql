-- 2026-11-28 Roles lock-down (Keren: "pls fix it all & run sql", 28 Nov 20:58)
-- 1. Staff records: a staff member can't make themselves an Owner or change their date of birth.
--    Only an owner can change who is an owner; only admin/manager can change date of birth.
-- 2. Gamemaster Own logins only see the bookings they run (or made, or are asked to run),
--    and only the clients of those bookings (plus their emails/notes and waivers).
--    Admin, manager and gamemaster logins still see everything.
-- 3. staff_booking_slots(from, to): times of ALL bookings with no customer details, for
--    room-reset checks and "Booked" blocks (works for every staff login).
-- 4. Settings and the games list can only be changed by admin/manager (everyone can still read them).

-- ---------- 1 ----------
create or replace function public.protect_staff_owner_dob()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service role / SQL editor
  if new.is_owner is distinct from old.is_owner and not public.is_owner() then
    raise exception 'Only an owner can change who is an owner';
  end if;
  if new.date_of_birth is distinct from old.date_of_birth and not public.is_admin_or_manager() then
    raise exception 'Only admins/managers can change date of birth';
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_staff_owner_dob on public.staff;
create trigger trg_protect_staff_owner_dob before update on public.staff
  for each row execute function public.protect_staff_owner_dob();

-- new staff can't be made owners by a non-owner either
create or replace function public.protect_staff_owner_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and coalesce(new.is_owner,false) and not public.is_owner() then
    raise exception 'Only an owner can make someone an owner';
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_staff_owner_insert on public.staff;
create trigger trg_protect_staff_owner_insert before insert on public.staff
  for each row execute function public.protect_staff_owner_insert();

-- ---------- 2 ----------
-- true for admin / manager / gamemaster; false for gamemaster_own (and anyone with no role)
create or replace function public.sees_all_bookings()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() in ('admin','manager','gamemaster'), false)
$$;
revoke all on function public.sees_all_bookings() from public, anon;
grant execute on function public.sees_all_bookings() to authenticated;

-- who made a booking / client (set automatically, can't be faked or changed)
alter table public.game_bookings add column if not exists created_by_staff uuid;
alter table public.clients add column if not exists created_by_staff uuid;

create or replace function public.set_created_by_staff()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by_staff := public.my_staff_id(); else new.created_by_staff := null; end if;
  else
    new.created_by_staff := old.created_by_staff;
  end if;
  return new;
end $$;
drop trigger if exists trg_game_bookings_created_by on public.game_bookings;
create trigger trg_game_bookings_created_by before insert or update on public.game_bookings
  for each row execute function public.set_created_by_staff();
drop trigger if exists trg_clients_created_by on public.clients;
create trigger trg_clients_created_by before insert or update on public.clients
  for each row execute function public.set_created_by_staff();

-- a booking this login may see: runs it, made it, or has been asked to run it
create or replace function public.my_booking(p_id uuid, p_assigned text, p_created uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_staff_id() is not null and (
       coalesce(p_assigned,'') like '%' || public.my_staff_id()::text || '%'
    or p_created = public.my_staff_id()
    or exists (select 1 from public.booking_request_offers o where o.booking_id = p_id and o.staff_id = public.my_staff_id()))
$$;
revoke all on function public.my_booking(uuid,text,uuid) from public, anon;
grant execute on function public.my_booking(uuid,text,uuid) to authenticated;

-- a client this login may see: all (if sees_all_bookings), made them, or one of their bookings is visible
create or replace function public.my_client(p_client uuid, p_created uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.sees_all_bookings()
      or (p_created is not null and p_created = public.my_staff_id())
      or exists (select 1 from public.game_bookings b
                 where b.client_id = p_client and public.my_booking(b.id, b.assigned_staff_ids, b.created_by_staff))
$$;
revoke all on function public.my_client(uuid,uuid) from public, anon;
grant execute on function public.my_client(uuid,uuid) to authenticated;

-- game_bookings
drop policy if exists authenticated_all_game_bookings on public.game_bookings;
create policy gb_staff_select on public.game_bookings for select to authenticated
  using ((select public.sees_all_bookings()) or public.my_booking(id, assigned_staff_ids, created_by_staff));
create policy gb_staff_insert on public.game_bookings for insert to authenticated
  with check (public.current_user_role() is not null);
create policy gb_staff_update on public.game_bookings for update to authenticated
  using ((select public.sees_all_bookings()) or public.my_booking(id, assigned_staff_ids, created_by_staff))
  with check (public.current_user_role() is not null);
create policy gb_staff_delete on public.game_bookings for delete to authenticated
  using ((select public.sees_all_bookings()));

-- clients
drop policy if exists clients_authenticated_all on public.clients;
create policy clients_staff_select on public.clients for select to authenticated
  using (public.my_client(id, created_by_staff));
create policy clients_staff_insert on public.clients for insert to authenticated
  with check (public.current_user_role() is not null);
create policy clients_staff_update on public.clients for update to authenticated
  using (public.my_client(id, created_by_staff)) with check (public.current_user_role() is not null);
create policy clients_staff_delete on public.clients for delete to authenticated
  using ((select public.sees_all_bookings()));

-- client emails / notes / to-dos
drop policy if exists authenticated_all on public.client_interactions;
create policy ci_staff_all on public.client_interactions for all to authenticated
  using ((select public.sees_all_bookings())
         or staff_id = (select public.my_staff_id()) or assigned_staff_id = (select public.my_staff_id())
         or (client_id is not null and public.my_client(client_id, null)))
  with check (public.current_user_role() is not null);

-- waivers (signing stays open; reading limited to waivers for bookings they can see)
drop policy if exists authenticated_all_waivers on public.waivers;
create policy waivers_staff_select on public.waivers for select to authenticated
  using ((select public.sees_all_bookings())
         or (booking_id is not null and exists (select 1 from public.game_bookings b where b.id = waivers.booking_id)));
create policy waivers_staff_insert on public.waivers for insert to authenticated with check (true);
create policy waivers_staff_update on public.waivers for update to authenticated
  using ((select public.sees_all_bookings())
         or (booking_id is not null and exists (select 1 from public.game_bookings b where b.id = waivers.booking_id)))
  with check (true);
create policy waivers_staff_delete on public.waivers for delete to authenticated
  using ((select public.is_admin_or_manager()));

-- ---------- 3 ----------
create or replace function public.staff_booking_slots(p_from date, p_to date)
returns table (id uuid, game_id text, game_name text, booking_date date, slot_time time, status text,
               assigned_staff_ids text, players_booked int, play_location text, gm_attends boolean,
               dropoff_method text, dropoff_time time, pickup_method text, pickup_time time,
               group_booking_id uuid, source text, done boolean)
language sql stable security definer set search_path = public as $$
  select b.id, b.game_id, b.game_name, b.booking_date, b.slot_time, b.status, b.assigned_staff_ids,
         b.players_booked, b.play_location, b.gm_attends, b.dropoff_method, b.dropoff_time,
         b.pickup_method, b.pickup_time, b.group_booking_id, b.source, b.done
  from public.game_bookings b
  where public.current_user_role() is not null
    and b.booking_date between p_from and least(p_to, p_from + 400)
    and b.status <> 'cancelled'
  order by b.booking_date, b.slot_time
$$;
revoke all on function public.staff_booking_slots(date,date) from public, anon;
grant execute on function public.staff_booking_slots(date,date) to authenticated;

-- ---------- 4 ----------
drop policy if exists authenticated_all_settings on public.settings;
create policy settings_staff_read on public.settings for select to authenticated using (true);
create policy settings_admin_write on public.settings for insert to authenticated with check ((select public.is_admin_or_manager()));
create policy settings_admin_update on public.settings for update to authenticated
  using ((select public.is_admin_or_manager())) with check ((select public.is_admin_or_manager()));
create policy settings_admin_delete on public.settings for delete to authenticated using ((select public.is_admin_or_manager()));

drop policy if exists authenticated_all_games on public.games;
create policy games_staff_read on public.games for select to authenticated using (true);
create policy games_admin_insert on public.games for insert to authenticated with check ((select public.is_admin_or_manager()));
create policy games_admin_update on public.games for update to authenticated
  using ((select public.is_admin_or_manager())) with check ((select public.is_admin_or_manager()));
create policy games_admin_delete on public.games for delete to authenticated using ((select public.is_admin_or_manager()));

-- ---------- page ticks ----------
-- Gamemaster Own: their own calendar, clients, POS, Task Hub, Control Room (to run their games) and Staff Portal
update public.user_roles set allowed_tabs = '["calendar","leads","pos","task_hub","control_room","staff_portal"]'
  where role = 'gamemaster_own';
-- Liam (test gamemaster) back to the gamemaster starting ticks (had Settings + Enquiries)
update public.user_roles set allowed_tabs = '["calendar","pos","task_hub","control_room","staff_portal"]'
  where role = 'gamemaster';
-- managers also get the Staff Portal tick (Manny had none)
update public.user_roles set allowed_tabs = (
  select jsonb_agg(distinct x)::text from jsonb_array_elements_text(allowed_tabs::jsonb || '["staff_portal"]'::jsonb) x)
  where role = 'manager';

-- managers also get the Reports tick (reports.html now checks the tick)
update public.user_roles set allowed_tabs = (
  select jsonb_agg(distinct x)::text from jsonb_array_elements_text(allowed_tabs::jsonb || '["reports"]'::jsonb) x)
  where role = 'manager';

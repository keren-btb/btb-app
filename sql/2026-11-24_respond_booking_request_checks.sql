-- 2026-11-24 — respond_booking_request: safer "Accept"
-- Run this once in Supabase > SQL Editor. It only replaces the one function; no data is changed.
--
-- What changes when someone accepts a booking request:
--   1. Refused if that person is already running another game at that time
--      (hires with a GM going count from drop-off to pick-up).
--   2. If they already have a shift covering the game, no second (overlapping) shift is made,
--      so "Hours rostered" isn't counted twice.
--   3. A new shift now covers the game PLUS its reset time (the game's buffer, usually 30 min),
--      so the booking page knows someone is there to reset.
-- Everything else (who may accept, declining, the confirmation email) works exactly as before.

create or replace function public.respond_booking_request(p_booking uuid, p_accept boolean, p_staff uuid default null::uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid; who uuid; b record; len int; buf int; s_min int; e_min int; service_key text;
begin
  select id into me from public.staff where user_role_id = auth.uid();
  if me is null then return 'not_staff'; end if;
  who := coalesce(p_staff, me);
  if who <> me and not public.is_owner() then return 'not_allowed'; end if;

  select * into b from public.game_bookings where id = p_booking for update;
  if not found then return 'not_found'; end if;
  if b.status <> 'requested' then return 'already_done'; end if;

  if not p_accept then
    insert into public.booking_request_offers (booking_id, staff_id, response, responded_at)
      values (p_booking, who, 'declined', now())
      on conflict (booking_id, staff_id) do update set response = 'declined', responded_at = now();
    return 'declined';
  end if;

  select coalesce(duration, 60), coalesce(buffer_minutes, 30) into len, buf from public.games where id = b.game_id;
  len := coalesce(len, 60); buf := coalesce(buf, 30);
  s_min := extract(hour from b.slot_time)::int * 60 + extract(minute from b.slot_time)::int;
  e_min := s_min + len;

  -- 1. not if they're already running another game then
  if exists (
    select 1 from public.game_bookings o
    left join public.games og on og.id = o.game_id
    where o.booking_date = b.booking_date and o.id <> b.id
      and o.status in ('confirmed','requested','completed')
      and coalesce(o.assigned_staff_ids, '') like '%"' || who::text || '"%'
      and (case when o.play_location = 'hire' and o.dropoff_time is not null
                then extract(hour from o.dropoff_time)::int * 60 + extract(minute from o.dropoff_time)::int
                else extract(hour from o.slot_time)::int * 60 + extract(minute from o.slot_time)::int end) < e_min
      and (case when o.play_location = 'hire' and o.pickup_time is not null
                then extract(hour from o.pickup_time)::int * 60 + extract(minute from o.pickup_time)::int
                else extract(hour from o.slot_time)::int * 60 + extract(minute from o.slot_time)::int + coalesce(og.duration, 60) end) > s_min
  ) then
    return 'They are already running another game at that time';
  end if;

  -- 2 + 3. a shift for the game and its reset, unless they already have a shift covering the game
  if not exists (
    select 1 from public.assigned_shifts sh
    where sh.staff_id = who and sh.shift_date = b.booking_date and sh.status <> 'open'
      and sh.custom_start_time <= b.slot_time
      and sh.custom_end_time >= b.slot_time + make_interval(mins => len)
  ) then
    insert into public.assigned_shifts (shift_date, custom_start_time, custom_end_time, staff_id, status, assigned_at, shift_type, is_standby, notes, created_by)
      values (b.booking_date, b.slot_time, least(b.slot_time + make_interval(mins => len + buf), time '23:59'), who, 'assigned', now(), 'custom', false,
              'Accepted request: ' || coalesce(b.game_name, 'game'), 'Booking request');
  end if;

  update public.game_bookings set status = 'confirmed', assigned_staff_ids = json_build_array(who)::text, updated_at = now()
    where id = p_booking;
  insert into public.booking_request_offers (booking_id, staff_id, response, responded_at)
    values (p_booking, who, 'accepted', now())
    on conflict (booking_id, staff_id) do update set response = 'accepted', responded_at = now();
  update public.booking_request_offers set response = 'taken_by_other', responded_at = now()
    where booking_id = p_booking and staff_id <> who and response is null;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  perform net.http_post(
    url := 'https://dcksohetvlonijtcbjwe.supabase.co/functions/v1/btb-booking-confirmation',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || service_key),
    body := jsonb_build_object('booking_id', p_booking));
  return 'accepted';
end $function$;

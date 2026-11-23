-- 2026-11-24 — check_online_booking_clash: a GM going out with a hire is busy from drop-off to pick-up
-- Run once in Supabase > SQL Editor. Only replaces the one function; no data is changed.
-- Same as before, except in the "is the game master still free?" part: a hire booking with a GM going
-- (gm_attends not false) blocks that GM from its drop-off time to its pick-up time, not just for the game itself.

create or replace function public.check_online_booking_clash()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  g record; ns int; ne_room int; ne_game int; sid text; ids jsonb;
begin
  if new.source is distinct from 'online' or new.status not in ('confirmed','requested') or new.play_location = 'hire' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('btb-booking-' || new.booking_date::text));

  select coalesce(duration, 60) as dur, coalesce(buffer_minutes, 30) as buf, category into g from public.games where id = new.game_id;
  ns := extract(hour from new.slot_time)::int * 60 + extract(minute from new.slot_time)::int;
  ne_game := ns + coalesce(g.dur, 60);
  ne_room := ne_game + coalesce(g.buf, 30);

  if coalesce(g.category, '') <> 'cafe' and exists (
    select 1 from public.game_bookings b
    left join public.games og on og.id = b.game_id
    where b.booking_date = new.booking_date and b.game_id = new.game_id and b.id <> new.id
      and b.status in ('confirmed','requested','completed')
      and (
        (extract(hour from b.slot_time)::int * 60 + extract(minute from b.slot_time)::int) = ns
        or (case when b.play_location = 'hire'
              then least(coalesce(extract(hour from b.dropoff_time)::int * 60 + extract(minute from b.dropoff_time)::int, 100000),
                         extract(hour from b.slot_time)::int * 60 + extract(minute from b.slot_time)::int)
              else extract(hour from b.slot_time)::int * 60 + extract(minute from b.slot_time)::int end) < ne_room
           and (case when b.play_location = 'hire'
              then coalesce(extract(hour from b.pickup_time)::int * 60 + extract(minute from b.pickup_time)::int,
                            extract(hour from b.slot_time)::int * 60 + extract(minute from b.slot_time)::int
                              + greatest(coalesce(round(og.hire_period_hours * 60)::int, 0), coalesce(og.duration, 60)))
                   + coalesce(og.buffer_minutes, 30)
              else extract(hour from b.slot_time)::int * 60 + extract(minute from b.slot_time)::int
                   + coalesce(og.duration, 60) + coalesce(og.buffer_minutes, 30) end) > ns
      )
  ) then
    raise exception 'SLOT_TAKEN: this room is already booked at this time' using errcode = 'P0001';
  end if;

  begin ids := coalesce(nullif(new.assigned_staff_ids, ''), '[]')::jsonb; exception when others then ids := '[]'::jsonb; end;
  if jsonb_typeof(ids) <> 'array' then ids := '[]'::jsonb; end if;
  for sid in select jsonb_array_elements_text(ids) loop
    if exists (
      select 1 from public.game_bookings b
      left join public.games og on og.id = b.game_id
      where b.booking_date = new.booking_date and b.id <> new.id
        and b.status in ('confirmed','requested','completed')
        and coalesce(b.assigned_staff_ids, '') like '%"' || sid || '"%'
        -- start: a hire with a GM going starts at drop-off (if earlier)
        and (case when b.play_location = 'hire' and b.gm_attends is distinct from false and b.dropoff_time is not null
                  then least(extract(hour from b.dropoff_time)::int * 60 + extract(minute from b.dropoff_time)::int,
                             extract(hour from b.slot_time)::int * 60 + extract(minute from b.slot_time)::int)
                  else extract(hour from b.slot_time)::int * 60 + extract(minute from b.slot_time)::int end) < ne_game
        -- end: a hire with a GM going ends at pick-up (if later)
        and (case when b.play_location = 'hire' and b.gm_attends is distinct from false and b.pickup_time is not null
                  then greatest(extract(hour from b.pickup_time)::int * 60 + extract(minute from b.pickup_time)::int,
                                extract(hour from b.slot_time)::int * 60 + extract(minute from b.slot_time)::int + coalesce(og.duration, 60))
                  else extract(hour from b.slot_time)::int * 60 + extract(minute from b.slot_time)::int + coalesce(og.duration, 60) end) > ns
    ) then
      raise exception 'SLOT_TAKEN: the game master is no longer free at this time' using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $function$;

-- 2026-11-27 Security tightening (Keren OK'd fixes 1-5, 27 Nov 23:02)
-- 1. Online bookings: the database checks the price itself and flags a mismatch for staff
--    (never blocks a customer); staff-only notes are cleared on public bookings.
-- 2. New public_get_client_id(): find-or-create in one step, so the public page can't
--    test whether an email/phone is a customer. (Old functions stay until the new
--    pages are pushed, then: see the "LATER" block at the bottom.)
-- 3. Caps: max 20 online bookings per client per hour, 60 online bookings per 10 min overall,
--    60 new clients per hour from public pages, 10 public to-dos per client per hour.
-- 4. Remove public (anon) table permissions that no security rule uses (no behaviour change).
-- 5. game-photos: only owners/managers can upload, replace or delete.

-- ---------- 1 ----------
create or replace function public.btb_setting_json(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v text; j jsonb;
begin
  select value into v from public.settings where key = p_key;
  if v is null then return null; end if;
  begin
    j := v::jsonb;
    if jsonb_typeof(j) = 'string' then j := (j #>> '{}')::jsonb; end if;
    return j;
  exception when others then return null; end;
end $$;
revoke all on function public.btb_setting_json(text) from public, anon, authenticated;

-- Same formula as calcPrice() in booking_widget.html / calcom-booking-intake
create or replace function public.btb_game_base_price(p_game_id text, p_players int)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare games jsonb; cfg jsonb; g jsonb; typ text; tiers jsonb; t jsonb; pp numeric; n int := coalesce(p_players, 1);
begin
  games := public.btb_setting_json('btb_games');
  cfg := coalesce(public.btb_setting_json('btb_booking_config'), '{}'::jsonb);
  if games is null or jsonb_typeof(games) <> 'array' then return null; end if;
  select x into g from jsonb_array_elements(games) x where x->>'id' = p_game_id limit 1;
  if g is null then return null; end if;
  typ := coalesce(g->>'pricingType', 'per_person_tiered');
  if typ = 'per_hour_flat' then
    return coalesce((cfg->'gameFlatPrice'->>p_game_id)::numeric, 0);
  elsif typ = 'per_person_per_hour' then
    return coalesce((cfg->'gamePerPersonPerHour'->>p_game_id)::numeric, 0) * n;
  end if;
  tiers := cfg->'gamePriceTiers'->p_game_id;
  if tiers is null or jsonb_typeof(tiers) <> 'array' or jsonb_array_length(tiers) = 0 then
    tiers := '[{"min":1,"max":99,"pp":35}]'::jsonb;
  end if;
  select x into t from jsonb_array_elements(tiers) x
    where n >= coalesce((x->>'min')::int, 1) and n <= coalesce((x->>'max')::int, 999) limit 1;
  if t is null then t := tiers -> (jsonb_array_length(tiers) - 1); end if;
  pp := coalesce((t->>'pp')::numeric, 35);
  return pp * n;
end $$;
revoke all on function public.btb_game_base_price(text, int) from public, anon, authenticated;

create or replace function public.guard_online_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base numeric; pos numeric := 0; neg numeric := 0; expected numeric;
  a jsonb; lbl text; code text; flags text[] := '{}'; notes jsonb; recent int;
begin
  if coalesce(auth.role(), '') <> 'anon' or new.source is distinct from 'online' then
    return new;
  end if;

  -- caps (bots / mistakes filling the diary)
  if new.client_id is not null then
    select count(*) into recent from public.game_bookings
      where client_id = new.client_id and source = 'online' and created_at > now()::timestamp - interval '1 hour';
    if recent >= 20 then
      raise exception 'RATE_LIMIT: too many bookings from you in the last hour — please call us' using errcode = 'P0001';
    end if;
  end if;
  select count(*) into recent from public.game_bookings
    where source = 'online' and created_at > now()::timestamp - interval '10 minutes';
  if recent >= 60 then
    raise exception 'RATE_LIMIT: booking is very busy right now — please try again shortly or call us' using errcode = 'P0001';
  end if;

  -- staff-only fields: the public can't write staff notes
  new.staff_notes := '[]';

  -- price check (flags for staff, never blocks the customer)
  if new.status in ('confirmed', 'requested') and new.game_id is not null then
    base := public.btb_game_base_price(new.game_id, new.players_booked);
    if base is not null then
      begin
        if new.addons is not null and new.addons <> '' then
          for a in select x from jsonb_array_elements(new.addons::jsonb) x loop
            if coalesce((a->>'amount')::numeric, 0) >= 0 then
              pos := pos + coalesce((a->>'amount')::numeric, 0);
            else
              neg := neg + (a->>'amount')::numeric;
              lbl := coalesce(a->>'label', '');
              if lbl ilike 'Voucher %' then
                code := btrim(substr(lbl, 9));
                if not exists (select 1 from public.vouchers v where upper(v.code) = upper(code) and v.status = 'active') then
                  flags := flags || ('⚠ Price check: voucher "' || code || '" isn''t an active voucher');
                end if;
              else
                flags := flags || ('⚠ Price check: unexpected discount "' || lbl || '"');
              end if;
            end if;
          end loop;
        end if;
      exception when others then
        flags := flags || '⚠ Price check: couldn''t read the add-ons';
      end;
      expected := greatest(0, base + pos + neg);
      if abs(coalesce(new.total_amount, 0) - expected) > 1 then
        flags := flags || ('⚠ Price check: booking page sent $' || coalesce(new.total_amount, 0)::text
                           || ' but the price list says $' || expected::text || ' — please check');
      end if;
    end if;
  end if;

  if array_length(flags, 1) > 0 then
    notes := to_jsonb(flags);
    new.staff_notes := notes::text;
  end if;
  return new;
end $$;
revoke all on function public.guard_online_booking() from public, anon, authenticated;

drop trigger if exists before_online_booking_guard on public.game_bookings;
create trigger before_online_booking_guard before insert on public.game_bookings
  for each row execute function public.guard_online_booking();

-- ---------- 2 + 3 ----------
create or replace function public.public_get_client_id(
  p_first_name text, p_last_name text, p_email text, p_phone text, p_source text default 'online')
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; recent int;
  e text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  ph text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if e is null and ph is null then
    raise exception 'An email or phone number is needed' using errcode = 'P0001';
  end if;
  select id into cid from clients
    where (e is not null and lower(email) = e) or (ph is not null and phone = ph)
    order by (e is not null and lower(email) = e) desc, created_at limit 1;
  if cid is not null then return cid; end if;
  select count(*) into recent from clients
    where source in ('online', 'wishlist', 'voucher', 'waitlist', 'fillout') and created_at > now()::timestamp - interval '1 hour';
  if recent >= 60 then
    raise exception 'RATE_LIMIT: please try again shortly or call us' using errcode = 'P0001';
  end if;
  insert into clients (first_name, last_name, email, phone, source)
    values (left(coalesce(p_first_name, ''), 80), left(p_last_name, 80), left(e, 200), left(ph, 40),
            left(coalesce(p_source, 'online'), 30))
    returning id into cid;
  return cid;
end $$;
revoke all on function public.public_get_client_id(text, text, text, text, text) from public;
grant execute on function public.public_get_client_id(text, text, text, text, text) to anon, authenticated;

create or replace function public.public_log_client_contact(p_client_id uuid, p_summary text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid; recent int;
begin
  select count(*) into recent from client_interactions
    where client_id = p_client_id and direction = 'inbound' and type = 'other'
      and created_at > now()::timestamp - interval '1 hour';
  if recent >= 10 then
    raise exception 'RATE_LIMIT: please try again later or call us' using errcode = 'P0001';
  end if;
  insert into client_interactions (client_id, type, direction, content, to_do, to_do_done)
    values (p_client_id, 'other', 'inbound', left(p_summary, 4000), true, false)
    returning id into new_id;
  return new_id;
end $$;

create or replace function public.public_log_voucher_request(p_client_id uuid, p_summary text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  return public.public_log_client_contact(p_client_id, p_summary);
end $$;

-- ---------- 5 ----------
drop policy if exists authenticated_upload_game_photos on storage.objects;
drop policy if exists authenticated_update_game_photos on storage.objects;
drop policy if exists authenticated_delete_game_photos on storage.objects;
create policy managers_upload_game_photos on storage.objects for insert to authenticated
  with check (bucket_id = 'game-photos' and public.is_admin_or_manager());
create policy managers_update_game_photos on storage.objects for update to authenticated
  using (bucket_id = 'game-photos' and public.is_admin_or_manager());
create policy managers_delete_game_photos on storage.objects for delete to authenticated
  using (bucket_id = 'game-photos' and public.is_admin_or_manager());

-- ---------- LATER (after booking_widget.html v1.7.67 + gift_voucher_request.html are pushed) ----------
-- revoke execute on function public.public_find_client_id(text, text) from anon, public;
-- revoke execute on function public.public_create_client(text, text, text, text, text) from anon, public;

-- ---------- 2026-11-28 08:30 fix (applied) ----------
-- guard_online_booking() replaced: the first version mixed up its "code" variable with the
-- vouchers.code column and failed on bookings with add-ons. New version (now live) uses
-- v_code / array_append, accepts vouchers that are active or already used, and wraps the whole
-- price check so it can never stop a customer's booking. Tested as the public role with:
-- fake voucher (flagged), no add-ons, a paid add-on, empty add-ons (all saved fine).

-- ---------- 2026-11-28 fix 4 (applied) ----------
-- Removed public (anon) table permissions that no security rule uses: all rights on
-- booking_request_offers, client_interactions, clients, daily_task_*, enquiry_templates,
-- game_wishlist, general_task_*, help_alerts, hours_requests, personal_tasks, push_subscriptions,
-- quick_sales, staff_recurring_availability, staff_recurring_event_review, staff_shifts, task_*,
-- timesheets; everything except the used one on error_logs (insert), games (select),
-- settings (select), vouchers (insert), waivers (insert). This included TRUNCATE ("empty the
-- table"), which ignores security rules. Tested as the public role: booking slots, settings (4 public
-- keys), games, staff flags, availability, room pages, error logging and voucher requests still work;
-- clients is now blocked outright.

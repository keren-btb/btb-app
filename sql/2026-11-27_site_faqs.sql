-- 2026-11-27: Website FAQs, edited in the BtB app (Settings > Website FAQs, site_faqs.html).
-- Each FAQ has a question, an answer, an optional link (label + address), an order and a Show / Hide switch.
-- The website reads only shown FAQs through public_site_faqs(). The table itself isn't readable with the public key.
-- STATUS: applied 2026-11-27 by Claude with Keren's OK (migration "site_faqs"). Safe to re-run.

create table if not exists public.site_faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null check (length(trim(question)) > 0),
  answer text not null check (length(trim(answer)) > 0),
  link_label text,                     -- optional, e.g. 'Open in Google Maps'
  link_url text check (link_url is null or link_url ~* '^(https?://|/|tel:|mailto:)'),
  sort_order integer not null default 100,
  show_on_website boolean not null default true,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.site_faqs enable row level security;

drop policy if exists site_faqs_staff_all on public.site_faqs;
create policy site_faqs_staff_all on public.site_faqs
  for all to authenticated
  using (public.is_admin_or_manager() or public.is_owner())
  with check (public.is_admin_or_manager() or public.is_owner());

revoke all on public.site_faqs from anon;
grant select, insert, update, delete on public.site_faqs to authenticated;
grant all on public.site_faqs to service_role;

create or replace function public.site_faqs_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists site_faqs_touch on public.site_faqs;
create trigger site_faqs_touch before update on public.site_faqs
  for each row execute function public.site_faqs_touch();

create or replace function public.public_site_faqs()
returns table (question text, answer text, link_label text, link_url text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select f.question, f.answer, f.link_label, f.link_url
  from public.site_faqs f
  where f.show_on_website
  order by f.sort_order, f.created_at
  limit 100;
$$;
revoke all on function public.public_site_faqs() from public;
grant execute on function public.public_site_faqs() to anon, authenticated;

-- Start with the FAQs that are on the new website now (only if the table is empty).
insert into public.site_faqs (question, answer, link_label, link_url, sort_order, created_by)
select * from (values
  ('Are the rooms scary?', 'Not at all! Our rooms are about puzzles, teamwork and a good story — no jump scares and nobody chasing you.', null, null, 10, null::uuid),
  ('Can I bring my child?', 'Yes. Kids aged 10 and over are welcome with a paying adult. Younger than 10? Give us a call first and we’ll talk it through.', null, null, 20, null::uuid),
  ('Do I have to book, or can I just walk in?', 'Escape rooms run by appointment, so please book ahead online or by phone, then your room and game master are ready for you. Hoping to play today? Call us on 022 053 7365 and we’ll see what we can fit in.', null, null, 30, null::uuid),
  ('How many people do we need?', 'Most rooms suit 3–8 players, depending on the room (each room page shows its numbers). Just two of you? That works too: a booking for two costs the same as three.', null, null, 40, null::uuid),
  ('Can I add extra people on the day?', 'Yes, up to the room’s maximum. Just pay the extra when you arrive.', null, null, 50, null::uuid),
  ('What if we get stuck?', 'Your game master is watching over the game and can give you a hint whenever you need one. Asking for a hint is totally fine — we want you to have fun.', null, null, 60, null::uuid),
  ('What should I wear?', 'Nothing special. Comfortable clothes and shoes you can move around in are perfect.', null, null, 70, null::uuid),
  ('What happens if something breaks?', 'Accidents happen! Just let your game master know so we can fix it before the next team. There’s no charge as long as everyone has been playing respectfully.', null, null, 80, null::uuid),
  ('Do I need to pay a deposit?', 'We ask for a $35 deposit to hold your booking, and the rest is paid on the day. No payment is taken on the website.', null, null, 90, null::uuid),
  ('Do you sell gift vouchers?', 'Yes! Escape room gift vouchers make a great present. Ask for one online or give us a call.', 'Ask for a gift voucher online', '/test/gift_voucher_request.html', 100, null::uuid),
  ('Where are you?', '105 Market Street North, in the Hastings CBD. Look for the pavement sign and head in. FYI we do have stairs to go up to the rooms. We’re just around the corner from the concrete sheep!', 'Open in Google Maps', 'https://maps.google.com/?cid=1101478008693783258', 110, null::uuid)
) v
where not exists (select 1 from public.site_faqs);

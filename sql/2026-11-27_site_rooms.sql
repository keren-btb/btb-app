-- 2026-11-27: Website room pages ("case files"), edited in the BtB app (Settings > Website rooms, site_rooms.html).
-- One row per room page: words, facts, "Great for", booking button, main photo and spoiler photos.
-- Photos are uploaded to the public storage bucket 'site-photos' (only admins/managers/owners can upload;
-- nothing is ever deleted from it by the app; removing a photo from a room just stops showing it).
-- The website reads shown rooms through public_site_rooms(). The table itself isn't readable with the public key.
-- STATUS: applied 2026-11-27 by Claude with Keren's OK (migration "site_rooms"). Safe to re-run.

create table if not exists public.site_rooms (
  id text primary key check (id ~ '^[a-z0-9-]{2,30}$'),   -- matches the website, e.g. 'sherlock'
  name text not null,
  kicker text,
  story text not null default '',                            -- paragraphs separated by a blank line
  tip text,
  facts jsonb not null default '[]'::jsonb,                  -- [{icon:'time|players|price|level|place', label, value}]
  good_for text[] not null default '{}',
  main_photo_url text,                                       -- null = use the website's own photo
  spoilers jsonb not null default '[]'::jsonb,               -- [{url, caption}]
  book_label text,                                           -- e.g. 'Book Sherlock'
  book_game_id text,                                         -- booking page game id, e.g. 'g1' (null = escape room list)
  call_label text,                                           -- shown instead of a Book button, e.g. 'Call to book Pirate’s Cove'
  show_page boolean not null default true,
  sort_order integer not null default 100,
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_rooms_facts_is_array check (jsonb_typeof(facts) = 'array'),
  constraint site_rooms_spoilers_is_array check (jsonb_typeof(spoilers) = 'array')
);

alter table public.site_rooms enable row level security;

drop policy if exists site_rooms_staff_all on public.site_rooms;
create policy site_rooms_staff_all on public.site_rooms
  for all to authenticated
  using (public.is_admin_or_manager() or public.is_owner())
  with check (public.is_admin_or_manager() or public.is_owner());

revoke all on public.site_rooms from anon;
grant select, insert, update, delete on public.site_rooms to authenticated;
grant all on public.site_rooms to service_role;

create or replace function public.site_rooms_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by); return new; end $$;
drop trigger if exists site_rooms_touch on public.site_rooms;
create trigger site_rooms_touch before update on public.site_rooms
  for each row execute function public.site_rooms_touch();

create or replace function public.public_site_rooms()
returns table (id text, name text, kicker text, story text, tip text, facts jsonb, good_for text[],
               main_photo_url text, spoilers jsonb, book_label text, book_game_id text, call_label text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, r.name, r.kicker, r.story, r.tip, r.facts, r.good_for,
         r.main_photo_url, r.spoilers, r.book_label, r.book_game_id, r.call_label
  from public.site_rooms r
  where r.show_page
  order by r.sort_order, r.id;
$$;
revoke all on function public.public_site_rooms() from public;
grant execute on function public.public_site_rooms() to anon, authenticated;

-- Photo storage: public to view (the website shows them), upload only by admins/managers/owners. No delete policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-photos', 'site-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists site_photos_staff_upload on storage.objects;
create policy site_photos_staff_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-photos' and (public.is_admin_or_manager() or public.is_owner()));

-- Start with the room pages that are on the new website now (only rooms not already there).
insert into public.site_rooms (id, name, kicker, story, tip, facts, good_for, book_label, book_game_id, call_label, sort_order, updated_by)
values
 ('sherlock', 'Sherlock', 'A case left unfinished',
  E'Moriarty is going to strike again. Follow the legendary detective’s trail, connect the clues and finish what Sherlock started.\n\nThis is our “thinky” room: fewer puzzles than Saving Christmas, but each one needs proper detective work. Look closely, talk it through and piece the clues together.',
  'Great if your group likes logic and deduction more than racing through lots of quick puzzles.',
  '[{"icon":"time","label":"Time","value":"60 minutes"},{"icon":"players","label":"Players","value":"3–7 (2 by arrangement)"},{"icon":"price","label":"Price","value":"$35 per person"},{"icon":"level","label":"Style","value":"Thinky, deduction"}]',
  array['Puzzle lovers and armchair detectives','Friends and families with kids 10+','Teams who like to talk things through'],
  'Book Sherlock', 'g1', null, 10, null),
 ('christmas', 'Saving Christmas', 'Festive chaos awaits',
  E'Granny has mixed up the turkey, lights and stockings. Put everything right before the big day is completely derailed.\n\nDesigned and built by us here in Hastings. It has the most puzzles of any of our rooms and several lines of clues running at once, so everyone in the team has something to work on.',
  'Split up! With lots happening at once, bigger groups do really well in here.',
  '[{"icon":"time","label":"Time","value":"60 minutes"},{"icon":"players","label":"Players","value":"3–8 (2 by arrangement)"},{"icon":"price","label":"Price","value":"$35 per person"},{"icon":"level","label":"Style","value":"Lots of puzzles, all at once"}]',
  array['Families and bigger groups','Work Christmas parties','First-timers and keen escapers'],
  'Book Saving Christmas', 'g2', null, 20, null),
 ('gregg', 'Gregg in the Box', 'Small box, big mystery',
  E'An unexpected package may contain Daisy’s long-lost robot. Think beyond the box, crack it open and discover what is inside.\n\nA real escape room packed into a beautifully handcrafted chest: locks, hidden compartments and a story, all on the table in front of you.',
  null,
  '[{"icon":"time","label":"Time","value":"60 minutes"},{"icon":"players","label":"Players","value":"3–5 (2 by arrangement)"},{"icon":"price","label":"Price","value":"$35 per person"},{"icon":"level","label":"Style","value":"Escape room in a box"}]',
  array['Smaller groups','Families','Anyone who loves a hands-on puzzle box'],
  'Book Gregg in the Box', 'g3', null, 30, null),
 ('cube', 'The Cube', 'The entry test',
  'An elite task force is being assembled, and The Cube is the test that sorts the best from the rest. Crack every side to prove your team has what it takes.',
  null,
  '[{"icon":"time","label":"Time","value":"About an hour"},{"icon":"players","label":"Players","value":"2–4"},{"icon":"price","label":"Price","value":"$35 pp (minimum 3)"},{"icon":"level","label":"Style","value":"Escape room in a box"}]',
  array['Small teams','Couples and pairs','Anyone after a quick challenge'],
  'Book The Cube', null, null, 40, null),
 ('pirates', 'Pirate’s Cove', 'Ahoy, treasure hunters',
  'A locked pirate treasure chest packed with puzzles. Play it here at BtB, or hire it for a pirate party at your own house and let the crew race to claim the treasure.',
  null,
  '[{"icon":"time","label":"Time","value":"40–60 min"},{"icon":"place","label":"Where","value":"At BtB or your house"},{"icon":"level","label":"Style","value":"Treasure chest puzzle hunt"}]',
  array['Kids’ pirate parties','Family gatherings','Playing at home'],
  null, null, 'Call to book Pirate’s Cove', 50, null)
on conflict (id) do nothing;

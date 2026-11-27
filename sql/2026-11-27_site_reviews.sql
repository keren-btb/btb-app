-- 2026-11-27: Website reviews (copy-and-paste version).
-- Reviews are pasted in on site_reviews.html (BtB app > Settings > Website reviews).
-- Each one has a Show / Hide switch; the website only ever gets the shown ones,
-- through public_site_reviews(), which returns just name, stars, text, date and the room.
-- The table itself is NOT readable with the public key.
-- STATUS: applied 2026-11-27 8pm by Claude with Keren's OK (migration "site_reviews"). Safe to re-run.

create table if not exists public.site_reviews (
  id uuid primary key default gen_random_uuid(),
  reviewer_name text not null check (length(trim(reviewer_name)) > 0),
  rating smallint not null default 5 check (rating between 1 and 5),
  review_text text not null check (length(trim(review_text)) > 0),
  review_date date,
  room text,                                   -- optional, e.g. 'Sherlock' (shown under the name)
  source text not null default 'google',       -- 'google' now; 'google_api' later when it's automatic
  google_review_id text unique,                -- filled in later by the automatic import
  show_on_website boolean not null default true,
  pinned boolean not null default false,       -- pinned ones go first on the website
  notes text,                                  -- staff only, never shown
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_reviews_show_idx on public.site_reviews (show_on_website, pinned desc, review_date desc);

alter table public.site_reviews enable row level security;

-- Staff with admin/manager access (and owners) can see and manage reviews. No public access to the table.
drop policy if exists site_reviews_staff_all on public.site_reviews;
create policy site_reviews_staff_all on public.site_reviews
  for all to authenticated
  using (public.is_admin_or_manager() or public.is_owner())
  with check (public.is_admin_or_manager() or public.is_owner());

-- Explicit grants (new Supabase rule from 30 Oct 2026: new tables get no automatic API grants)
revoke all on public.site_reviews from anon;
grant select, insert, update, delete on public.site_reviews to authenticated;
grant all on public.site_reviews to service_role;

-- keep updated_at fresh
create or replace function public.site_reviews_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists site_reviews_touch on public.site_reviews;
create trigger site_reviews_touch before update on public.site_reviews
  for each row execute function public.site_reviews_touch();

-- What the website reads: shown reviews only, safe columns only.
create or replace function public.public_site_reviews()
returns table (reviewer_name text, rating smallint, review_text text, review_date date, room text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.reviewer_name, r.rating, r.review_text, r.review_date, r.room
  from public.site_reviews r
  where r.show_on_website
  order by r.pinned desc, r.review_date desc nulls last, r.created_at desc
  limit 60;
$$;
revoke all on function public.public_site_reviews() from public;
grant execute on function public.public_site_reviews() to anon, authenticated;

-- Start with the three reviews already on the new website (only if the table is empty).
insert into public.site_reviews (reviewer_name, rating, review_text, room, created_by)
select * from (values
  ('Natasha Macaulay', 5::smallint, 'Professional and intriguing puzzles. We had a great time as a family and booked another room straight away.', 'Sherlock', null::uuid),
  ('Kayla Peach', 5::smallint, 'The staff are friendly and never make you feel silly when you need a clue. We will definitely be back for more.', 'Gregg in the Box', null::uuid),
  ('Amy Teegan', 5::smallint, 'Super friendly, fun and excited about what they do. The puzzles are satisfying and reward out-of-the-box thinking.', null, null::uuid)
) v
where not exists (select 1 from public.site_reviews);

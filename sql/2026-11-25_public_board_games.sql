-- 2026-11-25: public website (new-site) board games list.
-- Returns ONLY name + sell price of active, in-stock, priced Boardgame products.
-- No purchase prices, stock counts or notes leave the database. anon still has no access to the products table itself.
-- STATUS: not yet applied (waiting for Keren's OK).
create or replace function public.public_board_games()
returns table (name text, sell_price numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.name, p.sell_price
  from public.products p
  where p.category = 'Boardgame'
    and coalesce(p.active, true)
    and coalesce(p.stock_qty, 0) > 0
    and coalesce(p.sell_price, 0) > 0
  order by lower(p.name);
$$;

revoke all on function public.public_board_games() from public;
grant execute on function public.public_board_games() to anon, authenticated;

-- Lu's Collections: promotion dates and per-size pricing
-- Run once in Supabase SQL Editor before using the new admin fields.
alter table public.products add column if not exists size_prices jsonb not null default '{}'::jsonb;
alter table public.products add column if not exists promotion_start date;
alter table public.products add column if not exists promotion_end date;
create index if not exists idx_products_promotion_dates on public.products (promotion_start, promotion_end);

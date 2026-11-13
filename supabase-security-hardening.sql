-- Lu's Collections security hardening migration
-- Run once in Supabase SQL Editor after the existing schema/workflow migrations.

-- 1) Public settings: expose only non-sensitive storefront values.
do $$ declare pol record; begin
  for pol in select policyname from pg_policies
             where schemaname='public' and tablename='settings'
  loop execute format('drop policy %I on public.settings', pol.policyname); end loop;
end $$;
create policy "public read safe settings" on public.settings
for select to anon, authenticated
using (key in (
  'shop_name','phone','address','viber','facebook','tiktok',
  'announcement_text','delivery_fee','other_city_delivery_fee'
));
create policy "admins read all settings" on public.settings
for select to authenticated
using ((select public.is_admin()));
create policy "admins insert settings" on public.settings for insert to authenticated
with check ((select public.is_admin()));
create policy "admins update settings" on public.settings for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
grant select on public.settings to anon, authenticated;
grant insert, update on public.settings to authenticated;

-- 2) Make future order references cryptographically unpredictable (128-bit).
-- Existing order numbers remain valid; newly created orders use the stronger format.
create or replace function public.create_order(
  p_customer_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_note text,
  p_payment_method text,
  p_payment_reference text,
  p_items jsonb,
  p_delivery_fee integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_subtotal integer := 0;
  v_delivery integer := 0;
  v_total integer := 0;
  v_order_id bigint;
  v_order_no text;
  item jsonb;
  v_product products%rowtype;
  v_qty integer;
  v_size text;
  v_color text;
  v_item_price integer;
  v_settings text;
begin
  if coalesce(trim(p_customer_name),'') = '' or coalesce(trim(p_phone),'') = '' or coalesce(trim(p_address),'') = '' then
    raise exception 'Name, phone and address are required';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty';
  end if;

  select value into v_settings from public.settings where key = 'other_city_delivery_fee';
  v_delivery := greatest(0, coalesce(p_delivery_fee, nullif(v_settings,'')::integer, 2500));
  if p_payment_method = 'Cash on Delivery' and p_address !~* '(taunggyi|တောင်ကြီး)' then
    raise exception 'COD is available in Taunggyi only. Please choose KPay.';
  end if;
  if p_payment_method = 'Cash on Delivery' then v_delivery := 0; end if;

  for item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((item->>'qty')::integer, 1));
    v_size := coalesce(item->>'size','');
    v_color := coalesce(item->>'color','');

    select * into v_product
    from public.products
    where id = (item->>'productId')::bigint
      and is_active = true
    for update;

    if not found then
      raise exception 'Product not found';
    end if;

    if v_product.stock < v_qty then
      raise exception '% is out of stock', v_product.name;
    end if;

    v_item_price := coalesce(nullif(v_product.size_prices->>v_size,'')::integer, v_product.price);
    v_subtotal := v_subtotal + (v_item_price * v_qty);
  end loop;

  v_total := v_subtotal + v_delivery;
  v_order_no := 'LUS-' || to_char(now(),'YYYYMMDD') || '-' || upper(encode(extensions.gen_random_bytes(16),'hex'));

  insert into public.orders(
    order_no, customer_name, phone, email, address, note,
    payment_method, payment_reference, subtotal, delivery_fee, total
  ) values (
    v_order_no, trim(p_customer_name), trim(p_phone), coalesce(trim(p_email),''),
    trim(p_address), coalesce(trim(p_note),''), trim(p_payment_method),
    coalesce(trim(p_payment_reference),''), v_subtotal, v_delivery, v_total
  ) returning id into v_order_id;

  for item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((item->>'qty')::integer, 1));
    v_size := coalesce(item->>'size','');
    v_color := coalesce(item->>'color','');

    select * into v_product
    from public.products
    where id = (item->>'productId')::bigint
    for update;

    v_item_price := coalesce(nullif(v_product.size_prices->>v_size,'')::integer, v_product.price);
    insert into public.order_items(order_id, product_id, product_name, price, qty, size, color)
    values(v_order_id, v_product.id, v_product.name, v_item_price, v_qty, v_size, v_color);

    update public.products
    set stock = stock - v_qty, updated_at = now()
    where id = v_product.id;
  end loop;

  return jsonb_build_object(
    'orderNo', v_order_no,
    'total', v_total,
    'subtotal', v_subtotal,
    'deliveryFee', v_delivery,
    'paymentMethod', p_payment_method,
    'status', 'pending'
  );
end;
$$;
revoke all on function public.create_order(text,text,text,text,text,text,text,jsonb,integer) from public;
grant execute on function public.create_order(text,text,text,text,text,text,text,jsonb,integer) to anon, authenticated;

-- Legacy broad lookup RPC is not used by the current storefront. Disable it so
-- customer lookups go through the limited status RPC below.
revoke all on function public.lookup_order(text,text) from public;
revoke all on function public.lookup_order(text,text) from anon, authenticated;

-- 3) Customer status endpoint reveals payment destination only after admin confirmation.
drop function if exists public.get_customer_order_status(text,text);
create function public.get_customer_order_status(p_order_no text, p_phone text)
returns table(
  order_no text, order_status text, payment_status text, payment_method text,
  total integer, subtotal integer, delivery_fee integer, created_at timestamptz,
  kpay_account text, kpay_qr_url text
)
language sql security definer set search_path=public,extensions stable as $$
  select o.order_no, o.order_status, o.payment_status,
         o.payment_method, o.total, o.subtotal, o.delivery_fee, o.created_at,
         case when o.order_status='confirmed' and lower(o.payment_method) not like '%cash%'
              then (select value from public.settings where key='kbzpay') else null end,
         case when o.order_status='confirmed' and lower(o.payment_method) not like '%cash%'
              then (select value from public.settings where key='kpay_qr_url') else null end
  from public.orders o
  where lower(o.order_no)=lower(trim(p_order_no))
    and regexp_replace(o.phone,'\D','','g')=regexp_replace(trim(p_phone),'\D','','g')
    and length(regexp_replace(trim(p_phone),'\D','','g')) >= 7
  limit 1;
$$;
revoke all on function public.get_customer_order_status(text,text) from public;
grant execute on function public.get_customer_order_status(text,text) to anon, authenticated;

-- 4) Payment proof bucket is private; anonymous uploads are allowed only beneath
-- a real, confirmed order's folder. Public read is never granted.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('payment-proofs','payment-proofs',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false, file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists "customers upload payment proof" on storage.objects;
drop policy if exists "customers upload proof for confirmed order" on storage.objects;
create or replace function public.can_upload_payment_proof(p_name text)
returns boolean language sql security definer set search_path=public,storage stable as $$
  select exists (
    select 1 from public.orders o
    where lower(o.order_no)=lower((storage.foldername(p_name))[1])
      and o.order_status='confirmed'
  );
$$;
revoke all on function public.can_upload_payment_proof(text) from public;
grant execute on function public.can_upload_payment_proof(text) to anon, authenticated;
create policy "customers upload proof for confirmed order" on storage.objects
for insert to anon, authenticated
with check (bucket_id='payment-proofs' and public.can_upload_payment_proof(name));
drop policy if exists "admins view payment proof" on storage.objects;
create policy "admins view payment proof" on storage.objects
for select to authenticated
using (bucket_id='payment-proofs' and (select public.is_admin()));

-- Validate that the uploaded object belongs to the same confirmed order.
create or replace function public.attach_payment_proof(p_order_no text,p_phone text,p_path text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_path is null or lower(split_part(p_path,'/',1)) <> lower(p_order_no) then
    return false;
  end if;
  update public.orders set payment_proof_path=p_path, updated_at=now()
  where lower(order_no)=lower(trim(p_order_no))
    and regexp_replace(phone,'\D','','g')=regexp_replace(trim(p_phone),'\D','','g')
    and order_status='confirmed'
    and exists (select 1 from storage.objects so
                where so.bucket_id='payment-proofs' and so.name=p_path);
  return found;
end; $$;
revoke all on function public.attach_payment_proof(text,text,text) from public;
grant execute on function public.attach_payment_proof(text,text,text) to anon, authenticated;

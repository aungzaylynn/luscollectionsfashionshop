-- Lu's Collections: auto-sync, delivery/payment workflow, proof upload
alter table public.orders add column if not exists payment_proof_path text default '';
insert into public.settings(key,value) values ('other_city_delivery_fee','2500')
on conflict (key) do nothing;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('payment-proofs','payment-proofs',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false, file_size_limit=5242880, allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists "customers upload payment proof" on storage.objects;
create policy "customers upload payment proof" on storage.objects for insert to anon, authenticated
with check (bucket_id='payment-proofs');
drop policy if exists "admins view payment proof" on storage.objects;
create policy "admins view payment proof" on storage.objects for select to authenticated
using (bucket_id='payment-proofs' and (select public.is_admin()));

create or replace function public.attach_payment_proof(p_order_no text,p_phone text,p_path text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update public.orders set payment_proof_path=p_path, updated_at=now()
 where lower(order_no)=lower(trim(p_order_no))
 and regexp_replace(phone,'\D','','g')=regexp_replace(trim(p_phone),'\D','','g')
 and order_status='pending';
 return found;
end; $$;
revoke all on function public.attach_payment_proof(text,text,text) from public;
grant execute on function public.attach_payment_proof(text,text,text) to anon, authenticated;

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
set search_path = public
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

    v_subtotal := v_subtotal + (v_product.price * v_qty);
  end loop;

  v_total := v_subtotal + v_delivery;
  v_order_no := 'LUS-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(encode(gen_random_bytes(4),'hex'),1,6));

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

    insert into public.order_items(order_id, product_id, product_name, price, qty, size, color)
    values(v_order_id, v_product.id, v_product.name, v_product.price, v_qty, v_size, v_color);

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

-- Supabase Dashboard > Database > Publications: ensure products, settings and ootd_posts are in supabase_realtime.

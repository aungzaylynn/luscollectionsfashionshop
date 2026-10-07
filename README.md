# Lu's Collections — Vercel + Supabase

This version is designed for a non-developer owner: Vercel hosts the website and Supabase provides the database, authentication, storage and secure order transaction.

## What is included

- Customer storefront matching the Lu's Collections catalog UI
- Home → Search → New Arrivals → OOTD
- Separate Shop page with catalog filters and View All Products
- Separate Promotions page with 6-item preview and View All Promotions
- Product detail, size/color selection and cart
- Checkout with Cash on Delivery, KBZPay and WavePay manual-payment options
- Secure order creation through a Supabase Postgres RPC (price/stock are calculated on the server/database, not trusted from the browser)
- Customer order number + phone contact confirmation
- Admin login using Supabase Auth
- Admin product CRUD, stock, featured/promotion badges
- Admin product image upload to Supabase Storage
- Admin order list with payment/order status updates
- Shop settings: phone, address, Viber, Facebook, TikTok, KBZPay, WavePay and delivery fee
- Supabase Row Level Security (RLS)
- Vercel-ready static deployment

## 1. Create Supabase project

1. Open https://supabase.com/dashboard
2. Create a new project.
3. Open **SQL Editor**.
4. Copy the complete `supabase-schema.sql` from this project and Run it.
5. Wait for the SQL to finish without errors.

The SQL creates tables, RLS policies, the secure `create_order()` function, order lookup function, product image bucket, settings and starter products.

## 2. Create the admin account

In Supabase:

1. Open **Authentication → Users**.
2. Create a user with email + password.
3. Copy that user's UUID.
4. In SQL Editor run:

```sql
insert into public.admin_users(id,email)
values('PASTE_USER_UUID_HERE','your-admin-email@example.com');
```

Do NOT put a service-role/secret key into the website.

## 3. Connect the website to Supabase

Open the root `config.js` and replace only these two values:

```js
window.LUS_SUPABASE_URL = 'YOUR_SUPABASE_URL';
window.LUS_SUPABASE_ANON_KEY = 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY';
```

Get them from your Supabase project's API/Connect settings.

The publishable/anon key is intended for browser use. Security comes from RLS. Never use the `service_role` / secret key in `config.js`.

## 4. Test locally (optional)

Because this is a static site, you can use any local static server. If Python is installed:

```bash
python -m http.server 8080
```

Then open:

- Shop: http://localhost:8080/
- Admin: http://localhost:8080/admin/

Do not open `index.html` by double-clicking it as a `file://` URL; use a local web server so Supabase requests work normally.

## 5. Put it on Vercel

### Easiest method: GitHub

1. Create a new GitHub repository, e.g. `lus-collections-shop`.
2. Upload the contents of this folder to the repository.
3. Go to https://vercel.com/new
4. Import the GitHub repository.
5. Keep the project root at the repository root.
6. Deploy.

This project already includes `vercel.json`, so no Node/Express server is needed.

### Important

You are deploying the whole project folder, NOT only `index.html` (main storefront) and NOT only `admin/index.html`.

The important files are:

```text
index.html        ← customer website (in public/)
admin/index.html  ← admin panel
config.js         ← Supabase connection
supabase-schema.sql ← database setup
vercel.json       ← Vercel configuration
```

## 6. Custom domain

After the Vercel deployment works:

1. Vercel → Project → Settings → Domains
2. Add your domain.
3. Follow the DNS records Vercel shows.
4. Wait for DNS/SSL to finish.

Then use the custom domain as the shop URL.

## 7. Store settings

After logging into `/admin/`, open **Shop settings** and set:

- Shop phone
- Address
- Viber
- Facebook
- TikTok
- KBZPay number
- WavePay number
- Delivery fee

These values are stored in Supabase and shown to customers.

## 8. How to add products

Admin → Products → Add product.

You can enter:

- Name
- Category
- Price
- Old price (for promotion)
- Badge
- Stock
- Sizes
- Colors
- Description
- Image URL OR upload an image
- Active
- Featured

If `Old price` is filled, the product appears automatically on the Promotions page.

## 9. Orders

Customer:

1. Add products to bag.
2. Checkout.
3. Enter name, phone and address.
4. Choose COD / KBZPay / WavePay.
5. If using manual payment, enter the transaction/reference number.
6. Place order.

Admin:

- Open Admin → Orders.
- Confirm payment status.
- Move order through pending → confirmed → packing → shipped → completed.

Stock is reduced inside the database transaction when the order is successfully created.

## 10. Payment gateway note

COD, KBZPay and WavePay manual payment workflows are included. A fully automatic gateway (webhook/API confirmation) requires the merchant's official payment-gateway credentials/API access. Do not put payment secrets in the browser.

## 11. VPN / Myanmar connectivity note

Vercel and Supabase are global services, but no hosting provider can guarantee that every ISP/network in Myanmar will always reach every Vercel or Supabase endpoint without a VPN. The correct target is a normal public HTTPS website with a custom domain; actual reachability still depends on the customer's ISP/network conditions.

## 12. Security notes

- `config.js` must contain only the Supabase publishable/anon key.
- Never expose a Supabase service-role/secret key in HTML, JS or GitHub.
- RLS must remain enabled.
- Admin access is controlled by Supabase Auth + `admin_users`.
- Orders are created by the database function so customers cannot simply submit their own total/price.


## Vercel 404 fix
The storefront is intentionally available as the root `index.html` so a Vercel static deployment serves `/` directly.

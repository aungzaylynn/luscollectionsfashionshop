Lu's Collections — Customer Order Steps Update

Changes in this update:
- Checkout shows a compact Step 1 / Step 2 / Step 3 progress indicator without the unwanted explanatory paragraph.
- Checkout shows Product price, Delivery fee, and Order total separately. Non-Taunggyi addresses include the other-city gate fee; Taunggyi addresses do not.
- After a successful order, a customer order-tracking panel opens and polls status.
- When order status becomes `confirmed`, KPay account and QR details are displayed for KPay orders.
- When status becomes `packing`, a package animation is shown.
- Payment screenshot upload is available in the confirmed-order panel.
- Admin order status selector includes rejected, Out of Size, Out of Color, and Out of Stock.
- SQL migration adds a phone + order-number checked customer status lookup function.

Deployment steps:
1. Deploy the updated project files to Vercel.
2. Run `supabase-order-workflow-migration.sql` in Supabase SQL Editor.
3. In Admin > Shop settings, fill the KPay number and upload a QR image, then Save settings.
4. Test with a real test order and verify order status updates.

Important: The browser can only show the payment account/QR after the database reports `order_status = confirmed`. The customer status lookup function must be installed via the migration. Payment proof upload does not automatically mark an order as packing; admin should check the transfer and then set status to `packing`, as requested. The 24-hour auto-cancel scheduler and stock-on-confirm transaction are not configured by this UI update.


## v6 fixes
- Existing latest-order tracking no longer blocks a new checkout when the cart has new items.
- Gate fee remains 0 until a non-empty delivery address is entered; Taunggyi/TGI addresses remain fee-free.

Lu's Collections — Security hardening

1. Back up your Supabase database first.
2. Open Supabase Dashboard → SQL Editor.
3. Run supabase-security-hardening.sql once.
4. Deploy this project ZIP to Vercel.

Changes: public settings are restricted to an allowlist; KPay account/QR are returned only by the customer order-status RPC after order_status=confirmed; new order references use 128-bit random values; the legacy lookup_order RPC is revoked; payment-proofs stays private and anonymous uploads are restricted to a confirmed order folder; only admins can read proof files.

Important: Existing short order numbers remain unchanged. Ask customers to use their existing order number and phone as before. New orders receive stronger order numbers. The migration does not delete any existing order or payment screenshot.

-- Add pickup to order_source enum before migration 025 uses it.
alter type public.order_source add value if not exists 'pickup';

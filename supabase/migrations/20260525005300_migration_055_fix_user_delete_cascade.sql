-- Migration 051 — fix FK constraints blocking auth.users deletion
--
-- Before this migration, deleting a user from auth.users (Dashboard or via
-- the GDPR cron process_account_deletions()) failed because three audit
-- columns referenced auth.users / profiles with NO ACTION:
--   • stock_movements.created_by  (migration 026)
--   • purchase_orders.created_by  (migration 026)
--   • happy_hour_rules.created_by (migration 036)
--
-- Audit history must be preserved when a user is deleted (stock ledger and
-- purchase records are accounting data; happy hour rules continue to apply
-- after the author leaves). So we switch to ON DELETE SET NULL: the rows
-- stay, "created_by" becomes NULL.
--
-- Idempotent: drop-if-exists then re-add.

-- 1. stock_movements.created_by → auth.users : SET NULL
alter table public.stock_movements
  drop constraint if exists stock_movements_created_by_fkey;
alter table public.stock_movements
  add constraint stock_movements_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

-- 2. purchase_orders.created_by → auth.users : SET NULL
alter table public.purchase_orders
  drop constraint if exists purchase_orders_created_by_fkey;
alter table public.purchase_orders
  add constraint purchase_orders_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

-- 3. happy_hour_rules.created_by → public.profiles : SET NULL
alter table public.happy_hour_rules
  drop constraint if exists happy_hour_rules_created_by_fkey;
alter table public.happy_hour_rules
  add constraint happy_hour_rules_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

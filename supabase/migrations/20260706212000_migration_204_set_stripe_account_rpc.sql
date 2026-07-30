-- ═══════════════════════════════════════════════════════════════════
-- Migration 204: set_restaurant_stripe_account (onboarding Stripe Connect)
-- ─────────────────────────────────────────────────────────────────────
-- Singura cale de scriere pentru restaurants.stripe_account_id (mig 203):
-- funcția Netlify stripe-connect.js (service_role) o cheamă după
-- accounts.create. Nu ne bazăm pe grant-uri de tabelă pentru service_role
-- (lockdown 096B) — scrierea trece printr-un SECURITY DEFINER explicit.
-- Design: docs/ONLINE_PAYMENT.md.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.set_restaurant_stripe_account(
  p_restaurant_id uuid,
  p_account_id    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- null = deconectare explicită; altfel doar formatul Stripe acct_...
  if p_account_id is not null and p_account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception 'Format invalid pentru contul Stripe.'
      using errcode = 'P0001', hint = 'invalid_account';
  end if;

  update public.restaurants
     set stripe_account_id = p_account_id
   where id = p_restaurant_id;

  if not found then
    raise exception 'Restaurant inexistent.'
      using errcode = 'P0001', hint = 'not_found';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_restaurant_stripe_account(uuid, text) from public, anon, authenticated;
grant execute on function public.set_restaurant_stripe_account(uuid, text) to service_role;

comment on function public.set_restaurant_stripe_account(uuid, text) is
  $$Onboarding Stripe Connect (mig 204). EXECUTE doar service_role — chemat
exclusiv din netlify/functions/stripe-connect.js, DUPĂ ce funcția a verificat
membership-ul owner/manager al apelantului.$$;

-- Asserții fail-closed
do $$
begin
  if has_function_privilege('anon', 'public.set_restaurant_stripe_account(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.set_restaurant_stripe_account(uuid, text)', 'execute') then
    raise exception 'ASSERT FAIL: set_restaurant_stripe_account trebuie să fie service_role-only';
  end if;
  if not has_function_privilege('service_role', 'public.set_restaurant_stripe_account(uuid, text)', 'execute') then
    raise exception 'ASSERT FAIL: service_role fără EXECUTE pe set_restaurant_stripe_account';
  end if;
end $$;

commit;

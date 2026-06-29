-- mig 169 — Top-up credite AI idempotent (Faza F)
-- ─────────────────────────────────────────────────────────────────────
-- Webhook-ul Stripe poate retrimite același eveniment de plată. `ai_add_credits`
-- (mig 168) e ADITIV → un retry ar dubla creditele. Adăugăm un registru de
-- fulfilment cu cheie unică (event/session Stripe) + un RPC idempotent care
-- creditează O SINGURĂ DATĂ per referință.
--
-- Convenții (CLAUDE.md): SECURITY DEFINER, search_path fix, PUBLIC zero EXECUTE,
-- grant doar service_role (apelat din webhook), idempotent, asserții fail-closed.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- Registru de top-up-uri (o linie per plată Stripe onorată).
create table if not exists public.ai_credit_purchases (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique,         -- ex. 'cs_...' (session Stripe) — cheia de idempotență
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  tokens        integer not null,
  created_at    timestamptz not null default now()
);

alter table public.ai_credit_purchases enable row level security;

-- Owner/manager își vede top-up-urile; fondatorul vede tot. Scrierile = service_role.
drop policy if exists "ai_credit_purchases: read own or platform" on public.ai_credit_purchases;
create policy "ai_credit_purchases: read own or platform"
  on public.ai_credit_purchases for select
  to authenticated
  using (public.is_admin(restaurant_id) or public.is_platform_admin());

revoke insert, update, delete on public.ai_credit_purchases from anon, authenticated;

-- Creditează idempotent: inserează referința; doar dacă rândul e NOU adaugă
-- creditele. Retry pe aceeași referință → no-op (already_credited).
create or replace function public.ai_add_credits_for_event(
  p_ref           text,
  p_restaurant_id uuid,
  p_tokens        integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows     integer := 0;
  v_inserted boolean := false;
  v_balance  integer;
begin
  if coalesce(p_tokens, 0) <= 0 then
    raise exception 'ai_add_credits_for_event: tokens trebuie să fie pozitiv';
  end if;
  if p_ref is null or length(btrim(p_ref)) = 0 then
    raise exception 'ai_add_credits_for_event: referință lipsă';
  end if;

  insert into public.ai_credit_purchases (ref, restaurant_id, tokens)
    values (btrim(p_ref), p_restaurant_id, p_tokens)
  on conflict (ref) do nothing;

  get diagnostics v_rows = row_count; -- 1 = inserat nou, 0 = duplicat
  v_inserted := v_rows = 1;

  if v_inserted then
    perform public.ai_add_credits(p_restaurant_id, p_tokens);
  end if;

  select credit_balance into v_balance from public.ai_quota where restaurant_id = p_restaurant_id;
  return jsonb_build_object('credited', v_inserted, 'credit_balance', coalesce(v_balance, 0));
end;
$$;
revoke all on function public.ai_add_credits_for_event(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_add_credits_for_event(text, uuid, integer) to service_role;

-- ── Asserții fail-closed ────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='ai_credit_purchases') then
    raise exception 'mig 169: ai_credit_purchases lipsește'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.ai_credit_purchases'::regclass) then
    raise exception 'mig 169: RLS off pe ai_credit_purchases'; end if;
  if has_table_privilege('authenticated', 'public.ai_credit_purchases', 'INSERT') then
    raise exception 'mig 169: authenticated poate insera în ai_credit_purchases'; end if;
  if not has_function_privilege('service_role',
       'public.ai_add_credits_for_event(text, uuid, integer)', 'EXECUTE') then
    raise exception 'mig 169: service_role nu poate executa ai_add_credits_for_event'; end if;
  if has_function_privilege('anon',
       'public.ai_add_credits_for_event(text, uuid, integer)', 'EXECUTE') then
    raise exception 'mig 169: anon poate executa ai_add_credits_for_event'; end if;

  raise notice 'mig 169: AI credit top-ups OK';
end $$;

commit;

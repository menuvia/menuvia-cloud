-- ═══════════════════════════════════════════════════════════════════
-- Migration 223: „Cere nota" cu bacșiș propus de CLIENT (tips digitale în QR)
-- ─────────────────────────────────────────────────────────────────────
-- EXPANSION E1 / COMPETITIE Val A/3: serverul are deja `orders.tips_amount`
-- (mig 043, scris de ospătar la mark_paid prin advance_order) și `tip_payout`
-- în tura de casă (mig 032) — dar CLIENTUL de la masă nu are nicio cale să-și
-- exprime intenția de bacșiș. Fluxul devine: clientul cere nota și alege
-- bacșișul → ospătarul VEDE suma propusă pe apel → o introduce la încasare
-- (input-ul de tips există în PayModal). Bonul fiscal cu bacșiș (OUG 8/2023)
-- rămâne pe planul fiscal (MASTER_PLAN §3) — aici e doar INTENȚIA, nu banii.
--
-- Extensie aditivă, pattern-ul mig 091 (backwards-compatible):
--   • coloană `waiter_calls.tip_amount numeric(10,2)` NULL — doar pe 'bill'.
--   • `call_waiter` primește `p_tip_amount` opțional (default null) — apelurile
--     existente cu 1–2 argumente funcționează neschimbat.
--   • dacă există deja un 'bill' pending (rate-limit) și clientul retrimite cu
--     alt bacșiș → UPDATE pe apelul pending (s-a răzgândit), nu apel nou.
--   • validare: tip doar pe 'bill', 0 ≤ tip ≤ 2000 (gard de sanity, nu preț).
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.waiter_calls
  add column if not exists tip_amount numeric(10,2)
  check (tip_amount is null or (tip_amount >= 0 and tip_amount <= 2000));

-- Semnătura veche (2-arg) trebuie drop-uită explicit (ca la mig 091): altfel
-- rămân două overload-uri și PostgREST dă "function is not unique".
drop function if exists public.call_waiter(uuid, text);

create or replace function public.call_waiter(
  p_qr_token_id uuid,
  p_call_type   text default 'waiter',
  p_tip_amount  numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token    record;
  v_call_id  uuid;
  v_tip      numeric;
begin
  if p_call_type not in ('waiter', 'bill') then
    raise exception 'Tip de apel invalid.';
  end if;

  -- Bacșișul propus are sens DOAR pe „cere nota"; pe 'waiter' se ignoră.
  -- Normalizare defensivă: negativ/NaN → null; plafon 2000 (gard de sanity).
  v_tip := case
    when p_call_type = 'bill' and p_tip_amount is not null
         and p_tip_amount >= 0 and p_tip_amount <= 2000
      then round(p_tip_amount, 2)
    else null
  end;

  -- Validare token QR (identic cu mig 016/091)
  select qt.id, qt.restaurant_id, qt.table_id
  into v_token
  from public.qr_tokens qt
  where qt.id = p_qr_token_id
    and qt.is_active = true;

  if not found then
    raise exception 'QR token invalid sau expirat.';
  end if;

  -- Rate limit: max 1 apel pending per masă per TIP per 5 minute.
  -- Pe 'bill' cu bacșiș nou: clientul s-a răzgândit → actualizăm apelul
  -- pending în loc să-l respingem (ospătarul vede ultima intenție).
  if exists (
    select 1 from public.waiter_calls
    where table_id = v_token.table_id
      and call_type = p_call_type
      and status = 'pending'
      and created_at > now() - interval '5 minutes'
  ) then
    if p_call_type = 'bill' and v_tip is not null then
      update public.waiter_calls
         set tip_amount = v_tip
       where table_id = v_token.table_id
         and call_type = 'bill'
         and status = 'pending'
         and created_at > now() - interval '5 minutes';
    end if;
    return jsonb_build_object(
      'ok', true,
      'message', case p_call_type
        when 'bill' then 'Nota a fost deja cerută.'
        else 'Ospătarul a fost deja chemat.'
      end
    );
  end if;

  insert into public.waiter_calls (restaurant_id, table_id, qr_token_id, call_type, tip_amount)
  values (v_token.restaurant_id, v_token.table_id, p_qr_token_id, p_call_type, v_tip)
  returning id into v_call_id;

  return jsonb_build_object('ok', true, 'call_id', v_call_id);
end;
$$;

revoke all on function public.call_waiter(uuid, text, numeric) from public;
grant execute on function public.call_waiter(uuid, text, numeric) to anon, authenticated;

comment on function public.call_waiter(uuid, text, numeric) is
  $$Apel client de la masă: 'waiter' (cheamă ospătar) sau 'bill' (cere nota,
  opțional cu bacșiș propus — intenție, nu plată). Rate limit 1 pending/masă/tip/5min;
  re-trimiterea 'bill' cu alt bacșiș actualizează apelul pending. Anon allowed (QR).$$;

-- ── Asserții fail-closed ──────────────────────────────────────────
do $$
declare v_def text;
begin
  -- Semnătura veche nu mai există (anti "function is not unique" în PostgREST)
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'call_waiter'
      and pg_get_function_identity_arguments(p.oid) = 'p_qr_token_id uuid, p_call_type text'
  ) then
    raise exception 'ASSERT FAIL (mig 223): overload-ul vechi call_waiter(uuid,text) încă există';
  end if;
  v_def := pg_get_functiondef('public.call_waiter(uuid, text, numeric)'::regprocedure);
  if position('tip_amount' in v_def) = 0 or position('2000' in v_def) = 0 then
    raise exception 'ASSERT FAIL (mig 223): call_waiter fără logica de tip_amount/plafon';
  end if;
  if not has_function_privilege('anon', 'public.call_waiter(uuid, text, numeric)', 'execute') then
    raise exception 'ASSERT FAIL (mig 223): call_waiter trebuie apelabil de anon (QR)';
  end if;
end $$;

commit;

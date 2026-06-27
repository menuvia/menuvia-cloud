-- Migration 115: Rate limit pe rezervările publice (anti-spam anon)
-- ─────────────────────────────────────────────────────────────────────
-- Context (audit securitate rezervări, 2026-06-27):
--   • create_reservation_public (mig 057, gate-uită în mig 086) e
--     anon-callable: oricine cu slug-ul public poate crea rezervări.
--   • Spre deosebire de comenzile QR (check_qr_order_rate_limit, mig 056 +
--     trigger mig 090) și de pickup (check_pickup_order_rate_limit, mig 046),
--     rezervările publice NU au niciun rate limit.
--   → Un atacator anon (sau un script) poate inunda un restaurant cu
--     rezervări: umple toate mesele (overlaps blochează sloturile),
--     trimite reminder-uri/notificări, poluează dashboard-ul.
--
-- Fix minimal invaziv: trigger BEFORE INSERT pe `reservations`, identic ca
-- abordare cu mig 090 (QR). NU recopiem cele ~150 de linii din
-- create_reservation_public (vezi capcana 085/087 din CLAUDE.md). Bonus
-- defense-in-depth: acoperă orice cale viitoare de scriere pe sursa
-- 'public', nu doar RPC-ul curent.
--
-- Comportament:
--   • Se aplică DOAR pentru source = 'public' (path-ul anon din widget).
--     Sursele admin/staff ('dashboard','phone','walk_in','google','widget')
--     trec neatinse — nu vrem să blocăm front-of-house care introduce
--     rezervări telefonice în rafală.
--   • Prag restaurant: max 5 rezervări publice / 1 minut / restaurant.
--   • Prag telefon: max 3 rezervări publice / 5 minute / același telefon
--     (burst guard fin; telefonul lipsă/gol e ignorat de această fereastră).
--   • Rezervările moarte (cancelled/no_show) NU se numără — nu pedepsim un
--     client care anulează și reîncearcă.
--   • Advisory xact lock pe restaurant serializează request-urile concurente
--     pe același restaurant (anti-TOCTOU, identic cu mig 056). Lock-ul e
--     xact-scoped, deci funcționează identic din trigger (aceeași tranzacție).
--   • Comportamentul sub prag e EXACT cel existent (trigger-ul nu modifică
--     NEW, doar lasă insert-ul să continue).
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. Helper check_reservation_rate_limit ───────────────────────────
-- void: nu întoarce date, doar raise exception peste prag (ca
-- check_qr_order_rate_limit / check_pickup_order_rate_limit).
-- SECURITY DEFINER + search_path fixat: numără pe `reservations` ignorând
-- RLS-ul apelantului anon și evită atac search_path.
create or replace function public.check_reservation_rate_limit(
  p_restaurant_id  uuid,
  p_customer_phone text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := nullif(trim(coalesce(p_customer_phone, '')), '');
begin
  if p_restaurant_id is null then
    return;
  end if;

  -- Serializează request-urile concurente pe ACELAȘI restaurant ca să nu
  -- treacă un burst printre două COUNT-uri (TOCTOU). Tokenuri/restaurante
  -- diferite nu se blochează între ele.
  perform pg_advisory_xact_lock(hashtext('reservation_rate:' || p_restaurant_id::text));

  -- Prag per restaurant: max 5 rezervări publice / minut.
  if (
    select count(*)
      from public.reservations
     where restaurant_id = p_restaurant_id
       and source = 'public'
       and status not in ('cancelled','no_show')
       and created_at > now() - interval '1 minute'
  ) >= 5 then
    raise exception 'Prea multe rezervări în ultimul minut pentru acest restaurant. Te rugăm reîncearcă mai târziu.'
      using errcode = 'P0001', hint = 'reservation_rate_limit';
  end if;

  -- Prag per telefon: max 3 rezervări publice / 5 minute de la același număr.
  if v_phone is not null and (
    select count(*)
      from public.reservations
     where restaurant_id = p_restaurant_id
       and source = 'public'
       and status not in ('cancelled','no_show')
       and customer_phone = v_phone
       and created_at > now() - interval '5 minutes'
  ) >= 3 then
    raise exception 'Prea multe rezervări de la acest număr în ultimele 5 minute. Te rugăm reîncearcă mai târziu.'
      using errcode = 'P0001', hint = 'reservation_rate_limit';
  end if;
end;
$$;

revoke all on function public.check_reservation_rate_limit(uuid, text) from public;
grant execute on function public.check_reservation_rate_limit(uuid, text) to anon, authenticated;

comment on function public.check_reservation_rate_limit(uuid, text) is
  $$Rate limit rezervări publice: max 5/min/restaurant + max 3/5min/telefon.
  Raise exception (hint=reservation_rate_limit) peste prag. Apelată din
  trigger-ul reservations_public_rate_limit (BEFORE INSERT). Advisory xact
  lock anti-TOCTOU pe restaurant (analog check_qr_order_rate_limit, mig 056).$$;

-- ── 2. Trigger BEFORE INSERT pe reservations ─────────────────────────
-- Doar pentru source = 'public' (path-ul anon). NEW.created_at încă nu e
-- setat la momentul BEFORE INSERT (default-ul tabelei se aplică), dar
-- COUNT-ul se face pe rândurile DEJA inserate (ferestre care se termină la
-- now()), deci numărăm rezervările anterioare — exact comportamentul dorit.
create or replace function public.trg_check_reservation_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source = 'public' then
    perform public.check_reservation_rate_limit(new.restaurant_id, new.customer_phone);
  end if;
  return new;
end;
$$;

drop trigger if exists reservations_public_rate_limit on public.reservations;
create trigger reservations_public_rate_limit
  before insert on public.reservations
  for each row
  execute function public.trg_check_reservation_rate_limit();

comment on trigger reservations_public_rate_limit on public.reservations is
  $$Rate limit rezervări publice (anti-spam anon, mig 115): max 5/min/restaurant
  + max 3/5min/telefon, doar pentru source='public'. Sursele admin/staff trec
  neatinse. Pattern identic cu orders_qr_rate_limit (mig 090).$$;

-- ── 3. Asersție inline post-deploy (sanity) ──────────────────────────
-- Verifică faptul că trigger-ul există și că funcția conține logica de
-- rate-limit. Rulează în aceeași tranzacție cu migrația.
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.reservations'::regclass
       and tgname = 'reservations_public_rate_limit'
  ) then
    raise exception 'MIG 115 ASSERT FAIL: trigger reservations_public_rate_limit lipsește';
  end if;

  if position('reservation_rate_limit' in pg_get_functiondef(
       'public.check_reservation_rate_limit(uuid, text)'::regprocedure)) = 0 then
    raise exception 'MIG 115 ASSERT FAIL: logica de rate-limit lipsește din check_reservation_rate_limit';
  end if;

  raise notice 'MIG 115 OK: rate limit rezervări publice instalat (trigger + helper)';
end $$;

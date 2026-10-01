-- migration_288_order_janitors.sql
-- =============================================================================
-- Comenzile AGĂȚATE de pe Planul 2 ies singure din starea deschisă (pg_cron).
--
-- ── Problema (măsurată pe producție la 30 sept 2026) ─────────────────────────
-- 5 comenzi de ospătar stau în `new` de 2–89 de zile, cu timer roșu în
-- Bucătărie. Pe planurile FĂRĂ bon fiscal (free/starter/growth) comanda nu are
-- un pas „plătit": se finalizează prin `close_order` (advance_order, mig 270),
-- iar dacă nimeni nu apasă butonul — comandă uitată, client plecat, tabletă
-- închisă — rândul rămâne deschis pe veci. Niciun janitor nu atingea `orders`
-- (mig 274 a programat doar cozile de livrare, sesiunile și rezervările).
--
-- ── Regula (CORECTATĂ față de prima schemă a planului) ──────────────────────
-- Prima schemă închidea TOT ce e vechi. Greșit: `closed` ACORDĂ puncte de
-- loialitate (`fn_loyalty_earn`, mig 226: new.status in ('paid','closed')) și
-- SCADE stocul (`deduct_stock_on_order_paid`, mig 250/252: același set). O
-- comandă-fantomă niciodată servită, închisă automat, ar fi dat puncte și ar fi
-- scăzut stoc din NIMIC. De aceea două ramuri, după ce s-a ÎNTÂMPLAT cu comanda:
--   • `new` / `confirmed` / `preparing` mai vechi de N ore → `cancelled`, cu
--     `cancel_reason = 'Expirată automat (neprocesată)'`. Nu a fost livrată, deci
--     NU primește puncte și NU scade stoc (verificat de OJ3: ramura `cancelled`
--     nu produce nici `loyalty_events`, nici `order_stock_deductions`).
--   • `ready` / `served` mai vechi de N ore → `closed`. Au fost livrate (sau cel
--     puțin gătite și predate), deci punctele și stocul sunt corecte — exact ca
--     la „Închide comanda" apăsat de ospătar (aceeași stare finală).
-- N = 12 ore (decizia D2 din plan).
--
-- ── Ce se SARE, și de ce ─────────────────────────────────────────────────────
--   • Restaurantele cu `fiscal_receipt` (Plan 3): acolo decizia e a omului
--     (bani + bon fiscal; gate-urile 264/270 ar respinge oricum `closed`, iar o
--     anulare automată ar putea ascunde o comandă încasată pe care ospătarul
--     n-a apucat s-o marcheze). Filtrul e în WHERE, nu doar în trigger: un
--     trigger care ARUNCĂ ar opri tot lotul.
--   • Comenzile cu rânduri în `order_payments`: banii sunt în registru (plată
--     parțială, split online), iar `trg_orders_cancel_ledger_gate` (mig 270) ar
--     respinge oricum anularea. Se ating DOAR prin acțiunea umană
--     (`void_order_payments_and_cancel`).
--   • Comenzile PICKUP programate: `pickup_time` poate fi la până la 24 h în
--     viitor (mig 046) — o comandă plasată dimineața pentru ridicare seara nu e
--     „agățată". Vârsta se măsoară din `greatest(...)` cu `pickup_time`.
--
-- ── „Vârsta" — ce coloană, și de ce nu `updated_at` ──────────────────────────
-- `orders` NU are `updated_at`, iar triggerele (audit, loyalty, stoc, sesiuni)
-- nu bump-uiesc nimic pe rând. Marcajele de timp sunt scrise o SINGURĂ dată, la
-- tranziție, de `stamp_order_timestamps` (mig 003) / `advance_order`:
--   `new`/`confirmed`/`preparing` → `created_at` (nu a fost servită niciodată);
--   `ready` → `ready_at`; `served` → `served_at`; fallback `created_at` când
--   marcajul lipsește (INSERT direct cu status avansat).
-- În toate cazurile se ia `greatest(…, pickup_time)`.
--
-- ── Trece prin triggerele existente, fără ocolire ───────────────────────────
-- UPDATE obișnuit pe `orders`, ca postgres: rulează `trg_orders_*_gate`
-- (124/264/270), loyalty, stoc, `maybe_close_session`, audit. Nimic cu
-- `session_replication_role`. Singura diferență față de `advance_order` e că
-- gate-urile de ROL (owner/manager/waiter) nu se aplică — janitorul nu e un
-- utilizator —, dar gate-urile în DATE (fiscal, registru) rămân active.
--
-- ── Double-run safe (criteriul mig 274) ─────────────────────────────────────
-- Predicat AUTO-CONSUMAT (starea se schimbă în terminală → a doua rulare nu mai
-- vede rândul) + claim `for update of o skip locked`: două rulări suprapuse nu
-- pot prelua același rând. Izolare per rând (`exception when others` + warning):
-- un rând care face un trigger să arunce (ex. o comandă veche cu masă din alt
-- restaurant, respinsă de `trg_enforce_order_table_tenant`) NU blochează
-- celelalte comenzi în fiecare oră. Lot maxim 500 / rulare, ca o primă rulare
-- peste un istoric mare să nu țină tranzacția minute întregi.
--
-- Teste permanente: tests/sql/order_janitors_assertions.sql (OJ1–OJ9);
-- JL1 (tests/sql/janitor_liveness_assertions.sql) are controlul pozitiv.
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Index parțial: janitorul caută comenzi deschise vechi FĂRĂ filtru pe
--    restaurant (rulează global, o dată pe oră). Fără el, planificatorul ar
--    parcurge `orders` în întregime la fiecare rulare. Parțial pe stările
--    deschise → rămâne mic oricât ar crește istoricul.
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists orders_stale_open_idx
  on public.orders (created_at)
  where status in ('new', 'confirmed', 'preparing', 'ready', 'served');

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Janitorul. DEFINER, owner postgres (rulează ca postgres pe pg_cron),
--    ZERO grant: nici service_role, nici clienții (revoke explicit per rol —
--    default privileges din Supabase re-acordă EXECUTE funcțiilor noi).
--    Fără aritmetică de ceas de perete în corp (CJ7): doar `now() - interval`.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.expire_stale_orders(p_hours integer default 12)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_hours     integer := greatest(coalesce(p_hours, 12), 1);
  v_cut       timestamptz := now() - make_interval(hours => v_hours);
  v_cancelled integer := 0;
  v_closed    integer := 0;
  v_errors    integer := 0;
  r           record;
begin
  for r in
    select o.id, o.status
      from public.orders o
     where o.status in ('new', 'confirmed', 'preparing', 'ready', 'served')
       -- prefiltru sargabil pe indexul parțial: orice vârstă calculată mai jos
       -- e >= created_at, deci un rând mai nou decât pragul nu poate fi vechi.
       and o.created_at < v_cut
       and greatest(
             case o.status
               when 'ready'  then coalesce(o.ready_at,  o.created_at)
               when 'served' then coalesce(o.served_at, o.created_at)
               else o.created_at
             end,
             coalesce(o.pickup_time, o.created_at)
           ) < v_cut
       -- Plan 3: decizia e a omului (gate-urile 264/270 ar respinge oricum).
       and not public.restaurant_has_feature(o.restaurant_id, 'fiscal_receipt')
       -- Bani în registru: se ating doar prin storno uman (mig 270).
       and not exists (select 1 from public.order_payments p where p.order_id = o.id)
     order by o.created_at
     limit 500
       for update of o skip locked
  loop
    begin
      if r.status in ('new', 'confirmed', 'preparing') then
        -- Niciodată servită: anulare (fără puncte, fără stoc).
        update public.orders
           set status = 'cancelled',
               cancel_reason = 'Expirată automat (neprocesată)'
         where id = r.id;
        v_cancelled := v_cancelled + 1;
      else
        -- Livrată: închidere (puncte + stoc corecte), ca „Închide comanda".
        update public.orders
           set status = 'closed',
               served_at = coalesce(served_at, now())
         where id = r.id;
        v_closed := v_closed + 1;
      end if;
    exception when others then
      -- Izolare per rând: un rând respins de un gate din DATE nu are voie să
      -- blocheze restul lotului la fiecare rulare.
      v_errors := v_errors + 1;
      raise warning 'expire_stale_orders: comanda % sarita (%: %)', r.id, sqlstate, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('cancelled', v_cancelled, 'closed', v_closed, 'errors', v_errors);
end $fn$;

revoke all on function public.expire_stale_orders(integer) from public, anon, authenticated, service_role;

comment on function public.expire_stale_orders(integer) is
  'mig 288: janitor pg_cron pentru comenzile agatate pe planurile FARA fiscal_receipt. new/confirmed/preparing mai vechi de N ore -> cancelled (motiv Expirata automat, fara puncte/stoc); ready/served -> closed (livrate: puncte+stoc corecte). Sare Plan 3, comenzile cu plati in registru si pickup-urile programate in viitor. Auto-consumat + for update skip locked; izolare per rand. Zero grant (ruleaza ca postgres).';

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Rândul de manifest. Minut 43: liber (7/11/13/17/19 orare, 23/29/37/41
--    zilnice) și ne-multiplu de 15 (CJ6). max_age_s = 3 × perioada (CJ8:
--    [2 × 3600, 172800]).
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.pg_cron_janitor_manifest
  (job_name, schedule, signature, command, max_age_s, safety_marker, note)
values
  ('menuvia_janitor_stale_orders', '43 * * * *',
   'public.expire_stale_orders(integer)',
   'select public.expire_stale_orders(12)', 10800,
   'for update of o skip locked',
   'mig 288 (Plan 2, comenzi agatate). new/confirmed/preparing > 12h -> cancelled; ready/served > 12h -> closed (au fost livrate: loyalty/stoc corecte). Sare Plan 3 si comenzile cu plati in registru. Auto-consumat + for update skip locked.')
on conflict (job_name) do update set
  schedule      = excluded.schedule,
  signature     = excluded.signature,
  command       = excluded.command,
  max_age_s     = excluded.max_age_s,
  safety_marker = excluded.safety_marker,
  note          = excluded.note;

-- Programarea efectivă (același tipar ca mig 282: discriminator pe pg_extension).
do $$
declare v_n integer;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'mig 288: pg_cron neinstalat - programarea sarita, functia si manifestul sunt aplicate. Clichetul permanent (CJ1-CJ13 + OJ1-OJ9) nu depinde de extensie.';
    return;
  end if;
  v_n := public.pg_cron_apply_manifest();
  raise notice 'mig 288: % joburi pg_cron programate (inclusiv menuvia_janitor_stale_orders)', v_n;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Asserțiuni la aplicare (centură; acoperirea permanentă e OJ1–OJ9 + CJ*).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_src text; v_def boolean; v_cfg text[];
begin
  select p.prosrc, p.prosecdef, p.proconfig into v_src, v_def, v_cfg
    from pg_proc p where p.oid = 'public.expire_stale_orders(integer)'::regprocedure;
  if not v_def or not exists (select 1 from unnest(coalesce(v_cfg, '{}')) c
                               where c like 'search_path=%' and c like '%pg_temp%') then
    raise exception 'mig 288: expire_stale_orders trebuie DEFINER cu search_path public, pg_temp'; end if;
  if position('for update of o skip locked' in v_src) = 0 then
    raise exception 'mig 288: lipseste claim-ul per rand (double-run safety)'; end if;
  if position('fiscal_receipt' in v_src) = 0 or position('order_payments' in v_src) = 0 then
    raise exception 'mig 288: lipsesc filtrele Plan 3 / registru de plati'; end if;
  if v_src ~* 'Europe/Bucharest|current_date|date_trunc' then
    raise exception 'mig 288: aritmetica de ceas de perete in corp (pg_cron ruleaza in GMT, CJ7)'; end if;
  if has_function_privilege('anon', 'public.expire_stale_orders(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.expire_stale_orders(integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.expire_stale_orders(integer)', 'EXECUTE') then
    raise exception 'mig 288: expire_stale_orders e apelabila de un rol client / service_role (zero grant)'; end if;
  if not exists (select 1 from public.pg_cron_janitor_manifest
                  where job_name = 'menuvia_janitor_stale_orders' and schedule = '43 * * * *') then
    raise exception 'mig 288: randul de manifest lipseste'; end if;
end $$;

commit;

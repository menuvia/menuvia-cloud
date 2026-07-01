-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 183 — izolare erori per-element în bucle batch (GDPR + payout)
-- ═══════════════════════════════════════════════════════════════
-- Finding audit: pattern comun „buclă fără exception handling per-element,
-- un eșec oprește tot batch-ul" în 2 funcții RPC de tip cron/service_role:
--
--   1. process_account_deletions (ultima def. mig 179) — bucla peste userii
--      eligibili pentru ștergere GDPR NU izola erorile per-user. O eroare la
--      UN user (ex. constraint violation neașteptată la cascada de delete)
--      oprea tot batch-ul acelui tick, lăsând restul userilor needeterminați.
--
--   2. run_affiliate_payout_batch (ultima def. mig 107) — bucla per
--      afiliat+monedă NU izola erorile. O eroare la UN afiliat oprea tot
--      batch-ul lunar de payout pentru TOȚI afiliații.
--
-- FIX: recreăm ambele funcții IDENTIC cu ultima lor definiție (mig 179,
-- respectiv mig 107) — nicio schimbare de logică de business (cele 3 politici
-- GDPR/fiscal, calculele de payout, pragurile) — și înfășurăm DOAR corpul
-- buclei per-element într-un bloc `begin ... exception when others then
-- raise warning; continue/skip; end;`, astfel încât o eroare izolată la un
-- singur element să nu oprească restul batch-ului.
--
-- Convenție lockdown (CLAUDE.md): SECURITY DEFINER, `search_path = public,
-- pg_temp`, revoke/grant IDENTICE cu ultima definiție a fiecărei funcții.
-- Migrațiile aplicate (042/107/179) NU sunt editate — acesta e fișier nou.
-- Idempotent: `create or replace function`.
-- ═══════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 1. process_account_deletions — izolare eroare per-user         ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Identică cu mig 179, cu corpul buclei `for v_user in ...` înfășurat într-un
-- bloc local `begin ... exception when others then ... continue; end;`.
-- Cele 3 politici (block / transfer_tombstone / archive_anonymize) și toată
-- logica lor rămân EXACT ca în mig 179 — doar izolate acum per-user.

create or replace function public.process_account_deletions()
returns table(deleted_user_id uuid, deleted_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      record;
  v_policy    text;
  v_has_invoices boolean;
  v_archived  integer;
begin
  -- Citește politica activă (fallback la default recomandat dacă lipsește rândul)
  select coalesce(
           (select policy from public.gdpr_deletion_config where id = true),
           'archive_anonymize'
         )
    into v_policy;

  for v_user in
    select id from public.profiles
    where deletion_requested_at is not null
      and deletion_requested_at < now() - interval '30 days'
      -- Sari peste conturile deja marcate blocate (așteaptă remediere manuală)
      and deletion_blocked_reason is null
    limit 100 -- batch pentru a nu bloca cron-ul
  loop
    -- Izolare eroare per-user (mig 183): o eroare neașteptată (ex. constraint
    -- violation) la UN user NU oprește restul batch-ului de ștergeri GDPR.
    begin
      -- Are owner-ul facturi fiscale EMISE pe vreun restaurant deținut?
      select exists(
        select 1
          from public.invoices i
          join public.restaurants r on r.id = i.restaurant_id
         where r.owner_id = v_user.id
           and i.status in ('issued', 'cancelled')
      ) into v_has_invoices;

      -- ── Politica BLOCK ──────────────────────────────────────────
      -- Nu șterge. Marchează motivul; owner-ul rezolvă manual (transfer/închidere).
      if v_policy = 'block' and v_has_invoices then
        update public.profiles
           set deletion_blocked_reason =
                 'Blocat: contul are facturi fiscale emise care trebuie păstrate 10 '
                 'ani (Legea 82/1991). Contactați privacy@menuvia.ro pentru transfer '
                 'sau închiderea restaurantului înainte de ștergere.'
         where id = v_user.id;
        raise notice 'process_account_deletions: user % blocat (are facturi fiscale)', v_user.id;
        continue; -- NU avansează ștergerea, NU returnează next
      end if;

      -- ── Politica TRANSFER_TOMBSTONE ────────────────────────────
      -- Snapshot fiscal + marchează restaurantele ca orfane. Transferul REAL de
      -- owner NU se face aici (owner_id imuabil, lockdown). raise notice pentru
      -- remediere manuală via scripts/apply_ownership_remediation.sql.
      if v_policy = 'transfer_tombstone' and v_has_invoices then
        perform public.archive_fiscal_invoices_for_user(v_user.id);
        update public.restaurants
           set is_tombstoned    = true,
               tombstoned_at     = now(),
               tombstoned_reason =
                 'Owner șters (GDPR). Necesită remediere manuală de owner: '
                 'scripts/apply_ownership_remediation.sql'
         where owner_id = v_user.id;
        raise notice
          'process_account_deletions: user % — restaurante tombstoned; transfer '
          'owner necesită remediere manuală (owner_id imuabil)', v_user.id;
        -- Continuă ștergerea contului: datele personale se șterg (GDPR), snapshot-ul
        -- fiscal supraviețuiește. Cascada VA șterge restaurantele tombstoned și
        -- invoices — acceptat, fiindcă am salvat deja snapshot-ul fiscal.
      end if;

      -- ── Politica ARCHIVE_ANONYMIZE (DEFAULT) ───────────────────
      -- Snapshot fiscal ÎNAINTE de ștergere, apoi lasă cascada să șteargă originalele.
      -- Se aplică și ca ramură comună pentru archive_anonymize + fallback
      -- transfer_tombstone (snapshot deja făcut mai sus e idempotent).
      if v_has_invoices then
        v_archived := public.archive_fiscal_invoices_for_user(v_user.id);
        raise notice 'process_account_deletions: user % — % facturi arhivate fiscal',
          v_user.id, v_archived;
      end if;

      -- Ștergerea propriu-zisă. Cascada (auth.users → profiles → restaurants →
      -- invoices) șterge datele personale. retained_invoices NU e cascadat →
      -- supraviețuiește. Datele personale reziduale (audit columns) sunt deja
      -- SET NULL prin FK-urile din mig 055.
      delete from auth.users where id = v_user.id;

      deleted_user_id := v_user.id;
      deleted_at := now();
      return next;
    exception when others then
      -- Izolare (mig 183): un singur user eșuat NU oprește restul batch-ului.
      -- Userul rămâne eligibil și va fi reîncercat la următorul tick al cron-ului.
      raise warning
        'process_account_deletions: eroare la ștergerea user % — sărit, se reîncearcă '
        'la următorul tick (%: %)', v_user.id, sqlstate, sqlerrm;
      continue;
    end;
  end loop;
end;
$$;

revoke all on function public.process_account_deletions() from public, anon, authenticated;
-- Doar service_role poate apela (cron job) — identic cu mig 042/179.


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 2. run_affiliate_payout_batch — izolare eroare per afiliat+monedă ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Identică cu mig 107 (ultima create or replace — batch multi-monedă), cu
-- corpul buclei interne `for cur in ...` înfășurat într-un bloc local
-- `begin ... exception when others then ... continue; end;`. Calculele de
-- payout (eligible/committed/payable, pragul p_min_cents) rămân EXACT ca în
-- mig 107 — doar izolate acum per (afiliat, monedă). Erorile sunt acumulate
-- într-un jsonb și returnate alături de created/skipped, plus `raise warning`.

create or replace function public.run_affiliate_payout_batch(
  p_period_month date,
  p_min_cents    bigint default 5000
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r           record;
  cur         public.affiliate_currency;
  v_eligible  bigint;
  v_committed bigint;
  v_payable   bigint;
  v_created   int := 0;
  v_skipped   int := 0;
  v_errors    jsonb := '[]'::jsonb;
begin
  if p_period_month <> date_trunc('month', p_period_month)::date then
    raise exception 'period_month trebuie să fie prima zi a lunii';
  end if;

  for r in select id from public.affiliates where status = 'active' loop
    -- O rulare per monedă cu sold plătibil (RON și/sau EUR).
    for cur in
      select distinct currency from public.v_affiliate_payable where affiliate_id = r.id
    loop
      -- Izolare eroare per (afiliat, monedă) (mig 183): o eroare la UN afiliat
      -- NU oprește tot batch-ul lunar de payout pentru restul afiliaților.
      begin
        select coalesce(sum(amount_cents), 0) into v_eligible
          from public.v_affiliate_payable where affiliate_id = r.id and currency = cur;

        -- Angajat: în zbor sau decontat; eliberăm doar canceled și failed FĂRĂ transfer.
        select coalesce(sum(gross_cents), 0) into v_committed
          from public.affiliate_payouts
         where affiliate_id = r.id and currency = cur
           and (status in ('draft','awaiting_invoice','invoice_matched','processing','paid','on_hold')
                or (status = 'failed' and wise_transfer_id is not null));

        v_payable := v_eligible - v_committed;

        if v_payable < p_min_cents then
          v_skipped := v_skipped + 1;
          continue;
        end if;

        insert into public.affiliate_payouts (affiliate_id, period_month, currency, gross_cents, status)
        values (r.id, p_period_month, cur, v_payable, 'draft')
        on conflict (affiliate_id, period_month, currency) do nothing;

        if found then v_created := v_created + 1; else v_skipped := v_skipped + 1; end if;
      exception when others then
        -- Izolare (mig 183): un singur afiliat+monedă eșuat NU oprește restul
        -- batch-ului. Se loghează și se acumulează în rezultatul jsonb pentru
        -- reconciliere/reîncercare manuală.
        v_skipped := v_skipped + 1;
        v_errors := v_errors || jsonb_build_object(
          'affiliate_id', r.id,
          'currency',     cur,
          'sqlstate',     sqlstate,
          'error',        sqlerrm
        );
        raise warning
          'run_affiliate_payout_batch: eroare la afiliat % monedă % — sărit (%: %)',
          r.id, cur, sqlstate, sqlerrm;
      end;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped,
                            'period', p_period_month, 'errors', v_errors);
end$$;

revoke all on function public.run_affiliate_payout_batch(date, bigint) from public, anon, authenticated;
grant execute on function public.run_affiliate_payout_batch(date, bigint) to service_role;


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 3. Asserții inline — funcțiile există, sunt SECURITY DEFINER  ║
-- ╚═══════════════════════════════════════════════════════════════╝

do $$ begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'process_account_deletions' and p.prosecdef
  ) then
    raise exception 'mig 183: process_account_deletions missing/not SECURITY DEFINER';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'run_affiliate_payout_batch' and p.prosecdef
  ) then
    raise exception 'mig 183: run_affiliate_payout_batch missing/not SECURITY DEFINER';
  end if;

  raise notice 'mig 183: izolare erori per-element în bucle batch OK (GDPR + payout)';
end $$;

-- ═══════════════════════════════════════════════════════════════
-- FINAL: comportament nou
--   • process_account_deletions: eroare la un user → warning + continue, restul
--     batch-ului GDPR/fiscal se procesează normal. Logica celor 3 politici
--     (block/archive_anonymize/transfer_tombstone) rămâne IDENTICĂ cu mig 179.
--   • run_affiliate_payout_batch: eroare la un afiliat+monedă → warning +
--     acumulare în jsonb.errors + continue, restul batch-ului de payout se
--     procesează normal. Calculele de payout rămân IDENTICE cu mig 107.
-- ═══════════════════════════════════════════════════════════════

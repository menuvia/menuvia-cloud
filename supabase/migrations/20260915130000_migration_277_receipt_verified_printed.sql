-- migration_277_receipt_verified_printed.sql
-- =============================================================================
-- Un bon TIPĂRIT pe care Menuvia l-a pierdut din vedere poate fi ÎNREGISTRAT.
-- (găsit de recenzia adversarială a mig 276 și de CodeRabbit pe PR #258)
--
-- Starea de dinainte. `pending_receipts.status = 'success'` avea DOI scriitori,
-- amândoi doar din `sent`: `bridge_confirm_receipt` (bridge-ul, 045) și
-- `bridge_force_resolve_stuck` (adminul, 045). Dar janitorul orar
-- `bridge_mark_stale_as_error` (262, pe pg_cron din 274) duce un `sent` fără
-- confirmare în `error` + markerul „POSIBIL DUPLICAT” după 10 minute — exact
-- cazul „bridge-ul a murit DUPĂ ce casa a tipărit”. De acolo, adminul care
-- verifică banda și GĂSEȘTE bonul nu avea nicio cale să-i scrie numărul:
--   • retry-ul cu ack (270) RE-tipărește → bon fiscal DUBLU real;
--   • `bridge_cancel_receipt` → `cancelled`, bonul real rămâne neînregistrat;
--   • `bridge_force_resolve_stuck` → „Doar bonuri stuck pot fi rezolvate”;
--   • un PATCH brut sub `admin manage` → fără audit, fără urmă.
-- Cu mig 276 gaura devine vizibilă pe un document: factura Oblio a acelei
-- comenzi stă AMÂNATĂ cât timp bonul e `error` (corect — emiterea e one-shot),
-- iar singura „ieșire” era anularea bonului, care ar fi emis factura FĂRĂ
-- mențiunea bonului tipărit.
--
-- Ce se schimbă. `bridge_force_resolve_stuck` (lanț 045→**277**, ACEEAȘI
-- semnătură `(uuid, boolean, text)` → `create or replace`, fără risc PGRST203)
-- acceptă, pe lângă `sent`, și rândurile `error` cu markerul
-- `POSIBIL DUPLICAT%` (prefix, același contract ca 270/262):
--   • `p_was_printed = true` + număr obligatoriu → `success`, `bon_number`,
--     `completed_at = now()`, `error_code` curățat, `error_info` = urmă
--     „Force-resolved by admin … TIPĂRIT”. `claimed_at` NU se atinge: e
--     momentul tipăririi, pe care mig 276 îl proiectează pe factură.
--   • `p_was_printed = false` → rămâne `error`, markerul e ÎNLOCUIT cu urma
--     „Force-resolved … NOT printed” (ca pe `sent`), deci retry-ul fără ack
--     trece (RR8/RR11) — verificarea umană e în DB, nu în UI.
--   • un `error` FĂRĂ marker (eșec CLAR: BONOK=0, payload respins) NU e
--     rezolvabil aici — nu s-a tipărit nimic; calea lui rămâne retry/anulare
--     (RR10). Un rând cu `bon_number` deja scris nu se rezolvă de două ori.
-- Fiecare rezolvare scrie un rând în `audit_log` (`pending_receipts`,
-- `UPDATE`, old/new complet) — tabela n-are trigger de audit (275), iar o
-- suprascriere umană a cozii fiscale trebuie să lase urmă.
--
-- Teste permanente: RR9–RR12 în tests/sql/receipt_retry_ambiguous_assertions.sql;
-- OB9 (oblio_delivery_date_assertions.sql) trece prin această cale cap-coadă:
-- error+marker → force_resolve → claim-ul de facturi iese cu bonul.
-- UI: BridgeTab, butonul „Bonul a ieșit” pe rândurile cu marker →
-- ReceiptPrintedDialog (numărul de pe bandă), fără window.prompt (iOS PWA).
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

create or replace function public.bridge_force_resolve_stuck(
  p_receipt_id  uuid,
  p_was_printed boolean,
  p_bon_number  text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old       public.pending_receipts%rowtype;
  v_new       public.pending_receipts%rowtype;
  v_ambiguous boolean;
  v_actor     uuid := auth.uid();
  v_stamp     text := to_char(now() at time zone 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI');
begin
  -- Lacăt pe rând ÎNAINTE de validări (recenzie CodeRabbit pe #258): două
  -- rezolvări concurente ale aceluiași bon ar fi trecut amândouă de gărzi și
  -- ar fi scris două rânduri de audit (sau un „NOT printed" peste un success).
  -- Cu lacăt, a doua așteaptă și vede rândul deja rezolvat → `already_resolved`.
  select * into v_old from public.pending_receipts where id = p_receipt_id for update;
  if not found then return false; end if;

  if not public.is_admin(v_old.restaurant_id) then
    raise exception 'Only owners/managers can force-resolve receipts'
      using hint = 'role_insufficient';
  end if;

  -- Un rând cu număr de bon e DEJA rezolvat, indiferent de status — mesajul
  -- ăsta e mai util decât „status curent: success” (verificat ÎNAINTEA
  -- statusului, RR9).
  if v_old.bon_number is not null then
    raise exception 'Bonul are deja număr fiscal: %. Nu poate fi resolvat din nou.', v_old.bon_number
      using hint = 'already_resolved';
  end if;

  -- mig 277: și un eșec AMBIGUU (marker PREFIX, contractul din 262/270) —
  -- bonul POATE fi pe bandă; adminul a verificat-o și spune ce a găsit.
  v_ambiguous := v_old.status = 'error' and v_old.error_info like 'POSIBIL DUPLICAT%';
  if v_old.status <> 'sent' and not v_ambiguous then
    raise exception 'Doar bonurile agățate în sent sau cu eșec AMBIGUU (POSIBIL DUPLICAT) pot fi rezolvate manual. Status curent: %', v_old.status
      using hint = 'not_resolvable';
  end if;

  if p_was_printed then
    if nullif(trim(coalesce(p_bon_number, '')), '') is null then
      raise exception 'Dacă bonul a fost tipărit, numărul fiscal este obligatoriu.'
        using hint = 'bon_number_required';
    end if;
    -- claimed_at NU se atinge: e momentul tipăririi (mig 276 → receipt_printed_at).
    update public.pending_receipts
       set status       = 'success',
           bon_number   = trim(p_bon_number),
           completed_at = now(),
           error_code   = null,
           error_info   = format('Force-resolved by admin %s la %s: bon verificat pe bandă ca TIPĂRIT (din %s)',
                                 coalesce(v_actor::text, '?'), v_stamp,
                                 case when v_ambiguous then 'error POSIBIL DUPLICAT' else 'sent' end)
     where id = p_receipt_id
     returning * into v_new;
  else
    update public.pending_receipts
       set status       = 'error',
           error_code   = 'FORCE_FAILED',
           error_info   = format('Force-resolved by admin %s la %s: bon NOT printed, marked as error (din %s)',
                                 coalesce(v_actor::text, '?'), v_stamp,
                                 case when v_ambiguous then 'error POSIBIL DUPLICAT' else 'sent' end),
           completed_at = now()
     where id = p_receipt_id
     returning * into v_new;
  end if;

  -- Urmă: o suprascriere umană a cozii fiscale (tabela n-are trigger de audit).
  insert into public.audit_log
    (actor_id, actor_role, table_name, operation, row_id, restaurant_id, old_data, new_data, changed_keys)
  values
    (v_actor, 'authenticated', 'pending_receipts', 'UPDATE', p_receipt_id::text, v_old.restaurant_id,
     to_jsonb(v_old), to_jsonb(v_new), array['status', 'bon_number', 'error_code', 'error_info', 'completed_at']);

  return true;
end;
$$;

-- Aceleași grant-uri ca 045 (explicit per rol — default privileges Supabase, mig 274).
revoke all on function public.bridge_force_resolve_stuck(uuid, boolean, text) from public, anon;
grant execute on function public.bridge_force_resolve_stuck(uuid, boolean, text) to authenticated;

comment on function public.bridge_force_resolve_stuck(uuid, boolean, text) is
  'mig 277 (lant 045->277): rezolvare MANUALA a unui bon agatat in sent SAU cu esec AMBIGUU (error + marker POSIBIL DUPLICAT). p_was_printed=true cere numarul bonului si scrie success (claimed_at neatins = momentul tiparirii, folosit de mig 276 pe factura Oblio); false lasa error cu urma Force-resolved (marker inlocuit, retry-ul fara ack trece). Un error FARA marker nu e rezolvabil aici. Fiecare rezolvare scrie audit_log (pending_receipts/UPDATE). Doar owner/manager.';

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificări ONE-SHOT (poziția 277). Permanentele: RR9–RR12, OB9.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int; v_src text;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_force_resolve_stuck';
  if v_n <> 1 then
    raise exception 'mig 277: bridge_force_resolve_stuck are % semnaturi', v_n; end if;
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_force_resolve_stuck';
  if position('security definer' in lower(v_src)) = 0 or position('pg_temp' in v_src) = 0 then
    raise exception 'mig 277: functia nu e DEFINER cu pg_temp'; end if;
  if position('POSIBIL DUPLICAT%' in v_src) = 0 or position('public.audit_log' in v_src) = 0
     or position('not_resolvable' in v_src) = 0 then
    raise exception 'mig 277: ramura AMBIGUA sau auditul lipsesc din corp'; end if;
  if position('claimed_at' in v_src) = 0 then
    raise exception 'mig 277: claimed_at trebuie mentionat explicit (momentul tiparirii nu se atinge)'; end if;
  if position('where id = p_receipt_id for update' in v_src) = 0 then
    raise exception 'mig 277: lookup-ul nu mai ia lacat pe rand (for update) — rezolvari concurente ar trece amandoua'; end if;
  if has_function_privilege('anon', 'public.bridge_force_resolve_stuck(uuid, boolean, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.bridge_force_resolve_stuck(uuid, boolean, text)', 'EXECUTE') then
    raise exception 'mig 277: grant-urile s-au schimbat'; end if;
  raise notice 'MIG277 OK: bonul verificat pe banda se poate inregistra (permanentele: RR9-RR12, OB9)';
end $$;

commit;

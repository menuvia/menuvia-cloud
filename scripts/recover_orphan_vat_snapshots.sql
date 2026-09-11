-- scripts/recover_orphan_vat_snapshots.sql
-- =============================================================================
-- RECUPERARE ISTORICĂ, rulată MANUAL de fondator — NU face parte din lanțul de
-- migrații (nu e în supabase/migrations/) și NU se rulează automat niciodată.
--
-- Context (mig 272 / audit v3 RES-20). Backfill-ul din mig 272 a pus grupa+cota
-- pe liniile care mai au un produs. Liniile al căror produs fusese ȘTERS înainte
-- de migrație au `product_id` NULL (FK `on delete set null`) și rămân fără
-- snapshot — cititorii cad pe `coalesce(..., 1)`, adică raportează TOATĂ istoria
-- lor în GRUPA 1, la cota curentă a grupei 1.
--
-- Măsurat pe producție la 11 sept 2026: 16 din 53 de linii (447,00 lei, toate pe
-- comenzi `paid`, un singur restaurant `enterprise`, deci INTRĂ în raportul TVA).
-- Dintre ele, „Vin pahar" (2 linii, 36,00 lei) era în grupa 2 — raportată azi ca
-- grupă 1. Restul chiar erau grupa 1, deci fără efect.
--
-- Sursa de adevăr e jurnalul de audit (mig 044): orice scriere pe `products`
-- lasă `old_data`/`new_data` complete, deci numele ȘI `vat_group` sunt păstrate.
-- Potrivirea se face pe (restaurant, nume), cu `order_items.product_name_snapshot`
-- — numele de la VÂNZARE (mig 003). Se citește TOT istoricul numelui, nu doar
-- rândul de ștergere: un produs reclasificat ÎNAINTE de ștergere ar face ca
-- ștergerea să raporteze o grupă pe care vânzarea nu a avut-o.
--
-- DISCIPLINĂ (jurnal fiscal, nu date de lucru):
--   * se ating DOAR liniile fără snapshot ȘI fără produs — nicio linie cu
--     snapshot nu e rescrisă, deci scriptul e idempotent;
--   * un nume care în acel restaurant a purtat VREODATĂ grupe TVA diferite —
--     fie prin produse diferite, fie prin reclasificarea aceluiași produs, fie
--     fiindcă un produs VIU poartă azi acel nume cu altă grupă — e AMBIGUU: se
--     SARE (rămâne pe fallback-ul documentat), nu se ghicește. A sări o linie o
--     lasă exact cum e azi; a ghici ar da unui jurnal fiscal aparența de
--     certitudine peste o presupunere;
--   * liniile fără nicio potrivire (audit curățat, nume schimbat) rămân NULL;
--   * cota scrisă e cea CURENTĂ a grupei recuperate — aceeași regulă ca
--     backfill-ul din mig 272; pe producție s-a verificat că NICIUN restaurant
--     nu are `vat_rates.updated_at` după prima încasare, deci „curent" = „de la
--     vânzare" pentru tot istoricul de azi. Dacă grupa nu e configurată la acel
--     restaurant, se scrie doar grupa, iar cota rămâne NULL (cititorii cad pe
--     cota curentă a grupei — corect).
--
-- CUM SE RULEAZĂ — în DOI pași:
--   1) previzualizare (doar raportează; nu scrie și NU ia niciun lacăt de scriere):
--        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--          -c "set menuvia.recover_dry_run = 'on'" \
--          -f scripts/recover_orphan_vat_snapshots.sql
--   2) aplicare (o singură tranzacție; COMMIT automat la succes, ROLLBACK la eroare):
--        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f scripts/recover_orphan_vat_snapshots.sql
--
-- NU-l rula interactiv cu `begin` … te uiți … `commit`: aplicarea ia SHARE ROW
-- EXCLUSIVE pe `order_items` (prin `alter table ... disable trigger`), care
-- blochează INSERT/UPDATE/DELETE — adică CREAREA DE COMENZI pe toată platforma —
-- cât timp tranzacția e deschisă. De asta există pasul 1: raportul se obține din
-- ACEEAȘI logică, fără lacăt, iar fereastra de decizie umană stă în afara
-- tranzacției care scrie. Pasul 2 verifică la final că a scris exact câte linii
-- anunțase previzualizarea; dacă nu, dă eroare și nu comite.
--
-- Scriptul NU conține `begin`/`commit`: `psql -1` îl încadrează, iar suita de
-- teste îl include (`\ir`) în propria tranzacție (VS9), în ambele moduri.
-- =============================================================================

-- Totul stă într-UN SINGUR bloc, cu handler de excepție: trigger-ul de
-- sincronizare a subtotalului (mig 248) se dezactivează pe durata lucrului —
-- altfel fiecare comandă atinsă ar primi un UPDATE pe `orders` (audit 044 +
-- gate-urile BEFORE UPDATE), iar un total deja bonat ar putea fi „reparat" tăcut
-- din liniile curente. Dezactivarea trebuie să se RIDICE și pe calea de eroare:
-- dacă scriptul e rulat fără `-1` (fiecare instrucțiune își face commit), un
-- `alter table ... disable` urmat de o excepție ar lăsa trigger-ul STINS în
-- producție — adică subtotalurile ar înceta tăcut să se mai sincronizeze. Într-un
-- `do` cu `exception`, eșecul dă înapoi subtranzacția (deci și dezactivarea), iar
-- handler-ul re-activează explicit înainte de a re-arunca: fail-safe în ambele
-- moduri de rulare.
do $$
declare
  v_fixed     bigint := 0;
  v_fixable   bigint := 0;
  v_ambiguous bigint := 0;
  v_unmatched bigint := 0;
  v_dry       boolean;
  v_rec       record;
begin
  v_dry := coalesce(current_setting('menuvia.recover_dry_run', true), 'off') in ('on', 'true', '1');

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'order_items'
       and column_name = 'vat_group_snapshot') then
    raise exception 'recover_orphan_vat_snapshots: mig 272 nu e aplicată (lipsește order_items.vat_group_snapshot)';
  end if;

  -- Re-rulabil în aceeași tranzacție (preview, apoi aplicare).
  drop table if exists _orphan_candidates;
  drop table if exists _deleted_groups;

  -- Candidații: linii orfane (fără produs) și fără snapshot, cu nume de la vânzare.
  create temp table _orphan_candidates on commit drop as
  select oi.id,
         o.restaurant_id,
         oi.product_name_snapshot as nume
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where oi.vat_group_snapshot is null
     and oi.product_id is null
     and oi.product_name_snapshot is not null;

  -- Grupele TVA pe care le-a purtat VREODATĂ un nume, per restaurant.
  --
  -- Rândul DELETE singur NU e de ajuns: un produs poate fi RECLASIFICAT (grupa 1
  -- → 2) și abia apoi șters, caz în care ștergerea spune 2, dar vânzarea s-ar fi
  -- putut face cât timp era 1 — exact defectul pe care îl repară mig 272, doar
  -- că strecurat înapoi prin ușa din dos. De aceea se ia TOT istoricul de audit
  -- al numelui (orice operație, grupa din AMBELE instantanee) plus produsele
  -- care încă EXISTĂ cu acel nume (un nume reutilizat de un produs viu cu altă
  -- grupă e la fel de ambiguu). `n_grupe > 1` → se sare, nu se ghicește.
  create temp table _deleted_groups on commit drop as
  with hist as (
    select al.restaurant_id,
           coalesce(al.old_data->>'name', al.new_data->>'name') as nume,
           v.vg::smallint                                       as vat_group
      from public.audit_log al
      cross join lateral (values (al.old_data->>'vat_group'),
                                 (al.new_data->>'vat_group')) as v(vg)
     where al.table_name    = 'products'
       and al.restaurant_id is not null
       and v.vg ~ '^[0-9]+$'          -- old_data poate conține orice; nu presupunem un număr
    union all
    select p.restaurant_id, p.name, p.vat_group
      from public.products p
     where p.vat_group is not null
  )
  select restaurant_id,
         nume,
         min(vat_group)           as vat_group,
         count(distinct vat_group) as n_grupe
    from hist
   where nume is not null
   group by 1, 2;

  -- Numărătorile se fac ÎNAINTE de orice scriere, ca modul de PREVIZUALIZARE să
  -- dea exact aceleași cifre ca rularea reală, din ACEEAȘI logică (un raport
  -- scris separat ar putea diverge tăcut de ce face scriptul).
  select count(*) into v_fixable
    from _orphan_candidates c
    join _deleted_groups s
      on s.restaurant_id = c.restaurant_id and s.nume = c.nume
   where s.n_grupe = 1 and s.vat_group between 1 and 4;

  select count(*) into v_ambiguous
    from _orphan_candidates c
    join _deleted_groups s
      on s.restaurant_id = c.restaurant_id and s.nume = c.nume
   where s.n_grupe > 1;

  select count(*) into v_unmatched
    from _orphan_candidates c
   where not exists (select 1 from _deleted_groups s
                      where s.restaurant_id = c.restaurant_id and s.nume = c.nume);

  for v_rec in
    select c.nume, count(*) as linii
      from _orphan_candidates c
      join _deleted_groups s
        on s.restaurant_id = c.restaurant_id and s.nume = c.nume
     where s.n_grupe > 1
     group by 1 order by 2 desc
  loop
    raise notice '  AMBIGUU (nesetat): „%" — % linii, nume purtat de produse cu grupe TVA diferite', v_rec.nume, v_rec.linii;
  end loop;

  if v_dry then
    raise notice 'recover_orphan_vat_snapshots [PREVIZUALIZARE, nimic scris]: % linii recuperabile, % ambigue, % fără potrivire',
      v_fixable, v_ambiguous, v_unmatched;
    return;
  end if;

  -- De AICI încolo se scrie. `alter table ... disable trigger` ia SHARE ROW
  -- EXCLUSIVE pe `order_items`, care blochează INSERT/UPDATE/DELETE — adică
  -- CREAREA DE COMENZI pe toată platforma cât timp e ținut. De asta stă cât mai
  -- târziu posibil, iar previzualizarea (unde omul se uită și se gândește) NU
  -- ajunge niciodată aici: altfel lacătul ar fi ținut peste o fereastră de
  -- decizie umană, deschisă oricât.
  execute 'alter table public.order_items disable trigger order_items_subtotal_sync_upd';
  perform set_config('menuvia.skip_item_audit', 'on', true);

  update public.order_items oi
     set vat_group_snapshot = s.vat_group,
         vat_rate_snapshot  = vr.rate_percent
    from _orphan_candidates c
    join _deleted_groups s
      on s.restaurant_id = c.restaurant_id
     and s.nume          = c.nume
     and s.n_grupe       = 1                  -- fail-closed: ambiguu → nu se atinge
    left join public.vat_rates vr
      on vr.restaurant_id = c.restaurant_id
     and vr.vat_group     = s.vat_group
   where oi.id = c.id
     and s.vat_group between 1 and 4;         -- respectă CHECK-ul coloanei
  get diagnostics v_fixed = row_count;

  execute 'alter table public.order_items enable trigger order_items_subtotal_sync_upd';

  if v_fixed <> v_fixable then
    raise exception 'recover_orphan_vat_snapshots: previzualizarea anunța % linii, s-au scris % — logica raportului și cea a scrierii au divergat', v_fixable, v_fixed;
  end if;

  raise notice 'recover_orphan_vat_snapshots: % linii recuperate din jurnalul de audit, % sărite ca AMBIGUE, % fără potrivire (rămân pe fallback-ul grupei 1)',
    v_fixed, v_ambiguous, v_unmatched;
exception
  when others then
    -- Ieșirea din subtranzacție a dat deja înapoi dezactivarea; re-activăm
    -- explicit fiindcă e idempotent și fiindcă ne bazăm pe STARE, nu pe presupuneri.
    execute 'alter table public.order_items enable trigger order_items_subtotal_sync_upd';
    raise;
end $$;

-- mig 313 — „Epuizat” automat din stoc + deblocare de către personal (lotul B)
-- ─────────────────────────────────────────────────────────────────────────────
-- Decizia fondatorului: „Sub o porție + staff poate debloca”. Când stocul unui
-- ingredient din rețeta unui produs scade SUB cantitatea dintr-o porție
-- (`current_stock < recipes.quantity`), produsul devine „Epuizat” pe meniu,
-- singur. Personalul (orice membru: proprietar, manager, ospătar, bucătărie)
-- îl poate bloca sau debloca manual.
--
-- ── MODELUL ──────────────────────────────────────────────────────────────────
-- `products.is_sold_out` RĂMÂNE starea EFECTIVĂ: o citesc meniul public
-- (get_menu_for_restaurant 212→253, forma jsonb NEATINSĂ), trigger-ul 130 de
-- pe order_items, filtrele de împerecheri (164/253) și tot clientul. Coloana
-- nouă `products.sold_out_source` spune DE CE:
--
--   is_sold_out | sold_out_source | sens
--   ------------+-----------------+--------------------------------------------
--   true        | 'stock'         | epuizat automat: un ingredient e sub o porție
--   true        | 'manual'        | epuizat de om (RPC, ProductsTab, PATCH direct)
--   false       | null            | disponibil, regula de stoc e ARMATĂ
--   false       | 'manual'        | DEBLOCAT de om deși stocul e sub o porție
--               |                 | („a venit marfa, n-am făcut încă NIR-ul”)
--
-- CHECK-urile interzic celelalte două combinații (epuizat fără sursă;
-- disponibil „din stoc”). Rândurile vechi `is_sold_out = true` primesc
-- `'manual'` la backfill — au fost puse de om, înainte să existe regula.
--
-- ── REGULA AUTOMATĂ (recalc_products_sold_out) ──────────────────────────────
-- `product_stock_short(produs)` = restaurantul are featurea `stocks` (Gestiune,
-- growth+; fără ea stocul nu e ținut și regula ar ascunde meniul degeaba) ȘI
-- există o linie de rețetă cu ingredient ACTIV și `current_stock < quantity`
-- (recalc_products_sold_out aplică ACELAȘI predicat pe mulțime, cu featurea
-- calculată o dată per restaurant; helperul rămâne pentru RPC și normalizare).
-- Pentru produsele atinse:
--   • lipsă + regula armată (false/null)   → true/'stock'
--   • stoc refăcut + sursa e stocul        → false/null   (revine SINGUR)
--   • stoc refăcut + deblocat manual       → false/null   (regula se RE-ARMEAZĂ)
--   • epuizat MANUAL                        → NEATINS, orice ar face stocul
--   • deblocat manual + încă lipsă          → NEATINS (vezi mai jos)
-- La următoarea SCĂDERE după o deblocare manuală, produsul rămâne DISPONIBIL:
-- deblocarea ține până când stocul trece din nou peste prag (NIR, ajustare),
-- moment în care regula se re-armează și o scădere ULTERIOARĂ sub porție îl
-- epuizează din nou (SO3b). Alternativa — re-epuizare la prima vânzare — ar fi
-- obligat ospătarul să deblocheze după FIECARE vânzare, iar deblocarea ar fi
-- fost practic inutilă.
--
-- ── TRIGGERE: semnal imediat, recalculare AMÂNATĂ la COMMIT ─────────────────
-- Două straturi, deliberat separate:
--   (1) SEMNALUL, imediat, FOR EACH STATEMENT cu transition tables (tiparul
--       mig 248): ingredients AFTER UPDATE (fără listă de coloane — Postgres
--       refuză transition tables pe `UPDATE OF col`) și recipes AFTER INSERT /
--       UPDATE / DELETE. Triggerul NU recalculează și NU ia niciun lock pe
--       products: doar pune în coada `products_sold_out_queue` produsele al
--       căror prag a fost TRAVERSAT de statement — `(old.current_stock <
--       r.quantity) is distinct from (new.current_stock < r.quantity)` sau
--       `is_active` schimbat (rețetele: toate produsele atinse). O vânzare
--       obișnuită, cu stoc departe de prag, nu pune nimic în coadă.
--   (2) RECALCULAREA, la COMMIT: coada are un CONSTRAINT TRIGGER `DEFERRABLE
--       INITIALLY DEFERRED` (AFTER INSERT ROW, `trg_products_sold_out_queue_
--       flush`). Prima lui declanșare din tranzacție golește coada pentru
--       `txid_current()` și recalculează PE MULȚIME: produsele se lock-uiesc
--       ORDONAT (`order by id`) cu `for update skip locked` — nu se AȘTEAPTĂ
--       niciodată pe un rând de produs —, iar featurea `stocks` se calculează
--       O DATĂ per restaurant. Celelalte declanșări găsesc coada goală.
--   Cheia cozii e `(tx_id, product_id)` cu `on conflict do nothing`: o
--   singură intrare (și un singur eveniment amânat) per produs per tranzacție,
--   iar două tranzacții nu se ating niciodată pe același rând (fără `tx_id`,
--   unicitatea pe `product_id` ar fi pus a doua tranzacție să AȘTEPTE commit-ul
--   primeia — un lock nou exact pe calea încasării). Rândurile sunt tranzacțio-
--   nale: un rollback (sau un savepoint derulat) le ia cu el, împreună cu
--   evenimentul amânat. Coada e goală după orice commit.
--
-- ── DE CE LA COMMIT (deadlock-ul găsit de recenzia adversarială) ──────────
-- Prima variantă recalcula ÎN statement, deci lua lock pe rândul produsului în
-- MIJLOCUL buclei de deducere din `deduct_stock_on_order_paid` (250/252), care
-- face câte un UPDATE pe fiecare ingredient. Ciclu ingredient ↔ produs: P are
-- i1, i2, i3; A scade i1, P se epuizează (A ține P), apoi scade i2; B scăzuse
-- deja i2, scade i3 și vrea P (așteaptă A); A așteaptă i2 (B) → deadlock, iar
-- detectorul îl dă LUI A, în `UPDATE ingredients` — în AFARA sub-blocului de
-- recalculare, deci închiderea/încasarea pică. Comentariul vechi („inclusiv un
-- deadlock pe rândul produsului: sub-tranzacția îl absoarbe”) era FALS: cel
-- care moare e celălalt statement. Acum, în timpul statement-ului nu se ia
-- niciun lock pe products, iar la commit lock-ul e ordonat și fără așteptare,
-- deci ciclul nu se mai poate închide.
-- Dovada, cu două sesiuni psql pe replay (precedentul mig 273/282), aceleași
-- instrucțiuni pe ambele variante (P = 1 kg din fiecare ingredient, stoc 10):
--   B: begin; i2 -= 1;                       A: begin; i1 := 0 (P sub porție);
--   A: i2 -= 1 (așteaptă B);                 B: i3 := 0; … commit;
--   • varianta în statement: A → „ERROR: deadlock detected … while locking
--     tuple in relation "ingredients"” (tranzacția lui A, adică încasarea,
--     derulată); B → COMMIT, P true/stock.
--   • varianta amânată: B → COMMIT (P true/stock); A se deblochează după
--     commit-ul lui B → COMMIT; P true/stock, i1 = 0, i2 = 8, i3 = 0.
--
-- ── REZIDUU: produsul SĂRIT de `skip locked` ────────────────────────────────
-- Dacă la commit rândul produsului e ținut de altă tranzacție, recalcularea îl
-- SARE (nu așteaptă — orice așteptare la commit e o încasare care stă).
-- Deținătorul e, în practică, cealaltă tranzacție care recalculează ACELAȘI
-- produs la commit (două vânzări simultane care traversează pragul) — ea scrie
-- starea din propria vedere, deci cazul obișnuit iese corect. Cazul rău e cel
-- în care vederea ei e veche (de ex. un NIR pe i1 și o vânzare pe i3 comise în
-- același moment): produsul poate rămâne în starea veche până la URMĂTOAREA
-- traversare de prag pe un ingredient al lui, o editare de rețetă sau un gest
-- manual (ProductsTab / panoul „Epuizate”). Nu se mai recalculează la orice
-- mișcare de stoc — tocmai filtrul de traversare face încasarea ieftină. Un
-- produs rămas „disponibil” deși e sub porție e comportamentul de dinainte de
-- 313 (se vinde pe stoc negativ), nu un bon greșit.
--
-- ── PERFORMANȚA pe încasare (măsurat pe replay) ─────────────────────────────
-- Scenariu: un local cu 300 de produse, 20 de ingrediente, 3 ingrediente per
-- rețetă (~45 de produse per ingredient); comandă de 20 de linii închisă →
-- 60 de UPDATE-uri pe ingredients în bucla de deducere. Timpul instrucțiunii
-- `update orders set status = 'closed'` (+ COMMIT), Postgres 16 local, 3–6
-- rulări:
--   fără niciun trigger 313 (referința)         14–20 ms           + commit ~2 ms
--   prima variantă, stoc departe de prag        168–207 ms         + commit ~2 ms
--   varianta amânată, stoc departe de prag      17–23 ms           + commit ~2 ms
--   prima variantă, TOATE pragurile traversate  1136–1393 ms       + commit ~2 ms
--   varianta amânată, TOATE traversate          21–37 ms           + commit 82–98 ms
-- (ultimul rând = cazul-limită: toate cele 300 de produse devin „Epuizat” în
-- aceeași încasare; costul de la commit e cel al celor 300 de UPDATE-uri pe
-- products, cu auditul lor, făcute O DATĂ în loc de la fiecare din cele 60 de
-- statement-uri). Panta contează mai mult decât factorul: prima variantă
-- creștea cu (statement-uri × produse per ingredient × restaurant_has_feature
-- per produs); acum o vânzare obișnuită costă cât o deducere fără 313.
--
-- Recalcularea e izolată pe TOATE straturile: semnalul (inserarea în coadă),
-- golirea cozii și recalcularea propriu-zisă sunt fiecare într-un sub-bloc
-- `exception when others → raise warning`. Recalcularea rulează la commit-ul
-- tranzacției ÎNCASĂRII (advance_order → trigger pe orders), iar un „epuizat”
-- ratat nu are voie să oprească niciodată un commit de plată. Golirea cozii e
-- ÎNAINTEA sub-blocului de recalculare: un eșec al recalculării nu lasă rânduri
-- orfane în coadă.
--
-- ── PERSONALUL: set_product_sold_out(uuid, boolean) → jsonb ─────────────────
-- DEFINER `public, pg_temp`; ospătarul și bucătarul NU au UPDATE pe products
-- (politica „products: admin write”), deci singura lor cale e acest RPC. Gate
-- `is_member` (proprietar/manager/ospătar/bucătărie + escape-ul fondatorului
-- 186) SAU `has_partner_access` (286): partenerul cu acces ACORDAT are deja
-- scriere pe products prin politica „products: admin write” și tab-ul Produse
-- e în PARTNER_TAB_IDS — fără ramura lui, comutatorul „Epuizat” din ProductsTab
-- i-ar fi întors „Nu ai acces” pe un produs pe care îl poate edita. Funelul
-- is_member rămâne NEATINS (286: partenerul nu intră în funel); ramura e
-- scrisă explicit aici, iar PO9 are funcția în lista permisă. Produs
-- inexistent, produs străin și partener FĂRĂ consimțământ dau ACEEAȘI eroare
-- (42501, hint `not_member`) — fără oracol de existență. Blocarea pune
-- 'manual'; deblocarea pune 'manual' dacă stocul e încă sub porție, altfel
-- null. Auditul e cel existent: `audit_products` (mig 044, FOR EACH ROW pe
-- products) consemnează rândul cu actorul din JWT.
-- `is_sold_out` se schimbă DOAR prin comutator / acest RPC: formularul de
-- produs din ProductsTab NU mai trimite câmpul în PATCH (PRODUCT_UPDATE_FIELDS,
-- sanitize.ts). Altfel o listă încărcată ÎNAINTE ca stocul să epuizeze produsul
-- trimitea `is_sold_out:false` la o simplă editare de descriere, iar
-- normalizarea de mai jos îl transforma în `false/manual` — produs DEBLOCAT
-- tăcut. Un PATCH direct care tot schimbă `is_sold_out` (clientul vechi,
-- fallback-ul pe PGRST202 al comutatorului) trece prin normalizarea BEFORE ROW
-- `trg_products_sold_out_normalize`: o scriere care schimbă starea fără să
-- spună sursa e un act MANUAL (aceeași regulă ca RPC-ul).
--
-- ── COMENZI ──────────────────────────────────────────────────────────────────
-- create_order (191) NU se recreează, deliberat: trigger-ul 130
-- (`reject_unavailable_order_item`, BEFORE INSERT pe order_items) respinge
-- DEJA orice linie cu produs epuizat, cu hint `product_sold_out`, pe ORICE cale
-- de inserare — o a doua copie a gardei în create_order ar fi un loc în plus
-- de ținut sincron, nu o barieră în plus (SO5 verifică pe create_order REAL).
-- update_order_items (lanț 079→080→081→082→146→184→192→**313**): editarea
-- face DELETE + INSERT, deci trigger-ul 130 respingea pe ORICE editare o
-- comandă care conținea un produs epuizat ÎNTRE TIMP — ospătarul nu mai putea
-- nici măcar scoate altă linie. Acum: cantitatea deja comandată dintr-un
-- produs epuizat se PĂSTREAZĂ; doar cantitatea NOUĂ (suma pe produs peste cea
-- veche) e respinsă cu `product_sold_out`. RPC-ul își face singur verificarea
-- de cantitate și semnalează trigger-ului 130, prin GUC-ul tranzacțional
-- `menuvia.sold_out_keep_order` = id-ul comenzii (pus imediat înaintea
-- INSERT-ului unei linii păstrate, golit imediat după), că acea linie e
-- legitimă. Clienții nu pot seta un GUC (PostgREST nu expune `set_config`;
-- același tipar ca `menuvia.skip_item_audit`, 081), iar valoarea e legată de
-- comanda curentă. Restul corpului e copie FIDELĂ a lui 192 (minim pe grup,
-- dedup 184, plafon 146, extras M1, lock optimist 082, audit sumar 081).
--
-- ── SONDA: get_menu_version(uuid) → text ─────────────────────────────────────
-- md5 peste (id, is_sold_out, is_active, is_draft, updated_at) ale produselor
-- + (id, ordine, nume/meta/traduceri) ale categoriilor; se schimbă la orice
-- epuizare/deblocare și la orice editare de meniu. Clientul QR o cheamă la
-- `visibilitychange` și refă meniul DOAR când s-a schimbat. DEFINER (anon nu
-- vede produsele inactive, iar dispariția lor trebuie să schimbe versiunea),
-- STABLE, grant anon+authenticated, NULL pe restaurant inactiv/inexistent
-- (filtrul `is_restaurant_active`, ca meniul). Fără rate-limit, deliberat:
-- întoarce un hash, nu date, și costă mai puțin decât meniul pe care îl
-- înlocuiește (get_menu_for_restaurant n-are plafon nici el). AH1 o listează.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Coloana sursei + CHECK-uri ────────────────────────────────────────────
alter table public.products add column if not exists sold_out_source text;

alter table public.products drop constraint if exists products_sold_out_source_check;
alter table public.products add constraint products_sold_out_source_check
  check (sold_out_source is null or sold_out_source in ('manual', 'stock'));

-- Backfill: tot ce e epuizat azi a fost pus de om.
update public.products
   set sold_out_source = 'manual'
 where is_sold_out is true and sold_out_source is null;

alter table public.products drop constraint if exists products_sold_out_source_pair_check;
alter table public.products add constraint products_sold_out_source_pair_check
  check (not (is_sold_out is true and sold_out_source is null)
         and not (is_sold_out is not true and sold_out_source = 'stock'));

comment on column public.products.sold_out_source is
  $$De ce e (sau nu e) epuizat produsul (mig 313): 'stock' = automat, un ingredient al rețetei e sub o porție; 'manual' cu is_sold_out=true = blocat de personal; 'manual' cu is_sold_out=false = deblocat de personal deși stocul e sub porție (ține până când stocul revine peste prag); null = disponibil, regula de stoc armată.$$;

-- ── 2. Helperul: e produsul sub o porție? ────────────────────────────────────
create or replace function public.product_stock_short(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
           select 1
             from public.recipes r
             join public.ingredients i on i.id = r.ingredient_id
            where r.product_id = p_product_id
              and i.is_active
              and i.current_stock < r.quantity)
     and coalesce((
           select public.restaurant_has_feature(p.restaurant_id, 'stocks')
             from public.products p
            where p.id = p_product_id), false);
$$;

revoke all on function public.product_stock_short(uuid) from public, anon, authenticated, service_role;

-- ── 3. Recalcularea pe un set de produse (rulează la COMMIT, prin coadă) ────
create or replace function public.recalc_products_sold_out(p_product_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_locked uuid[];
  v_rids   uuid[];
  v_feat   uuid[] := '{}';
  v_rid    uuid;
  v_short  uuid[];
  v_ok     uuid[];
  v_n      integer := 0;
  v_c      integer;
begin
  if p_product_ids is null or cardinality(p_product_ids) = 0 then
    return 0;
  end if;

  -- Lock ORDONAT, FĂRĂ așteptare: un produs ținut de altă tranzacție e sărit
  -- (reziduul din antet). Lock-urile proprii nu sunt sărite.
  select coalesce(array_agg(s.id order by s.id), '{}')
    into v_locked
    from (select p.id
            from public.products p
           where p.id = any(p_product_ids)
           order by p.id
             for update skip locked) s;
  if cardinality(v_locked) = 0 then
    return 0;
  end if;

  -- Featurea `stocks` O DATĂ per restaurant (o buclă, nu un predicat: un
  -- filtru peste un subquery DISTINCT poate fi împins sub DISTINCT și evaluat
  -- iar per produs).
  select coalesce(array_agg(distinct p.restaurant_id), '{}')
    into v_rids
    from public.products p
   where p.id = any(v_locked);
  foreach v_rid in array v_rids loop
    if public.restaurant_has_feature(v_rid, 'stocks') then
      v_feat := v_feat || v_rid;
    end if;
  end loop;

  -- Aceeași regulă ca product_stock_short, pe mulțime.
  select coalesce(array_agg(p.id) filter (where s.short), '{}'),
         coalesce(array_agg(p.id) filter (where not s.short), '{}')
    into v_short, v_ok
    from public.products p
    cross join lateral (
      select p.restaurant_id = any(v_feat)
             and exists (select 1
                           from public.recipes r
                           join public.ingredients i on i.id = r.ingredient_id
                          where r.product_id = p.id
                            and i.is_active
                            and i.current_stock < r.quantity) as short
    ) s
   where p.id = any(v_locked);

  -- Lipsă + regula armată → epuizat din stoc. Manualul (epuizat SAU deblocat)
  -- are sold_out_source = 'manual' și nu e atins.
  update public.products
     set is_sold_out = true, sold_out_source = 'stock'
   where id = any(v_short)
     and is_sold_out is not true
     and sold_out_source is null;
  get diagnostics v_c = row_count;
  v_n := v_n + v_c;

  -- Stoc refăcut: revine DOAR ce epuizase stocul.
  update public.products
     set is_sold_out = false, sold_out_source = null
   where id = any(v_ok)
     and is_sold_out is true
     and sold_out_source = 'stock';
  get diagnostics v_c = row_count;
  v_n := v_n + v_c;

  -- Stoc refăcut după o deblocare manuală: regula se re-armează.
  update public.products
     set sold_out_source = null
   where id = any(v_ok)
     and is_sold_out is not true
     and sold_out_source = 'manual';
  get diagnostics v_c = row_count;
  v_n := v_n + v_c;

  return v_n;
end;
$$;

revoke all on function public.recalc_products_sold_out(uuid[]) from public, anon, authenticated, service_role;

-- ── 4. Normalizarea scrierilor directe (BEFORE ROW) ──────────────────────────
create or replace function public.normalize_product_sold_out()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.is_sold_out is distinct from old.is_sold_out
     and new.sold_out_source is not distinct from old.sold_out_source then
    -- Scriitorul a schimbat starea fără să spună sursa → act MANUAL (PATCH-ul
    -- adminului din ProductsTab / formular). Aceeași regulă ca RPC-ul.
    if new.is_sold_out is true then
      new.sold_out_source := 'manual';
    elsif public.product_stock_short(new.id) then
      new.sold_out_source := 'manual';
    else
      new.sold_out_source := null;
    end if;
  end if;

  -- Integritate (oglinda CHECK-urilor, ca un INSERT/UPDATE neatent să nu pice).
  if new.is_sold_out is true and new.sold_out_source is null then
    new.sold_out_source := 'manual';
  elsif new.is_sold_out is not true and new.sold_out_source = 'stock' then
    new.sold_out_source := null;
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_product_sold_out() from public, anon, authenticated, service_role;

drop trigger if exists trg_products_sold_out_normalize on public.products;
create trigger trg_products_sold_out_normalize
  before insert or update of is_sold_out, sold_out_source on public.products
  for each row execute function public.normalize_product_sold_out();

-- ── 5. Coada + recalcularea la COMMIT ────────────────────────────────────────
-- Coada per tranzacție. Fără FK pe products, deliberat: un produs șters în
-- aceeași tranzacție e doar ignorat la golire, iar un FK ar cere index propriu
-- (AH5) și un KEY SHARE pe products la fiecare semnal. RLS pornit fără politici
-- + revoke explicit pe toate rolurile client (default privileges din 047 dau
-- authenticated CRUD pe orice tabelă nouă): scriitorii sunt DOAR funcțiile
-- DEFINER de mai jos.
create table if not exists public.products_sold_out_queue (
  tx_id      bigint not null default txid_current(),
  product_id uuid   not null,
  primary key (tx_id, product_id)
);

alter table public.products_sold_out_queue enable row level security;
revoke all on table public.products_sold_out_queue from public, anon, authenticated, service_role;

comment on table public.products_sold_out_queue is
  $$Coada recalculării „epuizat din stoc” (mig 313): produsele al căror prag a fost traversat în tranzacția tx_id. Golită la COMMIT de trg_products_sold_out_queue_flush (DEFERRABLE INITIALLY DEFERRED); goală după orice commit.$$;

create or replace function public.flush_products_sold_out_queue()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  -- Prima declanșare din tranzacție ia TOT; celelalte găsesc coada goală.
  begin
    with d as (
      delete from public.products_sold_out_queue
       where tx_id = txid_current()
      returning product_id)
    select array_agg(distinct d.product_id) into v_ids from d;
  exception when others then
    raise warning 'mig 313: golirea cozii „epuizat din stoc” a eșuat (%): %', sqlstate, sqlerrm;
    return null;
  end;

  if v_ids is null then
    return null;
  end if;

  begin
    perform public.recalc_products_sold_out(v_ids);
  exception when others then
    -- Un „epuizat” ratat NU oprește niciodată commit-ul încasării.
    raise warning 'mig 313: recalcularea „epuizat din stoc” a eșuat (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.flush_products_sold_out_queue() from public, anon, authenticated, service_role;

drop trigger if exists trg_products_sold_out_queue_flush on public.products_sold_out_queue;
create constraint trigger trg_products_sold_out_queue_flush
  after insert on public.products_sold_out_queue
  deferrable initially deferred
  for each row execute function public.flush_products_sold_out_queue();

-- ── 6. Semnalul (FOR EACH STATEMENT): doar pragurile TRAVERSATE ──────────────
create or replace function public.ingredients_sold_out_stmt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.products_sold_out_queue (product_id)
    select distinct r.product_id
      from sold_out_new_rows n
      join sold_out_old_rows o on o.id = n.id
      join public.recipes r on r.ingredient_id = n.id
     where n.is_active is distinct from o.is_active
        or (o.current_stock < r.quantity) is distinct from (n.current_stock < r.quantity)
    on conflict (tx_id, product_id) do nothing;
  exception when others then
    -- Un semnal pierdut NU oprește niciodată încasarea care a scăzut stocul.
    raise warning 'mig 313: semnalul „epuizat din stoc” a eșuat (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.ingredients_sold_out_stmt() from public, anon, authenticated, service_role;

drop trigger if exists trg_ingredients_sold_out_upd on public.ingredients;
create trigger trg_ingredients_sold_out_upd
  after update on public.ingredients
  referencing old table as sold_out_old_rows new table as sold_out_new_rows
  for each statement execute function public.ingredients_sold_out_stmt();

create or replace function public.recipes_sold_out_stmt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.products_sold_out_queue (product_id)
      select distinct product_id from sold_out_new_rows
      on conflict (tx_id, product_id) do nothing;
    elsif tg_op = 'DELETE' then
      insert into public.products_sold_out_queue (product_id)
      select distinct product_id from sold_out_old_rows
      on conflict (tx_id, product_id) do nothing;
    else
      insert into public.products_sold_out_queue (product_id)
      select product_id from sold_out_new_rows
      union
      select product_id from sold_out_old_rows
      on conflict (tx_id, product_id) do nothing;
    end if;
  exception when others then
    raise warning 'mig 313: semnalul „epuizat din stoc” a eșuat (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.recipes_sold_out_stmt() from public, anon, authenticated, service_role;

drop trigger if exists trg_recipes_sold_out_ins on public.recipes;
create trigger trg_recipes_sold_out_ins
  after insert on public.recipes
  referencing new table as sold_out_new_rows
  for each statement execute function public.recipes_sold_out_stmt();

drop trigger if exists trg_recipes_sold_out_upd on public.recipes;
create trigger trg_recipes_sold_out_upd
  after update on public.recipes
  referencing old table as sold_out_old_rows new table as sold_out_new_rows
  for each statement execute function public.recipes_sold_out_stmt();

drop trigger if exists trg_recipes_sold_out_del on public.recipes;
create trigger trg_recipes_sold_out_del
  after delete on public.recipes
  referencing old table as sold_out_old_rows
  for each statement execute function public.recipes_sold_out_stmt();

-- ── 7. RPC-ul personalului ───────────────────────────────────────────────────
create or replace function public.set_product_sold_out(p_product_id uuid, p_sold_out boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_rid  uuid;
  v_cur  boolean;
  v_csrc text;
  v_src  text;
begin
  if v_uid is null then
    raise exception 'Trebuie să fii autentificat.'
      using errcode = '42501', hint = 'not_authenticated';
  end if;
  if p_product_id is null or p_sold_out is null then
    raise exception 'Produsul și starea sunt obligatorii.'
      using errcode = '22023', hint = 'invalid_input';
  end if;

  -- Acces ÎNAINTE de lock (un străin nu blochează rândul altuia): membru
  -- (funelul, cu escape-ul fondatorului) SAU partener cu acces ACORDAT (mig
  -- 286 — aceeași suprafață ca politica „products: admin write”). Produs
  -- inexistent, produs străin și partener fără consimțământ → ACEEAȘI eroare
  -- (fără oracol de existență).
  select restaurant_id into v_rid from public.products where id = p_product_id;
  if v_rid is null
     or not (public.is_member(v_rid) or public.has_partner_access(v_rid)) then
    raise exception 'Nu ai acces la acest produs.'
      using errcode = '42501', hint = 'not_member';
  end if;

  select is_sold_out, sold_out_source into v_cur, v_csrc
    from public.products where id = p_product_id
     for update;

  if p_sold_out then
    v_src := 'manual';
  elsif public.product_stock_short(p_product_id) then
    v_src := 'manual';   -- deblocat deși stocul e sub porție (ține până revine)
  else
    v_src := null;
  end if;

  if (v_cur is true) is distinct from p_sold_out or v_csrc is distinct from v_src then
    update public.products
       set is_sold_out = p_sold_out, sold_out_source = v_src
     where id = p_product_id;
  end if;

  return jsonb_build_object(
    'ok',              true,
    'product_id',      p_product_id,
    'is_sold_out',     p_sold_out,
    'sold_out_source', v_src
  );
end;
$$;

revoke all on function public.set_product_sold_out(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_product_sold_out(uuid, boolean) to authenticated;

comment on function public.set_product_sold_out(uuid, boolean) is
  'Personalul (orice membru) sau partenerul cu acces acordat marchează un produs epuizat/disponibil (mig 313). Hint not_member = produs străin, inexistent sau partener fără consimțământ.';

-- ── 8. Sonda de versiune a meniului ──────────────────────────────────────────
create or replace function public.get_menu_version(p_restaurant_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_restaurant_id is null or not public.is_restaurant_active(p_restaurant_id) then null
    else md5(
      coalesce((
        select string_agg(
                 p.id::text || ':' || coalesce(p.is_sold_out, false)::text
                 || ':' || coalesce(p.is_active, false)::text
                 || ':' || coalesce(p.is_draft, false)::text
                 || ':' || coalesce(extract(epoch from p.updated_at)::text, ''),
                 ',' order by p.id)
          from public.products p
         where p.restaurant_id = p_restaurant_id), '')
      || '|' ||
      coalesce((
        select string_agg(
                 c.id::text || ':' || coalesce(c.display_order, 0)::text || ':'
                 || md5(coalesce(c.name, '') || '~' || coalesce(c.meta_text, '')
                        || '~' || coalesce(c.translations::text, '')),
                 ',' order by c.id)
          from public.categories c
         where c.restaurant_id = p_restaurant_id), '')
    )
  end;
$$;

revoke all on function public.get_menu_version(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_menu_version(uuid) to anon, authenticated;

comment on function public.get_menu_version(uuid) is
  'Versiunea meniului public (mig 313): hash care se schimbă la orice epuizare/deblocare și la orice editare de produse/categorii. NULL = restaurant inactiv/inexistent.';

-- ── 9. Trigger-ul 130: linia PĂSTRATĂ de update_order_items trece ───────────
-- Copie a lui 130 + o singură excepție pe ramura sold_out: GUC-ul
-- `menuvia.sold_out_keep_order` egal cu comanda liniei (pus doar de
-- update_order_items, după ce a verificat că nu crește cantitatea).
create or replace function public.reject_unavailable_order_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod record;
begin
  if new.product_id is null then
    return new;  -- linie ad-hoc fara produs (FK permite); nimic de validat
  end if;

  select is_active, is_draft, is_sold_out, name
    into v_prod
  from public.products
  where id = new.product_id;

  if not found then
    return new;  -- FK-ul se ocupa de inexistenta; nu dublam eroarea
  end if;

  if v_prod.is_draft then
    raise exception 'Produsul "%" este ciornă și nu poate fi comandat', v_prod.name
      using errcode = 'P0001', hint = 'product_draft';
  end if;
  if v_prod.is_sold_out
     and coalesce(current_setting('menuvia.sold_out_keep_order', true), '') <> new.order_id::text then
    raise exception 'Produsul "%" este epuizat', v_prod.name
      using errcode = 'P0001', hint = 'product_sold_out';
  end if;
  if not v_prod.is_active then
    raise exception 'Produsul "%" nu este disponibil', v_prod.name
      using errcode = 'P0001', hint = 'product_inactive';
  end if;

  return new;
end;
$$;

revoke all on function public.reject_unavailable_order_item() from public, anon, authenticated, service_role;

-- ── 10. update_order_items: păstrează cantitatea deja comandată ──────────────
create or replace function public.update_order_items(
  p_order_id       uuid,
  p_items          jsonb,
  p_expected_total numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_uid    uuid := auth.uid();
  v_order         public.orders%rowtype;
  v_role          text;
  v_item          jsonb;
  v_product       record;
  v_option_ids    uuid[];
  v_valid_count   integer;
  v_unit_price    numeric(10,2);
  v_options_delta numeric(10,2);
  v_options_json  jsonb;
  v_extras_delta  numeric(10,2);
  v_extras_json   jsonb;
  v_extras_count  integer;
  v_preserved     jsonb;
  v_used          boolean[];
  v_pcount        integer;
  v_idx           integer;
  v_match_idx     integer;
  v_item_total    numeric(10,2);
  v_item_qty      integer;
  v_item_notes    text;
  v_payments_sum  numeric(10,2);
  v_items_count   integer;
  v_was_happy_hour boolean := false;
  v_hh_rule       record;
  v_hh_subtotal   numeric(10,2);
  v_hh_discount   numeric(10,2);
  v_hh_best_disc  numeric(10,2) := 0;
  v_hh_best_name  text;
  v_new_subtotal  numeric(10,2);
  v_old_items     jsonb;
  v_new_items     jsonb;
  v_old_total     numeric(10,2);
  v_group_name    text;
  v_group_min     int;
  -- mig 313: cantitățile deja comandate per produs (înainte de DELETE) și cele
  -- păstrate până acum din produsele epuizate.
  v_old_qty       jsonb;
  v_kept_qty      jsonb := '{}'::jsonb;
  v_old_n         integer;
  v_new_n         integer;
begin
  if v_caller_uid is null then
    raise exception 'update_order_items: authentication required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'update_order_items: order % not found', p_order_id;
  end if;
  v_old_total := v_order.total;

  -- ============================================================
  -- OPTIMISTIC LOCK: comanda nu s-a schimbat de la deschiderea sheet-ului
  -- ============================================================
  if p_expected_total is not null and v_order.total <> p_expected_total then
    raise exception
      'update_order_items: comanda a fost modificată între timp (total %, așteptat %). Redeschide comanda și încearcă din nou.',
      v_order.total, p_expected_total
      using errcode = '40001';
  end if;

  select role::text into v_role
  from public.restaurant_memberships
  where restaurant_id = v_order.restaurant_id
    and user_id = v_caller_uid;

  if v_role is null then
    raise exception 'update_order_items: caller is not a member of this restaurant';
  end if;
  if v_role not in ('owner', 'manager', 'waiter') then
    raise exception 'update_order_items: role % cannot edit orders', v_role;
  end if;

  -- Stari terminale: include 'closed' (nota deja decontata pe casa externa). Altfel un waiter
  -- ar putea edita prin RPC direct produsele/totalul unei comenzi inchise dupa decontare,
  -- divergand evidenta de bonul extern emis. advance_order blocheaza deja re-tranzitia din closed.
  if v_order.status in ('paid', 'cancelled', 'closed') then
    raise exception 'update_order_items: order is % — cannot edit terminal state', v_order.status;
  end if;

  select coalesce(sum(amount), 0) into v_payments_sum
  from public.order_payments
  where order_id = p_order_id;
  if v_payments_sum > 0 then
    raise exception
      'update_order_items: order has partial payments (% lei). Anulează plățile întâi.',
      v_payments_sum;
  end if;

  v_items_count := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if v_items_count = 0 then
    raise exception 'update_order_items: items array empty. Pentru anulare folosește advance_order(cancel).';
  end if;
  if v_items_count > 100 then
    raise exception 'update_order_items: too many items (max 100)';
  end if;

  v_was_happy_hour := v_order.discount_reason is not null
    and v_order.discount_reason like '%Happy Hour%';

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', product_name_snapshot,
           'qty',  quantity,
           'total', item_total
         ) order by product_name_snapshot), '[]'::jsonb)
    into v_old_items
    from public.order_items where order_id = p_order_id;

  -- ── mig 313: cât era DEJA comandat din fiecare produs (sumă pe produs, peste
  -- linii cu modificatori diferiți). Un produs epuizat între timp poate rămâne
  -- pe comandă până la această cantitate; doar ce o depășește e respins.
  select coalesce(jsonb_object_agg(s.product_id::text, s.q), '{}'::jsonb)
    into v_old_qty
    from (select product_id, sum(quantity)::int as q
            from public.order_items
           where order_id = p_order_id and product_id is not null
           group by product_id) s;

  -- ── M1 (mig 146): snapshot extras existente ÎNAINTE de delete, pentru păstrare ──
  -- pe item-urile care nu trimit 'extra_ids'. Ordinea (by id) = ordinea de inserare.
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', product_id,
           'extras',     coalesce(extras_added, '[]'::jsonb)
         ) order by id), '[]'::jsonb)
    into v_preserved
    from public.order_items where order_id = p_order_id;
  v_pcount := jsonb_array_length(v_preserved);
  v_used   := array_fill(false, array[greatest(v_pcount, 1)]);

  perform set_config('menuvia.skip_item_audit', 'on', true);

  delete from public.order_items where order_id = p_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_qty := (v_item ->> 'quantity')::integer;
    if v_item_qty is null or v_item_qty < 1 or v_item_qty > 99 then
      raise exception 'update_order_items: invalid quantity (1-99)';
    end if;

    select id, restaurant_id, name, price, is_active, is_sold_out
    into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid;

    if not found then
      raise exception 'update_order_items: product % not found', v_item ->> 'product_id';
    end if;
    if v_product.restaurant_id <> v_order.restaurant_id then
      raise exception 'update_order_items: product does not belong to this restaurant';
    end if;
    if not v_product.is_active then
      raise exception 'update_order_items: product "%" is inactive', v_product.name;
    end if;

    -- ── mig 313: produs epuizat — se păstrează DOAR cantitatea deja comandată.
    if v_product.is_sold_out is true then
      v_old_n := coalesce((v_old_qty ->> v_product.id::text)::int, 0);
      v_new_n := coalesce((v_kept_qty ->> v_product.id::text)::int, 0) + v_item_qty;
      if v_new_n > v_old_n then
        raise exception 'update_order_items: produsul "%" este epuizat — poți păstra cel mult cantitatea deja comandată (%)',
          v_product.name, v_old_n
          using errcode = 'P0001', hint = 'product_sold_out';
      end if;
      v_kept_qty := jsonb_set(v_kept_qty, array[v_product.id::text], to_jsonb(v_new_n));
    end if;

    v_unit_price := v_product.price;

    v_option_ids := array(
      select (x)::uuid
      from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as x
    );

    v_options_delta := 0;
    v_options_json  := '[]'::jsonb;

    if array_length(v_option_ids, 1) > 0 then
      -- ── FIX (mig 184, anti-furt — paritate cu create_order #1, mig 145): respinge
      -- option_ids DUPLICATE pe inputul brut, ÎNAINTE de orice join. Fără acest guard,
      -- editarea unei comenzi rămânea pe o cale de validare diferită de create_order
      -- (uuid[] + `= any()`, fără eroarea specifică `duplicate_options`) pentru aceeași
      -- clasă de bug deja reparată la creare. Verificăm pe valorile brute din JSON,
      -- exact ca guard-ul de mai jos pentru extra_ids (#2, mig 146).
      if array_length(v_option_ids, 1) <> (
           select count(distinct t.v)
           from jsonb_array_elements_text(v_item -> 'option_ids') as t(v)
         ) then
        raise exception 'update_order_items: option_ids duplicate pentru produsul "%"', v_product.name
          using errcode = 'P0001', hint = 'duplicate_options';
      end if;

      select count(*) into v_valid_count
      from public.modifier_options mo
      join public.modifier_groups mg on mg.id = mo.modifier_group_id
      join public.product_modifier_groups pmg on pmg.modifier_group_id = mg.id
      where mo.id = any(v_option_ids)
        and mo.is_available = true
        and pmg.product_id = v_product.id
        and mg.restaurant_id = v_order.restaurant_id;

      if v_valid_count <> array_length(v_option_ids, 1) then
        raise exception 'update_order_items: invalid options for product "%"', v_product.name;
      end if;

      -- Plafon de selecție pe grup — oglindă create_order (#9): editarea nu poate
      -- persista o combinație pe care calea de creare o respinge (max_select; single => 1).
      if exists (
        select 1
        from public.modifier_options mo
        join public.modifier_groups mg on mg.id = mo.modifier_group_id
        join public.product_modifier_groups pmg on pmg.modifier_group_id = mg.id
        where mo.id = any(v_option_ids)
          and mo.is_available = true
          and pmg.product_id = v_product.id
          and mg.restaurant_id = v_order.restaurant_id
        group by mg.id, mg.selection_type, mg.max_select
        having count(*) > coalesce(
                 case when mg.selection_type = 'single' then 1 else mg.max_select end,
                 2147483647)
      ) then
        raise exception 'update_order_items: prea multe opțiuni selectate într-un grup pentru produsul "%"', v_product.name
          using errcode = 'P0001', hint = 'too_many_in_group';
      end if;

      select
        coalesce(sum(mo.price_delta), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'group_id',    mg.id,
          'group_name',  mg.name,
          'option_id',   mo.id,
          'option_name', mo.name,
          'price_delta', mo.price_delta
        )), '[]'::jsonb)
      into v_options_delta, v_options_json
      from public.modifier_options mo
      join public.modifier_groups mg on mg.id = mo.modifier_group_id
      where mo.id = any(v_option_ids);
    end if;

    -- ── FIX (mig 192): MINIM pe grup — server-side (paritate create_order, mig 191).
    -- Verificăm TOATE grupurile produsului (un grup fără nicio selecție nu apare
    -- în query-urile pe v_option_ids de mai sus, deci validarea existentă nu-l
    -- vede). Regula (identică mig 191; paritate cu clientul — modifierGroupMin
    -- din src/lib/qr.ts):
    --   • minim efectiv = greatest(min_select, 1 dacă is_required), plafonat la 1
    --     pe selection_type='single' (plafonul pe grup impune oricum ≤1 acolo);
    --   • se numără doar opțiunile selectate ȘI disponibile din grup;
    --   • duplicatele au fost deja respinse (guard mig 184), iar `= any(uuid[])`
    --     nu multiplică rândurile, deci count(*) e corect;
    --   • max_select e deja gate-uit de plafonul pe grup (mig 146/184) — neatins.
    select mg.name,
           least(
             greatest(mg.min_select, case when mg.is_required then 1 else 0 end),
             case when mg.selection_type = 'single' then 1 else 32767 end
           )::int
      into v_group_name, v_group_min
      from public.product_modifier_groups pmg
      join public.modifier_groups mg on mg.id = pmg.modifier_group_id
      left join lateral (
        select count(*) as cnt
          from public.modifier_options mo
         where mo.modifier_group_id = mg.id
           and mo.id = any(v_option_ids)
           and mo.is_available = true
      ) sel on true
     where pmg.product_id = v_product.id
       and mg.restaurant_id = v_order.restaurant_id
       and (mg.is_required or mg.min_select > 0)
       and sel.cnt < least(
             greatest(mg.min_select, case when mg.is_required then 1 else 0 end),
             case when mg.selection_type = 'single' then 1 else 32767 end
           )
     order by pmg.display_order, mg.name
     limit 1;

    if v_group_name is not null then
      raise exception 'update_order_items: grupul "%" pentru produsul "%" cere cel puțin % %',
        v_group_name, v_product.name, v_group_min,
        case when v_group_min = 1 then 'opțiune selectată' else 'opțiuni selectate' end
        using errcode = 'P0001', hint = 'missing_required_group';
    end if;

    -- ── EXTRAS (mig 146, #2) ────────────────────────────────────────
    v_extras_delta := 0;
    v_extras_json  := '[]'::jsonb;

    if v_item ? 'extra_ids' then
      -- (a) client trimite explicit extra_ids
      if jsonb_array_length(coalesce(v_item -> 'extra_ids', '[]'::jsonb)) > 0 then
        -- dedup pe input brut (anti dublă-numărare, paritate cu create_order #1)
        if jsonb_array_length(v_item -> 'extra_ids') <> (
             select count(distinct t.v)
             from jsonb_array_elements_text(v_item -> 'extra_ids') as t(v)
           ) then
          raise exception 'update_order_items: extra_ids duplicate pentru produsul "%"', v_product.name;
        end if;

        select
          coalesce(sum(pe.price), 0),
          coalesce(jsonb_agg(jsonb_build_object(
            'extra_id',   pe.id,
            'extra_name', pe.name,
            'price',      pe.price
          )), '[]'::jsonb),
          count(*)
        into v_extras_delta, v_extras_json, v_extras_count
        from jsonb_array_elements_text(v_item -> 'extra_ids') eid
        join public.product_extras pe on pe.id = eid::uuid
        where pe.product_id = v_product.id
          and pe.is_available = true;

        if v_extras_count <> jsonb_array_length(v_item -> 'extra_ids') then
          raise exception 'update_order_items: extras invalide/indisponibile pentru produsul "%"', v_product.name;
        end if;
      end if;
      -- (c) extra_ids prezent dar gol → extras golite explicit (rămân []/0)
    else
      -- (b) M1: item fără 'extra_ids' → păstrăm extras existente pentru acest product_id
      v_match_idx := null;
      if v_pcount > 0 then
        for v_idx in 0 .. v_pcount - 1 loop
          if not v_used[v_idx + 1]
             and (v_preserved -> v_idx ->> 'product_id')::uuid = v_product.id then
            v_match_idx := v_idx;
            exit;
          end if;
        end loop;
      end if;
      if v_match_idx is not null then
        v_used[v_match_idx + 1] := true;
        v_extras_json := v_preserved -> v_match_idx -> 'extras';
        select coalesce(sum((e ->> 'price')::numeric), 0)
          into v_extras_delta
          from jsonb_array_elements(v_extras_json) e;
      end if;
    end if;

    v_item_total := (v_unit_price + v_options_delta + v_extras_delta) * v_item_qty;
    v_item_notes := nullif(trim(coalesce(v_item ->> 'notes', '')), '');

    -- mig 313: semnalul pentru trigger-ul 130 — DOAR pe linia păstrată a unui
    -- produs epuizat (cantitatea a fost verificată mai sus), golit imediat după.
    perform set_config('menuvia.sold_out_keep_order',
                       case when v_product.is_sold_out is true then p_order_id::text else '' end,
                       true);

    insert into public.order_items (
      order_id, product_id, product_name_snapshot, unit_price_snapshot,
      quantity, item_total, selected_modifiers, extras_added, notes
    )
    values (
      p_order_id, v_product.id, v_product.name, v_unit_price,
      v_item_qty, v_item_total, v_options_json, v_extras_json, v_item_notes
    );

    perform set_config('menuvia.sold_out_keep_order', '', true);
  end loop;

  if v_was_happy_hour then
    select coalesce(sum(item_total), 0) into v_new_subtotal
    from public.order_items where order_id = p_order_id;

    for v_hh_rule in
      select * from public.public_happy_hour_now(v_order.restaurant_id)
    loop
      if v_hh_rule.scope = 'all' then
        v_hh_subtotal := v_new_subtotal;
      elsif v_hh_rule.scope = 'category' then
        select coalesce(sum(oi.item_total), 0) into v_hh_subtotal
          from public.order_items oi
          join public.products p on p.id = oi.product_id
         where oi.order_id = p_order_id and p.category_id = v_hh_rule.category_id;
      elsif v_hh_rule.scope = 'product' then
        select coalesce(sum(oi.item_total), 0) into v_hh_subtotal
          from public.order_items oi
         where oi.order_id = p_order_id and oi.product_id = v_hh_rule.product_id;
      else
        v_hh_subtotal := 0;
      end if;

      if v_hh_subtotal <= 0 then continue; end if;

      if v_hh_rule.discount_type = 'percent' then
        v_hh_discount := round(v_hh_subtotal * v_hh_rule.discount_value / 100, 2);
      else
        v_hh_discount := least(v_hh_rule.discount_value, v_hh_subtotal);
      end if;

      if v_hh_rule.max_discount is not null and v_hh_discount > v_hh_rule.max_discount then
        v_hh_discount := v_hh_rule.max_discount;
      end if;

      if v_hh_discount > v_hh_best_disc then
        v_hh_best_disc := v_hh_discount;
        v_hh_best_name := v_hh_rule.name;
      end if;
    end loop;

    update public.orders
       set discount_type   = case when v_hh_best_disc > 0 then 'amount'::public.order_discount_type else null end,
           discount_value  = case when v_hh_best_disc > 0 then v_hh_best_disc else null end,
           discount_reason = case
             when v_hh_best_disc > 0 then '🎉 Happy Hour: ' || coalesce(v_hh_best_name, '')
             else null
           end
     where id = p_order_id;
  end if;

  perform public._refresh_order_totals(p_order_id);

  select * into v_order from public.orders where id = p_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', product_name_snapshot,
           'qty',  quantity,
           'total', item_total
         ) order by product_name_snapshot), '[]'::jsonb)
    into v_new_items
    from public.order_items where order_id = p_order_id;

  begin
    insert into public.audit_log (
      actor_id, actor_role, table_name, operation, row_id,
      restaurant_id, old_data, new_data, changed_keys
    ) values (
      v_caller_uid,
      coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user),
      'order_items', 'UPDATE', p_order_id::text,
      v_order.restaurant_id,
      jsonb_build_object('items', v_old_items, 'total', v_old_total),
      jsonb_build_object('items', v_new_items, 'total', v_order.total),
      array['items', 'total']
    );
  exception when others then
    raise warning 'update_order_items: audit summary insert failed: %', sqlerrm;
  end;

  return jsonb_build_object(
    'id',              v_order.id,
    'total',           v_order.total,
    'discount_amount', v_order.discount_amount,
    'items_count',     v_items_count
  );
end;
$$;

revoke all on function public.update_order_items(uuid, jsonb, numeric) from public, anon;
grant execute on function public.update_order_items(uuid, jsonb, numeric) to authenticated;

-- ── 11. Starea inițială: produsele cu rețetă se evaluează O DATĂ acum ───────
-- Altfel un produs deja sub porție ar rămâne „disponibil” până la prima
-- traversare de prag. Doar restaurantele cu featurea `stocks` pot fi atinse.
-- Apel DIRECT (nu prin coadă): suntem în tranzacția migrației.
do $$
declare v_n integer;
begin
  v_n := public.recalc_products_sold_out(array(select distinct product_id from public.recipes));
  raise notice 'mig 313: % produse marcate/actualizate din stoc la aplicare', v_n;
end $$;

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_fn   text;
  v_src  text;
  v_n    int;
begin
  -- Funcțiile noi: DEFINER + search_path = public, pg_temp.
  foreach v_fn in array array[
    'public.product_stock_short(uuid)',
    'public.recalc_products_sold_out(uuid[])',
    'public.normalize_product_sold_out()',
    'public.ingredients_sold_out_stmt()',
    'public.recipes_sold_out_stmt()',
    'public.flush_products_sold_out_queue()',
    'public.set_product_sold_out(uuid,boolean)',
    'public.get_menu_version(uuid)',
    'public.reject_unavailable_order_item()',
    'public.update_order_items(uuid,jsonb,numeric)'
  ] loop
    if not exists (select 1 from pg_proc where oid = v_fn::regprocedure and prosecdef
                     and proconfig @> array['search_path=public, pg_temp']) then
      raise exception 'mig 313: % nu e DEFINER cu search_path = public, pg_temp', v_fn;
    end if;
  end loop;

  -- Interne + funcțiile de trigger: niciun rol client (RP13 + helperi).
  foreach v_fn in array array[
    'public.product_stock_short(uuid)',
    'public.recalc_products_sold_out(uuid[])',
    'public.normalize_product_sold_out()',
    'public.ingredients_sold_out_stmt()',
    'public.recipes_sold_out_stmt()',
    'public.flush_products_sold_out_queue()',
    'public.reject_unavailable_order_item()'
  ] loop
    if has_function_privilege('anon', v_fn::regprocedure, 'execute')
       or has_function_privilege('authenticated', v_fn::regprocedure, 'execute') then
      raise exception 'mig 313: % e executabilă de un rol client', v_fn;
    end if;
  end loop;

  if not has_function_privilege('authenticated', 'public.set_product_sold_out(uuid,boolean)', 'execute')
     or has_function_privilege('anon', 'public.set_product_sold_out(uuid,boolean)', 'execute') then
    raise exception 'mig 313: set_product_sold_out trebuie să fie DOAR pentru authenticated';
  end if;
  if not has_function_privilege('anon', 'public.get_menu_version(uuid)', 'execute') then
    raise exception 'mig 313: get_menu_version trebuie să fie apelabilă de anon (meniul public)';
  end if;

  -- Triggerele de stoc: toate cele 4 există și sunt STATEMENT-level.
  select count(*) into v_n
    from pg_trigger
   where not tgisinternal
     and (tgrelid, tgname) in (('public.ingredients'::regclass, 'trg_ingredients_sold_out_upd'),
                               ('public.recipes'::regclass, 'trg_recipes_sold_out_ins'),
                               ('public.recipes'::regclass, 'trg_recipes_sold_out_upd'),
                               ('public.recipes'::regclass, 'trg_recipes_sold_out_del'))
     and (tgtype & 1) = 0;
  if v_n <> 4 then
    raise exception 'mig 313: aștept 4 triggere de stoc FOR EACH STATEMENT, găsit %', v_n;
  end if;

  -- Recalcularea e AMÂNATĂ la commit: constraint trigger DEFERRABLE INITIALLY
  -- DEFERRED pe coadă (AFTER INSERT ROW = tgtype 5); triggerele de semnal NU
  -- recalculează în statement, iar recalcularea lock-uiește ordonat, fără
  -- așteptare.
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.products_sold_out_queue'::regclass
                    and tgname = 'trg_products_sold_out_queue_flush'
                    and tgconstraint <> 0 and tgdeferrable and tginitdeferred
                    and tgtype = 5) then
    raise exception 'mig 313: trg_products_sold_out_queue_flush nu e constraint trigger DEFERRABLE INITIALLY DEFERRED';
  end if;
  foreach v_fn in array array['public.ingredients_sold_out_stmt()', 'public.recipes_sold_out_stmt()'] loop
    v_src := (select prosrc from pg_proc where oid = v_fn::regprocedure);
    if position('recalc_products_sold_out' in v_src) > 0
       or position('products_sold_out_queue' in v_src) = 0 then
      raise exception 'mig 313: % trebuie doar să pună în coadă, nu să recalculeze în statement', v_fn;
    end if;
  end loop;
  v_src := (select prosrc from pg_proc where oid = 'public.recalc_products_sold_out(uuid[])'::regprocedure);
  if position('skip locked' in v_src) = 0 or position('order by p.id' in v_src) = 0 then
    raise exception 'mig 313: recalc_products_sold_out trebuie să lock-uiască ordonat cu skip locked';
  end if;
  if has_table_privilege('authenticated', 'public.products_sold_out_queue', 'select,insert,update,delete')
     or has_table_privilege('anon', 'public.products_sold_out_queue', 'select,insert,update,delete')
     or not (select relrowsecurity from pg_class where oid = 'public.products_sold_out_queue'::regclass) then
    raise exception 'mig 313: products_sold_out_queue trebuie să fie deny-all (RLS + fără privilegii client)';
  end if;

  -- update_order_items: o singură semnătură, invariantele 146/184/192 + 313.
  select count(*) into v_n from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'update_order_items';
  if v_n <> 1 then
    raise exception 'mig 313: update_order_items are % overload-uri (aștept 1)', v_n;
  end if;
  v_src := pg_get_functiondef('public.update_order_items(uuid,jsonb,numeric)'::regprocedure);
  if position('missing_required_group' in v_src) = 0 or position('duplicate_options' in v_src) = 0
     or position('too_many_in_group' in v_src) = 0 or position('v_preserved' in v_src) = 0
     or position('cannot edit terminal state' in v_src) = 0 or position('40001' in v_src) = 0
     or position('product_extras' in v_src) = 0 then
    raise exception 'mig 313: update_order_items a pierdut un invariant din 146/184/192';
  end if;
  if position('product_sold_out' in v_src) = 0 or position('sold_out_keep_order' in v_src) = 0 then
    raise exception 'mig 313: update_order_items fără păstrarea cantității epuizate';
  end if;
  if has_function_privilege('anon', 'public.update_order_items(uuid,jsonb,numeric)', 'execute') then
    raise exception 'mig 313: anon NU trebuie să poată executa update_order_items';
  end if;

  -- Trigger-ul 130 rămâne pe order_items, cu hint-ul lui.
  if not exists (select 1 from pg_trigger where tgname = 'trg_reject_unavailable_order_item'
                    and tgrelid = 'public.order_items'::regclass and not tgisinternal) then
    raise exception 'mig 313: trg_reject_unavailable_order_item a dispărut';
  end if;
  v_src := pg_get_functiondef('public.reject_unavailable_order_item()'::regprocedure);
  if position('product_sold_out' in v_src) = 0 or position('product_draft' in v_src) = 0
     or position('product_inactive' in v_src) = 0 then
    raise exception 'mig 313: reject_unavailable_order_item a pierdut un hint din 130';
  end if;

  raise notice 'mig 313: epuizat din stoc + set_product_sold_out + get_menu_version OK';
end $$;

commit;

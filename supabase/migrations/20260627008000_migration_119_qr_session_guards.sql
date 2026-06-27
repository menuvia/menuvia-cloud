-- Migration 119: Gărzi server-side pentru QR — masă dezactivată + rotație token
-- ─────────────────────────────────────────────────────────────────────
-- Context (audit QR, 2026-06-27): două scurgeri de control existau DOAR în UI:
--
--   QR-2  Dezactivarea unei mese (tables.is_active=false) din TablesManager
--         (toggleActive) NU avea efect server-side. resolve_qr_token (mig
--         022→024), open_table_session (mig 084) și create_order (mig 084)
--         nu verifică tables.is_active, deci QR-ul unei mese „dezactivate"
--         rămânea pe deplin funcțional: scanare → sesiune → comandă.
--
--   QR-3  Rotația token-ului (rotateToken) face în client două operații
--         separate (UPDATE is_active=false pe vechi + INSERT token nou).
--         Dacă INSERT-ul reușește dar UPDATE-ul a eșuat / a fost ocolit (alt
--         client, scriere directă, eroare de rețea între cele două), masa
--         rămânea cu DOUĂ token-uri active simultan → vechiul QR tipărit
--         încă deschidea sesiuni. Nu exista nicio garanție „un singur token
--         activ per masă" la nivel de DB.
--
-- Fix-uri MINIM invazive (fără a recrea RPC-urile mari open_table_session /
-- create_order — vezi capcana 085/087 din CLAUDE.md): triggere BEFORE INSERT
-- + index parțial unic. Acoperă și orice cale de scriere viitoare, nu doar
-- RPC-ul/clientul curent.
-- ─────────────────────────────────────────────────────────────────────

begin;

-- ═══════════════════════════════════════════════════════════════
-- QR-2: masă inactivă → nicio sesiune nouă
-- ═══════════════════════════════════════════════════════════════
-- open_table_session (mig 084) e singura cale legitimă de a deschide o
-- sesiune (SECURITY DEFINER, apelată de anon la scanare). În loc să-i
-- recopiem cele ~80 de linii, punem garda pe INSERT-ul în table_sessions:
-- orice sesiune nouă pe o masă cu is_active=false e respinsă. Cum create_order
-- pentru source='qr' cere o sesiune 'open' validă (mig 084 §4.3), blocarea
-- deschiderii sesiunii sigilează implicit întreg fluxul de comandă QR.
create or replace function public.trg_reject_session_on_inactive_table()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_active boolean;
begin
  select is_active into v_active
  from public.tables
  where id = new.table_id;

  -- Masa lipsește (FK ar prinde oricum) sau e dezactivată → respinge.
  if v_active is distinct from true then
    raise exception 'Masa este dezactivată. Nu se pot deschide sesiuni noi pe această masă.'
      using errcode = 'P0001', hint = 'table_inactive';
  end if;

  return new;
end;
$$;

drop trigger if exists table_sessions_reject_inactive_table on public.table_sessions;
create trigger table_sessions_reject_inactive_table
  before insert on public.table_sessions
  for each row
  execute function public.trg_reject_session_on_inactive_table();

comment on trigger table_sessions_reject_inactive_table on public.table_sessions is
  $$QR-2 (mig 119): respinge deschiderea unei sesiuni pe o masă dezactivată.
  Sigilează fluxul QR la nivel de DB — open_table_session nu verifica is_active.$$;

-- ═══════════════════════════════════════════════════════════════
-- QR-3: un singur token QR activ per masă
-- ═══════════════════════════════════════════════════════════════
-- 1) Normalizare a stării existente: dacă vreo masă are deja >1 token activ
--    (din rotări vechi ne-atomice), păstrăm cel mai recent activ și
--    dezactivăm restul. Necesar înainte de a putea crea indexul unic parțial.
with ranked as (
  select id,
         row_number() over (
           partition by table_id
           order by created_at desc, id desc
         ) as rn
  from public.qr_tokens
  where is_active = true
)
update public.qr_tokens q
   set is_active = false
  from ranked
 where q.id = ranked.id
   and ranked.rn > 1;

-- 2) Trigger BEFORE INSERT: la inserarea unui token nou activ pe o masă,
--    dezactivează automat token-urile active anterioare ale aceleiași mese.
--    Rotația devine astfel atomică server-side, indiferent de client.
create or replace function public.trg_single_active_qr_token()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_active = true then
    update public.qr_tokens
       set is_active = false
     where table_id = new.table_id
       and is_active = true
       and id <> new.id;  -- noul rând nu e încă vizibil aici, dar e defensiv
  end if;

  return new;
end;
$$;

drop trigger if exists qr_tokens_single_active on public.qr_tokens;
create trigger qr_tokens_single_active
  before insert on public.qr_tokens
  for each row
  execute function public.trg_single_active_qr_token();

comment on trigger qr_tokens_single_active on public.qr_tokens is
  $$QR-3 (mig 119): un token nou activ dezactivează token-urile active vechi ale
  aceleiași mese → rotație atomică, vechiul QR tipărit nu mai funcționează.$$;

-- 3) Plasă de siguranță la nivel de schemă: cel mult un token activ per masă.
--    Trigger-ul de mai sus garantează respectarea ei pe calea normală; indexul
--    prinde orice scriere care l-ar ocoli (ex. UPDATE is_active=true direct).
create unique index if not exists qr_tokens_one_active_per_table
  on public.qr_tokens(table_id)
  where is_active = true;

-- ═══════════════════════════════════════════════════════════════
-- Asserții inline (rulate la aplicarea migrației pe Postgres efemer)
-- ═══════════════════════════════════════════════════════════════
do $$
declare
  v_has_sess_trg boolean;
  v_has_tok_trg  boolean;
  v_has_idx      boolean;
begin
  select exists (
    select 1 from pg_trigger
    where tgrelid = 'public.table_sessions'::regclass
      and tgname  = 'table_sessions_reject_inactive_table'
  ) into v_has_sess_trg;

  select exists (
    select 1 from pg_trigger
    where tgrelid = 'public.qr_tokens'::regclass
      and tgname  = 'qr_tokens_single_active'
  ) into v_has_tok_trg;

  select exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'qr_tokens'
      and indexname  = 'qr_tokens_one_active_per_table'
  ) into v_has_idx;

  if not v_has_sess_trg then
    raise exception 'mig 119: lipsește trigger-ul table_sessions_reject_inactive_table';
  end if;
  if not v_has_tok_trg then
    raise exception 'mig 119: lipsește trigger-ul qr_tokens_single_active';
  end if;
  if not v_has_idx then
    raise exception 'mig 119: lipsește indexul qr_tokens_one_active_per_table';
  end if;

  raise notice 'mig 119: gărzi QR (masă inactivă + un singur token activ/masă) OK';
end $$;

commit;

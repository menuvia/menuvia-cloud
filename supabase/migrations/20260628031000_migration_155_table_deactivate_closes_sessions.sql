-- mig 155 — dezactivarea unei mese închide sesiunile deschise (#21)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-4 (#21). Când o masă era dezactivată (tables.is_active → false), sesiunile
-- de masă deschise (table_sessions.status='open') rămâneau deschise → clienții QR cu o sesiune
-- veche puteau continua să comande pe o masă scoasă din uz. Închidem automat sesiunile
-- deschise la dezactivare.
--
-- Trigger AFTER UPDATE pe tables, doar pe tranziția is_active true→false. Nu interferează cu
-- trg_maybe_close_session (mig 084), care închide sesiunea când comenzile devin terminale —
-- aici e o cale ortogonală (dezactivare administrativă a mesei).
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout = '10s';

create or replace function public.close_sessions_on_table_deactivate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.table_sessions
     set status = 'closed', closed_at = now()
   where table_id = new.id
     and status = 'open';
  return new;
end;
$$;
revoke all on function public.close_sessions_on_table_deactivate() from public;

drop trigger if exists trg_close_sessions_on_table_deactivate on public.tables;
create trigger trg_close_sessions_on_table_deactivate
  after update on public.tables
  for each row
  when (old.is_active is distinct from new.is_active and new.is_active = false)
  execute function public.close_sessions_on_table_deactivate();

-- ── Asserție fail-closed ─────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_close_sessions_on_table_deactivate'
                  and tgrelid='public.tables'::regclass and not tgisinternal) then
    raise exception 'mig 155: triggerul de închidere sesiuni la dezactivare lipsește';
  end if;
  raise notice 'mig 155: dezactivarea mesei închide sesiunile deschise (#21) OK';
end $$;

commit;

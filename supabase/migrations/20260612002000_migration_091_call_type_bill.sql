-- Migration 091: „Cere nota" — tip de apel pe waiter_calls
-- ─────────────────────────────────────────────────────────────────────
-- UX pagina QR client (Zona 3): clientul are două acțiuni distincte —
-- „Cheamă ospătar" și „Cere nota". Ospătarul trebuie să ȘTIE de ce e
-- chemat, altfel face două drumuri.
--
-- Extensie aditivă, backwards-compatible:
--   • coloană call_type ('waiter' | 'bill'), default 'waiter' — rândurile
--     vechi rămân valide fără backfill
--   • call_waiter primește p_call_type opțional (default 'waiter') —
--     apelurile existente cu 1 argument funcționează neschimbat
--   • rate limit-ul devine per masă + TIP: un „cheamă ospătar" pending
--     nu blochează un „cere nota" (sunt nevoi diferite)
-- Zero schimbări la token-uri / validare QR / RLS.
-- ─────────────────────────────────────────────────────────────────────

alter table public.waiter_calls
  add column if not exists call_type text not null default 'waiter'
  check (call_type in ('waiter', 'bill'));

-- Semnătura veche (1-arg) trebuie drop-uită explicit: CREATE OR REPLACE
-- cu altă semnătură ar lăsa două overload-uri și PostgREST ar da
-- "function is not unique" la apelurile cu un singur parametru.
drop function if exists public.call_waiter(uuid);

create or replace function public.call_waiter(
  p_qr_token_id uuid,
  p_call_type   text default 'waiter'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token    record;
  v_call_id  uuid;
begin
  if p_call_type not in ('waiter', 'bill') then
    raise exception 'Tip de apel invalid.';
  end if;

  -- Validare token QR (identic cu mig 016)
  select qt.id, qt.restaurant_id, qt.table_id
  into v_token
  from public.qr_tokens qt
  where qt.id = p_qr_token_id
    and qt.is_active = true;

  if not found then
    raise exception 'QR token invalid sau expirat.';
  end if;

  -- Rate limit: max 1 apel pending per masă per TIP per 5 minute
  if exists (
    select 1 from public.waiter_calls
    where table_id = v_token.table_id
      and call_type = p_call_type
      and status = 'pending'
      and created_at > now() - interval '5 minutes'
  ) then
    return jsonb_build_object(
      'ok', true,
      'message', case p_call_type
        when 'bill' then 'Nota a fost deja cerută.'
        else 'Ospătarul a fost deja chemat.'
      end
    );
  end if;

  insert into public.waiter_calls (restaurant_id, table_id, qr_token_id, call_type)
  values (v_token.restaurant_id, v_token.table_id, p_qr_token_id, p_call_type)
  returning id into v_call_id;

  return jsonb_build_object('ok', true, 'call_id', v_call_id);
end;
$$;

grant execute on function public.call_waiter(uuid, text) to anon, authenticated;

comment on function public.call_waiter(uuid, text) is
  $$Apel client de la masă: 'waiter' (cheamă ospătar) sau 'bill' (cere nota).
  Rate limit 1 pending/masă/tip/5min. Anon allowed (vine din QR).$$;

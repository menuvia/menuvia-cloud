-- mig 196 — submit_order_feedback acceptă și comenzile 'closed' (Plan 2)
-- ─────────────────────────────────────────────────────────────────────
-- Bug găsit la implementarea review funnel-ului (Val A, docs/COMPETITIE.md):
-- OrderTracker afișează ecranul de feedback + Google review și pentru
-- comenzile 'closed' (Plan 2, închidere non-fiscală — exact segmentul țintă),
-- dar RPC-ul (mig 094) accepta doar 'served'/'paid' → feedback-ul clienților
-- Plan 2 era respins server-side, cu eroarea înghițită silențios în client.
--
-- Recreare VERBATIM din corpul mig 094 (session-gate, plafon 24h, trunchiere
-- 500 chars, upsert pe (order_id, feedback_type)), cu o SINGURĂ deltă:
-- 'closed' intră în lista de statusuri acceptate. Semnătura, grant-urile și
-- search_path rămân identice.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

create or replace function public.submit_order_feedback(
  p_order_id      uuid,
  p_feedback_type text,
  p_rating        int,
  p_comment       text default null,
  p_session_id    uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_order_status  text;
  v_age_hours     numeric;
  v_session_id    uuid;
begin
  if p_feedback_type not in ('payment', 'service', 'food') then
    raise exception 'Tip feedback invalid';
  end if;
  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating invalid (1-5)';
  end if;

  select restaurant_id, status, session_id,
         extract(epoch from (now() - created_at)) / 3600
    into v_restaurant_id, v_order_status, v_session_id, v_age_hours
    from public.orders
   where id = p_order_id;

  if v_restaurant_id is null then
    raise exception 'Comandă inexistentă';
  end if;

  -- ★ Session-gate (mig 094) — comenzile de la masă cer sesiune validă.
  -- Pickup/legacy (session_id NULL pe orders) păstrează comportamentul.
  if v_session_id is not null
     and (p_session_id is null
          or not public._order_session_valid(p_order_id, p_session_id)) then
    raise exception 'Sesiunea mesei nu mai este validă.'
      using errcode = 'P0001', hint = 'session_required';
  end if;

  if v_age_hours > 24 then
    raise exception 'Comandă prea veche pentru feedback';
  end if;
  -- mig 196: + 'closed' — Plan 2 închide masa non-fiscal, dar clientul
  -- trebuie să poată lăsa feedback/recenzie exact ca la 'paid'.
  if v_order_status not in ('served', 'paid', 'closed') then
    raise exception 'Feedback acceptat doar după servire';
  end if;

  if p_comment is not null then
    p_comment := nullif(trim(p_comment), '');
    if length(p_comment) > 500 then
      p_comment := substring(p_comment, 1, 500);
    end if;
  end if;

  insert into public.order_feedback
    (order_id, restaurant_id, feedback_type, rating, comment)
  values
    (p_order_id, v_restaurant_id, p_feedback_type, p_rating, p_comment)
  on conflict (order_id, feedback_type)
  do update set
    rating     = excluded.rating,
    comment    = excluded.comment,
    created_at = now();
end;
$$;

revoke all on function public.submit_order_feedback(uuid, text, int, text, uuid) from public;
grant execute on function public.submit_order_feedback(uuid, text, int, text, uuid) to anon, authenticated;

-- ── Asserții fail-closed ────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'submit_order_feedback';
  if v_def is null then
    raise exception 'mig 196: submit_order_feedback lipsește';
  end if;
  -- Delta nouă prezentă:
  if v_def !~ '''closed''' then
    raise exception 'mig 196: statusul closed nu e acceptat';
  end if;
  -- Guard-urile din mig 094 NU s-au pierdut:
  if v_def !~ 'session_required' or v_def !~ '_order_session_valid' then
    raise exception 'mig 196: session-gate-ul din mig 094 s-a pierdut';
  end if;
  if v_def !~ 'prea veche' then
    raise exception 'mig 196: plafonul de 24h s-a pierdut';
  end if;
  raise notice 'mig 196: feedback pe comenzile closed OK (session-gate intact)';
end $$;

commit;

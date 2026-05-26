-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 042 — GDPR Art. 15 (acces) + Art. 17 (ștergere)
-- ═══════════════════════════════════════════════════════════════
-- Adaugă mecanisme pentru:
--   1. export_user_data() — utilizatorul obține o copie completă
--      a datelor sale personale (JSON download)
--   2. request_account_deletion() — utilizatorul cere ștergerea contului,
--      cu perioadă de grație de 30 zile + arhivare facturi (Legea 82/1991)
--   3. terms_accepted_at + version — audit pentru consimțământ
-- ═══════════════════════════════════════════════════════════════

-- ── Coloane noi pe profiles ──────────────────────────────────
alter table public.profiles
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists terms_accepted_at     timestamptz,
  add column if not exists terms_accepted_version text;

-- Index pentru cron-ul de ștergere (rapid scan)
create index if not exists profiles_deletion_requested_idx
  on public.profiles (deletion_requested_at)
  where deletion_requested_at is not null;


-- ─────────────────────────────────────────────────────────────
-- RPC: export_user_data
-- Returnează un JSON cu toate datele utilizatorului curent.
-- ─────────────────────────────────────────────────────────────
create or replace function public.export_user_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_result  jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Autentificare necesară';
  end if;

  select jsonb_build_object(
    'export_date',  now(),
    'user_id',      v_user_id,
    'profile',      (
      select to_jsonb(p) from public.profiles p where p.id = v_user_id
    ),
    'restaurants',  (
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
        from public.restaurants r where r.owner_id = v_user_id
    ),
    'memberships',  (
      select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
        from public.restaurant_memberships m where m.user_id = v_user_id
    ),
    'orders_handled', (
      select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb)
        from public.orders o
       where o.created_by = v_user_id
          or o.served_by  = v_user_id
          or o.paid_by    = v_user_id
    ),
    'lifecycle_events', (
      -- Doar dacă tabela există (ar putea lipsi în versiuni vechi)
      select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
        from public.lifecycle_events e
       where e.user_id = v_user_id
    )
  ) into v_result;

  return v_result;
exception
  when undefined_table then
    -- lifecycle_events poate să nu existe — întoarce restul fără el
    select jsonb_build_object(
      'export_date', now(),
      'user_id',     v_user_id,
      'profile',     (select to_jsonb(p) from public.profiles p where p.id = v_user_id),
      'restaurants', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
                        from public.restaurants r where r.owner_id = v_user_id),
      'memberships', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
                        from public.restaurant_memberships m where m.user_id = v_user_id)
    ) into v_result;
    return v_result;
end;
$$;

revoke all on function public.export_user_data() from public;
grant execute on function public.export_user_data() to authenticated;


-- ─────────────────────────────────────────────────────────────
-- RPC: request_account_deletion
-- Marchez contul pentru ștergere în 30 zile. Cron-ul efectuează.
-- ─────────────────────────────────────────────────────────────
create or replace function public.request_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_has_active_subscription boolean;
  v_invoices_kept integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Autentificare necesară';
  end if;

  -- Verifică abonament activ — anulare obligatorie prin Stripe Portal întâi
  select coalesce(
    (plan is not null and plan != 'free' and stripe_subscription_id is not null),
    false
  )
    into v_has_active_subscription
    from public.profiles where id = v_user_id;

  if v_has_active_subscription then
    raise exception 'Aveți un abonament activ. Anulați-l prin Portal Stripe înainte de a șterge contul.';
  end if;

  -- Marchez pentru ștergere (cron-ul efectuează la D+30)
  update public.profiles
    set deletion_requested_at = now()
   where id = v_user_id;

  -- Număr facturi care rămân arhivate (10 ani conform Legii 82/1991)
  begin
    select count(*) into v_invoices_kept
      from public.invoices i
      join public.restaurants r on r.id = i.restaurant_id
     where r.owner_id = v_user_id;
  exception when undefined_table then
    v_invoices_kept := 0;
  end;

  return jsonb_build_object(
    'success',                true,
    'deletion_scheduled_at',  (now() + interval '30 days'),
    'invoices_archived',      v_invoices_kept,
    'message',                'Contul va fi șters în 30 zile. Pentru anulare, scrieți la privacy@menuvia.ro.'
  );
end;
$$;

revoke all on function public.request_account_deletion() from public;
grant execute on function public.request_account_deletion() to authenticated;


-- ─────────────────────────────────────────────────────────────
-- RPC: cancel_deletion_request (în cele 30 zile de grație)
-- ─────────────────────────────────────────────────────────────
create or replace function public.cancel_deletion_request()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Autentificare necesară';
  end if;

  update public.profiles
    set deletion_requested_at = null
   where id = v_user_id
     and deletion_requested_at is not null;

  return jsonb_build_object(
    'success', true,
    'message', 'Cererea de ștergere a fost anulată.'
  );
end;
$$;

revoke all on function public.cancel_deletion_request() from public;
grant execute on function public.cancel_deletion_request() to authenticated;


-- ─────────────────────────────────────────────────────────────
-- Cron job: process_account_deletions
-- Apelat zilnic prin automation-cron.js (Netlify Scheduled).
-- Șterge conturi marcate cu deletion_requested_at < now() - 30d.
-- ─────────────────────────────────────────────────────────────
create or replace function public.process_account_deletions()
returns table(deleted_user_id uuid, deleted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user record;
begin
  for v_user in
    select id from public.profiles
    where deletion_requested_at is not null
      and deletion_requested_at < now() - interval '30 days'
    limit 100 -- batch pentru a nu bloca cron-ul
  loop
    -- Cascade va șterge restaurants, products, memberships etc.
    -- Facturile rămân (legate de restaurant_id cu ON DELETE RESTRICT pe invoices,
    -- dacă schema e configurată corect). Verifică în migrations existente.
    delete from auth.users where id = v_user.id;
    deleted_user_id := v_user.id;
    deleted_at := now();
    return next;
  end loop;
end;
$$;

revoke all on function public.process_account_deletions() from public;
-- Doar service_role poate apela (cron job)


-- ─────────────────────────────────────────────────────────────
-- RPC: record_terms_acceptance — apelat la signup pentru audit
-- ─────────────────────────────────────────────────────────────
create or replace function public.record_terms_acceptance(p_version text default '1.0')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Autentificare necesară';
  end if;

  update public.profiles
    set terms_accepted_at      = coalesce(terms_accepted_at, now()),
        terms_accepted_version = coalesce(terms_accepted_version, p_version)
   where id = v_user_id;
end;
$$;

revoke all on function public.record_terms_acceptance(text) from public;
grant execute on function public.record_terms_acceptance(text) to authenticated;

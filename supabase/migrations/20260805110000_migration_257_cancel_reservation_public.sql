-- Migration 257: anularea PUBLICĂ a rezervării pe cod de confirmare
--
-- Finding MARE din auditul pe capitole: fără flux public de anulare, o parte
-- din no-show-uri sunt clienți care AR FI anulat — produsul își umflă singur
-- metrica pe care promite s-o rezolve, iar `confirmation_code` (mig 057) era
-- pur decorativ. RPC-ul de față îl transformă în bearer token de anulare.
--
-- Securitate (aceeași disciplină ca cele 7 RPC-uri DEFINER din lockdown):
--  • SECURITY DEFINER, search_path = public, pg_temp, returns jsonb,
--    PUBLIC zero EXECUTE, grant anon + authenticated (fluxul e public).
--  • Rate-limit prin check_rate_limit (mig 038): 15 încercări / 15 min per
--    restaurant — spațiul codului e 16^8 (~4,3 mld), brute-force-ul devine
--    irelevant; scope-ul pe slug previne și enumerarea în masă.
--  • ANTI-ORACLE: slug greșit, cod greșit sau rezervare inexistentă întorc
--    TOATE același hint `invalid_code` — un anonim nu poate sonda nimic.
--  • Anulabile DOAR pending/confirmed cu starts_at în viitor; restul →
--    `not_cancellable` (fără să dezvăluie statusul real).
--  • Emailul către owner e best-effort (exception-wrapped): un blip pe coada
--    de email NU blochează anularea clientului. Kind-ul vine din mig 256.

begin;

create or replace function public.cancel_reservation_by_code(
  p_slug text,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_rest_name     text;
  v_owner_id      uuid;
  v_owner_email   text;
  v_owner_name    text;
  v_res           public.reservations%rowtype;
  v_code          text := upper(trim(coalesce(p_code, '')));
  v_slug          text := lower(trim(coalesce(p_slug, '')));
begin
  if v_slug = '' or v_code = '' then
    return jsonb_build_object('ok', false, 'hint', 'invalid_code');
  end if;

  -- Rate-limit per restaurant (slug), înaintea oricărei citiri utile.
  if not public.check_rate_limit('cancel_reservation_public', v_slug, 15, 15) then
    return jsonb_build_object('ok', false, 'hint', 'rate_limited');
  end if;

  select r.id, r.name, r.owner_id
    into v_restaurant_id, v_rest_name, v_owner_id
    from public.restaurants r
   where r.slug = v_slug and r.is_active = true;

  if v_restaurant_id is null then
    -- Același răspuns ca la cod greșit — fără oracle de existență a slugului.
    return jsonb_build_object('ok', false, 'hint', 'invalid_code');
  end if;

  select * into v_res
    from public.reservations
   where restaurant_id = v_restaurant_id
     and upper(confirmation_code) = v_code;

  if v_res.id is null then
    return jsonb_build_object('ok', false, 'hint', 'invalid_code');
  end if;

  if v_res.status not in ('pending', 'confirmed') or v_res.starts_at <= now() then
    return jsonb_build_object('ok', false, 'hint', 'not_cancellable');
  end if;

  update public.reservations
     set status = 'cancelled'
   where id = v_res.id;

  -- Owner-ul află de anulare (perechea notificării din mig 255) — best-effort.
  begin
    select p.email, p.full_name into v_owner_email, v_owner_name
      from public.profiles p where p.id = v_owner_id;
    if v_owner_email is not null then
      perform public.enqueue_email(
        v_owner_email,
        'reservation_cancelled'::email_template_kind,
        jsonb_build_object(
          'restaurant_name', v_rest_name,
          'customer_name',   v_res.customer_name,
          'customer_phone',  v_res.customer_phone,
          'party_size',      v_res.party_size,
          'starts_at',       v_res.starts_at
        ),
        v_owner_id,
        v_owner_name,
        null,
        'resv_cancelled:' || v_res.id::text
      );
    end if;
  exception when others then
    raise warning 'email owner anulare rezervare % a esuat: %', v_res.id, sqlerrm;
  end;

  return jsonb_build_object('ok', true, 'starts_at', v_res.starts_at);
end;
$$;

revoke all on function public.cancel_reservation_by_code(text, text) from public;
grant execute on function public.cancel_reservation_by_code(text, text) to anon, authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.cancel_reservation_by_code(text, text)'::regprocedure);
  if v_def !~* 'check_rate_limit' then
    raise exception 'mig 257: RPC-ul de anulare a rămas fără rate-limit';
  end if;
  if v_def !~* 'search_path' then
    raise exception 'mig 257: search_path lipsă';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'email_template_kind' and e.enumlabel = 'reservation_cancelled'
  ) then
    raise exception 'mig 257: enum-ul reservation_cancelled lipsește (mig 256?)';
  end if;
end $$;

commit;

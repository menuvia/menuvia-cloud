-- Migration 327: emailurile de rezervare către owner poartă RESTAURANTUL (lotul L8a)
--
-- Problema: `reservation_created` (mig 255) și `reservation_cancelled` (mig
-- 257) intrau în coadă fără să spună la ce local e rezervarea, deci worker-ul
-- de email (process-email-queue.js) le afișa ora pe București la ORICE fus —
-- un local din Londra vedea „21:30” pentru o rezervare la 19:30, adică altă
-- oră decât arată fila Rezervări (fusul OPERAȚIONAL, `restaurant_time_zone`,
-- mig 324). Worker-ul nou citește `template_data.restaurant_id` și rezolvă
-- fusul (+ limba de bază, + țara) printr-o singură interogare pe lot.
--
-- Ce face: adaugă `'restaurant_id'` la FINALUL `jsonb_build_object` din ambele
-- funcții. Nimic altceva nu se schimbă.
--
-- Lanțuri: `trg_email_on_reservation_created` 255→327 și
-- `cancel_reservation_by_code` 257→327 — corpurile sunt copii VERBATIM ale
-- definițiilor vii (nicio migrație ulterioară nu le-a recreat; 262 a pus
-- `pg_temp`, pe care ambele îl aveau deja). `create or replace` cu ACEEAȘI
-- semnătură, FĂRĂ DROP: ACL-ul viu se păstrează (RPC-ul rămâne în allowlist-ul
-- anon AH1, mig 297), iar trigger-ul nu se recreează. `set search_path` e
-- scris explicit fiindcă `create or replace` rescrie `proconfig`.
--
-- Invariante păstrate (asertate mai jos, fail-closed, și permanent în
-- tests/sql/auto/327_reservation_email_restaurant_id.sql):
--   trigger: DEFINER `public, pg_temp`, guard pe email null, exception-wrapper
--            (un eșec de notificare NU avortează rezervarea, ca SQ9/RN3),
--            revoke pe PUBLIC/anon/authenticated;
--   RPC:     DEFINER `public, pg_temp`, rate-limit DOAR pe încercările
--            invalide, anti-oracle (`invalid_code` identic), predicatul de
--            status în UPDATE (anti-TOCTOU), emailul best-effort, PUBLIC fără
--            EXECUTE, anon + authenticated cu EXECUTE.
--
-- Toleranță: cheia nouă e ignorată de un worker vechi; un worker nou fără 327
-- (cheie lipsă) afișează ora pe București, exact ca înainte. Ordinea pe
-- producție: DUPĂ 326.

begin;

-- ── 1. trg_email_on_reservation_created (255 → 327) ─────────────────────────
create or replace function public.trg_email_on_reservation_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rest_name   text;
  v_owner_id    uuid;
  v_owner_email text;
  v_owner_name  text;
begin
  begin
    select r.name, r.owner_id, p.email, p.full_name
      into v_rest_name, v_owner_id, v_owner_email, v_owner_name
      from public.restaurants r
      left join public.profiles p on p.id = r.owner_id
     where r.id = new.restaurant_id;

    -- Owner fără email în profil = nu avem unde trimite; skip tăcut (nu raise:
    -- rezervarea clientului nu are voie să depindă de igiena profilului).
    if v_owner_email is null then
      return null;
    end if;

    perform public.enqueue_email(
      v_owner_email,
      'reservation_created'::email_template_kind,
      jsonb_build_object(
        'restaurant_name',   v_rest_name,
        'customer_name',     new.customer_name,
        'customer_phone',    new.customer_phone,
        'party_size',        new.party_size,
        'starts_at',         new.starts_at,
        'status',            new.status,
        'source',            new.source,
        'special_requests',  new.special_requests,
        'confirmation_code', new.confirmation_code,
        -- Lotul L8a: worker-ul afișează ora pe fusul LOCALULUI.
        'restaurant_id',     new.restaurant_id
      ),
      v_owner_id,
      v_owner_name,
      null,
      -- Dedup pe id-ul rezervării: un singur email per rezervare, indiferent
      -- de re-intrări (enqueue_email face on conflict (dedup_key) do nothing).
      'resv_created:' || new.id::text
    );
  exception when others then
    -- Un eșec de notificare NU are voie să avorteze rezervarea clientului —
    -- aceeași disciplină ca triggerele SMS (mig 228, test SQ9).
    raise warning 'email owner rezervare % a esuat: %', new.id, sqlerrm;
  end;
  return null; -- AFTER trigger
end;
$$;

revoke all on function public.trg_email_on_reservation_created() from public, anon, authenticated;

-- ── 2. cancel_reservation_by_code (257 → 327) ───────────────────────────────
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

  select r.id, r.name, r.owner_id
    into v_restaurant_id, v_rest_name, v_owner_id
    from public.restaurants r
   where r.slug = v_slug and r.is_active = true;

  if v_restaurant_id is null then
    -- Același răspuns ca la cod greșit — fără oracle de existență a slugului.
    -- Consumă bucket-ul de încercări EȘUATE (vezi mai jos de ce doar eșuate).
    perform public.check_rate_limit('cancel_reservation_public', v_slug, 30, 15);
    return jsonb_build_object('ok', false, 'hint', 'invalid_code');
  end if;

  select * into v_res
    from public.reservations
   where restaurant_id = v_restaurant_id
     and upper(confirmation_code) = v_code;

  if v_res.id is null then
    -- Rate-limit DOAR pe încercările cu cod INVALID (audit aug 2026): un
    -- bucket unic pe slug, consumat și de anulările reușite, permitea un DoS
    -- trivial — 15 POST-uri cu coduri aleatorii blocau TOȚI clienții
    -- legitimi ai localului. Codul VALID e bearer token (16^8) — purtătorul
    -- lui nu are nevoie de limită; brute-force-ul, da.
    if not public.check_rate_limit('cancel_reservation_public', v_slug, 30, 15) then
      return jsonb_build_object('ok', false, 'hint', 'rate_limited');
    end if;
    return jsonb_build_object('ok', false, 'hint', 'invalid_code');
  end if;

  if v_res.status not in ('pending', 'confirmed') or v_res.starts_at <= now() then
    return jsonb_build_object('ok', false, 'hint', 'not_cancellable');
  end if;

  -- Predicat de status ÎN UPDATE (anti-TOCTOU, audit aug 2026): între SELECT
  -- și UPDATE staff-ul poate marca 'seated' — fără predicat, clientul așezat
  -- la masă era rescris în 'cancelled' și masa apărea fals liberă.
  update public.reservations
     set status = 'cancelled'
   where id = v_res.id
     and status in ('pending', 'confirmed');
  if not found then
    return jsonb_build_object('ok', false, 'hint', 'not_cancellable');
  end if;

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
          'starts_at',       v_res.starts_at,
          -- Lotul L8a: worker-ul afișează ora pe fusul LOCALULUI.
          'restaurant_id',   v_restaurant_id
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

-- ── 3. Asserții fail-closed ──────────────────────────────────────────────────
do $$
declare
  v_trg  regprocedure := 'public.trg_email_on_reservation_created()'::regprocedure;
  v_rpc  regprocedure := 'public.cancel_reservation_by_code(text, text)'::regprocedure;
  v_def  text;
  v_cfg  text;
  v_n    int;
  v_fn   regprocedure;
begin
  foreach v_fn in array array[v_trg, v_rpc] loop
    v_def := pg_get_functiondef(v_fn);
    if position('''restaurant_id''' in v_def) = 0 then
      raise exception 'mig 327: % nu pune restaurant_id în template_data', v_fn;
    end if;
    if v_def !~* 'when\s+others' then
      raise exception 'mig 327: % nu mai e exception-wrapped (un eșec de email ar avorta rezervarea/anularea)', v_fn;
    end if;
    if v_def !~* 'v_owner_email\s+is\s+(not\s+)?null' then
      raise exception 'mig 327: % a pierdut garda pe emailul owner-ului', v_fn;
    end if;
    select array_to_string(p.proconfig, ',') into v_cfg from pg_proc p where p.oid = v_fn;
    if coalesce(v_cfg, '') not like '%pg_temp%' then
      raise exception 'mig 327: % fără pg_temp în search_path (proconfig=%)', v_fn, v_cfg;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = v_fn) then
      raise exception 'mig 327: % nu mai e SECURITY DEFINER', v_fn;
    end if;
  end loop;

  v_def := pg_get_functiondef(v_rpc);
  if v_def !~* 'check_rate_limit' then
    raise exception 'mig 327: RPC-ul de anulare a rămas fără rate-limit';
  end if;
  if v_def !~* 'and\s+status\s+in\s+\(''pending'',\s*''confirmed''\)' then
    raise exception 'mig 327: predicatul de status din UPDATE (anti-TOCTOU) s-a pierdut';
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cancel_reservation_by_code';
  if v_n <> 1 then
    raise exception 'mig 327: % semnături cancel_reservation_by_code (PGRST203)', v_n;
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trg_email_on_reservation_created';
  if v_n <> 1 then
    raise exception 'mig 327: % funcții trg_email_on_reservation_created', v_n;
  end if;

  if not has_function_privilege('anon', v_rpc, 'execute')
     or not has_function_privilege('authenticated', v_rpc, 'execute') then
    raise exception 'mig 327: fluxul public de anulare a pierdut EXECUTE pentru anon/authenticated';
  end if;
  if has_function_privilege('anon', v_trg, 'execute')
     or has_function_privilege('authenticated', v_trg, 'execute') then
    raise exception 'mig 327: funcția de trigger e apelabilă prin /rpc (RP13)';
  end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgname = 'trg_email_reservation_created'
       and t.tgrelid = 'public.reservations'::regclass
       and t.tgfoid = v_trg::oid
       and not t.tgisinternal
  ) then
    raise exception 'mig 327: trigger-ul trg_email_reservation_created lipsește sau nu mai cheamă funcția';
  end if;

  raise notice 'mig 327: restaurant_id în emailurile de rezervare, invariantele 255/257 păstrate';
end $$;

commit;

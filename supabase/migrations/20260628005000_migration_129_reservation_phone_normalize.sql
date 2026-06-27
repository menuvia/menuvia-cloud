-- mig 129 — Fix P3 (anti-abuz): rate-limit rezervari per-telefon robust la format (RES-RATE-2)
--
-- Auditul rundei 2 (reservations_tables). check_reservation_rate_limit (mig 115) compara
-- customer_phone EXACT (`customer_phone = v_phone`). Variind formatul (+40 / 0040 / 0 /
-- spatii / cratime) acelasi numar trece de pragul de 3/5min => rate-limit per-telefon
-- usor de ocolit. Pragul per-restaurant ramane neschimbat (deja robust).
--
-- Fix: normalizez ambele parti la ultimele 9 cifre (RO: numar national de 9 cifre dupa
-- prefixul de tara/0), comparand pe cifre. Recreez functia verbatim din DB + normalizare.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

create or replace function public.check_reservation_rate_limit(p_restaurant_id uuid, p_customer_phone text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  -- Normalizare: pastreaza doar cifrele, ia ultimele 9 (numar national RO). Astfel
  -- '+40 712 345 678', '0712345678', '0040712345678' colapseaza la '712345678'.
  v_phone text := nullif(right(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), 9), '');
begin
  if p_restaurant_id is null then
    return;
  end if;

  -- Serializează request-urile concurente pe ACELAȘI restaurant ca să nu
  -- treacă un burst printre două COUNT-uri (TOCTOU).
  perform pg_advisory_xact_lock(hashtext('reservation_rate:' || p_restaurant_id::text));

  -- Prag per restaurant: max 5 rezervări publice / minut.
  if (
    select count(*)
      from public.reservations
     where restaurant_id = p_restaurant_id
       and source = 'public'
       and status not in ('cancelled','no_show')
       and created_at > now() - interval '1 minute'
  ) >= 5 then
    raise exception 'Prea multe rezervări în ultimul minut pentru acest restaurant. Te rugăm reîncearcă mai târziu.'
      using errcode = 'P0001', hint = 'reservation_rate_limit';
  end if;

  -- Prag per telefon: max 3 rezervări publice / 5 minute de la același număr (NORMALIZAT).
  if v_phone is not null and (
    select count(*)
      from public.reservations
     where restaurant_id = p_restaurant_id
       and source = 'public'
       and status not in ('cancelled','no_show')
       and right(regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g'), 9) = v_phone
       and created_at > now() - interval '5 minutes'
  ) >= 3 then
    raise exception 'Prea multe rezervări de la acest număr în ultimele 5 minute. Te rugăm reîncearcă mai târziu.'
      using errcode = 'P0001', hint = 'reservation_rate_limit';
  end if;
end;
$function$;

revoke all on function public.check_reservation_rate_limit(uuid, text) from public;
grant execute on function public.check_reservation_rate_limit(uuid, text) to anon, authenticated;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='check_reservation_rate_limit' limit 1;
  if v_def is null or position('regexp_replace' in v_def) = 0 then
    raise exception 'mig 129: check_reservation_rate_limit nu normalizeaza telefonul';
  end if;
  raise notice 'mig 129: rate-limit telefon normalizat (ultimele 9 cifre) OK';
end $$;

commit;

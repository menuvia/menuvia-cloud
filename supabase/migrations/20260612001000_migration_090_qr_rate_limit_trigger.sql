-- Migration 090: Reactivare rate limit pe comenzile QR (regresie din mig 083/084)
-- ─────────────────────────────────────────────────────────────────────
-- Context (audit securitate QR, 2026-06-12):
--   • check_qr_order_rate_limit există din mig 012 (întărită în mig 056 cu
--     advisory xact lock anti-TOCTOU): max 3 comenzi / 2 minute / token QR.
--   • Versiunile vechi ale create_order (012→046) o apelau explicit.
--   • Rescrierea din mig 083/084 (Porțile A/B) a pierdut apelul — în mig 088
--     (versiunea curentă) singurul rate limit rămas e cel de pickup.
--   → Comenzile QR rulau FĂRĂ rate limit: un client (sau un script cu un
--     token valid de pe o masă) putea inunda bucătăria cu comenzi.
--
-- Fix minimal invaziv: trigger BEFORE INSERT pe orders în loc să recopiem
-- cele ~400 de linii din create_order (vezi capcana 085/087 din CLAUDE.md).
-- Bonus defense-in-depth: acoperă și orice cale de scriere viitoare, nu
-- doar RPC-ul curent. Advisory lock-ul din funcție e xact-scoped, deci
-- funcționează identic din trigger (aceeași tranzacție).
--
-- Comportament: qr_token_id NULL → no-op (funcția face return early), deci
-- comenzile waiter/pickup și seed-urile de test nu sunt afectate.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.trg_check_qr_order_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source = 'qr' then
    perform public.check_qr_order_rate_limit(new.qr_token_id);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_qr_rate_limit on public.orders;
create trigger orders_qr_rate_limit
  before insert on public.orders
  for each row
  execute function public.trg_check_qr_order_rate_limit();

comment on trigger orders_qr_rate_limit on public.orders is
  $$Rate limit QR: max 3 comenzi/2min/token (check_qr_order_rate_limit, mig 056).
  Reactivat ca trigger după ce apelul din create_order s-a pierdut la rescrierea
  din mig 083/084.$$;

-- Verificare manuală (post-deploy):
-- select tgname from pg_trigger where tgrelid = 'public.orders'::regclass
--   and tgname = 'orders_qr_rate_limit';

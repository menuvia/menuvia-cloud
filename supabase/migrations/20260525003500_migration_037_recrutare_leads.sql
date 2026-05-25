-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 037 — Stocare lead-uri din landing recrutare
-- ═══════════════════════════════════════════════════════════════
-- Tabela primește submission-urile de pe /recrutare prin Netlify function
-- recrutare-contact.js. Founder vede lead-urile fie:
--   • Direct prin SQL în Supabase Studio (v1 — manual)
--   • Printr-un viitor tab "Lead-uri" în admin (v2)
--
-- RLS: doar service_role poate INSERT (functions). Read-only pentru users
-- autentificați CARE au flag-ul `is_super_admin = true` (n-am implementat
-- super_admin încă; deocamdată doar service_role accesează).

create table if not exists public.recrutare_leads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  cafe        text not null,
  city        text,
  phone       text not null,
  email       text not null,
  message     text,

  source      text not null default 'landing_recrutare',
  ip          text,
  user_agent  text,

  status      text not null default 'new'
    check (status in ('new', 'contacted', 'demo_scheduled', 'converted', 'rejected', 'spam')),

  contacted_at timestamptz,
  notes_internal text,  -- notițe ulterioare de la founder

  created_at  timestamptz not null default now()
);

create index if not exists idx_recrutare_leads_created_at on public.recrutare_leads(created_at desc);
create index if not exists idx_recrutare_leads_status     on public.recrutare_leads(status);

-- ── RLS ──────────────────────────────────────────────────────
alter table public.recrutare_leads enable row level security;

-- Nicio policy → blocată complet pentru anon/authenticated.
-- Service role (Netlify functions) ocolește RLS by default.

comment on table public.recrutare_leads is
  'Lead-uri capturate de pe landing /recrutare. Acces doar prin service_role.';

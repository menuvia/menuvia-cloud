-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 020 — Alergeni & Taguri dietetice
-- Regulamentul EU 1169/2011 — afișare obligatorie în meniu digital
-- ═══════════════════════════════════════════════════════════════

-- Coloana allergens: array de string-uri cu ID-urile alergenilor
-- Ex: ['gluten', 'oua', 'lapte']
alter table public.products
  add column if not exists allergens    text[] not null default '{}';

-- Coloana dietary_tags: array de taguri dietetice
-- Ex: ['vegetarian', 'fara-gluten']
alter table public.products
  add column if not exists dietary_tags text[] not null default '{}';

-- Index GIN pentru filtrare rapidă după alergeni
-- (util pentru viitor: "arată-mi produse fără gluten")
create index if not exists idx_products_allergens
  on public.products using gin (allergens);

create index if not exists idx_products_dietary_tags
  on public.products using gin (dietary_tags);

comment on column public.products.allergens is
  'Alergeni prezenți în produs. Valori valide: gluten, crustacee, oua, peste,
   arahide, soia, lapte, nuci, telina, mustar, susan, sulfiti, lupin, molusce.
   Regulamentul EU 1169/2011 — afișare obligatorie în meniu digital.';

comment on column public.products.dietary_tags is
  'Taguri dietetice opționale: vegetarian, vegan, fara-gluten, fara-lactoza, picant, raw.';

# Menuvia — Staging Checklist (cap-coadă, manual)

> Rulezi asta pe staging înainte de demo. Bifezi tot. Ce pică → notezi în
> secțiunea „Bug-uri găsite" de la final și repari DOAR ce blochează
> demo/vânzare. Fiecare item are forma: acțiune → ce trebuie să vezi.

## 1. Pre-flight — mediu

- [ ] Migrațiile **083 → 092** aplicate în Supabase SQL Editor, în ordine (10 fișiere; verifică cu `select tgname from pg_trigger where tgname='orders_qr_rate_limit'` → 1 rând, și `select proname from pg_proc where proname='_order_session_valid'` → 1 rând)
- [ ] `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` setate în Netlify env (proiectul corect, nu placeholder)
- [ ] `VITE_APP_URL` = domeniul public final (altfel QR-urile printate conțin URL de preview — warning-ul din Mese & QR trebuie să NU apară)
- [ ] Stripe: `STRIPE_SECRET_KEY` + price ID-uri pentru starter/growth (lunar + anual) în funcția `stripe-checkout`
- [ ] `VITE_WHATSAPP_NUMBER` setat (altfel CTA-urile WhatsApp dispar — fail-safe, dar pilotul Fiscalizare rămâne fără CTA)
- [ ] Funcțiile Netlify răspund: `curl -X POST /.netlify/functions/stripe-checkout` → 401/400, nu 404
- [ ] RLS activ: în SQL Editor, ca `anon`: `select * from orders limit 1` → 0 rânduri/eroare
- [ ] Supabase Auth: confirm email ON sau OFF — decide și testează fluxul corespunzător (pct. 3)
- [ ] Date demo curate: niciun restaurant de test vechi cu plan greșit pe contul de demo

## 2. Flux public de marketing

- [ ] Landing se încarcă < 3s, fără erori în consolă
- [ ] „Începe cu Meniu + Comenzi" (hero + final) → `/auth?plan=growth`
- [ ] „Vezi prețurile" → `/pricing`; nav-ul „Funcții"/„Cum funcționează" face scroll
- [ ] Pricing afișează 3 carduri cu valorile din `plans.ts` (99/249/499; 300/1000/2000 produse; 120/300/500 mese)
- [ ] CTA Meniu Digital → `/auth?plan=starter` (anon) — pill-ul apare pe auth
- [ ] CTA Meniu + Comenzi → `/auth?plan=growth` (anon)
- [ ] CTA Fiscalizare → deschide WhatsApp cu mesajul pilot; NU pornește checkout
- [ ] Caută în pagină (Ctrl+F pe landing + pricing): **zero** apariții „Fără card", „nelimitat", „Pro" ca nume vizibil de plan

## 3. Auth + plan intent

- [ ] `/auth?plan=growth` → pill „🛎 Continui cu Meniu + Comenzi"
- [ ] `/auth?plan=starter` → pill „📖 Continui cu Meniu Digital"
- [ ] `/auth` fără param → fără pill, formular normal
- [ ] Signup cu email nou → cont creat (sau ecran „Verifică emailul" dacă confirmarea e ON; după confirmare, login OK)
- [ ] Login cu credențiale corecte → dashboard; cu parolă greșită → eroare clară, rămâi pe /auth
- [ ] „Ai uitat parola?" → email primit → `/reset-password` funcționează
- [ ] Cu intent growth: după login ajungi pe /pricing → **loaderul** „Se pregătește checkout-ul pentru Meniu + Comenzi..." → Stripe Checkout (fără flash de carduri)
- [ ] Cu intent pro (forțat în URL): NU pornește checkout; pill informativ pe auth
- [ ] Anulezi în Stripe (Back) → te întorci în aplicație fără stare ruptă

## 4. Onboarding / primul restaurant

- [ ] User nou fără restaurant → ecranul de onboarding (nu dashboard gol)
- [ ] Creare restaurant (nume, oraș, slug) → succes
- [ ] Aterizezi pe **Acasă** (nu pe Produse)
- [ ] Sidebar pe plan: **Meniu Digital** = Acasă, Meniu, Mese & QR, Setări (4); **Meniu + Comenzi** = + Comenzi, Rapoarte (6); **Fiscalizare** = aceleași 6, fiscalul ca sub-tab-uri în Rapoarte/Setări — niciodată mai mult de 6 intrări

## 5. Dashboard Acasă

- [ ] „Bun venit, {restaurant}" + subtitlu
- [ ] Produse active = numărul real; QR-uri active = numărul real
- [ ] „Comenzi azi" apare DOAR pe tier 2+ (cifră mare aurie)
- [ ] „Setup X/Y" corect; pașii nebifați navighează la tab-ul corect (Produse / Categorii / Mese & QR / Echipă)
- [ ] Click „Vezi meniul public" → pasul „Verifică meniul public" se bifează (flag local)
- [ ] Tier 1: card „Vrei să primești comenzi direct de la masă?" cu CTA → pricing
- [ ] Tier 2: cardul de upgrade tier 1 NU apare; apare „Scor meniu" cu badge + sugestii
- [ ] Nicio funcție fiscală vizibilă pe tier 1/2 (niciun TVA/Încasări/Facturi nicăieri)

## 6. Administrare meniu

- [ ] Creează categorie → apare în listă și în meniul public
- [ ] Creează produs cu preț → apare în categoria corectă
- [ ] Adaugă imagine produs → se afișează în dashboard ȘI în meniul public
- [ ] Alergeni + tag-uri dietetice (vegan/vegetarian) → badge-uri pe meniul public
- [ ] Tier 2: „Opțiuni produse" (modificatori) + extras pe un produs → apar în sheet-ul produsului la client
- [ ] Tab-ul se numește „Promoții" (nu Happy Hour); creezi o regulă → bannerul verde apare pe pagina QR client
- [ ] Editezi prețul unui produs → meniul public reflectă schimbarea la refresh

## 7. Mese & QR

- [ ] Restaurant fără mese → empty state „Nu ai mese configurate încă" + input
- [ ] „Câte mese ai? 10" → Generează → 10 mese cu „● QR activ"
- [ ] Repeți cu 10 → „Ai deja 10 mese configurate", fără dubluri
- [ ] Introduci peste limita planului (ex. 121 pe Meniu Digital fără upgrade) → mesaj prietenos cu limita, fără insert
- [ ] Niciun token/UUID vizibil pe rânduri (doar „QR activ/dezactivat")
- [ ] „⬇" pe un rând → PNG descărcat cu numele mesei
- [ ] „Descarcă toate QR-urile" → PDF cu toate mesele active
- [ ] „Regenerează" → dialog „QR-ul vechi nu va mai funcționa..." → confirmi
- [ ] QR-ul VECHI (URL-ul salvat dinainte) → pagina „Acest QR nu mai este activ"
- [ ] QR-ul NOU → meniul se deschide normal
- [ ] Dezactivezi masa → QR-ul ei nu mai permite comandă; reactivezi → merge
- [ ] Editezi numele mesei + ștergi o masă → fără erori

## 8. Pagina QR client (pe TELEFON real)

- [ ] Deschizi `/q/:token` → nume restaurant + pill „Masa N"
- [ ] Search „pizza" → găsește produse din TOATE categoriile
- [ ] Chips de categorii comută corect
- [ ] Produs simplu → adăugare rapidă în coș
- [ ] Produs cu opțiuni → sheet cu opțiuni/extras → „Adaugă în coș"
- [ ] Bara sticky: „N produse · Vezi coșul · X lei"
- [ ] În coș: note la comandă + textul „Totalul final este confirmat de restaurant."
- [ ] „Trimite comanda" → „✅ Comanda a fost trimisă / Bucătăria a primit comanda."
- [ ] Statusul avansează live când bucătăria confirmă (vezi pct. 9)
- [ ] QR revocat → mesaj prietenos (nu eroare tehnică)
- [ ] Restaurant fără produse → „Momentan meniul nu este disponibil."
- [ ] „Cheamă ospătarul" → „✓ Am anunțat ospătarul" + buton blocat ~60s
- [ ] „Cere nota" → „✓ Nota e pe drum" + buton blocat ~60s

## 9. Kitchen (tabletă sau desktop)

- [ ] Comanda QR nouă apare în „Comenzi noi" cu sunet + border auriu
- [ ] „Confirmă" → cardul rămâne în „Comenzi noi" dar butonul devine „Marchează în pregătire"
- [ ] „Marchează în pregătire" → coloana „În pregătire"
- [ ] „Gata" → coloana „Gata de servit"
- [ ] NICIUN preț / metodă de plată / dată fiscală pe carduri
- [ ] Nota clientului vizibilă pe fundal evidențiat
- [ ] Fără comenzi → „Nu sunt comenzi în bucătărie..."
- [ ] Pe telefon: coloanele se stivuiesc vertical, fără overflow orizontal

## 10. Waiter (pe TELEFON)

- [ ] „Cheamă ospătar" de la client → apare cardul 👋 cu masa + ora
- [ ] „Cere nota" → cardul 🧾 cu badge „CERE NOTA" apare DEASUPRA apelurilor 👋
- [ ] „Preiau" → cardul dispare
- [ ] Comenzile deschise grupate pe masă: „🪑 Masa N · X comenzi"
- [ ] Comandă „Gata de servit" → butonul „Servit" funcționează
- [ ] „+ Comandă manuală" → flux complet funcțional
- [ ] Edit / Anulare (cu motiv) / Istoric (admin) — toate prezente
- [ ] Tier 1-2: pe comanda servită apare „✓ Închide comanda" (FĂRĂ plată/sume); tier 3: „Plată integrală / parțială" + PayModal
- [ ] Fără overflow orizontal; butoanele tap-abile cu degetul mare

## 11. Rapoarte / gating pe plan

- [ ] Tier 1: grupurile Comenzi și Rapoarte NU există în sidebar; URL-ul direct pe un tab ascuns te întoarce la Acasă
- [ ] Tier 2: Rapoarte → banner „Evidență operațională — nu este raport fiscal"; FĂRĂ Revenue/Cash/Card/Bon mediu; FĂRĂ export CSV/PDF
- [ ] Tier 3: sub-tab-urile TVA / Încasări / Fiscalizare / Facturi / Stocuri apar; exporturile revin
- [ ] „Statistici" (nu Analytics) ca etichetă peste tot

## 12. Securitate QR (testele răutăcioase)

- [ ] URL-ul QR conține DOAR tokenul (niciun table_id/restaurant_id în URL sau în pagină)
- [ ] QR regenerat → cel vechi mort (re-test după pct. 7)
- [ ] 4+ comenzi rapid de pe aceeași masă în <2 min → a 4-a respinsă (rate limit)
- [ ] Spam „Cheamă ospătarul" → al 2-lea apel în 5 min nu creează card nou
- [ ] Spam „Cere nota" → idem, dar separat de chemarea simplă
- [ ] În DevTools, modifici prețul în request-ul de comandă → totalul salvat în DB e cel REAL (server-side)
- [ ] `create_order` cu product_id din ALT restaurant → respins
- [ ] `get_order_public_status(UUID)` fără sesiune (din consolă/SQL) → doar `{id, short_id, status}` — fără sume
- [ ] Cu `session_id` valid → payload complet
- [ ] `request_fiscal_receipt(UUID)` fără sesiune → eroare; cu sesiune → succes

## 13. Stripe / facturare

- [ ] Checkout starter → sesiune Stripe corectă (99 lei sau prețul anual)
- [ ] Checkout growth → 249 lei / anual
- [ ] Toggle-ul anual schimbă prețurile pe carduri
- [ ] Plată test reușită → webhook-ul setează `profiles.plan` → sidebar-ul se schimbă la noul tier
- [ ] Plată eșuată/anulată → planul NU se schimbă; aplicația nu rămâne în stare ruptă
- [ ] Flash guard: logat + intent → loader, nu carduri (pct. 3)
- [ ] Stripe neconfigurat (staging fără chei) → fallback la dashboard, fără crash

## 14. Legal / conformitate

- [ ] `/termeni`, `/confidentialitate`, `/cookies`, `/dpa` se încarcă
- [ ] Cookie banner apare la prima vizită; alegerea persistă
- [ ] Link-urile din LegalFooter funcționează de pe landing și pricing

## 15. Responsive (4 lățimi: ~375px, ~412px, ~768px, ≥1280px)

- [ ] Landing — hero, preview, FAQ fără overflow
- [ ] Pricing — cardurile stack pe mobil; „Recomandat" lizibil
- [ ] Auth — panou brand compact pe mobil, pill vizibil sus
- [ ] Acasă — metricile stack curat
- [ ] Mese & QR — inputul + lista utilizabile pe mobil
- [ ] Pagina QR client — totul (e principalul ecran de mobil)
- [ ] Kitchen — stack pe telefon, 3 coloane pe tabletă
- [ ] Waiter — perfect pe telefon

## 16. Scenariul de demo (5 minute)

1. [ ] Deschizi landing-ul → „uite ce simplu: adaugi meniul, generezi QR, primești comenzi"
2. [ ] Click „Începe cu Meniu + Comenzi" → arăți pill-ul pe auth → login (cont pregătit)
3. [ ] Acasă: „aici vezi tot — comenzile de azi, setup-ul, scorul"
4. [ ] Meniu: adaugi un produs live (cu poză pregătită)
5. [ ] Mese & QR: „Câte mese ai? 10" → Generează → descarci PDF-ul
6. [ ] Pe TELEFON: scanezi QR-ul → comanzi 2 produse cu o opțiune
7. [ ] Pe TABLETĂ: comanda sună în bucătărie → Confirmă → În pregătire → Gata
8. [ ] Pe TELEFONUL 2 (waiter): „Gata de servit" → Servit → clientul cere nota → cardul 🧾 apare → Preiau → Închide comanda
9. [ ] Înapoi pe laptop: Rapoarte → „uite ziua de azi"
10. [ ] Închidere: „plata și bonul rămân pe casa ta — nu schimbi nimic din ce ai"

**Pregătit dinainte:** cont demo pe growth, restaurant cu 8-10 produse cu poze, 10 mese generate, QR-ul mesei 1 printat, telefon + tabletă încărcate, sunet pornit.

## 17. Riscuri cunoscute / watchlist

- [ ] CI verde pe PR înainte de deploy (în special „Apply all migrations" + „Tracking assertion")
- [ ] Migrațiile 083→092 — fără ele comanda QR e RUPTĂ în producție (mig 088) și rate-limit-ul lipsește (090)
- [ ] Fereastra de 2h post-închidere sesiune la tracking — clientul care se întoarce după 3h vede doar statusul (by design)
- [ ] „Verifică meniul public" e flag per-device (localStorage) — pe alt laptop pasul reapare
- [ ] Comenzile pickup/legacy (fără sesiune) au încă tracking full pe UUID — suprafață mică, de închis când pickup-ul devine activ comercial
- [ ] „Istoric comenzi" din hub-ul Comenzi e încă shortcut către raportul agregat (TODO în cod)
- [ ] „Scor meniu" e health score de cont (login/comenzi/echipă), nu audit de conținut al meniului — de upgradat ulterior
- [ ] Playwright E2E e roșu cronic în CI (secrets lipsă) — nu e semnal de regresie, dar de reparat după demo

---

## Bug-uri găsite la rulare (completezi tu)

| # | Ecran | Ce s-a întâmplat | Blochează demo? |
|---|---|---|---|
| 1 | | | |
| 2 | | | |

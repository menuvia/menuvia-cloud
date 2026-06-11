# Menuvia — Design Spec (faza de mockup, fără cod)

> Direcția vizuală pentru cele 8 ecrane cheie. Acest document e spec-ul de
> implementare — NU s-a scris cod pe baza lui încă. Decidem împreună ce
> ecrane se implementează primele.

## Sistemul de design — „două lumi, o singură identitate"

| Lume | Paletă | Unde | De ce |
|---|---|---|---|
| **Caldă / luminoasă** (`M`) | fundal `#FAF9F6`, text `#1A1208`, accent auriu `#C8963C`, accente soft `#FAF3E5` | landing, pricing, auth, pagina QR client | marketing + clientul final: premium, primitor, „restaurant", nu „software" |
| **Caldă / întunecată** (`D`) | fundalul actual de dashboard, auriu pe închis | dashboard, kitchen, waiter | operațiuni: săli cu lumină slabă, ture de seară, contrast pentru viteză |

- **Fonturi:** Fraunces (titluri — serif cald, „meniu de restaurant") + DM Sans (UI). Există deja peste tot — nu se schimbă.
- **Auriu = un singur rol:** CTA-ul principal și starea activă. Niciodată decorativ pe suprafețe mari.
- **Raze:** 12–18px carduri, 100px pills. **Spațiere:** generoasă — aerul e premium-ul.
- **Limbă:** română umană. Interzis în UI: token, UUID, session, slug, KDS, FiscalNet, „Pro", „nelimitat", „fără card".

---

## 1. Landing page — ✅ implementat în Zona 4 (doar delta)

**Scop:** vizitatorul înțelege în 10 secunde: ce e, pentru cine, care plan, cât de simplu.
**Stare:** structura cerută există deja (header sticky, hero, preview CSS telefon/bucătărie/QR, 6 beneficii, 3 pași, highlight Meniu + Comenzi, FAQ light, final CTA).
**Delta de polish (mic):**
- micro-animație pe preview (cardul de bucătărie „primește" comanda — pulse pe badge NOUĂ · acum) — pur CSS;
- social proof când există (logo-uri/citate piloti) — sub hero, max 1 rând;
- imagine reală de telefon (mockup generat) poate înlocui cardul CSS mai târziu — nu blocant.
**De evitat:** secțiuni noi de features, screenshot-uri de dashboard (vinde flow-ul, nu admin-ul).

## 2. Pricing page — ✅ implementat (doar delta)

**Stare:** hero + 3 carduri din `plans.ts`, „Recomandat" pe Meniu + Comenzi, „Nu știi ce să alegi?", trust signals, FAQ, Fiscalizare cu badge „Pilot" + CTA WhatsApp.
**Delta de polish:** pe mobil, cardul recomandat primul în ordine (acum ordinea e starter→growth→pro și pe mobil userul derulează); rest neschimbat.
**De evitat:** tabel comparativ mare cu 30 de rânduri; orice re-hardcodare de prețuri.

## 3. Login / Auth — 🔨 DE IMPLEMENTAT (prioritate 1)

**Scop:** încredere + continuitate cu intenția de plan. Azi: formular generic pe fundal închis — rupe complet tonul cald din landing → pricing.

**Layout (desktop):** split 45/55.
- **Stânga (brand, fundal `M.surface2`):** logo Menuvia · headline „**Configurezi restaurantul în câteva minute.**" · 3 bullet-uri mici: „Adaugi meniul" / „Generezi QR-urile" / „Primești comenzi de la masă" · jos, discret: „30 de zile gratuite. Anulezi oricând."
- **Dreapta (formular, fundal `M.bg`):** card alb cu tab-uri **Intră în cont / Creează cont**, email + parolă, CTA auriu lat.

**Plan intent (cheia ecranului):** dacă există `?plan=` / intent în session, deasupra formularului un pill cald:
> 🛎 **Continui cu Meniu + Comenzi** — contul tău va porni cu acest plan.
> (respectiv 📖 „Continui cu Meniu Digital")

**Copy butoane:** „Intră în cont" / „Creează cont gratuit" / „Ai uitat parola?".
**Mobil:** panoul de brand devine header compact (logo + o frază), formularul imediat sub.
**De evitat:** social login fals (nu există încă), link-uri multe, asterisks juridice lungi.
**Note implementare:** doar `AuthPage.tsx` + citirea intent-ului (helperii `readPlanIntent` există deja). Zero backend.

## 4. Dashboard „Acasă" — 🔨 DE RAFINAT (prioritate 2)

**Scop:** mission control, nu admin cu tabele. **Stare:** HomeTab există (stats, quick actions, asistent + scor expandabile, upgrade card) — fundația e bună; spec-ul e despre ierarhie vizuală.

**Layout (de sus în jos):**
1. **Salut + status:** „Bună, {nume restaurant}" + pill verde „● Activ · Meniu + Comenzi" (PLAN_LABELS există).
2. **Rândul zilei (3 carduri mari):** Comenzi azi (cifră mare Fraunces) · Produse active · Meniu QR: Activ. Tier 1: în loc de Comenzi → „Vizualizări meniu" (avem analytics de scanări).
3. **„De făcut azi" (carduri-acțiune, max 2 vizibile):** checklist-ul de setup devine progres vizual „Setup: 4/6 pași ✓" cu bara aurie — click = expandare (există); scor meniu la fel, cu cifra în badge colorat (verde/galben/roșu).
4. **Acțiuni rapide** (există): + produs, vezi meniul, Mese & QR, raportul de azi.
5. **Upgrade card tier 1** (există) — rămâne ultimul, niciodată deasupra conținutului util.

**Mobil:** carduri full-width, statistica „Comenzi azi" prima.
**De evitat:** grafice pe Acasă (sunt în Rapoarte), mai mult de un CTA de upgrade.
**Note:** doar `HomeTab.tsx` + mici stiluri; structura logică există deja.

## 5. Mese & QR — ✅ implementat în Zona 2 (doar delta)

**Stare:** blocul „Câte mese ai? → Generează QR-uri", listă cu „● QR activ", Descarcă PNG, Regenerează cu confirmare, PDF-uri bulk, limite pe plan — totul există.
**Delta de polish:** acțiunile secundare (link, edit, șterge) într-un meniu „⋯" per rând — rămân 2 butoane vizibile: **Descarcă QR** și **Regenerează** (recomandarea din review-ul Zonei 2; nu a fost implementată încă, e singurul delta).
**De evitat:** preview QR mare per rând (cel de 48px e suficient), zone/etaje în acest ecran.

## 6. Pagina QR client — ✅ implementată în Zona 3 (doar delta)

**Stare:** header cu nume + pill „Masa 12", Cheamă ospătar / Cere nota cu anti-spam, search, chips categorii, carduri produs, sticky cart, confirmare umană, stări prietenoase pentru QR inactiv/meniu gol.
**Delta de polish:**
- butoanele „Cheamă ospătarul" / „Cere nota" pot urca din floating în header sub pill-ul mesei (2 butoane mici outline) — A/B ulterior, nu acum;
- imaginile produselor: lazy + aspect fix există; placeholder-ul emoji e ok.
**De evitat:** orice element de dashboard (tabele, filtre), onboarding overlay.

## 7. Kitchen page — 🔨 DE RAFINAT (prioritate 3, împreună cu Waiter)

**Scop:** panou de operațiuni live — citit de la 2 metri, pe tabletă unsă cu făină.

**Layout:** fundal `D` închis; **coloane pe status** (board): **Noi → În pregătire → Gata**. Fiecare comandă = card mare:
- sus: **„Masa 12"** (Fraunces, mare) + timer crescător („acum 4 min" — devine chihlimbar la 10 min, roșu la 20);
- mijloc: produse cu cantități, font 16+, modificatorii indentați, nota clientului în italic pe fundal soft;
- jos: **un singur buton mare** pe lățime: „Confirmă" → „Începe" → „✓ Gata" (verbe scurte; statusurile vizibile: **Nouă / Confirmată / În pregătire / Gata**).

**Sunet:** la comandă nouă (există). **Mobil/tabletă:** coloanele devin tab-uri orizontale; cardul rămâne full-width.
**De evitat:** prețuri și totaluri (bucătaria nu are nevoie de bani pe ecran), butoane secundare pe card, scroll orizontal în card.

## 8. Waiter page — 🔨 DE RAFINAT (prioritate 3)

**Scop:** telefonul ospătarului — totul la un deget distanță, în mers.

**Layout (mobil-first):**
1. **Banda de apeluri (sus, mereu vizibilă):** carduri chihlimbar **👋 Masa 5 · acum 1 min · [Preiau]** și **🧾 Masa 12 · CERE NOTA · [Preiau]** (există; spec: cardurile 🧾 primele — nota e mai urgentă decât chemarea).
2. **„Gata de servit"** — secțiune evidențiată (verde) cu butonul mare „Servit ✓".
3. **Comenzi deschise pe mese** — grupate pe masă, nu listă plată: header „Masa 12 · 2 comenzi · 87 lei*" expandabil. (*suma doar pe tier 3; pe tier 2 fără bani, conform regulii de aur — există deja gating-ul.)
4. **Acțiunea finală per comandă:** tier 3 „Plată integrală / parțială"; tier 1-2 „✓ Închide comanda" (există).
5. **FAB „+" comandă manuală** (există ManualOrderSheet).

**De evitat:** tabele, edit inline, mai mult de 3 acțiuni vizibile per card.

---

## Recomandare de implementare (de decis împreună)

| Val | Ecrane | Efort | De ce primele |
|---|---|---|---|
| **Val 1** | Auth (light + plan intent) | mic | primul ecran după CTA — azi rupe tonul și pierde intenția vizual |
| **Val 2** | Dashboard Acasă (ierarhie) | mic-mediu | prima impresie post-login; fundația există |
| **Val 3** | Kitchen (board pe coloane) + Waiter (grupare pe mese, nota prioritară) | mediu | demo-ul live pentru patroni: aici se „vede" produsul |
| mai târziu | deltele de polish la landing/pricing/Mese&QR/QR client | mic | deja bune; randament mic acum |

**Neatins în toată faza asta:** backend, securitate, plans.ts, navigația dashboard-ului.

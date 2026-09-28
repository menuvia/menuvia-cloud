# Programul de afiliere / agenți — Menuvia (+ Codvia, Webvia, Bookvia)

> **Stare (28 sept 2026):** mecanica financiară pentru Menuvia e **COD VIU** (ledger,
> comisioane, payout-uri, aprobare, dashboard — mig 097…249), dar **programul e
> ÎNGHEȚAT** prin regula ECOSISTEM: *niciun afiliat aprobat prin
> `admin_review_affiliate` până la decizia E9* (`docs/ECOSISTEM.md:91`, `:147`).
> În producție: **0 afiliați**, 0 facturi Stripe, 0 facturi Oblio (`docs/ECOSISTEM.md:17-32`).
> Validarea juridică NU e făcută (niciun contract, `docs/vanzare/AFILIATI_KIT.md:39-43`).
>
> Acest document înlocuiește versiunea anterioară (calculată pe „€29/lună Plan 3”).
> **Versiunea 1 e păstrată neschimbată** în `docs/archive/AFFILIATE_PROGRAM_v1_2026-06.md`:
> migrațiile 097 și 179 (care nu se editează) și documentele mai vechi o citează pe
> secțiuni și linii (ex. mig 179 „§6.7” = întrebarea GDPR din brieful de avocat v1) —
> acele trimiteri se citesc în arhivă. Tot ce e în §3–§4 cu eticheta **PROPUNERE** e
> decizie de fondator, nu stare a codului. §6 NU se implementează înainte de poarta din §2.

**Legendă căi** (toate în `supabase/migrations/`): m097 = `20260626000000_migration_097_affiliate_foundation.sql`,
m098 = `…004000_migration_098_affiliate_payouts.sql`, m099 = `…005000_migration_099_affiliate_p0_fixes.sql`,
m100 = `…006000_migration_100_affiliate_incrementality.sql`, m105 = `…011000_migration_105_affiliate_setup_unique.sql`,
m106 = `…012000_migration_106_affiliate_payout_correctness.sql`, m108 = `…014000_migration_108_affiliate_touch_hardening.sql`,
m186 = `20260702120000_migration_186_founder_platform_access.sql`, m187 = `20260702140000_migration_187_affiliate_partner_access.sql`,
m188 = `20260703100000_migration_188_platform_settings_affiliate_commissions.sql`, m189 = `…_189_affiliate_public_defaults.sql`,
m190 = `20260703140000_migration_190_affiliate_hardening.sql`, m193 = `20260703200000_migration_193_partner_access_status_gate.sql`,
m224 = `20260712120000_migration_224_affiliate_application_flow.sql`, m236 = `20260717130000_migration_236_white_label_v1.sql`,
m243 = `20260720100000_migration_243_low_hardening_sweep.sql`, m249 = `20260723120000_migration_249_affiliates_own_row_pii.sql`,
m284 = `…_284_*` (ștergeri GDPR + arhivă bonuri).

---

## 1. Stare azi (cod vs. documentație)

### 1.1 Ce face codul (definițiile LIVE)

| Mecanism | Realitatea din cod | Dovadă |
|---|---|---|
| **Comision doar pe Plan 3** | `p_plan` null sau ∉ (`pro`,`enterprise`) → `skipped: not_plan3`. Un agent care vinde *Meniu Digital + Rezervări* (99) sau *Meniu + Comenzi* (249) câștigă **0 lei**. | m099:106-109; înghețat de `tests/sql/affiliate_p0_assertions.sql:41-49` (P0a) și `:53-74` (T4) |
| Setup | 30% (`setup_bps` 3000) din **prima factură cu bani care trece gate-ul** pe atribuire, hold 60 zile; UN setup per atribuire, pe viață (re-abonarea nu mai dă setup) | m099:132-149; m105:23-25 |
| Recurring | 10% (`recurring_bps` 1000), hold 14 zile, plafon = **12 facturi recurring** numărate pe toată viața atribuirii (nu 12 luni calendaristice) → setup + 12 = 13 facturi comisionate | m099:150-160 |
| Baza | `floor(amount_paid × bps / 10000)`, `amount_paid` = TOATĂ factura Stripe (include TVA/prorata dacă factura le conține) | m099:163; `netlify/functions/stripe-webhook.js:591` |
| Cascadă | Un singur nivel: părintele activ primește `cascade_bps` (200 = **2% din comisionul subafiliatului**, nu din venit), calculat la crearea comisionului, inversat proporțional la clawback | m099:188-202, :274-287 |
| Adâncime | Trigger deferred: părintele nu poate avea părinte; afiliatul cu copii nu poate primi părinte | m097:222-254 |
| Procente | Citite LIVE din rândul `affiliates` la fiecare `invoice.paid`; defaults în `platform_settings` (founder-only); public se expun doar setup/recurring/cap, niciodată `cascade_bps` | m188:8-11, :34-56, :63-236; m189:24-41, :61-68 |
| Clawback | DOAR pe refund sau dispută PIERDUTĂ, proporțional, idempotent. Churn/anulare fără refund = **nimic recuperat**. Rezervă rulantă / setup condiționat de activitate: **neimplementate** | m099:225-291; `stripe-webhook.js:619-711` |
| Atribuire | Cookie `mv_ref` 90 zile + `mv_vid` → `record_affiliate_touch` (anon, rate-limit) → la **checkout Stripe** `capture_affiliate_attribution` (service_role, fail-closed pe touch, marjă 5 min, first-wins, **UNIC per profil**), cheie de legătură `stripe_customer_id` | `src/lib/affiliate.ts:15-17, :74-103`; m108:28-79; `stripe-checkout.js:179-204`; m100:75-140; m097:90 |
| Fără cale de atribuire | Comenzile Codvia nu trec prin Stripe → **niciun comision**. Un plan manual (`admin_set_restaurant_plan`, pilotul Fiscalizare) nu produce factură cât timp e manual; la conversie („un checkout normal”, `docs/ECOSISTEM.md:87`) atribuirea se poate captura dacă există cookie-ul `mv_ref` (90 zile) și touch-ul | m186:499-532; `stripe-checkout.js:183-203`; `src/lib/affiliate.ts:15-17` |
| Payout | Batch lunar (cron `day <= 2 && hour < 6` București) doar pe afiliați `active`; prag 5000 bani = **50 RON**, carry-forward; draft-uri + notificare Slack; plata manuală Wise. **Nu rulează azi în producție:** batch-ul e doar pe Netlify (denylist pg_cron, m274:218-219), unde env-ul are doar cele 3 variabile `VITE_*` și `/health` dă 503 (`docs/ECOSISTEM.md:29-30`); notificarea Slack e no-op fără `SLACK_WEBHOOK_URL` (`automation-cron.js:79-80`) | m190:115-189; `netlify/functions/automation-cron.js:300-328` |
| Stări payout | Mașina de stări e în trigger (draft→awaiting_invoice→invoice_matched→processing→paid …), dar **nu există RPC/UI** pentru draft→…→processing; singurul buton e „Marchează plătit” (`admin_mark_payout_paid`, processing/on_hold→paid). **Blocant pentru prima plată:** un draft din batch nu poate ajunge la „plătit” fără un UPDATE manual de status în SQL (RPC-ul acceptă doar processing/on_hold, m193:126-129, iar processing cere `wise_transfer_id`, m106:69-73). Fără potrivire Oblio a facturii afiliatului, fără API Wise | m106:37-125; m193:96-141; `docs/RUNBOOK.md:98-103` |
| Profil payout | `legal_form` ∈ (`pfa`,`srl`,**`other`**); UI oferă „Altă formă” | m098:51; m190:77; `src/pages/AfiliatPage.tsx:1105-1107` |
| Aprobare | `register_affiliate` (telefon obligatoriu) inserează `pending`; fondatorul decide cu `admin_review_affiliate`. Toate căile de bani/acces filtrează `status='active'` | m243:263-359; m224:161-197; CLAUDE.md „Afilierea e cu CERERE” |
| Suspendare | Enum `suspended`/`closed` există, **niciun RPC** nu le setează; batch-ul ignoră non-activii → sold înghețat, nu anulat | m097:35-53; m190:136 |
| Acces partener | Afiliatul primește automat rol virtual `manager` pe TOATE restaurantele owner-ului atribuit, de la captură, pe orice plan; se încheie doar prin revocare | m187:56-118, :197-254; m193:39-55 |
| Monede | Enum RON/EUR, batch multi-monedă; dashboard-ul însumează doar RON; moneda prețurilor Stripe nu se poate verifica din repo (price ID-urile există doar în env, `stripe-checkout.js:32-33`) | m107:20-24; m188:431-505 |

### 1.2 Ce spunea documentația veche și nu e adevărat

- „DRAFT pre-implementare” — fals; totul e implementat (m097…m249).
- Break-even pe „€29/lună Plan 3” — Fiscalizarea costă 499 lei (`src/lib/plans.ts:108-112`); semnalat în `docs/ECOSISTEM.md:91, :123`.
- „Clawback total la churn în fereastră” — fals, doar refund/dispută (m099:225-291).
- Cascadă „din comisioanele efectiv plătite” — fals, se calculează la crearea comisionului (m099:188-202).
- Tier-uri 30/35/40, plafon absolut enterprise, curs BNR, plată în EUR, re-atribuire <90 zile — **neimplementate**.
- Prag minim „€25” — codul are 50 RON (m190:117).
- `invoice_matched` „confirmat prin Oblio” — nu există.
- §7.6 (CN 2202/zahăr) nu ține de afiliere → se mută în documentația TVA.

### 1.3 Contradicții vii în UI (de rezolvat la decizia E9)

- Calculatorul public (`src/pages/AfiliatIntroPage.tsx:122-131, :399-401`) și exemplul de pe `src/pages/LandingPage.tsx:153-158, :945` calculează comisionul pe **growth 249 lei** — un plan care azi plătește 0 (m099:107).
- `/afiliat` încă primește cereri (`AfiliatIntroPage.tsx:219-221`, `AfiliatPage.tsx:241-253`), deși E9 recomandă închiderea lor (`docs/ECOSISTEM.md:147`).
- `AfiliatPage.tsx:1215` („PFA, SRL sau altă formă”) vs `AfiliatIntroPage.tsx:69` („de pe PFA sau SRL”).
- Tab-ul „Subafiliați” arată codul de recrutare și subafiliaților (`AfiliatPage.tsx:766-802`), dar invitatul lor pică la COMMIT pe trigger-ul de adâncime (m097:222-254).
- `docs/vanzare/AFILIATI_KIT.md:69` promite plată „lunar sau anual (~17% reducere)” — facturarea anuală NU există (`src/lib/plans.ts:28-37`).
- `AfiliatIntroPage.tsx:61` spune că după perioada de siguranță 60/14 zile comisioanele „sunt garantate” — fals: `process_affiliate_refund` (m099:250-287) recuperează setup/recurring la ORICE refund sau dispută pierdută ulterioară, fără verificare de hold.
- `AfiliatIntroPage.tsx:63` promovează „Recrutezi sub-parteneri și câștigi și din echipa ta” — în conflict cu liniile roșii anti-piramidale din §4 și cu propunerea de a ascunde recrutarea.

---

## 2. Principiu: un agent, patru produse

**De ce.** Agentul face o singură vizită la local și are mai multe lucruri de vândut:
Codvia (standul fizic, ieftin, ușor de acceptat) deschide ușa; Menuvia e abonamentul;
Webvia e site-ul pentru cei care n-au; Bookvia are nevoie de DENSITATE (15–20 de
localuri cu rezervări active, `docs/ECOSISTEM.md:69`) — exact ce produce o rețea de
agenți pe teren. Un program doar-Menuvia, doar-Plan-3, îi dă agentului motiv să vândă
un singur lucru — Fiscalizarea, vândută implicit prin WhatsApp (§2, tabelul).

**Constrângerea.** Agentul vinde DOAR ce e live ȘI vandabil legal, după porțile din
`docs/ECOSISTEM.md` §3 (ordinea canonică — nu se scrie o a patra listă):

| Produs | Stare cod | Vandabil de un agent când | Bază de comision |
|---|---|---|---|
| **Menuvia** | Live; checkout Stripe pe 99/249 (trial 30 zile). Fiscalizare 499: CTA-ul e WhatsApp DACĂ e configurat, altfel cade pe checkout-ul Stripe `pro` (`PricingPage.tsx:208-215`; `stripe-checkout.js` are price ID-uri `pro`/`enterprise`, :39-44) | după 0a (domeniu, `ECOSISTEM.md:57`) + 0c (SRL, contabil, regim TVA, Stripe pe firmă, `:62`) și după decizia E9 (înainte de 1b, `:147`) | abonament Stripe, azi doar pro/enterprise |
| **Codvia** | Pauza fail-closed a comenzilor e pe `main`, **nepublicată** — build-ul din producție (31 aug) ia comenzi ca înainte până la republicarea din 0a (`docs/CODVIA.md:20-21`; `codvia-order.js:40-45, :74-82`); fără captură de referral (`:95-110`) | după merge + publicare 2a + 2b ȘI după 0c (`docs/CODVIA.md:18-20`; `ECOSISTEM.md:66-67`) | nicio atribuire posibilă azi |
| **Webvia** | Inexistent în cod (`ECOSISTEM.md:36`); livrare MANUALĂ; **niciun preț în repo** | după „primul leu” (rândul 1) și rândul 3: draft 07 + preț LISTAT înainte de prima vânzare (`ECOSISTEM.md:68`) | nimic de comisionat |
| **Bookvia** | Inexistent; poartă de densitate (`ECOSISTEM.md:69`); E6 recomandă densitate pe free (`:144`) | după rândul 4; fără venit la start | **niciun comision până Bookvia are venit** |

Regula „niciun cod de produs nou înaintea primului leu” (`ECOSISTEM.md:51`) se aplică
și programului: §6 se construiește după E9 și după gate-ul 1 (primul `invoice.paid`
cu `amount_paid > 0` în Stripe-ul SRL-ului, `ECOSISTEM.md:63`).

---

## 3. Comisioane per produs — PROPUNERE (decizie de fondator)

### 3.1 Reguli comune propuse

1. **Baza = venitul NET încasat fără TVA** (Menuvia, Webvia) sau **MARJA BRUTĂ a
   comenzii** (Codvia, unde unit economics sunt subțiri). Azi baza e `amount_paid`
   brut (`stripe-webhook.js:591`), deci pe o firmă plătitoare de TVA comisionul de
   azi se calculează și pe TVA în AMBELE cazuri: dacă 99/249/499 includ TVA, TVA-ul
   e în preț; dacă nu-l includ, Stripe încasează 119,79 / 301,29 / 603,79 lei și
   baza crește cu 21%. Întrebarea e deschisă (0c; consemnată și la RES-11 în CLAUDE.md:
   „prețurile 99/249/499 includ TVA?”).
2. Comision **doar pe bani încasați** de la un client real; nimic pe recrutare.
3. Hold înainte de plată; clawback pe refund/dispută (există) + pe retur/retragere
   (Codvia) + **propunere nouă:** setup-ul devine plătibil abia după a DOUA factură
   plătită pe atribuire (azi un client care anulează după prima lună fără refund
   lasă setup-ul întreg plătit).
4. Prag de payout 50 lei (neschimbat), plată doar către PFA/SRL care facturează (§5)
   — **PROPUNERE**: azi regula e doar în texte, codul acceptă și `other` (m098:51, m190:77).

**Unde TVA:** exemplele de mai jos sunt pe **prețul listat**. Dacă firma e plătitoare
de TVA și prețurile includ TVA 21%, baza netă Menuvia/Webvia e 81,82 / 205,79 / 412,40 lei
(= preț / 1,21) și sumele Menuvia se înmulțesc cu 0,8264. La Codvia factorul NU e
0,8264: baza e marja, iar scoaterea TVA-ului scade marja cu venit × (1 − 1/1,21),
nu cu 17,36% din marjă (ex. 4 × plexiglas: venit 316, TVA 54,84, marja 171 → 116,16,
adică ×0,68). **Asta presupune costuri FĂRĂ TVA** (net), iar `CODVIA_LANSARE.md` B.1–B.3
nu spune pe ce bază sunt estimate. Dacă cele 145 lei de costuri (112 produs + 33 comandă)
sunt CU TVA deductibil, în marjă intră suma netă (145 / 1,21 = 119,83) și marja devine
261,16 − 119,83 = **141,32** (= 171 / 1,21, adică ×0,8264 ca la Menuvia). Pe un cost fără
TVA de dedus (furnizor neplătitor, bunuri/servicii nedeductibile) rămâne 116,16. Baza se
fixează pe facturile REALE de la furnizor și curier (0c), nu pe estimările din B.1.

### 3.2 Menuvia — abonament (PROPUNERE: gate-ul Plan 3 se RIDICĂ)

Recomandare: **comision pe toate planurile plătite** (`starter`, `growth`, `pro`,
`enterprise`) cu aceleași procente de azi (30% setup, 10% × 12 recurring, cascadă
2% din comision), plus condiția de a doua factură pentru setup.

Motivație: gate-ul din m099:106-109 e etichetat „regula de aur” în antet (m099:9-10),
dar regula de aur din CLAUDE.md privește feature-urile care ating plăți/bon fiscal,
nu comisionul; iar Fiscalizarea se vinde implicit prin WhatsApp (checkout-ul Stripe `pro`
e doar calea de rezervă, `PricingPage.tsx:208-215`), deci gate-ul face ca programul să
plătească aproape doar pe calea de rezervă. Gate-ul e etichetat în antetul m099 drept
regula de aur — ridicarea lui cere deci o decizie EXPLICITĂ de fondator (D2), nu o
interpretare.

| Plan (preț/lună) | Setup 30% | Recurring 10% / factură | Anul 1 (setup + 12) | Cascadă părinte (2% din comision), anul 1 |
|---|---:|---:|---:|---:|
| Meniu Digital + Rezervări (99) | 29,70 | 9,90 | 148,50 | 2,87 |
| Meniu + Comenzi (249) | 74,70 | 24,90 | 373,50 | 7,37 |
| Fiscalizare (499) | 149,70 | 49,90 | 748,50 | 14,87 |
| Custom / Lanțuri (enterprise) | 30% din factura reală | 10% | — (fără preț public) | 2% |

(Cascada se rotunjește în jos la ban pe FIECARE rând de comision, m099:191 — de
aceea 2,87 și nu 2,97: 0,59 + 12 × 0,19. Anul 1 = 13 facturi comisionate. Cu trial 30 zile sau pilot 60 zile, prima factură
cu bani vine după trial — `pricingCopy.ts:28-31` —, deci „anul 1” al agentului
începe la conversie.)

**Cost pentru Menuvia per client activ** (comision + cascadă, dacă agentul are părinte):

| Plan | Luna 1 (setup) | Lunile 2–13 | După factura 13 | % din venit, lunile 2–13 |
|---|---:|---:|---:|---:|
| 99 | 29,70 + 0,59 = 30,29 | 9,90 + 0,19 = 10,09 | 0 | ≈10,2% |
| 249 | 74,70 + 1,49 = 76,19 | 24,90 + 0,49 = 25,39 | 0 | ≈10,2% |
| 499 | 149,70 + 2,99 = 152,69 | 49,90 + 0,99 = 50,89 | 0 | ≈10,2% |

**Expunerea maximă per client** ≈ 1,5 × prețul lunar × 1,02 ≈ **1,53 luni de venit**
(aproximare înainte de rotunjire); exact, cu rotunjirea din cod: 151,37 lei (99) /
380,87 lei (249) / 763,37 lei (499). Peste TVA-ul facturat de
agentul plătitor de TVA (+21%, cost real dacă Menuvia nu-l poate deduce).
Comisioanele Stripe nu sunt cunoscute în repo (`ECOSISTEM.md:95`) — de adăugat la 0c.

Exemplu portofoliu: un agent cu 10 clienți pe 249 costă, după luna de setup,
253,90 lei/lună (10 × 25,39) timp de 12 luni, apoi 0.

**Upgrade.** Cu gate-ul ridicat, setup-ul cade pe prima factură plătită (ex. 249),
iar un upgrade ulterior la 499 continuă ca recurring la 10% din 499. Azi un client
growth→pro primește setup-ul pe prima factură pro (m099:132-149). **Risc de verificat
înainte de ridicarea gate-ului:** două facturi plătite în aceeași `period_month` (ciclul +
prorata facturată imediat la upgrade) devin ambele `recurring`; a doua lovește
`uq_affiliate_ledger_recurring_period` (m097:160-162), pe care `on conflict (stripe_event_id, leg)`
din m099:178 nu-l acoperă → excepție → webhook 500 → retry-uri (plauzibil, neverificat pe
configurația Stripe; tratat în §6.6).

**Cost al schimbării:** testele P0a și T4 (`tests/sql/affiliate_p0_assertions.sql:41-74`)
se rescriu în ACELAȘI PR cu migrația; calculatoarele publice (§1.3) devin adevărate
fără schimbare de cifre.

### 3.3 Codvia — vânzare unică de bunuri (PROPUNERE)

Baza: **marja de contribuție a comenzii** = venitul comenzii (inclusiv transportul
încasat de la client) − Σ cost unitar − costuri per comandă (ambalaj ~6, curier ramburs
~20–25, taxă ramburs ~3–6 lei). Toate costurile sunt IPOTEZE, nu oferte de furnizor
(`docs/vanzare/CODVIA_LANSARE.md:201-235`). Transportul de 25 lei sub 149 lei e
planificat, NU în cod (`CODVIA_LANSARE.md:239-243`), deci tabelul de mai jos folosește
scenariile fără transport; după 2a (comandă minimă 99 lei, transport 25 lei sub 149)
comenzile sub 149 lei primesc +25 lei la marjă (ex. 1 × PVC: −13 → +12).

Propunere: **20% din marja de contribuție**, podea 0 (comandă cu marjă negativă = 0),
o singură plată (fără recurring), plătibilă după livrare + 30 de zile, clawback
integral pe retur/retragere/ramburs refuzat. Hold-ul acoperă în principal refuzul la
ramburs și reclamațiile: dreptul de retragere de 14 zile NU se aplică produselor
personalizate (QR cu linkul meniului, gravură — adică majoritatea catalogului) și nici
cumpărătorilor B2B (`menuvia-pack/06-DRAFT-CODVIA-COMENZI.md:96, :102, :118`).

| Scenariu (`CODVIA_LANSARE.md:224-235`) | Marjă comandă | Comision 20% | Rămâne la Codvia |
|---|---:|---:|---:|
| 1 × PVC (29 lei) | −13 | 0 | −13 |
| 4 × PVC | +47 | 9,40 | 37,60 |
| 4 × plexiglas (79) — ținta | +171 | 34,20 | 136,80 |
| 10 × plexiglas | +495 | 99,00 | 396,00 |
| 2 × lemn gravat (129) | +135 | 27,00 | 108,00 |
| 1 × NFC combo (179) | +91 | 18,20 | 72,80 |
| 20 × PVC | +382 | 76,40 | 305,60 |

Expunere maximă: 20% din marjă, deci niciodată peste marja reală a comenzii.
Alternativa „% din venit” (ex. 10% × 316 lei — venitul brut listat, pe 4 × plexiglas —
= 31,60; pe baza netă de TVA, 26,12) plătește
și pe comenzile cu marjă negativă — respinsă.

Rolul Codvia e în primul rând achiziție pentru Menuvia (`CODVIA_LANSARE.md:24-26`):
un client Codvia care se abonează ulterior la Menuvia prin același agent generează
comision Menuvia normal (§3.2), deci atribuirea trebuie să treacă de la comanda Codvia
la profil (§6). Politica actuală „Codvia nu generează comision” (`AFILIATI_KIT.md:403`)
rămâne valabilă până la decizie.

### 3.4 Webvia — site livrat manual (PROPUNERE, fără preț)

Prețul nu există nicăieri în repo; ECOSISTEM cere **preț LISTAT înainte de prima
vânzare** (`ECOSISTEM.md:68`). Notăm:
- `P_W` = prețul unic al site-ului (fără TVA) — **îl stabilește fondatorul**;
- `R_W` = eventuala componentă recurentă (găzduire/mentenanță; contemplată ca
  `product='webvia'`, `scope_type='site'` în `subscriptions`, `ECOSISTEM.md:100`) — nestabilită.

Propunere: **15% din `P_W`** după încasarea integrală + 30 de zile hold, clawback pe
refund; **10% din `R_W` × 12 facturi** (aceeași logică ca Menuvia). Formulă de cost:
`0,15 × P_W + 1,2 × R_W` pe client. Fără cifre până nu există `P_W`.

### 3.5 Bookvia — fără comision

Fără venit la start (E6: densitate pe free, `ECOSISTEM.md:144`) → **fără bază**.
Plata pentru simpla listare a unui local fără venit ar fi recompensă fără vânzare
(linia roșie §4). Un local adus în Bookvia care se abonează la Menuvia prin agent
generează comision Menuvia. Comisionul Bookvia se decide când Bookvia facturează.

---

## 4. Subafiliați

**Ce există:** un nivel; părintele ia **2% din comisionul** subafiliatului (m099:188-202,
`cascade_bps` 200). În bani: 2,87 / 7,37 / 14,87 lei pe an per client pe
99 / 249 / 499 (§3.2) — practic simbolic. Adâncimea 1 e impusă în DATE (m097:222-254).
Bug de UX: subafiliatul vede un cod de recrutare care nu funcționează (§1.3).

**Ce vrea fondatorul:** „subafiliați etc.” — o rețea de agenți cu coordonatori.

**Variantă cu mai multe niveluri — DOAR ca întrebare pentru avocat**, nu ca plan:
ex. N1 = 5% din comisionul direct al subafiliatului, N2 = 2% (costul maxim suplimentar
per client pe 249: 7% × 373,50 = 26,15 lei în anul 1). Liniile roșii deja documentate
(Legea 363/2007, Dir. 2005/29/CE, CJUE 4finance C-515/12) rămân **necondiționate**:
- fără taxă de intrare / kit plătit;
- plată doar din vânzări reale către clienți finali, niciodată pe recrutare;
- fără recompensă condiționată de abonarea proprie a agentului;
- niciun nivel care nu e legat de o vânzare reală;
- fără „câștiguri garantate din echipă”.

Alternativă mai sigură de pus avocatului: un **coordonator** plătit din marja Menuvia
pentru vânzările echipei sale (override pe vânzare, nu pe recrutare), un singur nivel.

Până la răspuns: rămâne 1 nivel; se ascunde recrutarea pentru subafiliați.

---

## 5. Juridic și fiscal

### 5.1 Precondiții (nimic din §3 nu se plătește fără ele)

- **Nu există firmă** (`ECOSISTEM.md:32`): fără SRL Menuvia nu poate primi facturi de
  la afiliați și nu poate plăti comisioane. 0c = SRL → bancă → contabil → regim TVA →
  Stripe pe firmă → avocat pe draft-urile 02–06 (`ECOSISTEM.md:62`).
- **Contract de afiliere/agent** nescris — blocant pentru prima plată (`AFILIATI_KIT.md:39-43`).
- **Plata doar către PFA/SRL care facturează.** Plata unei persoane fizice
  neînregistrate ar face Menuvia plătitor de venit (reținere 10%, D100 lunar, D205
  anual, răspundere ANAF — raționamentul din brieful v1, **de validat cu contabilul**). Codul acceptă `other` (m098:51, m190:77) → decizie:
  se scoate `other` (migrație nouă + UI) sau se construiește fluxul de reținere.
- Comisionul e bază fără TVA; afiliatul plătitor de TVA adaugă 21% (L. 141/2025) —
  **de validat cu contabilul** (§5.3 q1).

### 5.2 Întrebări pentru avocat (păstrate + noi)

1. Tip de contract: prestări servicii de marketing/lead-generation (NCC 1851/1349),
   NU agenție (NCC 2072+) — agentul nu negociază, nu semnează, clientul contractează
   direct cu Menuvia.
2. Indemnizația de clientelă (NCC 2082-2095, imperativă): plafonul de 12 facturi ca
   *durată a contraprestației* cu recital, nu ca renunțare.
3. Reclasificare în contract de muncă (art. 7 Cod fiscal): structurare pe performanță
   și non-exclusivitate reală.
4. PFA ocazional (risc mic) vs SRL cu volum/exclusivitate de facto (candidat real la
   recalificare). **Nou:** un agent de teren care vinde 4 produse cu volum e exact
   profilul cu risc ridicat — ce clauze?
5. Anti-piramidal: validarea 1 nivel / 2%; **nou:** varianta cu 2 niveluri și
   varianta „coordonator” din §4.
6. Cross-border: doar rezidenți fiscali RO până la fluxul de taxare inversă?
7. GDPR cu afiliații (DPA, registru, temei art. 6(1)(b)/(c), retenție fiscală).
8. **Nou — acces partener:** afiliatul primește automat drepturi de manager pe toate
   restaurantele clientului, inclusiv PII oaspeți, comenzi, rezervări (m187:56-118,
   m193:39-55). DPA-ul (`menuvia-pack/05-DRAFT-DPA.md:18-20`) nu-i menționează.
   Ce calitate au (persoană autorizată a operatorului? sub-împuternicit?), ce clauză?
   Alternativa tehnică: acces doar la cererea explicită a owner-ului.
9. **Nou — Codvia:** comision pe vânzări unice de bunuri către consumatori
   (OUG 34/2014; drept de retragere 14 zile, excepția bunurilor personalizate):
   baza (fără TVA și transport?), clawback la retragere. Dacă agentul ia comanda sau
   încasează banii (ramburs/transfer), riscul de agenție crește — agentul doar trimite
   linkul?
10. **Nou — Webvia:** comision pe servicii livrate manual; relația cu draft-ul 07
    (prestări servicii + anexă DPA cu clientul-site ca operator).
11. **Nou — dreptul la ștergere:** `affiliates.profile_id` și
    `affiliate_attributions.referred_profile_id` sunt `ON DELETE RESTRICT` (m097:62-63, :90-91),
    iar `process_account_deletions` înghite eroarea per user (m284:311, :317-323) →
    un owner atribuit sau un afiliat **nu poate fi șters**. Ce se păstrează (retenție
    fiscală 10 ani pentru ledger/payout) și ce se pseudonimizează?

### 5.3 Întrebări pentru contabil (păstrate + noi)

1. TVA 21% pe comisionul afiliatului plătitor: cost bugetat? Baza fără TVA — confirmare.
2. Deductibilitate: contract + e-Factura + dovada conversiei (cod → client → factură plătită).
3. e-Factura B2B pentru facturile inbound afiliat → Menuvia: obligații.
4. Provizion pentru indemnizația de clientelă: parametru în raportare, nu tabel nou.
5. Plafonul de scutire TVA 395.000 RON (OG 22/2025) și impactul pe afiliații PFA.
6. **Nou:** 99/249/499 includ TVA? (decide baza comisionului, §3.1).
7. **Nou:** baza comisionului Codvia (marjă) — cum se documentează costul unitar
   pentru deductibilitate?
8. **Nou:** comision pe o comandă Codvia returnată după plata comisionului — clawback
   prin compensare pe payout-ul următor (sold negativ reportat) e acceptabil?

(Vechea întrebare 7.6 despre CN 2202/zahăr se mută în documentația de TVA a restaurantelor.)

---

## 6. Schiță tehnică — NU se implementează înainte de E9 + gate-ul 1

Fiecare pas = migrație NOUĂ (285+), manifest regenerat, `search_path = public, pg_temp`,
revoke explicit per rol (`public, anon, authenticated, service_role`), consumator în
același PR (`ECOSISTEM.md:110`). Filtrele `status='active'` NU se slăbesc (CLAUDE.md).

### 6.1 Precondiții (datorie existentă, independentă de multi-produs)
- RPC-uri founder pentru tranzițiile payout draft→awaiting_invoice→invoice_matched→processing
  (azi doar trigger, m106:37-87; singurul RPC e `admin_mark_payout_paid`, m193:96-141).
- RPC `admin_set_affiliate_status` (suspended/closed) + decizia ce se întâmplă cu soldul.
- `v_affiliate_payable` (m099:38-58) ignoră leg-ul `adjustment` → un ajustament pozitiv
  nu se plătește niciodată; se decide semantica înainte de a-l folosi.
- Ștergerea GDPR (§5.2 q11): lanțul `process_account_deletions` (…→282→284) primește
  tratarea tabelelor de afiliere.
- Pre-check de adâncime în `register_affiliate` (lanț 097d→188→224→243) + ascunderea
  recrutării pentru subafiliați.

### 6.2 Ledger per produs
- Enum `affiliate_product` (`menuvia`,`codvia`,`webvia`,`bookvia`).
- `affiliate_ledger.product` NOT NULL default `menuvia` (ADD COLUMN cu default — fără
  UPDATE, deci fără conflict cu trigger-ul WORM m097:180-194).
- Indexurile unice se extind cu `product`: setup unic per (atribuire, produs) (azi m105:23-25),
  recurring per (atribuire, produs, period_month) (azi m097:160-162).
- Leg nou `one_off` (Codvia/Webvia) în `affiliate_ledger_leg` — enum extins în fișier
  fără tranzacție (ca 230/233).

### 6.3 Reguli de comision
- Tabelă `affiliate_commission_rules(product, leg, base_kind in ('net_revenue','gross_margin'),
  bps, hold_days, cap_count, requires_second_invoice bool)` — founder-only, RLS fără politici
  pentru client; înlocuiește cheia `affiliate_commission_defaults` din `platform_settings` (m188).
- Override per afiliat: `affiliate_commission_overrides(affiliate_id, product, leg, bps)`
  (azi coloanele `*_bps` din `affiliates`, m097:60-77, editate prin
  `admin_set_affiliate_commission` m188:139-195). `cascade_bps` rămâne ne-public.
- `get_affiliate_public_defaults` (m189) întoarce regulile per produs — tot fără cascadă.

### 6.4 Atribuire per (client/restaurant, produs)
- `affiliate_attributions`: UNIQUE pe `referred_profile_id` (m097:90) → UNIQUE pe
  (`referred_profile_id`, `product`) sau per restaurant, conform Fazei 2 din
  `docs/RESTAURANT_SUBSCRIPTIONS.md:19-21, :102-108`.
- `capture_affiliate_attribution` (lanț 097c→100, live m100:75-140) primește `p_product`
  → semnătură nouă = DROP + CREATE (anti PGRST203). Fail-closed pe touch rămâne.
- Codvia: `codvia_orders` (planificat 2b, `ECOSISTEM.md:67`) primește `affiliate_id` +
  `visitor_id`, capturate de `codvia-order.js` din `mv_ref`/`mv_vid` și validate server-side
  cu același predicat de touch.
- `has_partner_access`/`list_partner_restaurants` (m193, schimbate ÎMPREUNĂ): accesul
  partener rămâne doar pe atribuiri `menuvia` și, după §5.2 q8, eventual opt-in.

### 6.5 Evenimente de venit non-Stripe (Codvia, Webvia manual)
- RPC founder `admin_record_affiliate_revenue_event(p_product, p_external_ref, p_attribution_id,
  p_net_cents, p_margin_cents, p_occurred_at)` — DEFINER, `is_platform_admin`, idempotent pe
  (`product`, `external_ref`, leg), scrie leg `one_off` cu hold din reguli, `audit_log`.
- RPC `admin_reverse_affiliate_revenue_event(p_product, p_external_ref, p_amount_cents, p_reason)`
  → leg `clawback` proporțional, oglinda `process_affiliate_refund` (m099:225-291).
- Consumator în același PR: formular în FounderPage + afișare în dashboard.

### 6.6 Stripe (Menuvia, eventual Webvia recurent)
- `process_affiliate_invoice_paid` (lanț 097b→099, live m099:73-206): gate-ul `not_plan3`
  → lookup în `affiliate_commission_rules`; `p_product` nou → DROP + CREATE. Testele
  P0a/T4 se rescriu în același PR. ÎNAINTE de ridicarea gate-ului: tratarea a două
  facturi plătite în aceeași `period_month` (upgrade cu prorata imediată, §3.2) — altfel
  indexul unic de recurring aruncă și webhook-ul intră în retry.
- `stripe-webhook.js:523-615` trimite `product` din `subscription.metadata.product`
  (`ECOSISTEM.md:45`); **`PLAN_BY_PRICE` rămâne STRICT Menuvia**, `PRICE_IDS` NU primește
  o a cincea cheie (`.every(Boolean)`, `stripe-checkout.js:49`).
- Entitlement-ul altor produse = tabela `subscriptions` SUB `profiles.plan`
  (`ECOSISTEM.md` §4, `:100-107`), cu backfill și măturarea tuturor scriitorilor de test ai
  `update public.profiles set plan` în același PR (CLAUDE.md, „Peretele profiles.plan”).
  Nicio valoare nouă în `profiles.plan` (CHECK-ul din 062 o respinge).

### 6.7 Payout și dashboard
- `run_affiliate_payout_batch` (lanț …→190): semantică neschimbată, sumează toate produsele;
  rămâne pe Netlify (denylist pg_cron, m274:218-219, m282:236-237).
- `get_affiliate_dashboard` (lanț 097d→110→174→188, live m188:371-509): câștiguri per produs
  (total/confirmat/în hold/plătit/recuperat), restaurante/comenzi per produs.
- `admin_list_affiliates` (lanț 186→188→224→236): păstrează TOATE câmpurile + totaluri per produs.

---

## 7. Decizii pentru fondator

| # | Decizie | Recomandare | Când |
|---|---|---|---|
| D1 | E9: recalcul sau închidere | Recalcul pe 99/249/499 (acest document); până atunci `/afiliat` nu mai primește cereri și spune că programul se redeschide după primii clienți. Recomandarea E9 suspendă și poarta FAZA 4 din PLAN_0_TO_HERO „≥1 venit prin afiliat” (`ECOSISTEM.md:147`) | înainte de 1b |
| D2 | Ridicarea gate-ului Plan 3 (m099:106-109) | DA, toate planurile plătite, 30% / 10% × 12 / 2% cascadă; cost max ≈ 1,53 luni de venit per client (§3.2) | cu D1 |
| D3 | Setup plătibil abia după a doua factură plătită | DA (anti-churn; azi clawback doar pe refund) | cu D1 |
| D4 | Baza: net fără TVA vs `amount_paid` brut | Net fără TVA — depinde de răspunsul contabilului (§5.3 q6) | 0c |
| D5 | Comision Codvia | 20% din marja de contribuție, podea 0, hold livrare + 30 zile | după 2a/2b + 0c |
| D6 | Prețul Webvia `P_W` (și `R_W`) | Stabilit și LISTAT înainte de prima vânzare; comision 15% din `P_W`, 10% × 12 din `R_W` | rândul 3 |
| D7 | Bookvia | Fără comision până la primul venit Bookvia | rândul 4 / E6 |
| D8 | Subafiliați pe mai multe niveluri | Doar după avizul avocatului (§4, §5.2 q5); până atunci 1 nivel + recrutare ascunsă pentru subafiliați | după 0c |
| D9 | `legal_form = 'other'` | Scos (doar PFA/SRL) sau flux de reținere 10% cu D100/D205 | înainte de primul payout |
| D10 | Accesul partener automat la datele restaurantului | Opt-in de către owner, după avizul avocatului (§5.2 q8) | înainte de prima aprobare |
| D11 | Ștergerea GDPR blocată de `ON DELETE RESTRICT` | Tratare în lanțul `process_account_deletions`, cu retenție fiscală pe ledger | înainte de prima aprobare |
| D12 | Calculatoarele publice pe growth (§1.3) | Corectate odată cu D1/D2 (devin adevărate dacă D2 = DA) | cu D1 |
| D13 | Suspendare: sold înghețat sau anulat | Anulat doar pentru comisioanele în hold, cu motiv în `audit_log`; RPC nou | înainte de prima aprobare |

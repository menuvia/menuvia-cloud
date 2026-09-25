# CODVIA — magazinul de suporturi QR fizice (brandul-frate)

> Numele a ieșit dintr-un juriu pe 29 de candidați (3 lentile: familie de brand,
> descriptiv RO, premium internațional): **Codvia, 88/100** — spune categoria
> („cod") fără s-o îngusteze, e frate sonor cu Menuvia și se scrie perfect după
> auz. Domenii verificate libere la decizie (30 iul 2026): codvia.ro, codvia.shop
> ($2,99/an), codvia.io, codvia.eu. `codvia.com` e luat.

## ⏸ Stare: comenzile sunt în PAUZĂ (24 sept 2026)

`codvia-order.js` refuză orice comandă cu 503 `orders_paused` cât timp
`CODVIA_ORDERS_OPEN` nu e EXACT `true` în env (fail-closed), iar `/codvia`
afișează „Comenzile sunt în pauză" în locul formularului (starea vine din GET
pe aceeași funcție — serverul e sursa unică). Motivul: pagina vinde bunuri
fizice și consumatorilor fără termeni de vânzare randați (draft 06), fără
confirmare pe suport durabil către cumpărător (emailul pleacă doar la fondator)
și acceptă 1 × PVC = −13 lei marjă (`docs/vanzare/CODVIA_LANSARE.md:228`).
Se redeschide (`CODVIA_ORDERS_OPEN=true`) după ce pariurile **2a + 2b** din
`docs/ECOSISTEM.md` §3 sunt livrate și publicate și după 0c (SRL + regim TVA).
Pauza e live abia după republicarea din 0a — până atunci build-ul din 31 aug ia
comenzi ca înainte. **Acest document e superseded de ECOSISTEM §3 pe patru
puncte:** modelul „confirmare telefonică în 24h” (contractul cu consumatorul se
încheie la acceptarea scrisă, 2b); `codvia_orders` „doar în v2” (e în 2b, înainte
de redeschidere); „Codvia se înscrie ca afiliat” (niciun afiliat aprobat până la
decizia E9); insert-ul din colet (fără adrese `@menuvia.ro` până la căsuța de
primire din 0b-2).
Teste: CO1–CO5 (`tests/functions/codvia-order.test.js`), CV1–CV3
(`src/pages/__tests__/CodviaPage.test.tsx`).

## Ce există în cod (v1, acest PR)

- **`/codvia`** (`src/pages/CodviaPage.tsx`) — landing + catalog 4 produse +
  formular de comandă. Pre-completare din query: `?slug=<meniu>` (dashboard) și
  `?produs=<cheie>`. Brand distinct (header/footer propriu), puntea spre Menuvia
  e explicită în ambele direcții.
- **`codvia-order.js`** (funcție Netlify) — validare + rate-limit (5/oră/IP,
  `check_rate_limit`) + lead în `recrutare_leads` cu `source='codvia_order'`
  (coloana nu are CHECK, mig 037 — fără migrație nouă) + email fondator prin
  Resend. Catalogul cu prețuri e sursă de adevăr pe SERVER (clientul trimite
  doar cheia produsului).
- **Dashboard → Acasă → „Suporturi QR fizice"** (QuickAction) — deschide
  `/codvia?slug=<slug-ul restaurantului>` în tab nou: comanda vine cu QR-ul
  REAL al meniului deja completat. Ăsta e cârligul reciproc.

**Model v1 (deliberat):** fără plată online — comanda → email → confirmare
telefonică în 24h → ramburs/transfer. Producția: tipografie/gravator local
(dropship, zero stoc). Nu promitem termene de livrare în copy până nu avem
furnizorul stabilizat.

## Pași de lansare (👤 fondator)

1. **Domenii**: `codvia.ro` de la un registrar românesc (~50 lei/an; NU prin
   Vercel la $111) + opțional `codvia.shop` ($2,99 prin Vercel, redirect).
   Verificare de 5 min pe OSIM + EUIPO pe „Codvia" ÎNAINTE de tipărituri.
2. **DNS**: în Netlify → Domain management → adaugă `codvia.ro` ca domain alias
   pe site-ul `menuvia`. Același bundle servește ambele domenii; pagina `/codvia`
   e punctul de intrare (redirect `/` → `/codvia` pe hostname `codvia.ro` se
   poate adăuga ulterior în `netlify.toml` sau prin detecție runtime ca în
   `lib/whiteLabel.ts`).
3. **Furnizor de producție**: o tipografie locală pentru PVC/plexi + un gravator
   pentru lemn/NFC. Cere mostre din fiecare înainte de prima comandă reală.
4. **Emailuri**: comenzile vin pe `RECRUTARE_NOTIFY_EMAIL` (fallback
   radu@menuvia.ro), subiect `[Codvia] …`; lead-urile se văd și în DB
   (`recrutare_leads` cu `source='codvia_order'`).

## Insert-ul din colet (textul, gata de tipar)

Față:
> **Acest QR poate mai mult.**
> Meniul digital cu comenzi la masă, în 7 limbi, cu import din poză prin AI.
> Prima lună gratuită: **menuvia.ro** · cod: `CODVIA`

Verso:
> Ai primit suporturile de la **Codvia** (codvia.ro) — mulțumim!
> Probleme cu comanda? pilot@menuvia.ro

Legătura de afiliere: Codvia se înscrie ca afiliat Menuvia prin fluxul existent
(`/afiliat`, cerere→aprobare din FounderPage) — atribuirea și comisioanele vin
din mașinăria deja construită (mig 097/188/224), zero cod nou.

## v2 (doar cu semnal de cerere — nu construi în avans)

- Tabelă `codvia_orders` proprie + statusuri de fulfilment (migrație nouă).
- Plată online (Stripe Checkout, pattern `ai-credits-checkout.js`).
- Generare automată a PDF-ului de print cu QR-ul meniului (lib/pdf.ts există).
- Detecție hostname `codvia.ro` → branding complet separat (pattern
  `lib/whiteLabel.ts`, promisiune memoizată la nivel de modul).

// src/lib/fiscalScreens.ts — ecranele fiscale ale Planului 3 (TVA, cotele,
// Casă de marcat / bridge, Ture de casă, Facturi Oblio) rămân DELIBERAT în
// română în orice limbă a personalului: sunt românești prin lege (bonul,
// raportul Z, declarația de TVA, e-Factura), iar o traducere ar pune pe ecran
// termeni care nu corespund documentelor reale.
//
// Două consecințe după activarea limbilor (precondițiile auditului):
//   - confirmările de pe aceste ecrane primesc `FISCAL_CONFIRM`: butonul de
//     renunțare fixat în română (implicit ar fi urmat `<html lang>` — „Cancel”
//     lângă „Anulează bon”, un dialog pe jumătate tradus) și `lang: 'ro'` pe
//     dialog (portalat în `document.body`, nu moștenește limba ecranului —
//     recenzia CodeRabbit pe #388);
//   - DashboardPage/SettingsTab le învelesc în `lang="ro"`, ca cititorul de
//     ecran să pronunțe textul românesc ca românesc.
// Româna e EXACT eticheta implicită (`confirm_cancel` din chrome.ts).
export const FISCAL_CONFIRM = { cancelLabel: 'Anulează', lang: 'ro' } as const

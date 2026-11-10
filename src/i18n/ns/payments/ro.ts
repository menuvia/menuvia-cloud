// Namespace `payments` — ÎNCASAREA și REDUCEREA de pe ecranul ospătarului
// (lotul L4b, partea a doua): PayModal (din WaiterOrderCard — „Înregistrează
// plată”, preflight-ul de supra-/sub-încasare, bacșișul, promoția Happy Hour),
// DiscountModal (reducerea pe comandă) și refuzul serverului la încasare
// (`describePayRejection`, lib/orders.ts). SURSA DE ADEVĂR: en/fr/de au tipul
// `Translation<typeof ro>`. Româna e BYTE-identică cu textele de dinainte —
// inclusiv „Se procesează…” cu ellipsis, „Se aplică...” cu trei puncte,
// ghilimeaua DREAPTĂ de închidere din „Plată parțială" și „lei off” din
// reducerea activă (textele de dinainte, păstrate ca atare).
// Banii rămân formatați EXACT ca înainte (`toFixed(2)` + „lei”), nu prin
// `fmt.money` (regula L3a). Numele regulii Happy Hour și motivul reducerii sunt
// date: intră ca `{x}`. Motivul scris în DB la aplicarea promoției
// („🎉 Happy Hour: …”, WaiterPage) e DATĂ, nu text de ecran — nu e aici.
// NU sunt aici: plata parțială din WaiterPage (`split_*` în `waiter`, partea
// întâi) și „Anulează” (din `common`).
const ro = {
  money: '{amount} lei',

  // ── PayModal ──
  pay_title: 'Înregistrează plată',
  pay_table: 'Masă: {table}',
  pay_subtotal: 'Subtotal:',
  pay_discount: 'Reducere:',
  pay_discountPct: 'Reducere ({value}%):',
  pay_minusMoney: '− {amount} lei',
  pay_totalDue: 'Total de plată:',
  pay_partiallyPaid: 'Plătit parțial:',
  pay_rest: 'Rest de plată:',
  pay_discountLocked: 'Reducerea nu se mai poate modifica: comanda are deja plăți înregistrate.',
  pay_discountEdit: 'Modifică / scoate reducerea',
  pay_discountApply: 'Aplică reducere',
  pay_promoActive: 'Promoție activă!',
  // `{rule}` = numele regulii (dată), `{value}` = valoarea brută a regulii.
  pay_promoPct: '{rule} · {value}%',
  pay_promoAmount: '{rule} · {value} lei',
  pay_promoApply: 'Aplică promoția',
  // Metodele de plată din PayModal (etichete scurte, butoane pe telefon).
  pay_method_cash: 'Cash',
  pay_method_card_pos: 'Card POS',
  pay_method_meal_voucher: 'Tichete de masă',
  pay_method_other: 'Altă metodă',
  pay_tips: 'Bacșiș',
  pay_tipsAmount: '({amount} lei)',
  pay_tipNone: 'Fără',
  pay_tipCustom: 'Sumă',
  pay_tipPct: '{pct}%',
  pay_amountLabel: 'Sumă încasată (lei)',
  pay_amountInclTips: '— include bacșiș',
  // Preflight-ul (informativ, NU blocant — serverul e gate-ul). Ramura „peste”
  // NU promite bacșiș automat: spune că serverul va respinge (mig 264).
  pay_preInvalid: 'Suma încasată nu e un număr valid (trebuie să fie mai mare ca 0).',
  pay_preUnder:
    'Suma pe notă ({net} fără bacșiș) e sub restul de plată ({rest}). Pentru încasare în tranșe folosește „Plată parțială".',
  pay_preOver:
    'Suma pe notă ({net} fără bacșiș) depășește restul ({rest}) — serverul va respinge plata. Dacă diferența e bacșiș, trece-o la Bacșiș.',
  pay_moveToTips: 'Trece {amount} lei la bacșiș',
  pay_errRejected: 'Plata nu a fost înregistrată. Verifică și reîncearcă.',
  pay_errNotRecorded: 'Plata nu a fost înregistrată.',
  pay_processing: 'Se procesează…',
  pay_confirm: 'Confirmă plata',

  // ── Refuzul încasării (describePayRejection, lib/orders.ts) ──
  // În română mesajul serverului primează pe under/overpayment și pe ramura
  // implicită (are sumele); în altă limbă un text românesc al serverului NU
  // se arată, deci rămâne textul hint-ului / `payRej_network` / `pay_errRejected`.
  payRej_amountMismatch: 'Suma nu corespunde restului de plată. Verifică suma (fără bacșiș) și reîncearcă.',
  payRej_amountRequired: 'Introdu suma încasată.',
  payRej_method: 'Metoda de plată nu poate fi înregistrată manual (plățile online vin din Stripe).',
  payRej_fiscal: 'Pe planul cu fiscalizare comanda se finalizează prin plată (bon fiscal).',
  payRej_role: 'Rolul tău nu permite înregistrarea plăților.',
  payRej_terminal: 'Comanda e deja finalizată.',
  payRej_withServer: 'Plata nu a fost înregistrată: {msg}',
  // Folosit DOAR în altă limbă decât româna (în română ramura implicită arată
  // mesajul tehnic al erorii de rețea, ca înainte).
  payRej_network: 'Fără conexiune — plata nu a fost trimisă. Reîncearcă.',

  // ── DiscountModal ──
  disc_title: '🎁 Reducere pe comandă',
  disc_active: 'Reducere activă:',
  disc_activePct: '{value}%',
  disc_off: '({amount} lei off)',
  disc_reasonShown: 'Motiv: {reason}',
  disc_modePct: 'Procent (%)',
  disc_modeAmount: 'Sumă fixă (lei)',
  disc_labelPct: 'Procent (1-100)',
  disc_labelAmount: 'Sumă în lei',
  disc_phPct: 'ex: 10',
  disc_phAmount: 'ex: 5.00',
  disc_reasonLabel: 'Motiv (opțional)',
  disc_reasonPh: 'ex: client fidel, problemă cu mâncarea, happy hour',
  disc_subtotal: 'Subtotal:',
  disc_discount: 'Reducere:',
  disc_minusMoney: '− {amount} lei',
  disc_newTotal: 'Total nou:',
  disc_remove: '🗑 Șterge reducerea actuală',
  disc_applying: 'Se aplică...',
  disc_update: 'Modifică',
  disc_apply: 'Aplică',
  disc_errApply: 'Eroare la aplicare',
  disc_errRemove: 'Eroare la ștergere',
  // Refuzurile de business ale RPC-urilor de reducere (mig 291), DOAR în altă
  // limbă decât româna (în română mesajul serverului rămâne ca atare).
  disc_errOverPayments: 'Comanda are deja plăți înregistrate — reducerea nu se mai poate modifica.',
  disc_errOnlinePayment: 'Comanda are o plată online în curs — reducerea nu se mai poate modifica până la finalizarea ei.',
}

export default ro

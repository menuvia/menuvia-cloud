// Detecția UNICĂ a erorilor de REȚEA (cererea n-a ajuns la server sau
// răspunsul s-a pierdut) — față de refuzurile de business, care au un mesaj
// al serverului și NU se reîncearcă.
//
// De ce un singur loc: fiecare ecran își scrisese propria listă de subșiruri
// (`fetch` / `network` / `Failed to fetch`), iar toate ratau exact browserul
// cel mai des întâlnit la mese — Safari pe iPhone, unde un fetch picat e
// `TypeError: Load failed`. Mesajul ajunge și prin supabase-js, care NU aruncă
// la o cădere de rețea: întoarce `{ error: { message: 'TypeError: Load failed',
// code: '' } }`. Efectul pe iPhone: comanda QR nu se mai reîncerca singură, iar
// comanda ospătarului nu intra în coada offline — ospătarul vedea textul brut
// în engleză și comanda nu pleca nicăieri.
//
// Textele, pe browser:
//   Chrome/Edge      TypeError: Failed to fetch
//                    TypeError: network error   (conexiunea cade în timpul citirii
//                    corpului: reset HTTP/2/QUIC după antetele 200 — comanda poate
//                    fi DEJA înregistrată, deci reîncercarea cu aceeași cheie de
//                    idempotență e exact ce trebuie)
//   Safari (iOS/mac) TypeError: Load failed
//                    The Internet connection appears to be offline.
//                    The network connection was lost.
//   Firefox          TypeError: NetworkError when attempting to fetch resource.
//   Node (teste/SSR) TypeError: fetch failed
//   cross-fetch/RN   Network request failed
// plus marcajele noastre interne (`network-error`, `offline`) și ECONNREFUSED.
//
// Fluxul OASPETELUI o folosește prin `isNetworkGuestError` (lib/guestErrors),
// care doar deleagă aici — fără a doua listă (NE6/NE7).

const NETWORK_MESSAGE =
  /failed to fetch|load failed|networkerror|network-error|\bnetwork error\b|network request failed|network connection was lost|internet connection appears to be offline|fetch failed|econnrefused|^offline$/i

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err
  if (err != null && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message
    return typeof m === 'string' ? m : ''
  }
  return ''
}

/** True dacă eroarea e o cădere de REȚEA (nu un refuz al serverului). */
export function isNetworkError(err: unknown): boolean {
  // `fetch` respinge DOAR cu TypeError când nu ajunge la server.
  if (err instanceof TypeError) return true
  return NETWORK_MESSAGE.test(messageOf(err))
}

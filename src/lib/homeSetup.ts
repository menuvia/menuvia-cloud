// ─────────────────────────────────────────────────────────────
// Pașii de configurare de pe „Acasă" (lotul C1): ce numărăm și ce ținem minte.
//
// (1) „Produse în meniu" = ce vede OASPETELE. Numărătoarea veche lua TOATE
//     produsele restaurantului, deci pasul „Adaugă produse" se bifa și cifra
//     arăta „12" pe un meniu QR gol: produse dezactivate, ciorne sau „Fără
//     categorie" (get_menu_for_restaurant construiește arborele din categorii,
//     mig 321). Filtrele de mai jos sunt EXACT `isGuestVisibleProduct`
//     (lib/menuTranslations.ts) — modifici unul, le modifici pe amândouă.
// (2) Cache-ul citirilor de setup, per restaurant, la nivel de modul: HomeTab se
//     REMONTEAZĂ la fiecare revenire pe Acasă (TabFade e keyed pe tab), deci fără
//     el fiecare vizită pornea de la „necunoscut" și cardul de configurare
//     clipea la un local configurat de mult. Cu el doar prima vizită din
//     sesiune așteaptă citirile; următoarele pornesc din ultima valoare
//     CUNOSCUTĂ și o reîmprospătează în fundal. O citire eșuată NU șterge
//     valoarea ținută (regula de la `productCount`: ultima valoare cunoscută,
//     niciodată un 0 inventat).
// (3) `everOrdered` are DOUĂ surse (citirea de existență de la montare și
//     „Comenzi azi", reîmprospătată), deci răspunsurile lor pot sosi în altă
//     ordine decât au plecat. Câștigă citirea PORNITĂ ultima, nu cea sosită
//     ultima: o existență pornită la montare care se întoarce târziu cu „încă
//     nicio comandă" nu rescrie comanda văzută între timp de „Comenzi azi"
//     (recenzia lotului C1). Singura cale de scriere e `rememberOrderObservation`.
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase'

/**
 * Câte produse vede oaspetele în meniul public: active, care nu sunt ciornă și
 * stau într-o categorie. `null` = necunoscut (citirea a eșuat), NU 0.
 */
export async function countMenuProducts(restaurantId: string): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .eq('is_draft', false)
      .not('category_id', 'is', null)
    if (error) return null
    return count ?? 0
  } catch {
    return null
  }
}

/** Ultimele valori CUNOSCUTE ale citirilor de setup; `null` = încă necitit. */
export interface HomeSetupSnapshot {
  tablesCount: number | null
  categoriesCount: number | null
  teamCount: number | null
  everOrdered: boolean | null
}

const EMPTY: HomeSetupSnapshot = {
  tablesCount: null,
  categoriesCount: null,
  teamCount: null,
  everOrdered: null,
}

const setupCache = new Map<string, HomeSetupSnapshot>()
// Marca citirii care a scris ULTIMA OARĂ `everOrdered`, per restaurant.
const orderMarks = new Map<string, number>()
// Contor strict crescător, comun tuturor restaurantelor: ordinea de PLECARE.
let orderReadSeq = 0

/** Ce știm despre restaurant din vizitele anterioare din sesiune. */
export function readHomeSetup(restaurantId: string): HomeSetupSnapshot {
  return setupCache.get(restaurantId) ?? EMPTY
}

/**
 * Ține minte valori citite CU SUCCES (o eroare nu ajunge aici). `everOrdered`
 * nu trece pe aici: are două surse care se pot întrece, vezi
 * `rememberOrderObservation`.
 */
export function rememberHomeSetup(
  restaurantId: string,
  patch: Partial<Omit<HomeSetupSnapshot, 'everOrdered'>>,
): void {
  setupCache.set(restaurantId, { ...readHomeSetup(restaurantId), ...patch })
}

/** Marca unei citiri care observă comenzile; se ia ÎNAINTE de a pleca cererea. */
export function beginOrderRead(): number {
  orderReadSeq += 1
  return orderReadSeq
}

/**
 * Ține minte ce a observat citirea pornită la `mark` despre comenzile
 * restaurantului, DOAR dacă nicio citire pornită după ea n-a scris deja.
 * Întoarce `true` dacă observația a fost primită — apelantul își actualizează
 * starea doar atunci, ca ecranul și cache-ul să nu se contrazică.
 */
export function rememberOrderObservation(
  restaurantId: string,
  mark: number,
  everOrdered: boolean,
): boolean {
  if ((orderMarks.get(restaurantId) ?? 0) > mark) return false
  orderMarks.set(restaurantId, mark)
  setupCache.set(restaurantId, { ...readHomeSetup(restaurantId), everOrdered })
  return true
}

/** Golește cache-ul (testele; aceeași fixtură de restaurant între teste). */
export function clearHomeSetupCache(): void {
  setupCache.clear()
  orderMarks.clear()
}

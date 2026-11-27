// Editorul de regulă Happy Hour (lotul C4a): dialog real, un singur „Creează”,
// prețuri cu virgulă, ordinea meniului. Textele în limbi sunt în
// HappyHourLang.test.tsx (HP0–HP6). Reducerea se aplică pe SERVER (mig 077);
// aici se verifică doar ce trimite editorul.
// (Prefixul HHM: verificat cu grep în src/, tests/, e2e/, supabase/, docs/ și
// CLAUDE.md, nefolosit înainte.)
//   HHM1 editorul e un dialog cu nume (`role="dialog"`, titlul „Regulă nouă”),
//        iar câmpurile au nume accesibile din etichetă (`<label htmlFor>`):
//        „Nume *”, „De la”, „Până la”, lista de categorii. Control pozitiv:
//        butonul „Creează regulă” e în dialog. Mutația care pică: overlay-ul
//        `div` de dinainte readus (fără rol) sau etichetele `<div style={lbl}>`.
//   HHM2 dublu-click pe „Creează regulă” cât cererea e în aer → regula se
//        creează O SINGURĂ dată, iar butonul arată „Se salvează…” dezactivat;
//        după un refuz butonul revine (control: a doua încercare pleacă).
//        Mutația care pică: garda `savingRef` / `disabled={saving}` scoasă.
//   HHM3 închiderea cu formularul modificat întreabă („Renunți la
//        modificări?”, „Rămân în editor”): refuzul lasă editorul deschis, ✕ +
//        acceptul îl închide; FĂRĂ modificări, „Anulează” închide direct, fără
//        întrebare (control). Mutația care pică: `confirmClose` scos de pe Modal
//        sau „Anulează” legat direct de `onClose`.
//   HHM4 valoarea și plafonul cu virgulă („12,5” / „7,5”) pleacă 12.5 / 7.5; un
//        plafon fără formă de număr („abc”) e o eroare, nu un plafon șters
//        tăcut (NaN → `null` în JSON). Mutația care pică: `type="number"` readus
//        (jsdom golește „12,5”) sau verificarea NaN a plafonului scoasă.
//   HHM5 categoriile se cer în ordinea MENIULUI (`display_order`), nu pe coloana
//        veche `position`. Mutația care pică: `.order('position')` readus.
//   HHM6 ștergerea trece prin confirm() (ui/confirm): refuzată → nimic șters;
//        acceptată → regula aleasă e ștearsă. Mutația care pică: ștergerea
//        fără confirmare.
// Recenzia lotului C4a:
//   HHM7 o valoare sau un plafon prea mare (309 cifre de 9 — `Infinity` pentru
//        `parseFloat`) e o eroare, nu o regulă trimisă: un plafon `Infinity`
//        pleca în JSON ca `null`, adică „fără plafon”. Control: „50” pe sumă
//        fixă pleacă. Mutația care pică: garda `Number.isFinite` scoasă din
//        `parseDecimalInput`.
//   HHM8 trecerea pe „Sumă fixă” șterge erorile care țin DOAR de procent
//        (plafon invalid, „Procent max 100”) — plafonul dispare, mesajul rămânea
//        lângă un câmp ascuns; o eroare care încă se aplică (numele gol) RĂMÂNE.
//        Mutația care pică: `setErr` scos din butonul „Sumă fixă”.
//   HHM9 cât cererea e în aer, formularul e blocat (o modificare tastată atunci
//        nu intra în cerere și se pierdea la succes) și la fel ÎNCHIDEREA:
//        „Anulează” (în formular), ✕, Escape și fundalul nu închid și nu
//        întreabă, chiar cu „Renunță” acceptat — altfel succesul cererii vechi
//        închidea un editor redeschis între timp, iar regula redeschisă pornea
//        de la valorile de dinainte de salvare (salvată, readucea reducerea
//        veche). După un refuz totul se deblochează cu ce s-a tastat. Controale:
//        fără cerere în aer, ACELAȘI Escape întreabă (deci ajunge la editor),
//        iar după succes editorul se închide. Mutațiile care pică:
//        `fieldset disabled={saving}` scos, sau `confirmDiscard` care lasă
//        închiderea cât se salvează (varianta cu `editorSeq` din a2e908a).
//   HHM10 o CREARE fără răspuns NU blochează panoul la nesfârșit și nici nu
//        lasă omul să ghicească: exact la HAPPY_HOUR_SAVE_TIMEOUT_MS cererea e
//        ANULATĂ (semnalul ei), editorul rămâne blocat pe „Se verifică…” cât
//        fila reîncarcă lista (cu semnal propriu, deci mărginită), iar când
//        lista arată o regulă NOUĂ cu numele ciornei, salvarea e confirmată:
//        editorul se închide, un toast spune că s-a salvat după ce conexiunea
//        și-a revenit, regula e în listă, fără o a doua creare. Control: cu 1 ms
//        înainte de termen totul e încă blocat, nimic reîncărcat. Mutațiile care
//        pică: fără `Promise.race` cu termenul (blocaj), fără `ctrl.abort()`,
//        verificarea scoasă (editorul rămânea deschis, peste lista care avea
//        deja regula — reîncercarea o dubla) sau toast-ul scos.
//   HHM11 reîncărcarea de verificare nu demontează editorul deschis pe o filă
//        FĂRĂ reguli: același dialog, aceeași ciornă, fără spinnerul filei, cât
//        ea e în aer și după ce arată că regula NU a ajuns (atunci: deblocat,
//        mesajul „nu s-a salvat”). Control: PRIMA încărcare chiar arată
//        spinnerul pe toată fila. Mutația care pică: `if (loading &&
//        rules.length === 0) return <InlineSpinner/>` readus.
//   HHM12 numele ciornei pe o regulă care EXISTA dinainte („Seara”) nu e o
//        confirmare: verificarea caută o regulă NOUĂ (id absent înaintea primei
//        încercări), deci editorul rămâne deschis cu „nu s-a salvat”, iar
//        reîncercarea verifică ÎNTÂI lista și abia apoi trimite crearea.
//        Mutațiile care pică: potrivirea doar pe nume (închidea editorul peste o
//        regulă care nu s-a creat) sau reîncercarea fără verificare.
//   HHM13 INSERT-ul anulat în client poate fi comis și DUPĂ verificarea de la
//        termen: reîncercarea îl găsește în listă și scrie peste EL ce e acum în
//        formular (o modificare, nu încă o regulă) — o singură creare, valorile
//        noi. Mutația care pică: reîncercarea fără verificarea dinainte (a doua
//        regulă „Brunch”, care rămânea să reducă comenzile, mig 077).
//   HHM14 când lista de verificare pică sau nu răspunde, editorul o SPUNE (nu
//        doar bannerul filei, ascuns sub overlay): „nu se știe dacă salvarea a
//        ajuns”, deblocat, cu ciorna; verificarea are termen propriu
//        (HAPPY_HOUR_VERIFY_TIMEOUT_MS, cererea ei anulată), iar cât lista nu se
//        poate citi reîncercarea NU trimite nimic; când lista revine (fără
//        regulă), crearea pleacă. Control: cu 1 ms înainte de termenul
//        verificării, încă „Se verifică…”. Mutațiile care pică: verificarea fără
//        termen (blocaj), reîncercarea care trimite fără listă, mesajul doar pe
//        banner.
//   HHM15 o MODIFICARE fără răspuns: dacă rândul reîncărcat are exact valorile
//        trimise, s-a salvat (editorul se închide, toast); dacă nu, editorul
//        rămâne deschis cu „modificarea nu s-a salvat” și ciorna. Mutațiile care
//        pică: confirmarea pe simpla prezență a rândului (a doua jumătate) sau
//        „nu s-a salvat” mereu (prima).
//   HHM16 schimbarea restaurantului pe ACEEAȘI instanță: încărcarea întârziată a
//        celui vechi nu mai scrie nimic — fila rămâne pe regulile noului
//        restaurant, fără spinner. Mutația care pică: garda de secvență din
//        `load` scoasă (spinner pe toată fila, pentru totdeauna).
//   HHM17 DashboardPage montează fila pe cheia restaurantului (`key={restaurant.id}`,
//        ca FloorPlanEditor; recenzia CodeRabbit pe #393), deci o schimbare de
//        locație o montează din nou. Control pozitiv: același tipar prinde
//        cheia lui FloorPlanEditor și NU prinde un element fără cheie. Mutația
//        care pică: cheia scoasă.
//   HHM18 cu lista refuzată la încărcare, o regulă NOUĂ nu pleacă orbește:
//        editorul cere lista întâi (fără ea, o creare fără răspuns n-ar mai
//        putea fi verificată) și spune că nu s-a trimis nimic; cu lista
//        venită, crearea pleacă. Mutația care pică: id-urile „de dinainte”
//        luate dintr-o listă goală, refuzată (orice regulă existentă cu numele
//        ciornei ar fi trecut drept salvarea ei).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HappyHourRule } from '../../lib/happyHour'
import type { ConfirmOptions } from '../ui/confirm'
import promotionsRo from '../../i18n/ns/promotions/ro'

type NewRule = Omit<HappyHourRule, 'id' | 'restaurant_id' | 'created_at' | 'updated_at'>

const h = vi.hoisted(() => ({
  rules: [] as HappyHourRule[],
  // Regulile altui restaurant (HHM16); implicit `rules`.
  rulesBy: {} as Record<string, HappyHourRule[]>,
  created: [] as NewRule[],
  // Semnalul primit de fiecare creare (HHM10: anulată la termen).
  signals: [] as (AbortSignal | null)[],
  updated: [] as [string, Partial<HappyHourRule>][],
  deleted: [] as string[],
  // Cererea de creare/modificare rămâne „în aer” până o rezolvă testul (HHM2).
  pending: null as null | { resolve: () => void; reject: (e: unknown) => void },
  holdCreate: false,
  holdUpdate: false,
  // Încărcările listei: numărate, cu semnalul lor; fiecare consumă un pas din
  // plan („ok” implicit, „fail” refuzată, „hold” în aer până o eliberează testul).
  fetches: 0,
  fetchSignals: [] as (AbortSignal | null)[],
  fetchPlan: [] as ('ok' | 'fail' | 'hold')[],
  held: [] as { release: () => void }[],
  // Ordinea cererilor (verificarea dinaintea unei reîncercări, HHM12–HHM14).
  log: [] as string[],
  toasts: [] as [string, string][],
  orders: [] as [string, string][],
  confirm: [] as ConfirmOptions[],
  answer: false,
  // Ca supabase-js: o cerere anulată se încheie cu eroarea `AbortError`. (În
  // `vi.hoisted`: factory-urile `vi.mock` sunt ridicate deasupra oricărei
  // constante a fișierului.)
  aborted: { message: 'AbortError: signal is aborted without reason', code: '20' },
}))

vi.mock('../ui/confirm', () => ({
  confirm: async (o: ConfirmOptions) => {
    h.confirm.push(o)
    return h.answer
  },
}))
vi.mock('../ui/useToast', () => {
  const push = (kind: string) => (m: string) => {
    h.toasts.push([kind, m])
  }
  const api = {
    success: push('success'),
    error: push('error'),
    warning: push('warning'),
    info: push('info'),
    dismiss: () => {},
  }
  return { useToast: () => api }
})
vi.mock('../../lib/happyHour', () => ({
  fetchHappyHourRules: (rid: string, signal?: AbortSignal) => {
    h.fetches += 1
    h.fetchSignals.push(signal ?? null)
    h.log.push('fetch')
    const list = () => [...(h.rulesBy[rid] ?? h.rules)]
    const step = h.fetchPlan.shift() ?? 'ok'
    if (step === 'ok') return Promise.resolve(list())
    if (step === 'fail') return Promise.reject({ message: 'TypeError: Failed to fetch' })
    return new Promise<HappyHourRule[]>((resolve, reject) => {
      h.held.push({ release: () => resolve(list()) })
      signal?.addEventListener('abort', () => reject(h.aborted))
    })
  },
  evaluateHappyHourForNow: async () => [],
  createHappyHourRule: (_rid: string, fields: NewRule, signal?: AbortSignal) => {
    h.created.push(fields)
    h.signals.push(signal ?? null)
    h.log.push('create')
    if (!h.holdCreate) return Promise.resolve(h.rules[0])
    return new Promise<void>((resolve, reject) => {
      h.pending = { resolve, reject }
      signal?.addEventListener('abort', () => reject(h.aborted))
    })
  },
  updateHappyHourRule: (id: string, fields: Partial<HappyHourRule>, signal?: AbortSignal) => {
    h.updated.push([id, fields])
    h.log.push('update')
    if (!h.holdUpdate) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      h.pending = { resolve, reject }
      signal?.addEventListener('abort', () => reject(h.aborted))
    })
  },
  deleteHappyHourRule: async (id: string) => {
    h.deleted.push(id)
  },
}))
vi.mock('../../lib/supabase', () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'abortSignal']) b[m] = () => b
    b.order = (col: string) => {
      h.orders.push([table, col])
      return b
    }
    b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({
        data:
          table === 'categories'
            ? [
                { id: 'c1', name: 'Cocktailuri', emoji: '🍹' },
                { id: 'c2', name: 'Bere', emoji: '🍺' },
              ]
            : [],
        error: null,
      }).then(resolve)
    return b
  }
  return { supabase: { from: (t: string) => builder(t) } }
})
vi.mock('../../hooks/usePollWhileVisible', () => ({ usePollWhileVisible: () => {} }))
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }))

import HappyHourTab, { HAPPY_HOUR_SAVE_TIMEOUT_MS, HAPPY_HOUR_VERIFY_TIMEOUT_MS } from '../HappyHourTab'

function rule(over: Partial<HappyHourRule>): HappyHourRule {
  return {
    id: 'r1',
    restaurant_id: 'rest-1',
    name: 'Happy',
    is_active: true,
    starts_at: '17:00:00',
    ends_at: '19:00:00',
    days_of_week: [],
    scope: 'all',
    category_id: null,
    product_id: null,
    discount_type: 'percent',
    discount_value: 20,
    max_discount: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    ...over,
  }
}

beforeEach(() => {
  h.rules = [rule({}), rule({ id: 'r2', name: 'Seara' })]
  h.rulesBy = {}
  h.created = []
  h.signals = []
  h.updated = []
  h.deleted = []
  h.pending = null
  h.holdCreate = false
  h.holdUpdate = false
  h.fetches = 0
  h.fetchSignals = []
  h.fetchPlan = []
  h.held = []
  h.log = []
  h.toasts = []
  h.orders = []
  h.confirm = []
  h.answer = false
})
// HHM10–HHM15 folosesc ceasul fals doar în jurul termenului; un test picat în
// mijloc nu are voie să-l lase următorului.
afterEach(() => {
  vi.useRealTimers()
})

// Avansează ceasul fals și lasă promisiunile să se așeze (tiparul din
// PayTableSheet.test.tsx). Doar `fireEvent` și interogări sincrone cât ceasul e
// fals: `userEvent` și `waitFor`/`findBy` își programează pașii pe `setTimeout`.
async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function openNew() {
  const user = userEvent.setup()
  render(<HappyHourTab restaurantId="rest-1" payAtTable={false} />)
  await screen.findByText('Seara')
  await user.click(screen.getByRole('button', { name: 'Regulă nouă' }))
  return { user, dlg: screen.getByRole('dialog', { name: 'Regulă nouă' }) }
}

describe('editorul Happy Hour (lotul C4a)', () => {
  it('HHM1 dialog real, cu câmpuri numite', async () => {
    const { user, dlg } = await openNew()
    expect(within(dlg).getByRole('button', { name: 'Creează regulă' })).toBeInTheDocument()
    expect(within(dlg).getByLabelText('Nume *')).toHaveAttribute('placeholder', 'ex: Happy Hour 17-19')
    expect(within(dlg).getByLabelText('De la')).toHaveValue('17:00')
    expect(within(dlg).getByLabelText('Până la')).toHaveValue('19:00')
    expect(within(dlg).getByRole('group', { name: 'Zilele săptămânii (gol = toate)' })).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Categorie' }))
    expect(within(dlg).getByRole('button', { name: 'Categorie' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dlg).getByRole('combobox', { name: 'Categorie' })).toBeInTheDocument()
  })

  it('HHM2 dublu-click: regula se creează o singură dată', async () => {
    h.holdCreate = true
    const { user, dlg } = await openNew()
    await user.type(within(dlg).getByLabelText('Nume *'), 'Seara de joi')
    const create = within(dlg).getByRole('button', { name: 'Creează regulă' })
    await user.dblClick(create)
    await user.click(create)
    expect(h.created).toHaveLength(1)
    const busy = within(dlg).getByRole('button', { name: 'Se salvează…' })
    expect(busy).toBeDisabled()

    // Refuzul deblochează butonul: a doua încercare pleacă (control).
    h.pending?.reject({ message: 'Nu ai voie.', code: '42501' })
    expect(await within(dlg).findByRole('button', { name: 'Creează regulă' })).toBeEnabled()
    h.holdCreate = false
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() => expect(h.created).toHaveLength(2))
  })

  it('HHM3 închiderea cu modificări întreabă; fără modificări, nu', async () => {
    const { user, dlg } = await openNew()
    // Control: neatins → „Anulează” închide direct, fără întrebare.
    await user.click(within(dlg).getByRole('button', { name: 'Anulează' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.confirm).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Regulă nouă' }))
    let open = screen.getByRole('dialog', { name: 'Regulă nouă' })
    await user.type(within(open).getByLabelText('Nume *'), 'Brunch')
    await user.click(within(open).getByRole('button', { name: 'Anulează' }))
    await waitFor(() => expect(h.confirm).toHaveLength(1))
    expect(h.confirm[0]).toMatchObject({ title: 'Renunți la modificări?', cancelLabel: 'Rămân în editor' })
    open = screen.getByRole('dialog', { name: 'Regulă nouă' })
    expect(within(open).getByLabelText('Nume *')).toHaveValue('Brunch')

    h.answer = true
    await user.click(within(open).getByRole('button', { name: 'Închide' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.confirm).toHaveLength(2)
    expect(h.created).toHaveLength(0)
  })

  it('HHM4 valoarea și plafonul cu virgulă; plafonul invalid e o eroare', async () => {
    const { user, dlg } = await openNew()
    await user.type(within(dlg).getByLabelText('Nume *'), 'Happy')
    const value = within(dlg).getByLabelText('Valoarea reducerii')
    await user.clear(value)
    await user.type(value, '12,5')
    const cap = within(dlg).getByLabelText('Plafon maxim în lei, opțional')
    await user.type(cap, 'abc')
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Plafonul nu e un număr valid')
    expect(cap).toHaveAttribute('aria-invalid', 'true')
    expect(h.created).toHaveLength(0)

    await user.clear(cap)
    await user.type(cap, '7,5')
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() => expect(h.created).toHaveLength(1))
    expect(h.created[0]).toMatchObject({ discount_type: 'percent', discount_value: 12.5, max_discount: 7.5 })
  })

  it('HHM5 categoriile în ordinea meniului', async () => {
    render(<HappyHourTab restaurantId="rest-1" payAtTable={false} />)
    await screen.findByText('Seara')
    expect(h.orders).toContainEqual(['categories', 'display_order'])
    expect(h.orders).not.toContainEqual(['categories', 'position'])
  })

  it('HHM6 ștergerea cere confirmare', async () => {
    const user = userEvent.setup()
    render(<HappyHourTab restaurantId="rest-1" payAtTable={false} />)
    await screen.findByText('Seara')
    await user.click(screen.getByRole('button', { name: 'Șterge regula Seara' }))
    await waitFor(() => expect(h.confirm).toHaveLength(1))
    expect(h.confirm[0]).toMatchObject({
      title: 'Ștergi regula?',
      description: 'Vrei să ștergi Seara? Acțiunea e ireversibilă.',
      confirmLabel: 'Șterge',
      cancelLabel: 'Anulează',
      destructive: true,
    })
    expect(h.deleted).toEqual([])

    h.answer = true
    await user.click(screen.getByRole('button', { name: 'Șterge regula Seara' }))
    await waitFor(() => expect(h.deleted).toEqual(['r2']))
  })

  it('HHM7 o valoare sau un plafon prea mare e o eroare', async () => {
    const huge = '9'.repeat(309)
    const { user, dlg } = await openNew()
    await user.type(within(dlg).getByLabelText('Nume *'), 'Happy')
    const cap = within(dlg).getByLabelText('Plafon maxim în lei, opțional')
    fireEvent.change(cap, { target: { value: huge } })
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Plafonul nu e un număr valid')
    expect(cap).toHaveAttribute('aria-invalid', 'true')
    expect(h.created).toHaveLength(0)

    await user.click(within(dlg).getByRole('button', { name: 'Sumă fixă (lei)' }))
    const value = within(dlg).getByLabelText('Valoarea reducerii')
    fireEvent.change(value, { target: { value: huge } })
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Valoarea nu e un număr valid')
    expect(value).toHaveAttribute('aria-invalid', 'true')
    expect(h.created).toHaveLength(0)

    // Control: o sumă obișnuită pleacă.
    fireEvent.change(value, { target: { value: '50' } })
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() => expect(h.created).toHaveLength(1))
    expect(h.created[0]).toMatchObject({
      discount_type: 'amount',
      discount_value: 50,
      max_discount: null,
    })
  })

  it('HHM8 „Sumă fixă” șterge doar erorile de procent', async () => {
    const { user, dlg } = await openNew()
    await user.type(within(dlg).getByLabelText('Nume *'), 'Happy')
    await user.type(within(dlg).getByLabelText('Plafon maxim în lei, opțional'), 'abc')
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Plafonul nu e un număr valid')
    await user.click(within(dlg).getByRole('button', { name: 'Sumă fixă (lei)' }))
    expect(within(dlg).queryByRole('alert')).toBeNull()
    expect(within(dlg).queryByLabelText('Plafon maxim în lei, opțional')).toBeNull()

    // „Procent max 100” nu se aplică unei sume în lei: 150 lei pleacă.
    await user.click(within(dlg).getByRole('button', { name: 'Procent (%)' }))
    const value = within(dlg).getByLabelText('Valoarea reducerii')
    await user.clear(value)
    await user.type(value, '150')
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Procent max 100')
    await user.click(within(dlg).getByRole('button', { name: 'Sumă fixă (lei)' }))
    expect(within(dlg).queryByRole('alert')).toBeNull()
    expect(value).not.toHaveAttribute('aria-invalid')

    // Control: o eroare care încă se aplică (numele gol) rămâne.
    await user.click(within(dlg).getByRole('button', { name: 'Procent (%)' }))
    await user.clear(within(dlg).getByLabelText('Nume *'))
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Numele e obligatoriu')
    await user.click(within(dlg).getByRole('button', { name: 'Sumă fixă (lei)' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Numele e obligatoriu')
    expect(h.created).toHaveLength(0)

    await user.type(within(dlg).getByLabelText('Nume *'), 'Happy')
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() => expect(h.created).toHaveLength(1))
    expect(h.created[0]).toMatchObject({
      discount_type: 'amount',
      discount_value: 150,
      max_discount: null,
    })
  })

  it('HHM9 cât se salvează, formularul și închiderea sunt blocate; refuzul le deblochează', async () => {
    h.holdCreate = true
    const { user, dlg } = await openNew()
    const name = within(dlg).getByLabelText('Nume *')
    await user.type(name, 'Brunch')
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(h.created).toHaveLength(1)
    expect(name).toBeDisabled()
    expect(within(dlg).getByLabelText('Valoarea reducerii')).toBeDisabled()
    expect(within(dlg).getByRole('button', { name: 'Categorie' })).toBeDisabled()
    expect(within(dlg).getByRole('button', { name: 'Anulează' })).toBeDisabled()

    // ✕ (în antetul dialogului, în afara formularului), Escape și fundalul nu
    // închid și nu întreabă, chiar dacă „Renunță” ar fi acceptat.
    h.answer = true
    await user.click(within(dlg).getByRole('button', { name: 'Închide' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    await user.click(dlg.parentElement as HTMLElement)
    expect(h.confirm).toHaveLength(0)
    expect(screen.getByRole('dialog', { name: 'Regulă nouă' })).toBe(dlg)

    // Refuzul deblochează totul, cu ce s-a tastat.
    h.pending?.reject({ message: 'Nu ai voie.', code: '42501' })
    await waitFor(() => expect(name).toBeEnabled())
    expect(name).toHaveValue('Brunch')
    expect(within(dlg).getByRole('button', { name: 'Anulează' })).toBeEnabled()

    // Control: fără cerere în aer, ACELAȘI Escape întreabă (deci ajunge la
    // editor); refuzată, întrebarea lasă editorul deschis.
    h.answer = false
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(h.confirm).toHaveLength(1))
    expect(screen.getByRole('dialog', { name: 'Regulă nouă' })).toBe(dlg)

    // Control: după succes editorul se închide.
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(h.created).toHaveLength(2)
    h.pending?.resolve()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('HHM10 crearea fără răspuns, găsită de verificare: editorul se închide, cu mesaj', async () => {
    h.holdCreate = true
    const { user, dlg } = await openNew()
    const name = within(dlg).getByLabelText('Nume *')
    await user.type(name, 'Brunch')
    expect(h.fetches).toBe(1)

    vi.useFakeTimers()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await flush()
    expect(h.created).toHaveLength(1)
    const signal = h.signals[0]
    expect(signal?.aborted).toBe(false)

    // Control: cu 1 ms înainte de termen, totul e încă blocat, nimic reîncărcat.
    await flush(HAPPY_HOUR_SAVE_TIMEOUT_MS - 1)
    expect(name).toBeDisabled()
    expect(within(dlg).queryByRole('alert')).toBeNull()
    expect(signal?.aborted).toBe(false)
    expect(h.fetches).toBe(1)

    // La termen: cererea anulată, verificarea pornită (cu semnal propriu) și
    // editorul tot blocat cât ea e în aer.
    h.fetchPlan = ['hold']
    await flush(1)
    expect(signal?.aborted).toBe(true)
    expect(h.fetches).toBe(2)
    expect(h.fetchSignals[1]?.aborted).toBe(false)
    expect(name).toBeDisabled()
    expect(within(dlg).getByRole('button', { name: 'Se verifică…' })).toBeDisabled()

    // INSERT-ul ajunsese: lista arată regula NOUĂ cu numele ciornei.
    h.rules = [...h.rules, rule({ id: 'r3', name: 'Brunch' })]
    h.held[0].release()
    await flush()
    await flush()
    vi.useRealTimers()

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.toasts).toEqual([['success', promotionsRo.saved_late]])
    expect(screen.getByText('Brunch')).toBeInTheDocument()
    expect(h.created).toHaveLength(1)
    // Lista verificării e cea afișată: nicio încărcare în plus după închidere.
    expect(h.fetches).toBe(2)
  })

  it('HHM11 verificarea în fundal nu demontează editorul deschis (fila fără reguli)', async () => {
    h.rules = []
    h.holdCreate = true
    h.fetchPlan = ['hold']
    const user = userEvent.setup()
    render(<HappyHourTab restaurantId="rest-1" payAtTable={false} />)
    // Control: PRIMA încărcare ține spinnerul pe toată fila.
    expect(await screen.findByText('Se încarcă regulile...')).toBeInTheDocument()
    h.held[0].release()
    expect(await screen.findByText('Nicio regulă încă')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Regulă nouă' }))
    const dlg = screen.getByRole('dialog', { name: 'Regulă nouă' })
    const name = within(dlg).getByLabelText('Nume *')
    await user.type(name, 'Brunch')

    // Salvarea ajunge la termen; verificarea rămâne „în aer”.
    vi.useFakeTimers()
    h.fetchPlan = ['hold']
    fireEvent.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await flush(HAPPY_HOUR_SAVE_TIMEOUT_MS)
    expect(h.fetches).toBe(2)
    expect(screen.queryByText('Se încarcă regulile...')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Regulă nouă' })).toBe(dlg)
    expect(name).toHaveValue('Brunch')

    // Verificarea se întoarce fără regulă: același editor, deblocat, ciorna.
    h.held[1].release()
    await flush()
    await flush()
    vi.useRealTimers()
    expect(screen.queryByText('Se încarcă regulile...')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Regulă nouă' })).toBe(dlg)
    expect(name).toBeEnabled()
    expect(name).toHaveValue('Brunch')
    expect(within(dlg).getByRole('alert').textContent).toBe(promotionsRo.err_notSavedCreate)
    expect(screen.getByText('Nicio regulă încă')).toBeInTheDocument()
  })

  it('HHM12 o regulă existentă cu numele ciornei nu confirmă; reîncercarea verifică întâi', async () => {
    h.holdCreate = true
    const { user, dlg } = await openNew()
    const name = within(dlg).getByLabelText('Nume *')
    // „Seara” EXISTĂ dinainte (r2): nu e regula acestui editor.
    await user.type(name, 'Seara')

    vi.useFakeTimers()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await flush(HAPPY_HOUR_SAVE_TIMEOUT_MS)
    await flush()
    vi.useRealTimers()

    expect(h.fetches).toBe(2)
    expect(screen.getByRole('dialog', { name: 'Regulă nouă' })).toBe(dlg)
    expect(name).toBeEnabled()
    expect(name).toHaveValue('Seara')
    expect(within(dlg).getByRole('alert').textContent).toBe(promotionsRo.err_notSavedCreate)
    expect(h.toasts).toEqual([])

    // Reîncercarea: ÎNTÂI lista, apoi crearea (care acum reușește).
    h.holdCreate = false
    h.log = []
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.log.slice(0, 2)).toEqual(['fetch', 'create'])
    expect(h.created).toHaveLength(2)
    expect(h.toasts).toEqual([])
  })

  it('HHM13 INSERT-ul comis după verificare: reîncercarea îl modifică, nu creează altul', async () => {
    h.holdCreate = true
    const { user, dlg } = await openNew()
    await user.type(within(dlg).getByLabelText('Nume *'), 'Brunch')

    vi.useFakeTimers()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await flush(HAPPY_HOUR_SAVE_TIMEOUT_MS)
    await flush()
    vi.useRealTimers()
    expect(within(dlg).getByRole('alert').textContent).toBe(promotionsRo.err_notSavedCreate)

    // Omul schimbă valoarea; între timp INSERT-ul anulat a fost totuși comis.
    const value = within(dlg).getByLabelText('Valoarea reducerii')
    await user.clear(value)
    await user.type(value, '25')
    h.rules = [...h.rules, rule({ id: 'r3', name: 'Brunch' })]

    h.log = []
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.log.slice(0, 2)).toEqual(['fetch', 'update'])
    expect(h.created).toHaveLength(1)
    expect(h.updated).toHaveLength(1)
    expect(h.updated[0][0]).toBe('r3')
    expect(h.updated[0][1]).toMatchObject({ name: 'Brunch', discount_value: 25 })
  })

  it('HHM14 lista de verificare picată sau mută: editorul o spune și nu trimite orbește', async () => {
    h.holdCreate = true
    const { user, dlg } = await openNew()
    const name = within(dlg).getByLabelText('Nume *')
    await user.type(name, 'Brunch')

    // Termenul salvării, apoi verificarea refuzată.
    vi.useFakeTimers()
    h.fetchPlan = ['fail']
    fireEvent.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await flush(HAPPY_HOUR_SAVE_TIMEOUT_MS)
    await flush()
    expect(h.fetches).toBe(2)
    expect(name).toBeEnabled()
    expect(name).toHaveValue('Brunch')
    expect(within(dlg).getByRole('alert').textContent).toBe(promotionsRo.err_saveUnverified)

    // Reîncercarea: verificarea nu răspunde; are termen propriu.
    h.fetchPlan = ['hold']
    fireEvent.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await flush()
    expect(h.fetches).toBe(3)
    const verifySignal = h.fetchSignals[2]
    // Control: cu 1 ms înainte de termenul verificării, încă în aer.
    await flush(HAPPY_HOUR_VERIFY_TIMEOUT_MS - 1)
    expect(within(dlg).getByRole('button', { name: 'Se verifică…' })).toBeDisabled()
    expect(verifySignal?.aborted).toBe(false)
    await flush(1)
    await flush()
    expect(verifySignal?.aborted).toBe(true)
    expect(name).toBeEnabled()
    expect(within(dlg).getByRole('alert').textContent).toBe(promotionsRo.err_saveUnverified)
    // Fără listă, nimic trimis din nou.
    expect(h.created).toHaveLength(1)
    vi.useRealTimers()

    // Lista revine (fără regulă): crearea pleacă.
    h.holdCreate = false
    h.log = []
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.log.slice(0, 2)).toEqual(['fetch', 'create'])
    expect(h.created).toHaveLength(2)
  })

  it('HHM15 modificarea fără răspuns: rândul cu valorile trimise = salvat; altfel nu', async () => {
    h.holdUpdate = true
    const user = userEvent.setup()
    render(<HappyHourTab restaurantId="rest-1" payAtTable={false} />)
    await screen.findByText('Seara')

    // Prima jumătate: modificarea ajunsese (rândul are exact valorile trimise).
    await user.click(screen.getAllByRole('button', { name: 'Editează' })[0])
    let dlg = screen.getByRole('dialog', { name: 'Editare regulă' })
    let value = within(dlg).getByLabelText('Valoarea reducerii')
    await user.clear(value)
    await user.type(value, '25')
    vi.useFakeTimers()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Salvează modificări' }))
    await flush()
    expect(h.updated).toEqual([['r1', expect.objectContaining({ discount_value: 25 })]])
    h.rules = [rule({ discount_value: 25 }), rule({ id: 'r2', name: 'Seara' })]
    await flush(HAPPY_HOUR_SAVE_TIMEOUT_MS)
    await flush()
    vi.useRealTimers()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.toasts).toEqual([['success', promotionsRo.saved_late]])

    // A doua jumătate: rândul reîncărcat are încă valoarea veche.
    await user.click(screen.getAllByRole('button', { name: 'Editează' })[1])
    dlg = screen.getByRole('dialog', { name: 'Editare regulă' })
    value = within(dlg).getByLabelText('Valoarea reducerii')
    await user.clear(value)
    await user.type(value, '30')
    vi.useFakeTimers()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Salvează modificări' }))
    await flush(HAPPY_HOUR_SAVE_TIMEOUT_MS)
    await flush()
    vi.useRealTimers()
    expect(screen.getByRole('dialog', { name: 'Editare regulă' })).toBe(dlg)
    expect(value).toBeEnabled()
    expect(value).toHaveValue('30')
    expect(within(dlg).getByRole('alert').textContent).toBe(promotionsRo.err_notSavedUpdate)
    expect(h.toasts).toHaveLength(1)
    expect(h.updated.map(([id]) => id)).toEqual(['r1', 'r2'])
  })

  it('HHM16 restaurant schimbat pe aceeași instanță: încărcarea veche întârziată nu mai scrie', async () => {
    h.rulesBy = { 'rest-2': [rule({ id: 'q1', restaurant_id: 'rest-2', name: 'Altă locație' })] }
    h.fetchPlan = ['hold']
    const { rerender } = render(<HappyHourTab restaurantId="rest-1" payAtTable={false} />)
    expect(await screen.findByText('Se încarcă regulile...')).toBeInTheDocument()

    rerender(<HappyHourTab restaurantId="rest-2" payAtTable={false} />)
    expect(await screen.findByText('Altă locație')).toBeInTheDocument()

    // Abia acum se întoarce încărcarea pentru rest-1.
    // Un macrotask: tot lanțul încărcării vechi (Promise.all → stare) se încheie.
    await act(async () => {
      h.held[0].release()
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.getByText('Altă locație')).toBeInTheDocument()
    expect(screen.queryByText('Seara')).toBeNull()
    expect(screen.queryByText('Se încarcă regulile...')).toBeNull()
  })

  it('HHM17 DashboardPage montează fila pe cheia restaurantului', () => {
    const keyed = (src: string, tag: string) =>
      new RegExp(`<${tag}\\s[^>]*\\bkey=\\{restaurant\\.id\\}`).test(src)
    // Controale pe surse sintetice: cu cheie da, fără cheie nu.
    expect(keyed('<X key={restaurant.id} a={1} />', 'X')).toBe(true)
    expect(keyed('<X a={restaurant.id} />\n<Y key={restaurant.id} />', 'X')).toBe(false)
    const dash = readFileSync(resolve(process.cwd(), 'src/pages/DashboardPage.tsx'), 'utf8')
    // Control: tiparul prinde cheia lui FloorPlanEditor (aceeași formă).
    expect(keyed(dash, 'FloorPlanEditor')).toBe(true)
    expect(keyed(dash, 'HappyHourTab')).toBe(true)
  })

  it('HHM18 lista refuzată la încărcare: o regulă nouă nu pleacă până nu vine lista', async () => {
    h.fetchPlan = ['fail']
    const user = userEvent.setup()
    render(<HappyHourTab restaurantId="rest-1" payAtTable={false} />)
    expect(await screen.findByText('Nicio regulă încă')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Regulă nouă' }))
    const dlg = screen.getByRole('dialog', { name: 'Regulă nouă' })
    const name = within(dlg).getByLabelText('Nume *')
    await user.type(name, 'Seara')
    h.fetchPlan = ['fail']
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() =>
      expect(within(dlg).getByRole('alert').textContent).toBe(promotionsRo.err_listUnavailable),
    )
    expect(h.created).toHaveLength(0)
    expect(name).toBeEnabled()
    expect(name).toHaveValue('Seara')

    // Lista vine (cu „Seara” EXISTENTĂ, r2): crearea pleacă, iar o verificare
    // ulterioară ar ști că r2 nu e regula ei.
    h.log = []
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.log.slice(0, 2)).toEqual(['fetch', 'create'])
    expect(h.created).toHaveLength(1)
  })
})

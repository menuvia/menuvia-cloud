// src/lib/__tests__/reports.test.ts
import { describe, it, expect } from 'vitest'
import { toCsv } from '../reports'

const BOM = '\uFEFF'

describe('toCsv()', () => {
  it('returnează string gol pentru array gol', () => {
    expect(toCsv([])).toBe('')
  })

  it('generează header din keys-urile primului rând', () => {
    const csv = toCsv([{ id: 1, nume: 'Test' }])
    expect(csv).toBe(`${BOM}id,nume\n1,Test`)
  })

  it('include BOM UTF-8 pentru Excel', () => {
    const csv = toCsv([{ x: 'a' }])
    expect(csv.startsWith(BOM)).toBe(true)
  })

  it('escapează valori cu virgulă', () => {
    const csv = toCsv([{ nume: 'Smith, John' }])
    expect(csv).toBe(`${BOM}nume\n"Smith, John"`)
  })

  it('escapează valori cu ghilimele duble', () => {
    const csv = toCsv([{ text: 'Spune "salut"' }])
    expect(csv).toBe(`${BOM}text\n"Spune ""salut"""`)
  })

  it('escapează valori cu newline', () => {
    const csv = toCsv([{ text: 'linie 1\nlinie 2' }])
    expect(csv).toBe(`${BOM}text\n"linie 1\nlinie 2"`)
  })

  it('escapează valori cu carriage return', () => {
    const csv = toCsv([{ text: 'linie 1\r\nlinie 2' }])
    expect(csv).toContain('"linie 1\r\nlinie 2"')
  })

  it('gestionează corect null și undefined ca string gol', () => {
    const csv = toCsv([{ a: 'x', b: null, c: undefined }])
    expect(csv).toBe(`${BOM}a,b,c\nx,,`)
  })

  it('păstrează numere fără ghilimele', () => {
    const csv = toCsv([{ total: 123.45, count: 7 }])
    expect(csv).toBe(`${BOM}total,count\n123.45,7`)
  })

  it('gestionează caractere diacritice românești', () => {
    const csv = toCsv([{ produs: 'Șuncă cu Ardei' }])
    expect(csv).toContain('Șuncă cu Ardei')
  })

  it('gestionează multiple rânduri', () => {
    const rows = [
      { id: 1, nume: 'Cappuccino', pret: 15 },
      { id: 2, nume: 'Espresso', pret: 8 },
      { id: 3, nume: 'Latte', pret: 17 },
    ]
    const csv = toCsv(rows)
    const lines = csv.split('\n')
    expect(lines).toHaveLength(4) // header + 3 rânduri
    expect(lines[0]).toBe(`${BOM}id,nume,pret`)
    expect(lines[1]).toBe('1,Cappuccino,15')
    expect(lines[2]).toBe('2,Espresso,8')
    expect(lines[3]).toBe('3,Latte,17')
  })

  it('gestionează valori boolean', () => {
    const csv = toCsv([{ activ: true, premium: false }])
    expect(csv).toBe(`${BOM}activ,premium\ntrue,false`)
  })

  it('gestionează edge case: valoare cu virgulă, ghilimele și newline', () => {
    const csv = toCsv([{ complex: 'a, "b"\nc' }])
    expect(csv).toBe(`${BOM}complex\n"a, ""b""\nc"`)
  })

  it('neutralizează injecția de formulă (=,+,-,@ la început)', () => {
    // Un produs numit ca o formulă nu trebuie să se execute când owner-ul
    // deschide CSV-ul în Excel/Sheets → prefixat cu apostrof.
    const csv = toCsv([{ nume: '=HYPERLINK("http://rau")' }])
    expect(csv).toContain(`'=HYPERLINK`)
    expect(csv.includes('\n=HYPERLINK')).toBe(false)
    // Numerele negative (tip number) NU sunt prefixate.
    expect(toCsv([{ x: -5 }])).toBe(`${BOM}x\n-5`)
  })
})

// Lotul C6a: CSV-ul deschis corect de Excel-ul regional (prefixul XL, cu XL1–XL3
// în reportsLang.test.ts; verificat cu grep, nefolosit înainte).
//   XL4  dialectul „;” + „,”: numerele cu virgulă zecimală, o celulă cu „;”
//        în ghilimele, una cu „,” NU (sub „;” virgula nu mai e separator).
//        Mutația care pică: quoting-ul legat de „,” în loc de separatorul ales.
//   XL5  `bom: false` = fără BOM (secțiunile unui fișier compus); implicitul
//        păstrează BOM-ul (testul „include BOM” de mai sus = controlul).
//   XL6  o sumă negativă deja formatată („-3,50”) rămâne număr (fără
//        apostrof), iar formulele, inclusiv „-1+1”, sunt neutralizate în
//        continuare. Mutația care pică: excepția scoasă (Excel ia „'-3,50”
//        drept text) SAU lărgită până la orice șir care începe cu „-”.
describe('toCsv() — dialectul (C6a)', () => {
  it('XL4: separator „;” și virgulă zecimală', () => {
    const csv = toCsv([{ a: 3.1, b: 'x;y', c: 'p,q', d: 7 }], { sep: ';', decimal: ',' })
    expect(csv).toBe(`${BOM}a;b;c;d\n3,1;"x;y";p,q;7`)
    // Implicitul rămâne „,” + punct.
    expect(toCsv([{ a: 3.1, c: 'p,q' }])).toBe(`${BOM}a,c\n3.1,"p,q"`)
  })

  it('XL5: fără BOM la cerere', () => {
    expect(toCsv([{ x: 1 }], { bom: false })).toBe('x\n1')
    expect(toCsv([{ x: 1 }], { bom: false, sep: ';' }).includes(BOM)).toBe(false)
  })

  it('XL6: sumele negative formatate nu sunt formule; formulele rămân neutralizate', () => {
    const row = { a: '-3,50', b: '-12.00', c: '-5%', d: '-1+1', e: '=1', f: '+5', g: '@x', h: '-SUM(A1)' }
    expect(toCsv([row], { sep: ';', decimal: ',', bom: false }).split('\n')[1]).toBe(
      `-3,50;-12.00;-5%;'-1+1;'=1;'+5;'@x;'-SUM(A1)`,
    )
  })
})

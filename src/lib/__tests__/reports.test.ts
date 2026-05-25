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
})

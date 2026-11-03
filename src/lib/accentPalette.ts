// Culorile de accent pe care proprietarul le poate alege pentru meniul public
// (Setări → Aspect meniu → Culoare accent). Sunt DATE — valoarea scrisă în
// `restaurants.primary_color` și citită de meniul oaspetelui —, nu culori ale
// panoului, deci stau aici și nu în tokenii `D` (lotul V, nov 2026: ecranele
// panoului nu mai conțin culori hex). Numele RO sunt eticheta accesibilă și
// indicatorul ne-cromatic al fiecărei mostre.
export const ACCENT_SWATCHES: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#C8963C', name: 'Auriu' },
  { hex: '#E05555', name: 'Roșu' },
  { hex: '#4CAF6E', name: 'Verde' },
  { hex: '#5B8DEF', name: 'Albastru' },
  { hex: '#9B72CF', name: 'Mov' },
  { hex: '#E07B45', name: 'Portocaliu' },
  { hex: '#3ABFBF', name: 'Turcoaz' },
]

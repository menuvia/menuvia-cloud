// eslint.config.js — configurația FLAT (obligatorie din eslint 9; v10 nu mai
// suportă .eslintrc deloc). Paritate 1:1 cu vechiul .eslintrc.cjs + flag-urile
// CLI din scriptul `lint`:
//   - se lintează DOAR *.ts/*.tsx (vechiul `--ext ts,tsx`): fișierele .js/.cjs
//     rămân afară (netlify/functions, bridge, deploy, tests/functions sunt
//     CommonJS cu propriile convenții, nelintate nici înainte);
//   - dist/ + e2e/ + playwright.config.ts ignorate ca în ignorePatterns;
//   - reportUnusedDisableDirectives a devenit linterOptions (flag-ul CLI
//     `--report-unused-disable-directives` a dispărut).
//
// eslint:recommended se ia prin SONDARE, nu prin import direct: @eslint/js nu e
// dependență declarată (lockfile-ul nu poate fi regenerat fără acces la
// registry), iar în eslint 10 pachetul poate lipsi din tree cu totul. Sondăm
// întâi din root, apoi din dependențele lui eslint; dacă lipsește, rămân
// regulile @typescript-eslint + react-hooks (config-ul nu crapă la load).
import { createRequire } from 'node:module'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

const rootRequire = createRequire(import.meta.url)
let coreRecommendedRules = {}
try {
  coreRecommendedRules = rootRequire('@eslint/js').configs.recommended.rules
} catch {
  try {
    const eslintRequire = createRequire(rootRequire.resolve('eslint/package.json'))
    coreRecommendedRules = eslintRequire('@eslint/js').configs.recommended.rules
  } catch {
    // eslint 10 fără @eslint/js în tree — vezi comentariul de sus.
  }
}

// react-hooks: PARITATE cu v4, nu preset-ul v7. `recommended` în v7 aduce
// suita nouă din era React Compiler (set-state-in-effect & co.) — 87 de erori
// pe pattern-uri deliberate din codebase (reset de state la schimbarea
// restaurantului etc.). Adoptarea acelor reguli e o decizie separată, cu
// refactor dedicat — NU se strecoară într-un PR de dependențe. Cele două
// reguli de mai jos sunt exact conținutul recommended-ului v4.

const TS_FILES = ['**/*.ts', '**/*.tsx']

export default [
  {
    ignores: ['dist/**', 'e2e/**', 'playwright.config.ts', '**/*.js', '**/*.cjs', '**/*.mjs'],
  },
  // eslint:recommended ÎNAINTEA preset-ului TS (ordinea vechiului extends):
  // eslint-recommended din preset stinge apoi regulile core nepotrivite pe TS
  // (no-undef etc.) — invers, le-ar reactiva.
  { files: TS_FILES, rules: coreRecommendedRules },
  // plugin:@typescript-eslint/recommended — preset-ul flat aduce parserul +
  // override-urile eslint-recommended.
  ...tsPlugin.configs['flat/recommended'].map((c) => ({ ...c, files: TS_FILES })),
  {
    files: TS_FILES,
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
]

// eslint.config.js — configurația FLAT (obligatorie din eslint 9; v10 nu mai
// suportă .eslintrc deloc). Paritate 1:1 cu vechiul .eslintrc.cjs + flag-urile
// CLI din scriptul `lint`:
//   - se lintează DOAR *.ts/*.tsx (vechiul `--ext ts,tsx`): fișierele .js/.cjs
//     rămân afară (netlify/functions, bridge, deploy, tests/functions sunt
//     CommonJS cu propriile convenții, nelintate nici înainte);
//   - dist/ + e2e/ + playwright.config.ts ignorate ca în ignorePatterns;
//   - reportUnusedDisableDirectives a devenit linterOptions (flag-ul CLI
//     `--report-unused-disable-directives` a dispărut).
import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

const TS_FILES = ['**/*.ts', '**/*.tsx']

export default [
  {
    ignores: ['dist/**', 'e2e/**', 'playwright.config.ts', '**/*.js', '**/*.cjs', '**/*.mjs'],
  },
  // eslint:recommended — restrâns la TS (echivalentul vechiului --ext).
  { ...js.configs.recommended, files: TS_FILES },
  // plugin:@typescript-eslint/recommended — preset-ul flat aduce parserul +
  // override-urile eslint-recommended (no-undef etc. stinse pe TS).
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
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
]

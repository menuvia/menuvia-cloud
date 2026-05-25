#!/usr/bin/env bash
# setup-git.sh
# ─────────────────────────────────────────────────────────────────
# Sincronizează Menuvia + Bridge într-un repo git cu structură clean.
# Rezolvă problema: tot codul după iter13 e în zip-uri, nu în git.
#
# Rulare:
#   bash setup-git.sh /path/to/menuvia-iter18  /path/to/bridge-iter16
#
# Va crea 2 repo-uri git separate (recomandat pentru Tauri + cloud).
# ─────────────────────────────────────────────────────────────────

set -e

CLOUD_DIR="${1:-}"
BRIDGE_DIR="${2:-}"

if [ -z "$CLOUD_DIR" ] || [ -z "$BRIDGE_DIR" ]; then
  echo "Folosire: bash setup-git.sh /path/to/menuvia-cloud /path/to/menuvia-bridge"
  echo ""
  echo "Exemplu:"
  echo "  bash setup-git.sh ~/projects/menuvia-iter18-csp-rls-audit ~/projects/menuvia-bridge-tauri-iter16"
  exit 1
fi

if [ ! -d "$CLOUD_DIR" ]; then
  echo "❌ Directorul cloud nu există: $CLOUD_DIR"
  exit 1
fi

if [ ! -d "$BRIDGE_DIR" ]; then
  echo "❌ Directorul bridge nu există: $BRIDGE_DIR"
  exit 1
fi

# ── Helper: setup un repo git ─────────────────────────────────
setup_repo() {
  local dir="$1"
  local name="$2"

  echo ""
  echo "══════════════════════════════════════════════════════════"
  echo "  Setup git pentru: $name"
  echo "  Path: $dir"
  echo "══════════════════════════════════════════════════════════"

  cd "$dir"

  if [ -d ".git" ]; then
    echo "⚠️  Git deja inițializat în $dir — sar peste"
    return 0
  fi

  # ── .gitignore ──
  echo "📝 Scriu .gitignore..."
  if [ "$name" = "cloud" ]; then
    cat > .gitignore << 'EOF'
# Dependencies
node_modules/
.pnp
.pnp.js
.yarn/

# Build outputs
dist/
build/
.next/
.vercel/
.netlify/

# Tests
coverage/
.vitest/
playwright-report/
test-results/
.nyc_output/

# Env files (NEVER COMMIT)
.env
.env.local
.env.development.local
.env.test.local
.env.production.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Husky temporary
.husky/_/

# Supabase local
supabase/.branches
supabase/.temp

# Backup files create during iteration
*.before-upgrade
*.UPDATED
*.corrupt
EOF
  else
    # Bridge / Tauri
    cat > .gitignore << 'EOF'
# Rust
/src-tauri/target/
**/*.rs.bk
Cargo.lock

# Node (frontend)
node_modules/
dist/
.parcel-cache/

# Tauri build artifacts
src-tauri/target/
src-tauri/WixTools/
src-tauri/gen/

# Audit log runtime (per-user, never commit)
audit/

# Env / secrets
.env
.env.local

# IDE
.vscode/
.idea/
*.swp

# OS
.DS_Store
Thumbs.db

# Logs
*.log
EOF
  fi

  # ── README minim dacă lipsește ──
  if [ ! -f "README.md" ]; then
    echo "📄 Creez README.md minimal..."
    if [ "$name" = "cloud" ]; then
      cat > README.md << 'EOF'
# Menuvia Cloud

SaaS HoReCa pentru cafenele și restaurante RO.

## Stack
- React 18 + TypeScript + Vite
- Supabase (Postgres + Auth + Realtime + Storage)
- Stripe Connect + Tax
- Netlify Functions + Cron
- Anthropic Claude (AI import meniu)
- Oblio (e-Factura RO)

## Quickstart

```bash
npm install
cp .env.example .env  # configurează VITE_SUPABASE_URL, etc.
npm run dev
```

## Comenzi

```bash
npm run test          # Vitest unit tests
npm run test:e2e      # Playwright E2E
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint
npm run format        # Prettier
npm run check-all     # toate de mai sus
npm run build         # production build
```

## Migrații Supabase

În `supabase/migration-XXX-*.sql`. Aplică în ordine numerică:

```bash
# Local cu Supabase CLI
supabase db push

# Production: prin SQL Editor în Dashboard
```
EOF
    fi
  fi

  # ── Git init + first commit ──
  echo "🔧 Init git..."
  git init -b main >/dev/null 2>&1

  # Configurare user dacă lipsește (necesar pentru commit)
  if [ -z "$(git config user.email 2>/dev/null)" ]; then
    echo ""
    echo "⚠️  Git user.email nu e setat global. Setez local pentru acest repo:"
    read -p "    Email-ul tău Git: " git_email
    read -p "    Numele tău: " git_name
    git config user.email "$git_email"
    git config user.name "$git_name"
  fi

  echo "📦 Primul commit..."
  git add .
  git commit -m "chore: initial commit — $name baseline

Sincronizare din zip iteration la repo git.
Tot codul anterior (iter1 → iter18 cloud / iter16 bridge) intră ca single commit.
De aici încolo, commits granulare per feature." --quiet

  local total_files=$(git ls-files | wc -l | tr -d ' ')
  echo "✅ $name committed ($total_files fișiere)"
}

# ── Setup ambele repo-uri ─────────────────────────────────────
setup_repo "$CLOUD_DIR" "cloud"
setup_repo "$BRIDGE_DIR" "bridge"

# ── Final ─────────────────────────────────────────────────────
cat << 'EOF'


╔══════════════════════════════════════════════════════════════╗
║                     ✅  GIT SETUP COMPLETE                    ║
╚══════════════════════════════════════════════════════════════╝

Următorii pași:

1. Creează 2 repo-uri private pe GitHub (sau GitLab/Gitea):
   • menuvia-cloud
   • menuvia-bridge

2. Connect repo local → remote:

   cd <CLOUD_DIR>
   git remote add origin git@github.com:USERNAME/menuvia-cloud.git
   git push -u origin main

   cd <BRIDGE_DIR>
   git remote add origin git@github.com:USERNAME/menuvia-bridge.git
   git push -u origin main

3. De aici încolo, fluxul tău normal:

   git checkout -b feature/nume-scurt   # branch nou pentru fiecare schimbare
   # ... modificări ...
   git add .
   git commit -m "feat(scope): descriere scurtă"
   git push -u origin feature/nume-scurt
   # ... apoi PR pe GitHub și merge în main ...

4. Reguli de aur:

   • NICIODATĂ commit pe .env (e în .gitignore)
   • NICIODATĂ commit chei API, parole, token-uri Stripe
   • Commit messages: "feat:", "fix:", "chore:", "docs:", "test:"
   • Branch-uri scurte: feature/*, fix/*, chore/*

5. Backup-ul tău e acum în siguranță. La fiecare push:
   • Cod salvat pe GitHub (cloud)
   • History întreg accesibil prin `git log`
   • Rollback rapid: `git revert <commit>`

Mergi.

EOF

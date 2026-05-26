# DeepBook Studio

AI-powered book writing and generation desktop app — built with HTML/CSS/JS, Node.js, and Electron.

Runs on **macOS** and **Windows**. Uses **DeepSeek** by default, with **Ollama** as an offline fallback.

---

## Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20 LTS+ |
| npm | 10+ (comes with Node) |
| Git | Any recent version |
| Ollama | Optional — for offline AI |

### Install & Run

```bash
# 1. Clone the repo
git clone https://github.com/<your-username>/deepbook-studio.git
cd deepbook-studio

# 2. Install all dependencies (root + backend)
npm install

# 3. Set up your environment
cp .env.example .env
# Edit .env and add your DEEPSEEK_API_KEY

# 4. Start in development mode (hot-reload)
npm run dev
```

The app opens as a native window. The backend API runs on `localhost:3001`.

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend + Electron with hot-reload |
| `npm run dev:backend` | Start only the Express server |
| `npm run dev:electron` | Start only the Electron window |
| `npm run build` | Build installer for current OS |
| `npm run build:mac` | Build macOS `.dmg` |
| `npm run build:win` | Build Windows `.exe` |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format all files with Prettier |
| `npm test` | Run tests |

---

## Project Structure

```
deepbook-studio/
├── frontend/          # HTML/CSS/JS UI
├── backend/           # Node.js + Express API (port 3001)
├── electron/          # Desktop shell (main process)
├── .github/workflows/ # CI/CD pipelines
├── build/             # App icons for installers
└── electron-builder.yml
```

See the [planning document](./DeepBook_Studio_Fullstack_Plan_v1.1_FINAL.docx) for full architecture details.

---

## Building Installers

### Local build (current OS only)
```bash
npm run build
# Output → dist/
```

### Cross-platform (via GitHub Actions)
Push a version tag — GitHub builds both installers automatically:
```bash
git tag v1.0.0
git push origin v1.0.0
```
Both `.dmg` and `.exe` appear in the GitHub Release within ~10 minutes.

---

## AI Providers

| Provider | Type | Setup |
|----------|------|-------|
| DeepSeek (default) | Online | Add `DEEPSEEK_API_KEY` to `.env` |
| Ollama | Offline/Local | Install from [ollama.com](https://ollama.com) |

Switch providers anytime in **Settings → AI Provider**.

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production — protected, triggers installer build |
| `develop` | Integration — all features merge here first |
| `feature/*` | One branch per feature |
| `hotfix/*` | Emergency fixes |
| `release/v*` | Release preparation |

---

## License

MIT

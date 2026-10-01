<div align="center">

# sikuwa-js

**SIKUWA untuk JavaScript/TypeScript** — SDK multi-gateway WhatsApp, porting dari
paket PHP [`mdestafadilah/sikuwa`](https://github.com/mdestafadilah/sikuwa).

Dibangun di atas **BHVR Template** (Bun + Hono + Vite + React + Cloudflare Workers).

![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-v4.10.7-E36002?style=for-the-badge&logo=hono&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-v6.0.0-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-v19.2.0-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-v5.9.3-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

![Playground](public/playground.png)

Pratinjau payload Fonnte — jeda tiap pesan, lama indikator mengetik, dan JSON
yang menjadi isi field `data`. Semuanya dihitung jalur kirim yang sama, tanpa
satu pun request:

![Pratinjau payload Fonnte](public/plan-preview.png)

## Apa ini

Dua hal dalam satu repositori:

1. **Pustaka** — `src/lib/sikuwa/`, porting setia dari paket PHP-nya. **Tanpa
   dependensi runtime**: seluruh provider hanya memanggil REST gateway, jadi
   `fetch` bawaan Node, Bun, Cloudflare Workers, dan peramban sudah cukup.
2. **Playground** — shell BHVR di sekelilingnya (`src/api/whatsapp/`,
   `src/routes/whatsapp.tsx`), untuk memeriksa konfigurasi, perhitungan, dan
   **payload yang akan dikirim** dari peramban. Seluruh playground bersifat
   **murni** — tidak ada pesan WhatsApp yang benar-benar dikirim: pratinjau
   payload memakai klien HTTP yang sengaja selalu gagal, jadi jalur itu memang
   tidak bisa menyentuh jaringan.

Ini **porting, bukan konversi**. Paket PHP tetap sumber kebenaran di Packagist;
versi npm-nya adalah implementasi kedua, dan berkas `.env` yang sudah ada tetap
terbaca karena seluruh kunci (`WHATSAPP_TOKEN`, `WHATSAPP_PACING_CYCLE`,
`WHATSAPP_TYPING`, …) dipertahankan persis.

Tiga perbedaan yang disengaja:

- **Setiap panggilan jaringan mengembalikan `Promise`.** PHP memblokir di dalam
  pemanggilan; JavaScript tidak bisa.
- **`File.bytes()` mengembalikan `Uint8Array`**, bukan string biner — bentuk
  yang memang diminta `Blob`/`FormData` di jalur unggah.
- **Accessor konfigurasi provider bernama `settings()`, bukan `config()`.** PHP
  membedakan properti `$this->config` dari method `$this->config()`; JavaScript
  tidak bisa, dan properti `config` dipertahankan apa adanya karena setiap
  provider membacanya jauh lebih sering.

## Status porting

| Lapisan | Status |
| --- | --- |
| Support (Pacing, Throttle, Typing, Presence, PhoneNumber, Text, File, Envelope, Qr) | selesai |
| Exceptions (14 kelas), Config, Session, Contracts | selesai |
| Http (HttpResponse, HttpExecutor berbasis `fetch`) | selesai |
| AbstractProvider (plan, retry, pacing, typing, jalur kirim berurutan) | selesai |
| Fonnte | selesai |
| Provider lain (OpenWA, ApiMe, EvolutionAPI, Wuzapi, Wwebjs, Waxum) | belum |
| Client (registri provider, pemilihan `auto`, `notify()`) | belum |

Paritas perilaku dibuktikan lewat tes, bukan diklaim: berkas PHPUnit di repo PHP
diterjemahkan menjadi `tests/sikuwa/**/*.test.ts` dan dijalankan dengan `bun test`.
Fonnte juga diuji terhadap server HTTP sungguhan (`fonnte-live.test.ts`) — mock
klien tidak bisa membuktikan bahwa `URLSearchParams`, `boundary` multipart, dan
byte berkas benar-benar utuh setelah melewati `fetch` bawaan.

```bash
bun install
bun test          # 287 tes paritas + integrasi
bun run typecheck
bun run dev       # playground di http://localhost:5173
```

## Struktur

```
src/lib/sikuwa/          pustaka (tanpa dependensi runtime)
  internal/scalar.ts     semantik tipe longgar PHP (is_numeric, FILTER_VALIDATE_BOOLEAN, …)
  support/               modul murni: pacing, throttle, typing, presence, file, …
  http/                  transport berbasis fetch yang bisa disuntik
  exceptions/            seluruh kelas exception
  config.ts, session.ts
  contracts/whatsapp.ts  antarmuka yang harus dipenuhi setiap gateway
  providers/             AbstractProvider + tiap gateway (fonnte/ sudah ada)
  index.ts               permukaan publik
src/api/whatsapp/        playground Hono (service → controller → route)
src/routes/whatsapp.tsx  halaman playground
tests/sikuwa/            suite tes paritas
```

---

## BHVR Template

Bagian berikut adalah dokumentasi asli template yang menjadi dasar repositori
ini.


This project is a **BHVR Template**, a powerful and modern starter kit combining **Bun**, **Hono**, **Vite**, and **React**. It is designed to provide a lightning-fast development experience and high-performance production builds, optimized for Cloudflare Workers.

## Project Structure

Here's an overview of the project's file structure:

```
bhvr-template/
├── public/                  # Public static assets
├── src/
│   ├── api/                 # Cloudflare Worker (Hono backend API)
│   │   ├── users/           # User feature (controllers, repositories, routes, services)
│   │   └── index.ts         # Worker entry point
│   ├── assets/              # Images, icons, SVGs for frontend
│   ├── database/            # Database configuration and schemas
│   ├── lib/                 # Shared utilities and libraries
│   ├── routes/              # React Router configuration and page components
│   ├── services/            # Frontend API service layers
│   ├── index.css            # Global styles (Tailwind CSS)
│   ├── main.tsx             # React + Router entry point
│   └── routeTree.gen.ts     # Auto-generated routing tree map
├── .env.example             # Environment variables template
├── .gitignore               # Git ignore rules
├── bun.lock                 # Bun lockfile
├── drizzle.config.ts        # Drizzle ORM configuration
├── package.json             # Project dependencies and scripts
├── tsconfig.json            # TypeScript project references
├── tsconfig.app.json        # Frontend TypeScript config
├── tsconfig.worker.json     # Backend TypeScript config
├── vite.config.ts           # Vite configuration
└── wrangler.json            # Cloudflare Workers configuration
```

## Tech Stack Deep Dive

This template leverages a cutting-edge stack to ensure maximum performance and developer productivity:

- **[Bun](https://bun.sh/)**: A fast all-in-one JavaScript runtime, bundler, and package manager. It replaces Node.js and npm, offering significantly faster install times and script execution.
- **[Hono](https://hono.dev/)**: An ultrafast web framework specifically designed for Edge environments like Cloudflare Workers. It handles routing and API logic with minimal overhead.
- **[Vite](https://vitejs.dev/)**: Next Generation Frontend Tooling. It provides an instant dev server with Hot Module Replacement (HMR) and optimized production builds.
- **[React](https://react.dev/)**: The industry-standard library for building interactive user interfaces.
- **[React Router](https://reactrouter.com/)**: Declarative client-side routing for React applications.
- **[Tailwind CSS](https://tailwindcss.com/)**: Utility-first CSS framework for rapid UI development.
- **[Drizzle ORM](https://orm.drizzle.team/)**: A lightweight, headless TypeScript ORM for secure and predictable database interactions.
- **[Cloudflare Workers](https://workers.cloudflare.com/)**: A serverless execution environment that runs your code on Cloudflare's global network, ensuring low latency for users worldwide.
- **[Cloudflare D1](https://developers.cloudflare.com/d1/)**: Cloudflare's native serverless SQL database, tightly integrated with Workers.

## Configuration

### `wrangler.json`

This file configures your Cloudflare Worker.

- **`main`**: Points to `./src/server/index.ts` (Hono backend entry point)
- **`compatibility_flags`**: Set to `["nodejs_compat"]` to enable Node.js compatibility APIs in the runtime
- **`observability`**: Enabled by default to provide logs and metrics
- **`assets`**: Configures the worker to serve static assets from `./dist/client` with SPA fallback routing
- **`d1_databases`**: Binds the Cloudflare D1 database for serverless SQL storage

### `vite.config.ts`

Vite is configured with:

- `@cloudflare/vite-plugin` for seamless Cloudflare Workers integration
- `@tailwindcss/vite` for Tailwind CSS v4 support
- Path aliases (`@/*`, `@api/*`) for clean imports

### TypeScript Configuration

The project uses **TypeScript project references** for strict separation:

- `tsconfig.app.json` - Frontend config (DOM types, React)
- `tsconfig.worker.json` - Backend config (Node.js, Cloudflare types)
- `tsconfig.node.json` - Build tools config

## Getting Started

Follow these steps to get your project up and running using `bun`.

### Prerequisites

Make sure you have [Bun](https://bun.sh/) installed on your machine.

```bash
curl -fsSL https://bun.sh/install | bash
```

### Installation

1.  **Clone the repository**

    ```bash
    git clone https://github.com/ZulfiFazhar/bhvr-template.git
    cd bhvr-template
    ```

2.  **Install dependencies**

    ```bash
    bun install
    ```

3.  **Configure Environment Variables (Cloudflare D1)**

    Start by making a copy of `.env.example` to your `.env` file:

    ```bash
    cp .env.example .env
    bunx wrangler d1 create <DATABASE_NAME>
    ```

    You can find `accountId`, `databaseId`, and `token` in the Cloudflare dashboard:
    - To get `accountId`, go to **Workers & Pages** -> **Overview** -> copy **Account ID** from the right sidebar.
    - To get `databaseId`, open the D1 database you want to connect to and copy the **Database ID**.
    - To get `token`, go to **My profile** -> **API Tokens** and create a token with **D1 edit** permissions.

    After you have configured the `drizzle.config.ts` file, Drizzle Kit lets you run `migrate`, `push`, `introspect`, and `studio` commands using the Cloudflare D1 HTTP API.

4.  **Run Migrations**

    ```bash
    bunx drizzle-kit generate
    bunx drizzle-kit migrate
    ```

### Development

Start the development server with hot reloading:

```bash
bun run dev
```

- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **Backend (Worker)**: The worker logic is integrated into the dev server.

### Production

Build the application for production:

```bash
bun run build
```

This command compiles both the React application (via Vite) and the Worker code (via `tsc`).

### Deployment

Deploy your application to Cloudflare Workers:

```bash
bun run deploy
```

This will upload your worker and static assets to Cloudflare.

### Preview

Preview the production build locally before deploying:

```bash
bun run preview
```

## Scripts

- `dev`: Starts the local development server with HMR
- `build`: Builds the project for production (TypeScript check + Vite build)
- `deploy`: Builds and deploys the project to Cloudflare Workers
- `preview`: Builds the project and starts a local preview server
- `lint`: Runs ESLint to check for code quality issues
- `check`: Runs a full check (type check, build, and dry-run deploy)
- `cf-typegen`: Generates TypeScript types from `wrangler.json` bindings

## Architecture Highlights

### Frontend (React + Vite)

- **React Router v7** for declarative client-side routing
- **Tailwind CSS v4** with Vite plugin for styling
- **Service layer pattern** for API communication
- Path aliases (`@/*`) for clean imports

### Backend (Hono + Cloudflare Workers)

- **N-Layered architecture** with clear separation of concerns:
  - **Routes**: Define endpoints and HTTP methods
  - **Controllers**: Handle requests and responses
  - **Services**: Contain business logic
  - **Repositories**: Manage data persistence
- Path aliases (`@api/*`) for clean imports
- Node.js compatibility enabled for broader API support
- **Database**: Fully integrates Cloudflare D1 using Drizzle ORM (`src/database/`)

### Example: User Feature

The template includes a complete CRUD implementation for user management:

- Frontend: `src/routes/user.tsx`, `src/services/userService.tsx`
- Backend: `src/api/users/userRoute.ts` → `src/api/users/userController.ts` → `src/api/users/userService.ts` → `src/api/users/userRepository.ts`

This demonstrates the recommended pattern for adding new features to your application.

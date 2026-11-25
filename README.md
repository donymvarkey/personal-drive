# Personal Drive

A self-hosted personal cloud storage application built with Next.js (App Router), TypeScript, PostgreSQL, Prisma, Tailwind CSS, shadcn/ui, and Auth.js v5.

All files are stored on local storage only — no third-party cloud storage services are used.

---

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) 16 (App Router, Standalone mode)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict mode)
- **Database**: [PostgreSQL](https://www.postgresql.org/) 16
- **ORM**: [Prisma ORM](https://www.prisma.io/) v6
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) v4 & [shadcn/ui](https://ui.shadcn.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Authentication**: [Auth.js](https://authjs.dev/) v5 (`next-auth@beta`) with single-owner model
- **Forms & Validation**: [React Hook Form](https://react-hook-form.com/) + [Zod](https://zod.dev/)
- **Containerization**: Docker & Docker Compose (Multi-stage build)
- **Package Manager**: [pnpm](https://pnpm.io/)

---

## Project Structure

```
personal-drive/
├── docker-compose.yml          # Postgres + App container orchestration
├── Dockerfile                  # Multi-stage Docker build (builder & runner)
├── prisma/
│   ├── schema.prisma           # Prisma schema (User, File, Folder, StorageHealth)
│   └── seed.ts                 # Database seed script for owner account
├── public/                     # Static assets
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   └── login/          # Clean login page with RHF + Zod
│   │   ├── (dashboard)/
│   │   │   ├── dashboard/      # Storage overview & quick upload
│   │   │   ├── files/          # File browser with grid/list view
│   │   │   ├── recent/         # Recent files view
│   │   │   ├── starred/        # Starred files view
│   │   │   ├── trash/          # Trash view
│   │   │   ├── settings/       # Settings & storage health
│   │   │   └── layout.tsx      # Dashboard shell with sidebar
│   │   ├── actions/
│   │   │   └── storage.ts      # Server action for storage statistics
│   │   ├── api/
│   │   │   └── auth/           # Auth.js route handlers
│   │   ├── globals.css         # CSS variables & design tokens
│   │   ├── layout.tsx          # Root layout with ThemeProvider & Tooltips
│   │   └── page.tsx            # Root redirect to /dashboard
│   ├── components/
│   │   ├── layout/
│   │   │   └── sidebar.tsx     # Collapsible navigation sidebar
│   │   ├── providers/
│   │   │   ├── auth-provider.tsx
│   │   │   └── theme-provider.tsx
│   │   └── ui/                 # shadcn/ui components
│   ├── lib/
│   │   ├── auth.ts             # Auth.js v5 credentials configuration
│   │   ├── db.ts               # Prisma client singleton
│   │   ├── storage.ts          # Storage abstraction service
│   │   └── utils.ts            # Formatting & class merging utilities
│   └── middleware.ts           # Route protection middleware
└── README.md
```

---

## Prerequisites

- [Docker](https://www.docker.com/) & Docker Compose
- [Node.js](https://nodejs.org/) v20+ / v24+
- [pnpm](https://pnpm.io/) v10+ / v12+

---

## Quick Start on macOS (One-Command Setup)

For local development on macOS, run the automated setup script:

```bash
chmod +x scripts/setup-dev.sh
./scripts/setup-dev.sh
```

Or using pnpm:
```bash
pnpm setup
```

This single command:
1. Checks for Node.js, pnpm, and Docker.
2. Starts Docker Desktop if it is not already running.
3. Automatically sets up `.env.local` and creates the local storage folder.
4. Starts the PostgreSQL container bound to `127.0.0.1:5432` (private to your machine).
5. Applies database migrations, generates the Prisma client, and seeds the owner account.
6. Runs unit tests to verify the setup.

Once complete, start the development server:
```bash
pnpm dev
```
Open **[http://localhost:3000](http://localhost:3000)** and log in with the owner credentials printed by the script.

---

Copy `.env.example` to create your environment configuration:

```bash
cp .env.example .env.local
```

### Environment Variables

| Variable | Description | Example |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://personal_drive:changeme@localhost:5432/personal_drive` |
| `NEXTAUTH_URL` | Application base URL | `http://localhost:3000` |
| `AUTH_SECRET` | Secret key for signing session tokens | `openssl rand -base64 32` |
| `DRIVE_STORAGE_PATH` | Local disk storage path for user files | `/srv/home-server/personal-drive/storage` |
| `DRIVE_OWNER_EMAIL` | Owner email address for login | `admin@personal.drive` |
| `DRIVE_OWNER_NAME` | Owner display name | `Drive Owner` |
| `DRIVE_OWNER_PASSWORD`| Initial owner account password | `changeme` |
| `DRIVE_MAX_UPLOAD_SIZE_MB` | Maximum allowed upload size (MB) | `10240` |
| `NODE_ENV` | Runtime environment | `development` / `production` |

---

## Getting Started

### Option 1: Running with Docker Compose (Recommended for Production)

1. Create your production environment file:
   ```bash
   cp .env.example .env
   # Edit .env with your desired credentials and storage path
   ```

2. Start the database and application containers:
   ```bash
   docker compose up -d --build
   ```

3. Initialize and seed the database inside the container:
   ```bash
   docker compose exec app pnpm exec prisma db push
   docker compose exec app pnpm exec prisma db seed
   ```

4. Open [http://localhost:3000](http://localhost:3000) and sign in using `DRIVE_OWNER_EMAIL` and `DRIVE_OWNER_PASSWORD`.

---

### Option 2: Running Locally for Development

1. Start only the PostgreSQL database container:
   ```bash
   docker compose up -d db
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Generate the Prisma Client:
   ```bash
   pnpm exec prisma generate
   ```

4. Push schema to the database and seed the owner user:
   ```bash
   pnpm exec prisma db push
   pnpm exec prisma db seed
   ```

5. Start the development server:
   ```bash
   pnpm dev
   ```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Available Scripts

- `pnpm dev`: Start the development server with hot-reload.
- `pnpm build`: Generate optimized production build.
- `pnpm start`: Run the production standalone server.
- `pnpm exec prisma generate`: Generate Prisma Client code.
- `pnpm exec prisma db push`: Synchronize Prisma schema with database.
- `pnpm exec prisma db seed`: Seed initial owner account into database.
- `pnpm lint`: Run ESLint checks.

---

## Security Features

- **Single-Owner Mode**: Restricts login strictly to the single owner email configured in `DRIVE_OWNER_EMAIL`.
- **Password Protection**: Passwords hashed using bcrypt with salt rounds 12.
- **Path Traversal Protection**: Storage abstraction checks that all resolved file paths remain strictly inside `DRIVE_STORAGE_PATH`.
- **Route Guard Middleware**: Protects all internal application routes, redirecting unauthenticated users to `/login`.
- **Docker Isolation**: Non-root container user (`nextjs`) and isolated internal bridge network for database access.

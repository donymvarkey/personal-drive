# Personal Drive — Installation & Setup Guide

This guide covers local development setup, prerequisites, and initial configuration on macOS and Linux home servers.

---

## 1. System Requirements

- **Processor**: x86_64 or ARM64 (e.g. AMD Ryzen 3 3300U / Apple Silicon / Intel i3+)
- **Memory**: Minimum 4GB RAM (8GB+ recommended, 12GB optimal)
- **Disk Storage**: 512GB+ SSD for system and fast storage, plus optional external drive
- **Operating System**: macOS (development) or Linux (Ubuntu Server, Debian, Rocky Linux)
- **Runtimes**:
  - Node.js 20.x or 22.x LTS (`node -v`)
  - pnpm 9.x+ (`corepack enable && corepack prepare pnpm@latest --activate`)
  - Docker Desktop (macOS) or Docker Engine + Docker Compose v2 (Linux)

---

## 2. Quickstart Development Setup

We provide an automated setup script that handles dependency checks, port detection, database initialization, schema pushing, account seeding, and automated test suite verification:

```bash
# 1. Clone repository and navigate to root
cd personal-drive

# 2. Run automated setup script
bash scripts/setup-dev.sh
```

The script will automatically:
1. Verify Node.js and pnpm.
2. Find an available PostgreSQL port (defaulting to `5433` to prevent clashes with existing Postgres servers on `5432`).
3. Generate `.env.local` with cryptographically secure `AUTH_SECRET` and defaults.
4. Prepare storage directories (`storage_dev/files`, `storage_dev/.tmp`, `storage_dev/.migration`) and backup directory (`drive_backups/`).
5. Launch the PostgreSQL Docker container (`personal_drive_db`).
6. Apply Prisma database schema migrations (`prisma db push`).
7. Seed the single-owner admin account (`admin@personal.drive`).
8. Run the verification test suite.

---

## 3. Launching the Application

Once `setup-dev.sh` completes:

```bash
# Start Next.js development server
pnpm dev
```

Open your browser to:
**http://localhost:3000**

Default credentials:
- **Email**: `admin@personal.drive`
- **Password**: `changeme123` *(change this on first login under Settings)*

---

## 4. Manual Configuration (Step-by-Step)

If you prefer configuring without the automated script:

```bash
# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env.local

# Start PostgreSQL container
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db

# Push Prisma database schema
pnpm exec prisma db push

# Seed owner credentials
pnpm exec prisma db seed

# Start development server
pnpm dev
```

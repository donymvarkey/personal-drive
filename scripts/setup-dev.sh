#!/usr/bin/env bash

# ==============================================================================
# Personal Drive — Complete macOS Development Setup Script (Phases 1 - 6)
# ==============================================================================
# 1. Validates Node.js & pnpm and installs dependencies
# 2. Automatically detects an available port for PostgreSQL (default 5433 to
#    prevent conflicts with any existing Postgres on 5432)
# 3. Configures .env and .env.local with secure secrets and the chosen port
# 4. Creates physical disk storage directories (files, .tmp, .migration staging)
# 5. Cleans up any conflicting/stale containers and starts PostgreSQL in Docker
# 6. Waits for database healthcheck (pg_isready)
# 7. Applies Prisma migrations (db push) and generates Prisma Client
# 8. Seeds the single-owner user account
# 9. Runs automated verification test suite (Phase 1, 2, 3, 4)
# ==============================================================================

set -e

# Visual colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BLUE}${BOLD}==================================================================${NC}"
echo -e "${BLUE}${BOLD}        Personal Drive — Full Development Environment Setup       ${NC}"
echo -e "${BLUE}${BOLD}==================================================================${NC}"
echo ""

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# ------------------------------------------------------------------------------
# 1. Prerequisite verification & dependency installation
# ------------------------------------------------------------------------------
echo -e "${CYAN}${BOLD}[1/7] Checking Node.js, pnpm, and project dependencies...${NC}"

if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}Error: Node.js is not installed. Please install Node.js 20+ (e.g. brew install node).${NC}"
    exit 1
fi
echo -e "  ✓ Node.js version: ${GREEN}$(node -v)${NC}"

if ! command -v pnpm >/dev/null 2>&1; then
    echo -e "  ${YELLOW}pnpm not found. Installing pnpm globally via npm...${NC}"
    npm install -g pnpm
fi
echo -e "  ✓ pnpm version: ${GREEN}v$(pnpm -v)${NC}"

if [ ! -d "node_modules" ]; then
    echo -e "  Installing project dependencies via pnpm..."
    pnpm install
else
    echo -e "  ✓ Project dependencies already installed."
fi

# ------------------------------------------------------------------------------
# 2. Port conflict detection (starting from 5433 to avoid standard 5432 conflicts)
# ------------------------------------------------------------------------------
echo ""
echo -e "${CYAN}${BOLD}[2/7] Checking port availability for PostgreSQL...${NC}"

is_port_in_use() {
    local port=$1
    if command -v lsof >/dev/null 2>&1; then
        if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
            return 0 # In use
        fi
    fi
    if command -v nc >/dev/null 2>&1; then
        if nc -z 127.0.0.1 "$port" 2>/dev/null; then
            return 0 # In use
        fi
    fi
    return 1 # Available
}

TARGET_PORT=5433
while is_port_in_use "$TARGET_PORT"; do
    echo -e "  ${YELLOW}Port ${TARGET_PORT} is already in use. Checking next port...${NC}"
    TARGET_PORT=$((TARGET_PORT + 1))
done

echo -e "  ✓ Allocated local port for PostgreSQL: ${GREEN}${TARGET_PORT}${NC}"
export DB_PORT="${TARGET_PORT}"

# ------------------------------------------------------------------------------
# 3. Setup environment files (.env and .env.local)
# ------------------------------------------------------------------------------
echo ""
echo -e "${CYAN}${BOLD}[3/7] Configuring environment files (.env and .env.local)...${NC}"

AUTH_SECRET=$(openssl rand -base64 32 2>/dev/null || date +%s | shasum -a 256 | base64 | head -c 32)

# Ensure .env exists (used by Docker Compose)
if [ ! -f ".env" ]; then
    cat <<EOF > .env
DATABASE_URL="postgresql://personal_drive:changeme@db:5432/personal_drive"
DB_PORT="${DB_PORT}"
NEXTAUTH_URL="http://localhost:3000"
AUTH_SECRET="${AUTH_SECRET}"
DRIVE_STORAGE_PATH="${PROJECT_ROOT}/storage_dev"
DRIVE_OWNER_EMAIL="admin@personal.drive"
DRIVE_OWNER_NAME="Drive Owner"
DRIVE_OWNER_PASSWORD="changeme123"
DRIVE_MAX_UPLOAD_SIZE_MB="10240"
NODE_ENV="development"
EOF
    echo -e "  ✓ Created ${GREEN}.env${NC}"
else
    # Update DB_PORT in existing .env
    if grep -q '^DB_PORT=' .env; then
        sed -i '' -E "s|^DB_PORT=.*|DB_PORT=\"${DB_PORT}\"|" .env 2>/dev/null || \
        sed -i -E "s|^DB_PORT=.*|DB_PORT=\"${DB_PORT}\"|" .env 2>/dev/null || true
    else
        echo "DB_PORT=\"${DB_PORT}\"" >> .env
    fi
    echo -e "  ✓ Updated ${GREEN}.env${NC} with DB_PORT=${DB_PORT}"
fi

# Ensure .env.local exists (used by local Next.js dev server on Mac)
if [ ! -f ".env.local" ]; then
    cat <<EOF > .env.local
DATABASE_URL="postgresql://personal_drive:changeme@127.0.0.1:${DB_PORT}/personal_drive"
DB_PORT="${DB_PORT}"
NEXTAUTH_URL="http://localhost:3000"
AUTH_SECRET="${AUTH_SECRET}"
DRIVE_STORAGE_PATH="${PROJECT_ROOT}/storage_dev"
DRIVE_BACKUP_PATH="${PROJECT_ROOT}/drive_backups"
DRIVE_OWNER_EMAIL="admin@personal.drive"
DRIVE_OWNER_NAME="Drive Owner"
DRIVE_OWNER_PASSWORD="changeme123"
DRIVE_MAX_UPLOAD_SIZE_MB="10240"
NODE_ENV="development"
EOF
    echo -e "  ✓ Created ${GREEN}.env.local${NC}"
else
    # Update DATABASE_URL and DB_PORT in existing .env.local
    sed -i '' -E "s|@(127\.0\.0\.1\|localhost):[0-9]+/|@127.0.0.1:${DB_PORT}/|g" .env.local 2>/dev/null || \
    sed -i -E "s|@(127\.0\.0\.1\|localhost):[0-9]+/|@127.0.0.1:${DB_PORT}/|g" .env.local 2>/dev/null || true

    if grep -q '^DB_PORT=' .env.local; then
        sed -i '' -E "s|^DB_PORT=.*|DB_PORT=\"${DB_PORT}\"|" .env.local 2>/dev/null || \
        sed -i -E "s|^DB_PORT=.*|DB_PORT=\"${DB_PORT}\"|" .env.local 2>/dev/null || true
    else
        echo "DB_PORT=\"${DB_PORT}\"" >> .env.local
    fi

    if ! grep -q '^DRIVE_BACKUP_PATH=' .env.local; then
        echo "DRIVE_BACKUP_PATH=\"${PROJECT_ROOT}/drive_backups\"" >> .env.local
    fi
    echo -e "  ✓ Updated ${GREEN}.env.local${NC} (DATABASE_URL port ${DB_PORT})"
fi

# Ensure physical storage directory and subdirectories exist (including Phase 5 migration staging)
STORAGE_PATH=$(grep -E '^DRIVE_STORAGE_PATH=' .env.local | cut -d '=' -f2- | tr -d '"' | tr -d "'")
STORAGE_PATH="${STORAGE_PATH:-${PROJECT_ROOT}/storage_dev}"
mkdir -p "$STORAGE_PATH" "$STORAGE_PATH/files" "$STORAGE_PATH/.tmp" "$STORAGE_PATH/.migration"

# Ensure independent backup directory exists
BACKUP_PATH=$(grep -E '^DRIVE_BACKUP_PATH=' .env.local | cut -d '=' -f2- | tr -d '"' | tr -d "'")
BACKUP_PATH="${BACKUP_PATH:-${PROJECT_ROOT}/drive_backups}"
mkdir -p "$BACKUP_PATH"
echo -e "  ✓ Physical storage directories ready: ${GREEN}${STORAGE_PATH}/files${NC}, ${GREEN}${STORAGE_PATH}/.tmp${NC}, and ${GREEN}${STORAGE_PATH}/.migration${NC}"
echo -e "  ✓ Independent backup directory ready: ${GREEN}${BACKUP_PATH}${NC}"

# ------------------------------------------------------------------------------
# 4. Check Docker & launch PostgreSQL container
# ------------------------------------------------------------------------------
echo ""
echo -e "${CYAN}${BOLD}[4/7] Checking Docker and starting PostgreSQL container...${NC}"

if ! docker info >/dev/null 2>&1; then
    if [[ "$OSTYPE" == "darwin"* ]] && [ -d "/Applications/Docker.app" ]; then
        echo -e "  ${YELLOW}Docker is not running. Launching Docker Desktop...${NC}"
        open -a Docker || true
    fi

    echo -n "  Waiting for Docker daemon to become responsive..."
    RETRIES=45
    while ! docker info >/dev/null 2>&1; do
        sleep 2
        echo -n "."
        RETRIES=$((RETRIES - 1))
        if [ $RETRIES -le 0 ]; then
            echo ""
            echo -e "${RED}Error: Docker daemon is not accessible.${NC}"
            echo -e "Please start Docker Desktop manually and re-run: ${BOLD}pnpm setup${NC}"
            exit 1
        fi
    done
    echo ""
    echo -e "  ✓ Docker daemon is ${GREEN}online${NC}!"
else
    echo -e "  ✓ Docker is ${GREEN}running${NC}."
fi

# Clean up any previously halted/failed personal_drive_db container
echo -e "  Resetting previous container state if any..."
docker compose -f docker-compose.yml -f docker-compose.dev.yml down --remove-orphans 2>/dev/null || true

echo -e "  Starting PostgreSQL container (bound to ${BLUE}127.0.0.1:${DB_PORT}${NC})..."
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db

# ------------------------------------------------------------------------------
# 5. Wait for PostgreSQL readiness
# ------------------------------------------------------------------------------
echo ""
echo -e "${CYAN}${BOLD}[5/7] Waiting for PostgreSQL database to be healthy...${NC}"

RETRIES=30
until docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T db pg_isready -U personal_drive -d personal_drive >/dev/null 2>&1 || [ $RETRIES -le 0 ]; do
    sleep 1
    echo -n "."
    RETRIES=$((RETRIES - 1))
done
echo ""

if [ $RETRIES -le 0 ]; then
    echo -e "${RED}Error: PostgreSQL did not become ready in time.${NC}"
    echo -e "Container logs:"
    docker compose -f docker-compose.yml -f docker-compose.dev.yml logs db
    exit 1
fi
echo -e "  ✓ PostgreSQL is ${GREEN}healthy and ready for queries${NC}."

# ------------------------------------------------------------------------------
# 6. Apply schema migrations & seed database
# ------------------------------------------------------------------------------
echo ""
echo -e "${CYAN}${BOLD}[6/7] Applying database migrations and seeding owner account...${NC}"

# Load environment variables from .env.local
set -a
# shellcheck disable=SC1091
source .env.local
set +a

echo -e "  Generating Prisma Client..."
pnpm exec prisma generate

echo -e "  Pushing schema migrations to PostgreSQL..."
pnpm exec prisma db push --accept-data-loss

echo -e "  Seeding single-owner account..."
pnpm exec prisma db seed

# ------------------------------------------------------------------------------
# 7. Run automated test suite
# ------------------------------------------------------------------------------
echo ""
echo -e "${CYAN}${BOLD}[7/7] Running automated verification test suite...${NC}"
pnpm test

# Extract credentials for display
OWNER_EMAIL=$(grep -E '^DRIVE_OWNER_EMAIL=' .env.local | cut -d '=' -f2- | tr -d '"' | tr -d "'")
OWNER_PASSWORD=$(grep -E '^DRIVE_OWNER_PASSWORD=' .env.local | cut -d '=' -f2- | tr -d '"' | tr -d "'")

echo ""
echo -e "${GREEN}${BOLD}==================================================================${NC}"
echo -e "${GREEN}${BOLD}            DEVELOPMENT ENVIRONMENT READY TO USE!                 ${NC}"
echo -e "${GREEN}${BOLD}==================================================================${NC}"
echo ""
echo -e "  ${BOLD}Web Application URL:${NC} ${CYAN}http://localhost:3000${NC}"
echo -e "  ${BOLD}Physical Storage:${NC}   ${BLUE}${STORAGE_PATH}${NC}"
echo -e "  ${BOLD}Database:${NC}           ${BLUE}PostgreSQL 16 @ 127.0.0.1:${DB_PORT} (personal_drive)${NC}"
echo ""
echo -e "  ${BOLD}Owner Login Credentials:${NC}"
echo -e "    • Email:    ${GREEN}${OWNER_EMAIL}${NC}"
echo -e "    • Password: ${GREEN}${OWNER_PASSWORD}${NC}"
echo ""
echo -e "  ${BOLD}Start Development Server:${NC}"
echo -e "    ${GREEN}${BOLD}pnpm dev${NC}"
echo ""
echo -e "  ${BOLD}Useful Maintenance Commands:${NC}"
echo -e "    • Run tests:          ${BLUE}pnpm test${NC}"
echo -e "    • Stop database:      ${BLUE}pnpm db:down${NC}"
echo -e "    • Restart DB:         ${BLUE}pnpm db:up${NC}"
echo -e "    • Prisma Studio:      ${BLUE}pnpm exec prisma studio${NC}"
echo -e "    • Storage Migration:  ${BLUE}bash scripts/migrate-storage.sh validate <dest_path>${NC}"
echo -e "    • Create Backup:      ${BLUE}bash scripts/backup.sh [dest_path]${NC}"
echo -e "    • Restore Backup:     ${BLUE}bash scripts/restore.sh <backup.tar.gz> [target_storage]${NC}"
echo ""

# Personal Drive — Production Docker Deployment Guide

Personal Drive uses a multi-stage `Dockerfile` (Node 24 Alpine standalone) and a hardened `docker-compose.yml` optimized for 24/7 home server operation on modest hardware (AMD Ryzen 3 3300U, 12GB RAM).

---

## 1. Architecture Overview

```
                        [Tailscale Mesh Network / Local LAN]
                                       │
                                       ▼ (Port 3000 / HTTPS)
                    ┌─────────────────────────────────────┐
                    │       Next.js Standalone App        │
                    │   (Container: personal_drive_app)   │
                    │   Limits: 2.0 CPUs, 2048MB RAM      │
                    └──────────────────┬──────────────────┘
                                       │ Internal Network: personal_drive_net
                                       ▼ (Port 5432 - NO public bind)
                    ┌─────────────────────────────────────┐
                    │      PostgreSQL 16 Alpine DB        │
                    │   (Container: personal_drive_db)    │
                    │   Limits: 1.5 CPUs, 1536MB RAM      │
                    └─────────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌────────────────────────┐                             ┌────────────────────────┐
│  Host Storage Volume   │                             │  Host Backup Volume    │
│  /srv/home-server/...  │                             │  /srv/home-server/...  │
└────────────────────────┘                             └────────────────────────┘
```

---

## 2. Preparing Production Environment (`.env`)

Create your production `.env` file in the project root:

```ini
# Database internal network connection
DATABASE_URL="postgresql://personal_drive:StrongSecretDbPassword@db:5432/personal_drive"
POSTGRES_USER="personal_drive"
POSTGRES_PASSWORD="StrongSecretDbPassword"
POSTGRES_DB="personal_drive"

# App Secrets
NEXTAUTH_URL="https://your-node.ts.net"   # or http://192.168.1.100:3000
AUTH_SECRET="GenerateWith_openssl_rand_base64_32"

# Physical Hardware Mounts
DRIVE_STORAGE_PATH="/srv/home-server/personal-drive/storage"
DRIVE_BACKUP_PATH="/srv/home-server/personal-drive/backups"

# Single-Owner Credentials
DRIVE_OWNER_EMAIL="owner@personal.drive"
DRIVE_OWNER_NAME="System Owner"
DRIVE_OWNER_PASSWORD="SecureProductionPassword123!"

# Limits
DRIVE_MAX_UPLOAD_SIZE_MB="10240"
NODE_ENV="production"
```

---

## 3. Preparing Host Storage Directories

Ensure host directories exist with correct permissions:

```bash
sudo mkdir -p /srv/home-server/personal-drive/storage/files
sudo mkdir -p /srv/home-server/personal-drive/storage/.tmp
sudo mkdir -p /srv/home-server/personal-drive/storage/.migration
sudo mkdir -p /srv/home-server/personal-drive/backups

# Ensure the container user (UID 1001) has read/write permissions
sudo chown -R 1001:1001 /srv/home-server/personal-drive/storage
sudo chown -R 1001:1001 /srv/home-server/personal-drive/backups
```

---

## 4. Building and Launching Containers

```bash
# Build standalone image and launch in background
docker compose up -d --build
```

Verify service status:
```bash
docker compose ps
docker compose logs -f app
```

Both `personal_drive_db` and `personal_drive_app` are configured with `restart: unless-stopped`, ensuring automatic recovery across host reboot or Docker daemon restarts.

---

## 5. Production Health Check

You can query the health endpoint:
```bash
curl -I http://127.0.0.1:3000/api/health
```
Returns `200 OK` with JSON telemetry on database latency, free storage, memory usage, and backup state.

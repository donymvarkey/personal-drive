# Personal Drive — Environment Configuration Reference

This document lists all environment variables supported by Personal Drive.

---

## 1. Core Configuration Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `DATABASE_URL` | *Required* | PostgreSQL connection string (`postgresql://user:pass@host:port/dbname`). |
| `DB_PORT` | `5433` | PostgreSQL host binding port for local development. |
| `NEXTAUTH_URL` | `http://localhost:3000` | Canonical public URL used for Auth session cookies and redirects. |
| `AUTH_SECRET` | *Required* | 32+ character random secret used to sign session JWTs. |
| `DRIVE_STORAGE_PATH` | `/app/storage` | Absolute path to the physical storage mount on the host or inside container. |
| `DRIVE_BACKUP_PATH` | `/app/backups` | Absolute path to independent backup storage destination. |
| `DRIVE_OWNER_EMAIL` | `admin@personal.drive` | Single-owner email permitted to log in. |
| `DRIVE_OWNER_NAME` | `Dony M Varkey` | Display name for the single-owner user account. |
| `DRIVE_OWNER_PASSWORD` | `Test@1234` | Seed password for the owner account (change upon first login). |
| `DRIVE_MAX_UPLOAD_SIZE_MB` | `10240` | Maximum single file upload limit in megabytes (default 10 GB). |
| `NODE_ENV` | `development` | Set to `production` in live deployments. |
| `NODE_OPTIONS` | `--max-old-space-size=1536` | Node.js memory optimization flag. |

---

## 2. Retention Policies (Configured in Settings UI)

- **Trash Retention**: Configurable to 7, 30, 60, 90 days, or manual only (0). Soft-deleted items are safely purged after this period.
- **File Versioning Limit**: Configurable to 3, 5, 10, or unlimited (0) versions per file. Oldest versions are automatically rotated.
- **Backup Retention**: Configurable in days (default 30 days). The system always preserves at least the 3 latest backups.

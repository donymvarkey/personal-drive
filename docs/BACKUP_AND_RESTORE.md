# Personal Drive — Backup, Recovery & Restore Guide

Personal Drive implements a dual-tier disaster recovery architecture designed to safeguard your data against disk failure, accidental data loss, or server replacement.

---

## 1. Backup Architecture

A Personal Drive backup creates a self-contained, timestamped `.tar.gz` archive containing:
1. **Database Export (`database_export.json`)**: Complete point-in-time snapshot of users, files, folders, versions, activity logs, and settings.
2. **Physical Storage Files (`files/`)**: Exact copies of all uploaded binaries, named by their immutable UUID.
3. **Integrity Manifest (`manifest.json`)**:
   - Manifest schema version & backup timestamp
   - Total file count and byte sum
   - Cryptographic SHA-256 inventory of every file
   - Database record counts

### Isolation Requirement
> [!IMPORTANT]
> `DRIVE_BACKUP_PATH` must be located on an independent physical drive or external volume. The system strictly rejects backing up to a directory inside the primary storage disk.

---

## 2. Creating a Backup

### Method A: Web UI
1. Navigate to **Settings** in the dashboard.
2. Scroll to the **Backup & Disaster Recovery** card.
3. Click **Create Backup Now**.
4. The system will create the archive, compute SHA-256 checksums, verify the file on disk, and list it in the backup history table.

### Method B: Host CLI Script
You can trigger backups manually from the terminal or schedule them with cron:

```bash
# Run backup to default configured backup path
bash scripts/backup.sh

# Or specify a custom backup directory on an external disk
bash scripts/backup.sh /Volumes/ExternalBackupDisk/drive_backups
```

### Method C: Automated Scheduling (Cron)
Add a crontab entry on the home server host:

```bash
# Run daily backup at 3:00 AM
0 3 * * * /path/to/personal-drive/scripts/backup.sh /mnt/backup_hdd/drive_backups >> /var/log/personal-drive-backup.log 2>&1
```

---

## 3. Verifying Backup Integrity

Every backup created via the UI or API undergoes automated verification. You can re-verify any backup archive at any time:
- In the UI, click the **Verify** button next to any backup in the catalog.
- Or query `POST /api/backup` with `{ "action": "verify", "backupId": "<UUID>" }`.

Verification confirms:
1. The archive exists and has a non-zero byte size.
2. The manifest inventory matches expected checksums.
3. The database export is non-empty and well-formed.

---

## 4. Disaster Recovery & Restoration

When replacing hardware, recovering from accidental file deletion, or restoring after a disk wipe, follow these procedures:

### Method A: Emergency CLI Restoration (`restore.sh`)
```bash
# Syntax:
bash scripts/restore.sh <path_to_backup_archive.tar.gz> [target_storage_path]

# Example: Restore from an external disk backup
bash scripts/restore.sh /mnt/backup_hdd/drive_backups/backup-2026-11-22.tar.gz
```

The script will:
1. Extract the backup archive to a temporary staging area.
2. Validate `manifest.json`.
3. Restore physical file binaries into `DRIVE_STORAGE_PATH/files/` and verify SHA-256 integrity.
4. Restore PostgreSQL records (users, folders, files, versions, settings).
5. Perform post-recovery reconciliation to ensure 100% database-to-disk consistency.
6. Clean up temporary staging files.

### Method B: In-App One-Click Restore
1. Go to **Settings** > **Backup & Disaster Recovery**.
2. Find the desired backup in the catalog.
3. Click the **Restore** button and confirm in the alert dialog.
4. The system will restore files and database state atomically.

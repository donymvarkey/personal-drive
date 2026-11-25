#!/usr/bin/env bash
# ==============================================================================
# Personal Drive — Host-Side Automated Backup Script (Phase 6)
# ==============================================================================
# Usage:
#   bash scripts/backup.sh [destination_directory]
#
# Examples:
#   bash scripts/backup.sh /srv/home-server/backups
#   bash scripts/backup.sh /Volumes/ExternalBackupDisk/drive_backups
#
# Can be scheduled via crontab:
#   0 3 * * * /path/to/personal-drive/scripts/backup.sh /srv/home-server/backups >> /var/log/personal-drive-backup.log 2>&1
# ==============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Load local environment if present
if [ -f ".env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
elif [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Override DRIVE_BACKUP_PATH if passed as CLI argument
if [ -n "${1:-}" ]; then
  export DRIVE_BACKUP_PATH="$1"
fi

BACKUP_DEST="${DRIVE_BACKUP_PATH:-${PROJECT_ROOT}/drive_backups}"
STORAGE_PATH="${DRIVE_STORAGE_PATH:-/tmp/personal-drive-storage}"

echo "=================================================================="
echo " Personal Drive — Automated Backup Service"
echo " Time: $(date)"
echo " Storage Path: ${STORAGE_PATH}"
echo " Backup Destination: ${BACKUP_DEST}"
echo "=================================================================="

# Prevent backup destination inside storage directory
if [[ "$(realpath "${BACKUP_DEST}")" == "$(realpath "${STORAGE_PATH}")"* ]]; then
  echo "ERROR: Backup destination cannot reside inside primary storage directory!"
  exit 1
fi

mkdir -p "${BACKUP_DEST}"

# Execute Node.js backup engine with env-file
echo "Executing backup engine..."
npx tsx --env-file=.env.local -e '
import { backupService } from "./src/lib/backup";
import { prisma } from "./src/lib/db";

async function run() {
  console.log("Starting backup creation...");
  const res = await backupService.createBackup("scheduled");
  console.log("✓ Backup created successfully:");
  console.log("  • Backup ID:    " + res.backupId);
  console.log("  • Archive:      " + res.archivePath);
  console.log("  • Total Files:  " + res.totalFiles);
  console.log("  • Size (bytes): " + res.sizeBytes);
  console.log("  • Verified:     " + res.verified);
}

run()
  .catch((err) => {
    console.error("Backup failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
'

echo "=================================================================="
echo " Backup Completed Successfully at $(date)"
echo "=================================================================="

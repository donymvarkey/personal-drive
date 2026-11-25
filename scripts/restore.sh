#!/usr/bin/env bash
# ==============================================================================
# Personal Drive — Disaster Recovery & Restore Script (Phase 6)
# ==============================================================================
# Usage:
#   bash scripts/restore.sh <path_to_backup_archive.tar.gz> [target_storage_path]
#
# Examples:
#   bash scripts/restore.sh /srv/home-server/backups/backup-2026-11-22.tar.gz
#   bash scripts/restore.sh /Volumes/Backup/backup.tar.gz /Volumes/NewInternalDrive/storage
# ==============================================================================

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <path_to_backup_archive.tar.gz> [target_storage_path]"
  exit 1
fi

ARCHIVE_PATH="$1"
TARGET_STORAGE="${2:-}"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [ ! -f "${ARCHIVE_PATH}" ]; then
  echo "Error: Backup archive file does not exist at: ${ARCHIVE_PATH}"
  exit 1
fi

echo "=================================================================="
echo " Personal Drive — Disaster Recovery & Database Restoration"
echo " Time: $(date)"
echo " Archive: ${ARCHIVE_PATH}"
if [ -n "${TARGET_STORAGE}" ]; then
  echo " Target Storage Override: ${TARGET_STORAGE}"
fi
echo "=================================================================="

echo "Executing restore engine..."
npx tsx --env-file=.env.local -e '
import { restoreService } from "./src/lib/restore";
import { prisma } from "./src/lib/db";

const archivePath = process.argv[1];
const targetStorage = process.argv[2] || undefined;

async function run() {
  console.log("Restoring from archive:", archivePath);
  const result = await restoreService.restoreFromArchive(archivePath, targetStorage);
  console.log("✓ Restoration completed successfully!");
  console.log("  • Backup ID:        " + result.backupId);
  console.log("  • Files Restored:   " + result.filesRestored);
  console.log("  • Users Restored:   " + result.dbRecordsRestored.users);
  console.log("  • Files in DB:      " + result.dbRecordsRestored.files);
  console.log("  • Folders in DB:    " + result.dbRecordsRestored.folders);
  console.log("  • Versions in DB:   " + result.dbRecordsRestored.versions);
  console.log("  • Verified on Disk: " + result.integrityVerified);
  result.details.forEach(d => console.log("    " + d));
}

run()
  .catch((err) => {
    console.error("Restore failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
' "${ARCHIVE_PATH}" "${TARGET_STORAGE}"

echo "=================================================================="
echo " Disaster Recovery Restore Completed Successfully at $(date)"
echo "=================================================================="

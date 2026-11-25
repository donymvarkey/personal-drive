#!/usr/bin/env bash

# ==============================================================================
# Personal Drive — Narrowly-Scoped Host Storage Migration Helper
# ==============================================================================
# Performs guided, non-destructive migration of physical file storage from
# source disk to target disk with SHA-256 verification, resume, and rollback.
#
# Commands:
#   validate <dest_path>
#   copy     <dest_path>
#   sync     <dest_path>
#   verify   <dest_path>
#   switch   <dest_path>
#   rollback <dest_path>
# ==============================================================================

set -eo pipefail

COMMAND="$1"
DEST_PATH="$2"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Resolve source storage path from environment or caller
if [ -n "${DRIVE_STORAGE_PATH:-}" ]; then
    SOURCE_PATH="$DRIVE_STORAGE_PATH"
elif [ -f ".env.local" ]; then
    SOURCE_PATH=$(grep -E '^DRIVE_STORAGE_PATH=' .env.local | cut -d '=' -f2- | tr -d '"' | tr -d "'")
elif [ -f ".env" ]; then
    SOURCE_PATH=$(grep -E '^DRIVE_STORAGE_PATH=' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'")
fi
SOURCE_PATH="${SOURCE_PATH:-${PROJECT_ROOT}/storage_dev}"

# Marker filename required on destination volume to guard against accidental paths
MARKER_FILE=".drive-target"

case "$COMMAND" in
    validate)
        if [ -z "$DEST_PATH" ]; then
            echo '{"valid":false,"error":"Destination path is required."}'
            exit 1
        fi

        # 1. Check directory existence
        if [ ! -d "$DEST_PATH" ]; then
            echo '{"valid":false,"error":"Destination directory does not exist or is not mounted."}'
            exit 1
        fi

        # 2. Check marker file (.drive-target)
        if [ ! -f "${DEST_PATH}/${MARKER_FILE}" ]; then
            echo '{"valid":false,"error":"Missing safety marker file (.drive-target). Please create '"${DEST_PATH}/${MARKER_FILE}"' to confirm this volume is dedicated for Personal Drive."}'
            exit 1
        fi

        # 3. Check write permissions
        TEST_FILE="${DEST_PATH}/.perm_test_$$"
        if ! touch "$TEST_FILE" 2>/dev/null; then
            echo '{"valid":false,"error":"Destination path is not writable by current user."}'
            exit 1
        fi
        rm -f "$TEST_FILE"

        # 4. Check capacity (Available destination space vs Source used space)
        SOURCE_USED_KB=$(du -sk "${SOURCE_PATH}/files" 2>/dev/null | awk '{print $1}')
        SOURCE_USED_KB="${SOURCE_USED_KB:-0}"

        DEST_AVAIL_KB=$(df -k "$DEST_PATH" | tail -1 | awk '{print $4}')
        DEST_AVAIL_KB="${DEST_AVAIL_KB:-0}"

        if [ "$DEST_AVAIL_KB" -lt "$SOURCE_USED_KB" ]; then
            echo '{"valid":false,"error":"Insufficient space on destination volume. Required: '"${SOURCE_USED_KB}"' KB, Available: '"${DEST_AVAIL_KB}"' KB."}'
            exit 1
        fi

        echo '{"valid":true,"sourcePath":"'"$SOURCE_PATH"'","destPath":"'"$DEST_PATH"'","requiredKb":'"$SOURCE_USED_KB"',"availableKb":'"$DEST_AVAIL_KB"'}'
        ;;

    copy|sync)
        if [ -z "$DEST_PATH" ] || [ ! -d "$DEST_PATH" ]; then
            echo '{"success":false,"error":"Invalid destination path."}'
            exit 1
        fi

        mkdir -p "${DEST_PATH}/files" "${DEST_PATH}/.tmp"

        # Use rsync for reliable delta copying with resume support
        if command -v rsync >/dev/null 2>&1; then
            rsync -av --inplace "${SOURCE_PATH}/files/" "${DEST_PATH}/files/" >/dev/null 2>&1
        else
            cp -rn "${SOURCE_PATH}/files/"* "${DEST_PATH}/files/" 2>/dev/null || true
        fi

        COPIED_COUNT=$(find "${DEST_PATH}/files" -type f | wc -l | tr -d ' ')
        SOURCE_COUNT=$(find "${SOURCE_PATH}/files" -type f | wc -l | tr -d ' ')

        echo '{"success":true,"copiedFiles":'"$COPIED_COUNT"',"sourceFiles":'"$SOURCE_COUNT"'}'
        ;;

    verify)
        if [ -z "$DEST_PATH" ] || [ ! -d "${DEST_PATH}/files" ]; then
            echo '{"verified":false,"error":"Destination files directory does not exist."}'
            exit 1
        fi

        MISMATCH_COUNT=0
        VERIFIED_COUNT=0

        for file in "${SOURCE_PATH}/files/"*; do
            if [ -f "$file" ]; then
                base=$(basename "$file")
                dest_file="${DEST_PATH}/files/${base}"

                if [ ! -f "$dest_file" ]; then
                    MISMATCH_COUNT=$((MISMATCH_COUNT + 1))
                    continue
                fi

                # Compute checksums
                if command -v shasum >/dev/null 2>&1; then
                    src_hash=$(shasum -a 256 "$file" | awk '{print $1}')
                    dst_hash=$(shasum -a 256 "$dest_file" | awk '{print $1}')
                else
                    src_hash=$(sha256sum "$file" | awk '{print $1}')
                    dst_hash=$(sha256sum "$dest_file" | awk '{print $1}')
                fi

                if [ "$src_hash" != "$dst_hash" ]; then
                    MISMATCH_COUNT=$((MISMATCH_COUNT + 1))
                else
                    VERIFIED_COUNT=$((VERIFIED_COUNT + 1))
                fi
            fi
        done

        if [ "$MISMATCH_COUNT" -gt 0 ]; then
            echo '{"verified":false,"mismatches":'"$MISMATCH_COUNT"',"verifiedCount":'"$VERIFIED_COUNT"'}'
            exit 1
        fi

        echo '{"verified":true,"verifiedCount":'"$VERIFIED_COUNT"'}'
        ;;

    switch)
        if [ -z "$DEST_PATH" ] || [ ! -d "$DEST_PATH" ]; then
            echo '{"success":false,"error":"Invalid destination path for switch."}'
            exit 1
        fi

        TIMESTAMP=$(date +%s)

        # 1. Create backups of .env and .env.local
        [ -f ".env" ] && cp ".env" ".env.backup.${TIMESTAMP}"
        [ -f ".env.local" ] && cp ".env.local" ".env.local.backup.${TIMESTAMP}"

        # 2. Update DRIVE_STORAGE_PATH in .env
        if [ -f ".env" ]; then
            sed -i '' -E "s|^DRIVE_STORAGE_PATH=.*|DRIVE_STORAGE_PATH=\"${DEST_PATH}\"|" .env 2>/dev/null || \
            sed -i -E "s|^DRIVE_STORAGE_PATH=.*|DRIVE_STORAGE_PATH=\"${DEST_PATH}\"|" .env 2>/dev/null
        fi

        # 3. Update DRIVE_STORAGE_PATH in .env.local
        if [ -f ".env.local" ]; then
            sed -i '' -E "s|^DRIVE_STORAGE_PATH=.*|DRIVE_STORAGE_PATH=\"${DEST_PATH}\"|" .env.local 2>/dev/null || \
            sed -i -E "s|^DRIVE_STORAGE_PATH=.*|DRIVE_STORAGE_PATH=\"${DEST_PATH}\"|" .env.local 2>/dev/null
        fi

        echo '{"success":true,"switchedPath":"'"$DEST_PATH"'","backupTimestamp":"'"$TIMESTAMP"'"}'
        ;;

    rollback)
        LATEST_BACKUP=$(ls -t .env.backup.* 2>/dev/null | head -1 || true)
        LATEST_LOCAL_BACKUP=$(ls -t .env.local.backup.* 2>/dev/null | head -1 || true)

        if [ -n "$LATEST_BACKUP" ] && [ -f "$LATEST_BACKUP" ]; then
            cp "$LATEST_BACKUP" .env
        fi
        if [ -n "$LATEST_LOCAL_BACKUP" ] && [ -f "$LATEST_LOCAL_BACKUP" ]; then
            cp "$LATEST_LOCAL_BACKUP" .env.local
        fi

        echo '{"success":true,"message":"Rolled back environment to previous backup."}'
        ;;

    *)
        echo "Usage: $0 {validate|copy|sync|verify|switch|rollback} <dest_path>"
        exit 1
        ;;
esac

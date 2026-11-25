#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Personal Drive – External exFAT SSD Discovery & Mount Assistant
#
# Helper script to identify external SSDs, configure persistent /etc/fstab mounts,
# and verify zero-data-loss compatibility for Personal Drive.
# ==============================================================================

echo "=================================================================="
echo " Personal Drive – External exFAT SSD Setup Assistant"
echo "=================================================================="
echo ""

# 1. Check OS
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Notice: This assistant is designed for Linux hosts (your dedicated Linux laptop)."
  echo "Current OS: $(uname -s)"
  echo ""
fi

# 2. Inspect available block devices with filesystems
echo "Scanning block devices on the system..."
echo "------------------------------------------------------------------"
if command -v lsblk >/dev/null 2>&1; then
  lsblk -f -o NAME,FSTYPE,FSVER,LABEL,UUID,FSAVAIL,FSUSE%,MOUNTPOINTS || true
elif command -v blkid >/dev/null 2>&1; then
  sudo blkid || true
else
  echo "Neither 'lsblk' nor 'blkid' found. Listing /dev/sd*:"
  ls -l /dev/sd* 2>/dev/null || true
fi
echo "------------------------------------------------------------------"
echo ""

# 3. Prompt or detect exFAT drives
echo "Look for your external SSD partition in the list above."
echo "Examples: sdb1, sdc1, nvme1n1p1 with FSTYPE 'exfat'."
echo ""

read -rp "Enter your external SSD partition name or UUID (e.g. sdb1 or 1234-ABCD): " TARGET_INPUT

if [[ -z "$TARGET_INPUT" ]]; then
  echo "Error: No partition or UUID specified. Exiting."
  exit 1
fi

DETECTED_UUID=""
DETECTED_FSTYPE=""
DEV_PATH=""

if [[ -b "/dev/$TARGET_INPUT" ]]; then
  DEV_PATH="/dev/$TARGET_INPUT"
  if command -v blkid >/dev/null 2>&1; then
    DETECTED_UUID=$(blkid -s UUID -o value "$DEV_PATH" || true)
    DETECTED_FSTYPE=$(blkid -s TYPE -o value "$DEV_PATH" || true)
  fi
elif [[ -b "$TARGET_INPUT" ]]; then
  DEV_PATH="$TARGET_INPUT"
  if command -v blkid >/dev/null 2>&1; then
    DETECTED_UUID=$(blkid -s UUID -o value "$DEV_PATH" || true)
    DETECTED_FSTYPE=$(blkid -s TYPE -o value "$DEV_PATH" || true)
  fi
else
  DETECTED_UUID="$TARGET_INPUT"
fi

echo ""
echo "Drive Details:"
if [[ -n "$DEV_PATH" ]]; then
  echo "  Device:     $DEV_PATH"
fi
if [[ -n "$DETECTED_UUID" ]]; then
  echo "  UUID:       $DETECTED_UUID"
fi
if [[ -n "$DETECTED_FSTYPE" ]]; then
  echo "  Filesystem: $DETECTED_FSTYPE"
fi
echo ""

# 4. Mount directory selection
DEFAULT_MOUNT="/mnt/personal-drive"
read -rp "Enter desired mount directory on the host [$DEFAULT_MOUNT]: " CHOSEN_MOUNT
MOUNT_PATH="${CHOSEN_MOUNT:-$DEFAULT_MOUNT}"

echo ""
echo "Recommended /etc/fstab entry for persistent mounting:"
echo "------------------------------------------------------------------"
if [[ -n "$DETECTED_UUID" ]]; then
  FSTAB_LINE="UUID=$DETECTED_UUID $MOUNT_PATH exfat defaults,uid=1001,gid=1001,umask=0022,nofail,iocharset=utf8 0 0"
else
  FSTAB_LINE="$DEV_PATH $MOUNT_PATH exfat defaults,uid=1001,gid=1001,umask=0022,nofail,iocharset=utf8 0 0"
fi
echo "$FSTAB_LINE"
echo "------------------------------------------------------------------"
echo ""
echo "Explanation of mount options:"
echo "  - uid=1001,gid=1001: Maps file ownership to Docker's non-root node user (UID 1001)."
echo "  - umask=0022: Ensures secure permissions (0755 dirs, 0644 files)."
echo "  - nofail: Allows Linux laptop to boot uninterrupted even if external SSD is unplugged."
echo "  - iocharset=utf8: Guarantees full UTF-8 encoding support for international file names."
echo ""

# 5. Optional verification
read -rp "Would you like to test creating the mount folder and mounting now? (y/N): " DO_TEST

if [[ "$DO_TEST" =~ ^[Yy]$ ]]; then
  echo "Creating mount directory $MOUNT_PATH..."
  sudo mkdir -p "$MOUNT_PATH"

  if [[ -n "$DEV_PATH" ]]; then
    echo "Mounting $DEV_PATH to $MOUNT_PATH..."
    sudo mount -t exfat -o "uid=1001,gid=1001,umask=0022,iocharset=utf8" "$DEV_PATH" "$MOUNT_PATH" || true
  fi

  echo "Verifying mount..."
  if mountpoint -q "$MOUNT_PATH"; then
    echo "  [SUCCESS] $MOUNT_PATH is actively mounted!"
    df -h "$MOUNT_PATH"
  else
    echo "  [WARNING] Mount check failed. Verify device is connected."
  fi
fi

echo ""
echo "=================================================================="
echo " Personal Drive Environment (.env) Configuration:"
echo "=================================================================="
echo "Add these variables to your Personal Drive .env or docker-compose.yml:"
echo ""
echo "DRIVE_STORAGE_PATH=$MOUNT_PATH"
if [[ -n "$DETECTED_UUID" ]]; then
  echo "DRIVE_STORAGE_UUID=$DETECTED_UUID"
fi
echo "DRIVE_STORAGE_FS_TYPE=exfat"
echo ""
echo "Done! Personal Drive is ready to index and protect your external SSD."
echo "=================================================================="

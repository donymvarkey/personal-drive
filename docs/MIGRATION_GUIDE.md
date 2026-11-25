# Personal Drive — Hybrid Storage Migration Guide

Personal Drive supports seamless migration from your internal SSD to a larger external HDD/SSD without changing PostgreSQL metadata or interrupting user read access.

---

## 1. Migration Overview

The migration process follows a 15-step safety workflow:
1. **Target Validation**: Detects and validates destination mount and identity marker (`.drive-target`).
2. **Permission Check**: Confirms write permissions on destination volume.
3. **Capacity Check**: Confirms target has sufficient free space.
4. **Initial Data Copy**: Background sync (`rsync` or streaming copy) allows normal read access during copy.
5. **Final Sync & Write Lock**: Brief write-lock pauses new uploads for 100% synchronization.
6. **Integrity Verification**: Compares SHA-256 checksums and file counts between source and destination.
7. **Switch Over**: Update `DRIVE_STORAGE_PATH` in `.env` and restart Docker containers.

---

## 2. Preparing the Destination Disk

1. Format your external drive with a modern filesystem (e.g., ext4, Btrfs, APFS).
2. Mount the drive on your host:
   ```bash
   sudo mkdir -p /mnt/external_drive/personal-drive-storage
   sudo chown -R 1001:1001 /mnt/external_drive/personal-drive-storage
   ```
3. Place an application marker file inside the target directory:
   ```bash
   echo "personal-drive-target-ok" | sudo tee /mnt/external_drive/personal-drive-storage/.drive-target
   ```

---

## 3. Running the Migration

### Method A: Guided Web UI Wizard
1. Open **Settings** > **Storage Migration Wizard**.
2. Enter the destination path (`/mnt/external_drive/personal-drive-storage`).
3. Click **Validate Destination**.
4. Click **Start Background Copy**. The wizard displays real-time file copy progress.
5. Review the final verification checksums.
6. Follow the prompt to update your Docker mount.

### Method B: Host Migration Script (`migrate-storage.sh`)
```bash
# 1. Validate destination
bash scripts/migrate-storage.sh validate /mnt/external_drive/personal-drive-storage

# 2. Run initial copy
bash scripts/migrate-storage.sh copy /mnt/external_drive/personal-drive-storage

# 3. Final synchronization and verify
bash scripts/migrate-storage.sh sync /mnt/external_drive/personal-drive-storage
```

---

## 4. Finalizing Docker Switchover

Update `.env`:
```ini
DRIVE_STORAGE_PATH="/mnt/external_drive/personal-drive-storage"
```

Restart the containers:
```bash
docker compose down && docker compose up -d
```
All files and metadata will immediately appear under the new physical mount!

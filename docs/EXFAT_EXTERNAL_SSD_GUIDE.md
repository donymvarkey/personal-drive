# External exFAT SSD Storage Guide – Personal Drive

This document outlines the architecture, setup procedure, and operational guarantees for using an existing **exFAT-formatted external SSD** as the primary storage device for Personal Drive on a dedicated Linux laptop.

---

## 1. Hardware & System Architecture Overview

```
+---------------------------------------------------------------------------------+
|                              DEDICATED LINUX LAPTOP                             |
|                                                                                 |
|  +-------------------------------------+   +---------------------------------+  |
|  |       INTERNAL 512GB SSD            |   |       EXTERNAL SSD (exFAT)      |  |
|  |-------------------------------------|   |---------------------------------|  |
|  | - Linux OS (Ubuntu / Debian / Arch) |   | - Existing personal files &     |  |
|  | - Docker Engine & Compose           |   |   folders (NEVER ERASED/MOVED)  |  |
|  | - Personal Drive Application Code   |   | - Application-managed data:     |  |
|  | - PostgreSQL DB (metadata, not file |   |   .personal-drive/              |  |
|  |   binaries)                         |   |     ├── disk.marker             |  |
|  | - System caches & temporary logs    |   |     ├── uploads/                |  |
|  | - Host Network Management Apps      |   |     ├── versions/               |  |
|  |   (Tailscale, Pi-hole, etc.)        |   |     ├── trash/                  |  |
|  |                                     |   |     └── temp/                   |  |
|  +-------------------------------------+   +---------------------------------+  |
|                     │                                       │                   |
|                     ▼                                       ▼                   |
|       Mounted at Host Root (/)            Mounted at /mnt/personal-drive        |
|                                                             │                   |
|                                                             ▼                   |
|                                             Docker Bind Mount (-v)              |
|                                           /app/storage inside container         |
+---------------------------------------------------------------------------------+
```

### Key Principles & Guarantees
1. **Zero Data Loss & In-Place Discovery**:
   - The external SSD is already formatted with **exFAT** and contains important existing personal files and folders.
   - Personal Drive **NEVER formats, erases, partitions, reinitializes, or reorganizes** your existing files.
   - Pre-existing files remain in their original folders and are indexed directly in-place.
2. **Metadata vs. Binaries**:
   - PostgreSQL stores metadata, ownership, checksums, and folder hierarchies.
   - File binaries remain solely on the external SSD.
3. **Dedicated Application Subdirectory**:
   - Application-managed artifacts live under `.personal-drive/`:
     - `disk.marker`: Hardware verification token confirming valid mount.
     - `uploads/`: New uploads.
     - `versions/`: Historical file versions.
     - `trash/`: Soft-deleted files.
     - `temp/`: High-performance staging for streaming atomic uploads.
4. **Disconnected Storage Protection**:
   - If the SSD is unplugged or unmounted, Personal Drive safely refuses writes with a `503 Service Unavailable` response.
   - It **never creates fallback directories** on the internal SSD.
   - Database records remain 100% intact. Normal operations resume automatically when reconnected.

---

## 2. Step-by-Step Linux Host Setup

### Step 1: Install Required exFAT Packages
Ensure your Linux distribution has modern exFAT kernel driver support:

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y exfat-fuse exfatprogs util-linux
```

### Step 2: Identify the External SSD & UUID
Connect your external SSD via USB. Run the helper script or `lsblk`:

```bash
# Using the Personal Drive assistant script:
bash scripts/mount-exfat-drive.sh

# Or manually:
lsblk -f -o NAME,FSTYPE,LABEL,UUID,MOUNTPOINTS
```

Sample output:
```
NAME   FSTYPE LABEL     UUID                                 MOUNTPOINTS
sda
├─sda1 vfat             9876-FEDC                            /boot/efi
└─sda2 ext4             4b67a843-1629-4d89-b003-882798e1f0e4 /
sdb
└─sdb1 exfat  MyDrive   1234-ABCD
```
Note the **UUID** (`1234-ABCD`) and **partition** (`/dev/sdb1`).

### Step 3: Create Mount Point
Create the dedicated host mount path (e.g. `/mnt/personal-drive`):

```bash
sudo mkdir -p /mnt/personal-drive
```

### Step 4: Configure `/etc/fstab` for Persistent Mounting
Edit `/etc/fstab` to ensure the drive mounts automatically at boot with the correct user permissions for Docker:

```bash
sudo nano /etc/fstab
```

Add the following entry (replace `1234-ABCD` with your drive's actual UUID):
```fstab
UUID=1234-ABCD /mnt/personal-drive exfat defaults,uid=1001,gid=1001,umask=0022,nofail,iocharset=utf8 0 0
```

#### Why These Specific Flags?
| Option | Purpose |
|---|---|
| `UUID=...` | Identifies the drive regardless of whether it shows up as `/dev/sdb`, `/dev/sdc`, etc. |
| `uid=1001,gid=1001` | Maps file ownership directly to the non-root `node` user inside the Docker container. |
| `umask=0022` | Grants standard read/execute permissions (`0755` for directories, `0644` for files). |
| `nofail` | **Critical**: Allows the Linux laptop to boot without hanging even if the external SSD is unplugged. |
| `iocharset=utf8` | Guarantees full UTF-8 character support for international filenames and emojis. |

### Step 5: Test the Mount
Mount the disk and verify:

```bash
sudo mount -a
mountpoint -q /mnt/personal-drive && echo "Mount successful!" || echo "Mount failed"
df -h /mnt/personal-drive
```

---

## 3. Application Environment Configuration

In your Personal Drive `.env` or `.env.local` file, specify:

```env
# Path to host mount
DRIVE_STORAGE_PATH=/mnt/personal-drive

# Optional: Enforce volume UUID verification at startup
DRIVE_STORAGE_UUID=1234-ABCD

# Enforce exFAT filesystem verification
DRIVE_STORAGE_FS_TYPE=exfat
```

When running with Docker Compose, the volume is automatically mapped:
```yaml
services:
  app:
    volumes:
      - ${DRIVE_STORAGE_PATH}:/app/storage
```

---

## 4. In-Place Discovery of Pre-Existing Files

Once the application is running:

1. Log into Personal Drive in your browser (`http://localhost:3000` or via Tailscale).
2. Go to **Settings** (`/settings`).
3. In the **External SSD & exFAT Storage** card:
   - Check the **Mount Status** (shows "Connected & Mounted").
   - Click **"Rescan External Drive"**.
4. The discovery engine will:
   - Scan all pre-existing folders and subfolders.
   - Extract file metadata, magic bytes MIME types, and compute streaming SHA-256 checksums.
   - Index the hierarchy in PostgreSQL in-place without moving or modifying a single file on disk.
5. All your existing files and directories will appear immediately under **My Files** in the Personal Drive dashboard.

---

## 5. exFAT Compatibility & Rules

| Constraint | Behavior in Personal Drive |
|---|---|
| **Forbidden Characters** | Characters `\ / : * ? " < > \|` and ASCII control chars (0x00-0x1F) are stripped on upload/rename. |
| **Trailing Dots / Spaces** | Trailing dots (`.`) and spaces (` `) are trimmed automatically as required by exFAT. |
| **Case Sensitivity** | exFAT is case-preserving but case-insensitive. Collision checks compare names case-insensitively (`Photo.jpg` collides with `photo.jpg`). |
| **POSIX Permissions** | Handled at mount time via `uid=1001,gid=1001,umask=0022`. `chmod`/`chown` calls are avoided. |
| **Atomic Operations** | Where atomic rename is not supported across filesystem boundaries, safe copy + verify + unlink is utilized. |

---

## 6. Disconnected Drive Handling & Recovery

If the external SSD is disconnected or unmounted:
1. **Application Response**:
   - All read/write operations detect the missing mount and return `503 Service Unavailable`.
   - The UI shows a clear red **"Disconnected"** status with the reason.
   - Personal Drive **never creates replacement folders** on the internal SSD.
2. **Metadata Integrity**:
   - PostgreSQL preserves all metadata, starred items, version history, and folder trees.
3. **Reconnecting**:
   - Re-attach the SSD via USB.
   - If not auto-mounted, run `sudo mount -a`.
   - Personal Drive automatically detects the drive and marker file, resuming normal operation immediately.

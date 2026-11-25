# Personal Drive — Storage Management Guide

This guide details physical disk layout, health monitoring, capacity tracking, and hybrid storage policies.

---

## 1. Physical Storage Architecture

Personal Drive stores data outside the web server root. The storage folder structure is:

```
$DRIVE_STORAGE_PATH/
├── files/              # Immutable physical binaries (UUID.ext)
├── .tmp/               # Temporary chunk uploads & in-flight streams
└── .migration/         # Staging area for external disk migrations
```

### Storage Status Lifecycle
- `ready`: File upload verified and available for download.
- `uploading`: File stream in progress in `.tmp/`.
- `corrupted`: Checksum verification failed; flagged for review.
- `trashed`: Soft-deleted item retained per configured retention policy.

---

## 2. Capacity Monitoring & Physical Health

The **Settings** page provides a live hardware dashboard showing:
1. **Total Physical Capacity**: Raw hardware block size reported by the OS filesystem (`statvfs`).
2. **Used Disk Space**: Total storage used by files, OS, and versions.
3. **Available Free Space**: Unallocated disk space remaining on the mount.
4. **Physical Mount Point**: Underlying hardware device and filesystem type.

---

## 3. Storage Validation & Offline Protection

Before accepting writes or reading binaries, `storageService.validateStoragePath()` verifies:
1. The configured directory exists and is accessible.
2. The filesystem is writable (via a transient atomic test file).
3. If an external disk becomes unmounted or disconnected, writes are refused immediately with `503 Service Unavailable` rather than falling back to an unsafe alternative directory.

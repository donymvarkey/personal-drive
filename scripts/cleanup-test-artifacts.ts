import { prisma } from "../src/lib/db";
import * as fs from "fs/promises";
import * as path from "path";

// Legitimate user files and folder to keep intact
const USER_FILES = new Set([
  "1a4b0ffa-f33f-471d-aa8f-b00f3409cd4e.pdf", // Dony M Varkey.pdf
  "3901a734-7950-45af-9564-9f52cef870ff.pdf", // Dony_M_Varkey_RHCSA.pdf
  "7f08376a-63f1-4c91-a8d4-86eab81d56d7.jpg", // eyg16l.jpg
  "6522170f-90dc-4a75-821a-f5bb8e542d3c.mov", // 3D-MODELVIEW-PROJECT-VIDEO-DEMONSTRATION.mov
  "ea49f6d6-b7b9-4608-be24-43db1d42415b.jpg", // 2680447.jpg
  "9447bd11-2a62-4a6c-b2f3-0e5f1e6b0ac7.jpg", // dgrooo.jpg
  "7e3437e2-b52b-416b-aecc-07fd0dbe09f3.jpg", // dictator0_vq2265.jpg
  "2f2b3c9b-166a-4754-8dcf-88578c236721.jpg", // 339324.jpg
]);

const USER_FOLDER_ID = "b679f71f-f6df-4298-948d-9fe280fa8f50"; // Dony's docs

async function cleanup() {
  console.log("=== Personal Drive Test Artifact Cleanup ===");

  const storageDir = process.env.DRIVE_STORAGE_PATH || "/tmp/personal-drive-storage";
  const filesDir = path.join(storageDir, "files");

  // 1. Identify test files in DB
  const allFiles = await prisma.file.findMany();
  const testFiles = allFiles.filter(f => !USER_FILES.has(f.storedName));
  const testFileIds = testFiles.map(f => f.id);

  console.log(`Found ${testFiles.length} synthetic test files in database to delete.`);

  // 2. Identify test folders in DB
  const allFolders = await prisma.folder.findMany();
  const testFolders = allFolders.filter(f => f.id !== USER_FOLDER_ID);
  const testFolderIds = testFolders.map(f => f.id);

  console.log(`Found ${testFolders.length} synthetic test folders in database to delete.`);

  // 3. Delete Starred Items related to test folders or test files
  const deletedStarred = await prisma.starredItem.deleteMany({
    where: {
      OR: [
        { folderId: { in: testFolderIds } },
        { fileId: { in: testFileIds } },
      ],
    },
  });
  console.log(`Deleted ${deletedStarred.count} test starred items.`);

  // 4. Delete Activity Logs related to test files or test folders
  const deletedActivities = await prisma.activityLog.deleteMany({
    where: {
      OR: [
        { folderId: { in: testFolderIds } },
        { fileId: { in: testFileIds } },
        { itemName: { contains: "SearchTest" } },
        { itemName: { contains: "Report" } },
        { itemName: { contains: "bulk-" } },
        { itemName: { contains: "starred-note" } },
        { itemName: { contains: "presentation.mp4" } },
        { itemName: { contains: "Test-Root" } },
        { itemName: { contains: "Subfolder" } },
        { itemName: { contains: "Cycle-Folder" } },
        { itemName: { contains: "Bulk-Destination" } },
        { itemName: { contains: "Starred-Folder" } },
        { itemName: { contains: "Owner-Private" } },
      ],
    },
  });
  console.log(`Deleted ${deletedActivities.count} test activity logs.`);

  // 5. Delete FileVersions related to test files
  const deletedVersions = await prisma.fileVersion.deleteMany({
    where: {
      fileId: { in: testFileIds },
    },
  });
  console.log(`Deleted ${deletedVersions.count} test file versions.`);

  // 6. Delete test Files from DB
  const deletedFiles = await prisma.file.deleteMany({
    where: {
      id: { in: testFileIds },
    },
  });
  console.log(`Deleted ${deletedFiles.count} test files from DB.`);

  // 7. Delete test Folders from DB (handle hierarchical parent relations by setting parentId null first if needed)
  await prisma.folder.updateMany({
    where: { id: { in: testFolderIds } },
    data: { parentId: null },
  });
  const deletedFolders = await prisma.folder.deleteMany({
    where: {
      id: { in: testFolderIds },
    },
  });
  console.log(`Deleted ${deletedFolders.count} test folders from DB.`);

  // 8. Delete secondary test users (intruder, etc.)
  const deletedUsers = await prisma.user.deleteMany({
    where: {
      email: { in: ["intruder@other.drive", "phase5-owner@personal.drive"] },
    },
  });
  console.log(`Deleted ${deletedUsers.count} test users from DB.`);

  // 9. Clean physical storage directory
  try {
    const diskFiles = await fs.readdir(filesDir);
    let removedDiskFiles = 0;
    for (const filename of diskFiles) {
      if (!USER_FILES.has(filename)) {
        const filePath = path.join(filesDir, filename);
        await fs.unlink(filePath).catch(() => {});
        removedDiskFiles++;
      }
    }
    console.log(`Removed ${removedDiskFiles} physical test files from ${filesDir}.`);
  } catch (err) {
    console.warn("Error reading storage files dir:", err);
  }

  // 10. Also clean .tmp directory if any leftover chunks
  try {
    const tmpDir = path.join(storageDir, ".tmp");
    const tmpFiles = await fs.readdir(tmpDir);
    for (const f of tmpFiles) {
      await fs.unlink(path.join(tmpDir, f)).catch(() => {});
    }
    console.log(`Cleaned up ${tmpFiles.length} temporary files in .tmp.`);
  } catch {}

  console.log("=== Cleanup completed successfully! ===");
}

cleanup()
  .catch((err) => {
    console.error("Cleanup error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

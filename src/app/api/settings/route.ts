import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

/**
 * GET: Retrieve user profile, preferences, retention policies, and storage info
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let settings = await prisma.appSettings.findUnique({
    where: { ownerId: user.id },
  });

  if (!settings) {
    settings = await prisma.appSettings.create({
      data: {
        ownerId: user.id,
        theme: "system",
        trashRetentionDays: 30,
        maxVersionsPerFile: 10,
      },
    });
  }

  const diskValidation = await storageService.validateStoragePath();

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
    settings: {
      theme: settings.theme,
      trashRetentionDays: settings.trashRetentionDays,
      maxVersionsPerFile: settings.maxVersionsPerFile,
      backupRetentionDays: settings.backupRetentionDays,
      backupScheduleHours: settings.backupScheduleHours,
    },
    storage: {
      currentPath: storageService.getStoragePath(),
      valid: diskValidation.valid,
      isMounted: diskValidation.isMounted ?? diskValidation.valid,
      fsType: diskValidation.fsType || "exfat",
      uuid: diskValidation.uuid,
      markerVerified: diskValidation.markerVerified ?? false,
      markerId: diskValidation.markerId,
      device: diskValidation.device || diskValidation.stats?.device || "Physical External Mount",
      mountPoint: diskValidation.stats?.mountPoint || storageService.getStoragePath(),
      totalBytes: diskValidation.stats?.totalBytes.toString() || "0",
      usedBytes: diskValidation.stats?.usedBytes.toString() || "0",
      freeBytes: diskValidation.stats?.freeBytes.toString() || "0",
      lastScanAt: settings.lastScanAt,
      indexedFilesCount: settings.indexedFilesCount || 0,
      indexedFoldersCount: settings.indexedFoldersCount || 0,
      error: diskValidation.error,
    },
  });
}

/**
 * PATCH: Update profile name, retention policies, theme, or change password
 */
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      name,
      theme,
      trashRetentionDays,
      maxVersionsPerFile,
      backupRetentionDays,
      backupScheduleHours,
      currentPassword,
      newPassword,
    } = body;

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Handle Password Change if requested
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: "Current password is required to change password." },
          { status: 400 }
        );
      }

      if (newPassword.length < 8) {
        return NextResponse.json(
          { error: "New password must be at least 8 characters long." },
          { status: 400 }
        );
      }

      const isMatch = await bcrypt.compare(currentPassword, user.hashedPassword);
      if (!isMatch) {
        return NextResponse.json(
          { error: "Current password is incorrect." },
          { status: 400 }
        );
      }

      const hashedNewPassword = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: { hashedPassword: hashedNewPassword },
      });
    }

    // Handle User profile updates
    if (name !== undefined) {
      await prisma.user.update({
        where: { id: user.id },
        data: { name: String(name).trim() || user.name },
      });
    }

    // Handle AppSettings updates
    const settingsUpdateData: Record<string, unknown> = {};
    if (theme && ["system", "light", "dark"].includes(theme)) {
      settingsUpdateData.theme = theme;
    }
    if (typeof trashRetentionDays === "number" && trashRetentionDays >= 0) {
      settingsUpdateData.trashRetentionDays = trashRetentionDays;
    }
    if (typeof maxVersionsPerFile === "number" && maxVersionsPerFile >= 0) {
      settingsUpdateData.maxVersionsPerFile = maxVersionsPerFile;
    }
    if (typeof backupRetentionDays === "number" && backupRetentionDays >= 0) {
      settingsUpdateData.backupRetentionDays = backupRetentionDays;
    }
    if (typeof backupScheduleHours === "number" && backupScheduleHours >= 0) {
      settingsUpdateData.backupScheduleHours = backupScheduleHours;
    }

    if (Object.keys(settingsUpdateData).length > 0) {
      await prisma.appSettings.upsert({
        where: { ownerId: user.id },
        update: settingsUpdateData,
        create: {
          ownerId: user.id,
          theme: (settingsUpdateData.theme as string) || "system",
          trashRetentionDays:
            (settingsUpdateData.trashRetentionDays as number) ?? 30,
          maxVersionsPerFile:
            (settingsUpdateData.maxVersionsPerFile as number) ?? 10,
          backupRetentionDays:
            (settingsUpdateData.backupRetentionDays as number) ?? 30,
          backupScheduleHours:
            (settingsUpdateData.backupScheduleHours as number) ?? 24,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: newPassword
        ? "Password and preferences updated successfully."
        : "Settings updated successfully.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

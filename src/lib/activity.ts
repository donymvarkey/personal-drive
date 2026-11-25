import { prisma } from "@/lib/db";

export type ActivityAction =
  | "upload"
  | "preview"
  | "download"
  | "rename"
  | "move"
  | "copy"
  | "delete"
  | "restore"
  | "scan";

export interface LogActivityParams {
  ownerId: string;
  action: ActivityAction;
  itemName: string;
  fileId?: string | null;
  folderId?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: Record<string, any>;
}

export async function logActivity(params: LogActivityParams) {
  try {
    return await prisma.activityLog.create({
      data: {
        ownerId: params.ownerId,
        action: params.action,
        itemName: params.itemName,
        fileId: params.fileId || null,
        folderId: params.folderId || null,
        details: params.details || {},
      },
    });
  } catch (err) {
    // Activity logging should not fail primary user operations
    console.error("Failed to record activity log:", err);
    return null;
  }
}

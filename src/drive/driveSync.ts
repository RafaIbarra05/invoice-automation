import { getDriveClient } from "./driveClient.js";
import { Readable } from "stream";

export async function listPdfsInFolder(
  folderId: string,
): Promise<{ id: string; name: string }[]> {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files ?? []) as { id: string; name: string }[];
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

export async function uploadExcel(
  folderId: string,
  fileName: string,
  localBuffer: Buffer,
): Promise<void> {
  const drive = getDriveClient();

  const existing = await drive.files.list({
    q: `'${folderId}' in parents and name='${fileName}' and trashed=false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const media = {
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: Readable.from(localBuffer),
  };

  const existingId = existing.data.files?.[0]?.id;

  if (existingId) {
    await drive.files.update({
      fileId: existingId,
      supportsAllDrives: true,
      media,
    });
    console.log(`🔄 Excel actualizado en Drive: ${fileName}`);
  } else {
    await drive.files.create({
      supportsAllDrives: true,
      requestBody: { name: fileName, parents: [folderId] },
      media,
    });
    console.log(`📤 Excel subido a Drive: ${fileName}`);
  }
}

export async function loadProcessedIds(folderId: string): Promise<Set<string>> {
  const drive = getDriveClient();
  const TRACKING_FILE = ".processed_ids.json";

  const res = await drive.files.list({
    q: `'${folderId}' in parents and name='${TRACKING_FILE}' and trashed=false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const fileId = res.data.files?.[0]?.id;
  if (!fileId) return new Set();

  try {
    const content = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "text" },
    );
    const ids: string[] = JSON.parse(content.data as string);
    return new Set(ids);
  } catch {
    return new Set();
  }
}

export async function saveProcessedIds(
  folderId: string,
  ids: Set<string>,
): Promise<void> {
  const drive = getDriveClient();
  const TRACKING_FILE = ".processed_ids.json";
  const buffer = Buffer.from(JSON.stringify([...ids], null, 2), "utf-8");

  const existing = await drive.files.list({
    q: `'${folderId}' in parents and name='${TRACKING_FILE}' and trashed=false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const media = { mimeType: "application/json", body: Readable.from(buffer) };
  const existingId = existing.data.files?.[0]?.id;

  if (existingId) {
    await drive.files.update({
      fileId: existingId,
      supportsAllDrives: true,
      media,
    });
  } else {
    await drive.files.create({
      supportsAllDrives: true,
      requestBody: { name: TRACKING_FILE, parents: [folderId] },
      media,
    });
  }
}

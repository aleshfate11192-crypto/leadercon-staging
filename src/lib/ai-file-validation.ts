export type AiFilePayload = { name: string; mimeType: string; base64: string };

export const MAX_AI_FILE_BYTES = 10 * 1024 * 1024;

export function validateAiFilePayload(value: unknown): AiFilePayload | null {
  if (!value || typeof value !== "object") return null;
  const file = value as Partial<AiFilePayload>;
  if (typeof file.name !== "string" || typeof file.mimeType !== "string" || typeof file.base64 !== "string") return null;
  const mimeTypes: Record<string, string[]> = {
    "application/pdf": ["pdf"],
    "image/png": ["png"],
    "image/jpeg": ["jpg", "jpeg"],
    "text/plain": ["txt", "csv"],
    "text/csv": ["csv"],
    "application/csv": ["csv"],
    "application/vnd.ms-excel": ["xls"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
    "application/msword": ["doc"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  };
  const name = file.name.replace(/\\/g, "/").split("/").pop() || "";
  const extension = name.toLowerCase().split(".").pop();
  if (!name || name.length > 180 || !extension || !mimeTypes[file.mimeType]?.includes(extension)) return null;
  if (!file.base64 || file.base64.length > Math.ceil(MAX_AI_FILE_BYTES / 3) * 4 || file.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) return null;

  const bytes = Buffer.from(file.base64, "base64");
  if (!bytes.length || bytes.byteLength > MAX_AI_FILE_BYTES || bytes.toString("base64") !== file.base64) return null;
  const startsWith = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const mimeType = file.mimeType;
  const signatureMatches = mimeType === "application/pdf" ? bytes.subarray(0, 5).toString("ascii") === "%PDF-"
    : mimeType === "image/png" ? startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    : mimeType === "image/jpeg" ? startsWith(0xff, 0xd8, 0xff)
    : mimeType === "application/vnd.ms-excel" || mimeType === "application/msword" ? startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)
    : mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? startsWith(0x50, 0x4b, 0x03, 0x04)
    : (() => { try { return !new TextDecoder("utf-8", { fatal: true }).decode(bytes).includes("\0"); } catch { return false; } })();
  if (!signatureMatches) return null;

  return {
    name: name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180),
    mimeType,
    base64: file.base64,
  };
}

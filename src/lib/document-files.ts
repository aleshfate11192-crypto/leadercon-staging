const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv",
  txt: "text/plain",
};

export function leaderConFileMimeType(file: Pick<File, "name" | "type">): string | null {
  const extension = file.name.toLowerCase().split(".").pop() || "";
  const expected = MIME_BY_EXTENSION[extension];
  if (!expected) return null;
  if (!file.type || file.type === "application/octet-stream") return expected;
  if (file.type === expected) return expected;
  // Some browsers label CSV files as Excel workbooks.
  if (extension === "csv" && file.type === "application/vnd.ms-excel") return expected;
  return null;
}

export function validateLeaderConFile(file: File, maxBytes = 20 * 1024 * 1024): string {
  if (file.size <= 0) return "This file is empty.";
  if (file.size > maxBytes) return `The file exceeds the ${(maxBytes / (1024 * 1024)).toFixed(0)} MB limit.`;
  if (!leaderConFileMimeType(file)) return "Unsupported file or mismatched file type. Use PDF, PNG, JPG, Excel, Word, CSV, or text.";
  return "";
}

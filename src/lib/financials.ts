export type LedgerEntry = {
  transaction_type: string | null;
  amount: number | string | null;
  status: string | null;
};

export function signedTransactionAmount(entry: LedgerEntry): number {
  const rawAmount = Number(entry.amount ?? 0);
  if (!Number.isFinite(rawAmount) || entry.status !== "posted") return 0;

  switch (entry.transaction_type) {
    case "payment":
    case "advance":
    case "credit_note":
      return -Math.abs(rawAmount);
    case "adjustment":
      return rawAmount;
    case "invoice":
      return Math.abs(rawAmount);
    default:
      return 0;
  }
}

export function calculateVendorBalance(
  openingBalance: number | string | null | undefined,
  entries: LedgerEntry[],
): number {
  const opening = Number(openingBalance ?? 0);
  const ledger = entries.reduce(
    (sum, entry) => sum + signedTransactionAmount(entry),
    0,
  );
  return (Number.isFinite(opening) ? opening : 0) + ledger;
}

export function formatINR(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value + (value.length === 10 ? "T00:00:00" : ""));
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date);
}

export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const safeText =
    typeof value === "string" && /^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(text)
      ? "'" + text
      : text;
  return '"' + safeText.replace(/"/g, '""') + '"';
}

export function downloadCsv(filename: string, rows: unknown[][]): void {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function canPostFinancialRecords(role: string | null | undefined): boolean {
  return role === "owner" || role === "accountant";
}

export function canApproveConstructionRecords(
  role: string | null | undefined,
): boolean {
  return ["owner", "accountant", "project_manager", "site_engineer"].includes(
    role ?? "",
  );
}

export function areUnitsComparable(plannedUnit: string | null | undefined, measuredUnit: string | null | undefined): boolean {
  const normalize = (unit: string | null | undefined) => (unit ?? "").trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
  const planned = normalize(plannedUnit);
  return planned !== "" && planned === normalize(measuredUnit);
}

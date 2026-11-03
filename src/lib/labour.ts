export type LabourPaymentStatus = "unpaid" | "partial" | "paid";

export function calculateLabourOutstanding(totalAmount: number | string, paidAmount: number | string): number {
  const total = Number(totalAmount);
  const paid = Number(paidAmount);
  if (!Number.isFinite(total) || !Number.isFinite(paid)) return 0;
  return Math.max(0, Math.round((total - paid + Number.EPSILON) * 100) / 100);
}

export function deriveLabourPaymentStatus(totalAmount: number | string, paidAmount: number | string): LabourPaymentStatus {
  const paid = Number(paidAmount);
  if (!Number.isFinite(paid) || paid <= 0) return "unpaid";
  return calculateLabourOutstanding(totalAmount, paid) === 0 ? "paid" : "partial";
}

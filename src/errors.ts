// Frontend bu kodlara göre mesaj gösterecek.
export type ErrorCode =
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "NOT_OWNER"
  | "PRICE_ABOVE_CAP"
  | "TICKET_ALREADY_USED"
  | "QR_EXPIRED"
  | "QR_INVALID"
  | "QR_ALREADY_USED"
  | "LISTING_CLOSED"
  | "TRANSFER_NOT_ALLOWED"
  | "GATE_UNAUTHORIZED"
  | "INTERNAL";

export class ApiError extends Error {
  constructor(public status: number, public code: ErrorCode, message?: string) {
    super(message ?? code);
  }
}

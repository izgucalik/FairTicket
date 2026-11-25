// TEK DOĞRULUK KAYNAĞI: iş kuralları burada.
// Anchor programındaki kurallar bununla AYNI olmalı (fiyat sınırı ve telif zincirde zorunlu kılınır;
// buradaki kontroller sadece kullanıcıya hızlı ve anlaşılır hata göstermek içindir).

export const RULES = {
  resale: {
    // Baz puan (basis points): 10000 = %100. 11000 = nominal fiyatın en fazla %110'u.
    defaultMaxPriceBps: 11000,
    // Organizatör telifi: 750 = %7.5
    defaultRoyaltyBps: 750,
  },
  maxTicketsPerWalletPerEvent: 4,
  // MVP'de bilet sadece pazar yeri üzerinden el değiştirir.
  freeTransferAllowed: false,
  // Etkinlikten bu kadar saat önce yeni listeleme açılamaz.
  listingClosesHoursBeforeEvent: 2,
  qr: {
    ttlSeconds: 25,
  },
  session: {
    ttlSeconds: 60 * 60 * 6,
    challengeTtlSeconds: 300,
  },
} as const;

// Tüm tutarlar en küçük birim cinsinden TAM SAYI (USDC için 6 basamak: 1 USDC = 1_000_000).
// Kayan noktalı sayı kullanma, para hesabında hata çıkarır.

export function maxAllowedPrice(facePrice: bigint, maxPriceBps: number): bigint {
  return (facePrice * BigInt(maxPriceBps)) / 10000n;
}

export function isPriceAllowed(facePrice: bigint, askPrice: bigint, maxPriceBps: number): boolean {
  return askPrice > 0n && askPrice <= maxAllowedPrice(facePrice, maxPriceBps);
}

export function splitPayment(price: bigint, royaltyBps: number): { royalty: bigint; seller: bigint } {
  const royalty = (price * BigInt(royaltyBps)) / 10000n;
  return { royalty, seller: price - royalty };
}

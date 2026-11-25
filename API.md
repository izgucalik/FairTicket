# FairTicket API (demo)

Sunucu: http://localhost:8000 — tüm istek ve cevaplar JSON.
Her cevapta "mode" alanı vardır: "simulated" (sunucuda taklit) veya "devnet" (zincirde gerçek). Arayüz bunu ekranda göstermelidir.

## POST /events
Organizatör etkinlik ve kuralları tanımlar.
İstek: { "name": "Konser A", "face_price": 100, "max_price": 120, "royalty_percent": 10, "supply": 50 }
Cevap: { "event_id": "e1", "mode": "simulated" }

## POST /tickets/mint
Etkinlik için bilet oluşturup cüzdana tanımlar.
İstek: { "event_id": "e1", "owner": "cüzdan_adresi" }
Cevap: { "ticket_id": "t1", "status": "valid", "mode": "simulated" }

## GET /tickets?owner=cüzdan_adresi
Cevap: { "tickets": [ { "id": "t1", "event": "Konser A", "owner": "cüzdan_adresi", "status": "valid" } ] }
status: "valid", "listed", "used"

## GET /listings
Cevap: { "listings": [ { "id": "l1", "ticket_id": "t1", "price": 110, "max_price": 120 } ] }

## POST /listings
Bileti pazar yerinde listeler. Fiyat tavanı aşılırsa reddedilir.
İstek: { "ticket_id": "t1", "seller": "cüzdan_adresi", "price": 110 }
Başarılı: { "ok": true, "listing_id": "l1", "mode": "simulated" }
Hata: { "ok": false, "error": "price_above_cap", "max_price": 120 }
Diğer hatalar: "not_owner", "ticket_used"

## POST /listings/{id}/buy
Satın alma: ödeme bölünür, bilet yeni sahibine geçer.
İstek: { "buyer": "cüzdan_adresi" }
Başarılı: { "ok": true, "seller_receives": 99, "organizer_royalty": 11, "new_owner": "cüzdan_adresi", "mode": "simulated" }

## POST /qr/issue
Bilet sahibi cüzdanıyla bir mesajı imzalar, sunucu kısa ömürlü token üretir.
İstek: { "ticket_id": "t1", "wallet": "cüzdan_adresi", "message": "metin", "signature": "imza" }
Cevap: { "token": "abc123", "expires_in": 30 }
Hata: { "error": "invalid_signature" } veya { "error": "not_owner" }

## POST /qr/verify
Görevli ekranı token'ı doğrular. Aynı token ikinci kez okutulursa reddedilir.
İstek: { "token": "abc123" }
Başarılı: { "valid": true, "ticket_id": "t1" }
Hata: { "valid": false, "reason": "already_used" }
Diğer sebepler: "expired", "unknown", "ticket_used"

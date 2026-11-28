# FairTicket

FairTicket is a Solana-based event ticketing and secondary marketplace protocol that enforces resale price caps, automatic organizer royalties, and single-use dynamic QR entry verification for event organizers and attendees.

**Demo Video (3 min):** https://youtu.be/E3biFk0aIzk 
**Solana Devnet Program ID:** `6xrY8GHUgWPZrjkRdNGTrD5Cp55icUN3L4Fot7MLiujs`  
**Solana Explorer:** https://explorer.solana.com/address/6xrY8GHUgWPZrjkRdNGTrD5Cp55icUN3L4Fot7MLiujs?cluster=devnet

---

## Problem
Traditional and secondary event ticketing markets suffer from three core failures:
1. **Scalping & Price Gouging:** Bots and resellers buy up primary inventory and resell tickets at inflated multiples.
2. **Zero Secondary Value Capture:** Event organizers and artists receive no revenue share when tickets are resold on secondary platforms.
3. **Screenshot Fraud & Duplicate Entry:** Static QR/PDF tickets are easily duplicated, leading to denied entry at venue gates.

---

## Solution & Key Features
- **Protocol-Enforced Resale Price Cap:** Organizers define a `max_price_bps` cap at event creation (e.g., 120% maximum resale ceiling). The on-chain Anchor program rejects any `list_ticket` transaction exceeding the allowed price ceiling.
- **Atomic On-Chain Royalty Split:** When a listed ticket is purchased via `buy_ticket`, the SPL payment token is atomically split between the seller (95%) and the organizer's treasury (5%) according to `royalty_bps`.
- **Dynamic Wallet-Signed QR Entry:** Attendees sign a wallet message to request a short-lived, rotating single-use QR token (`POST /qr/issue`, refreshing every 15 seconds). Gate staff verify the token (`POST /qr/verify`), which immediately invalidates the token and transitions the ticket status to `used` (`mark_used` on-chain).

---

## System Architecture

```text
+-------------------+       Phantom / Demo Wallet Sig          +------------------------+
|   Web Frontend    | ---------------------------------------> |   Backend / Chain API  |
|   (web/ UI)       | <--------------------------------------- | (src/ & chain-api/)    |
+-------------------+      JSON API ("devnet" | "simulated")   +------------------------+
         |                                                                 |
         | Direct RPC / Transaction Signing                                | Anchor Client & SPL Token
         v                                                                 v
+---------------------------------------------------------------------------------------+
|                              Solana Devnet (Anchor Program)                           |
|                     ID: 6xrY8GHUgWPZrjkRdNGTrD5Cp55icUN3L4Fot7MLiujs                  |
|                                                                                       |
|  [create_event] -> [mint_ticket] -> [list_ticket] -> [buy_ticket] -> [mark_used]      |
|                                  -> [cancel_listing]                                  |
+---------------------------------------------------------------------------------------+

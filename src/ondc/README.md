# ONDC Integration Module

## Overview

This module implements the **ONDC (Open Network for Digital Commerce)** Beckn-protocol BPP (Buyer-facing Platform Provider / Seller App) for the ODOP Mart platform.

**Reference implementation**: PHP project at `C:\xampp\htdocs\preprod_v1\`

---

## Architecture

```
src/ondc/
├── config/          ONDC network URLs, constants, category mapping
├── types/           Full TypeScript types for Beckn & ONDC payloads
├── middleware/       Signature auth, context validation, request logging
├── utils/           Signature crypto, payload builders, helpers
├── adapters/        Read main DB → transform to ONDC format
├── models/          Raw SQL models for ondc_odop_db
├── services/        Business logic (catalog, order, fulfillment, IGM, etc.)
├── controllers/     Thin HTTP handlers (Beckn protocol + admin API)
│   ├── beckn/       search, select, init, confirm, status, track, cancel, update
│   └── admin/       catalog, orders, providers, settlements, logs
├── flows/           Unsolicited outbound flows (1A, 3A, 3B, 3C, 4A, 4B, 7)
│   └── generators/  Payload generators per flow
├── routes/          Express routers (beckn, admin, test)
└── db/              SQL schema + migration files
```

---

## Database Strategy

| Database       | Access         | Purpose                                               |
| -------------- | -------------- | ----------------------------------------------------- |
| `new_odop_db`  | **READ-ONLY**  | Main e-commerce data (products, sellers, users)       |
| `ondc_odop_db` | **READ/WRITE** | All ONDC-specific data (orders, catalog copies, logs) |

- Use `~/lib/sql.ts` (`sqlQuery`, `sqlExec`) for main DB reads
- Use `~/lib/ondcSql.ts` (`ondcQuery`, `ondcExec`) for ONDC DB reads/writes
- **Never write to main DB from ONDC module** — use adapters to read, store results in ONDC DB

---

## API Endpoints

### Beckn Protocol (public, BAP → BPP)

| Method | Path                             | Action                               |
| ------ | -------------------------------- | ------------------------------------ |
| POST   | `/api/v1/ondc/search`            | Handle search intent                 |
| POST   | `/api/v1/ondc/select`            | Buyer selects items                  |
| POST   | `/api/v1/ondc/init`              | Buyer initializes order              |
| POST   | `/api/v1/ondc/confirm`           | Buyer confirms order                 |
| POST   | `/api/v1/ondc/status`            | Check order status                   |
| POST   | `/api/v1/ondc/track`             | Track shipment                       |
| POST   | `/api/v1/ondc/cancel`            | Cancel order                         |
| POST   | `/api/v1/ondc/update`            | Update order (return/partial cancel) |
| POST   | `/api/v1/ondc/issue`             | Raise IGM issue                      |
| POST   | `/api/v1/ondc/issue_status`      | Check issue status                   |
| POST   | `/api/v1/ondc/on_receiver_recon` | RSF recon callback                   |

### Admin API (protected)

| Method | Path                                        | Purpose                             |
| ------ | ------------------------------------------- | ----------------------------------- |
| POST   | `/api/v1/ondc/admin/catalog/sync`           | Sync seller products → ONDC catalog |
| GET    | `/api/v1/ondc/admin/orders`                 | List ONDC orders                    |
| GET    | `/api/v1/ondc/admin/orders/:id`             | Order detail + history              |
| POST   | `/api/v1/ondc/admin/orders/:id/fulfillment` | Update fulfillment state            |
| POST   | `/api/v1/ondc/admin/providers`              | Register seller as ONDC provider    |
| GET    | `/api/v1/ondc/admin/logs`                   | Transaction logs                    |
| GET    | `/api/v1/ondc/admin/settlements`            | Settlements list                    |

---

## Beckn Protocol Flow

```
BAP POST /search  →  [ACK]  →  async: build catalog  →  POST bap_uri/on_search
BAP POST /select  →  [ACK]  →  async: build quote    →  POST bap_uri/on_select
BAP POST /init    →  [ACK]  →  async: add payment    →  POST bap_uri/on_init
BAP POST /confirm →  [ACK]  →  async: create order   →  POST bap_uri/on_confirm
```

All protocol endpoints:

1. Return an immediate `{ message: { ack: { status: "ACK" } } }` (Beckn requirement)
2. Process asynchronously via `setImmediate`
3. Send callback to `context.bap_uri/{on_action}`

---

## Unsolicited Flows (Seller-initiated)

| Flow   | Trigger                                       | PHP Reference                       |
| ------ | --------------------------------------------- | ----------------------------------- |
| **1A** | Order state change (packed/shipped/delivered) | `generate_flow1a_on_status.php`     |
| **3A** | Seller cancels before pickup                  | `generate_flow3a_on_cancel.php`     |
| **3B** | Cancellation in transit                       | `generate_flow3b_on_cancel.php`     |
| **3C** | Cancellation (RTO)                            | `generate_flow3c_on_cancel.php`     |
| **4A** | Return initiated                              | `generate_flow4a_return_update.php` |
| **4B** | Return rejected                               | `generate_flow4b_return_update.php` |
| **7**  | Out-of-stock cancel                           | `Flow7_cancel.php`                  |

---

## Authentication

All incoming Beckn requests must have a valid `Authorization: Signature ...` header.

**Signature format:**

```
Authorization: Signature keyId="{subscriber_id}|{unique_key_id}|ed25519",
  algorithm="ed25519", created=<unix>, expires=<unix>,
  headers="(created) (expires) digest", signature="<base64>"
```

Implementation: `src/ondc/utils/signature.util.ts`

- Uses Ed25519 (Node.js `crypto` module)
- Public keys fetched from ONDC registry and cached 10 minutes

---

## Setup

### 1. Database

```sql
-- Create ONDC database and run schema
mysql -u root -p < src/ondc/db/schema.sql
```

### 2. Environment

```bash
# Copy ONDC env vars to your .env
cat .env.ondc >> .env
# Fill in: BPP_SUBSCRIBER_ID, BPP_UNIQUE_KEY_ID, BPP_SIGN_PRIV_KEY, BPP_SIGN_PUB_KEY
# Set: ONDC_DB_URL=mysql://user:pass@host:3306/ondc_odop_db
```

### 3. Register on ONDC Network

- Subscribe at ONDC Preprod: https://preprod.ondc.org
- Your BPP endpoints must be publicly reachable
- Register `BPP_BASE_URI` as your callback base URL

### 4. Sync Catalog

```
POST /api/v1/ondc/admin/catalog/sync
{ "seller_id": 1, "provider_id": "PROV_YOUR_ID" }
```

---

## TODO Priority List

1. **Signature verification** — complete Ed25519 with BLAKE2b digest (`signature.util.ts`)
2. **Search** — add location-based filtering, domain-specific rules
3. **Select** — add delivery charge calculation (Shiprocket API)
4. **Init** — validate delivery serviceability
5. **Flow 4A/4B** — complete return lifecycle
6. **RSF** — complete reconciliation report generation
7. **IGM** — implement escalation tiers (L1/L2/L3)
8. **Cron jobs** — stale order checks, settlement processing
9. **Frontend** — admin panel in `odop_ui/src/ondc/`

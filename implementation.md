## BRANCH-001

**Date:** 2026-06-20

**Status:** Completed

**Area:** ONDC IGM admin APIs, customer ticket persistence, issue lifecycle handling, provider enrichment, and callback logging

**What:**

- Added admin APIs to list customer tickets, view a single ticket, and fetch ticket attachments.
- Expanded admin issue APIs to support detail view, sending messages, updating status, resolving issues, and closing issues.
- Added a dedicated customer ticket model for storing normalized IGM ticket data in `ondc_customer_ticket`.
- Enhanced issue model helpers for scoped lookup, idempotent creation, action parsing, and action appending.
- Enriched provider lookup with seller and business details for IGM actor and respondent population.
- Reworked `igm.service.ts` to normalize incoming issue payloads, enrich refs and actors, persist customer ticket data, rebuild `on_issue` callback payloads from stored data, and log outbound callback results.

**Why:**

- To support a fuller ONDC IGM workflow from admin and seller panels.
- The UI buttons were visible but not actually connected to ONDC issue mutations
- on_issue was returning a minimal placeholder payload, not the expected contract structure
- To avoid losing issue, actor, attachment, and action data from inbound issue payloads.
- To keep `on_issue` callback payloads consistent by rebuilding them from normalized stored data instead of relying only on the raw request body.
- To expose customer ticket and issue progress in a structured way for operational tracking.
- To log outbound callback status for easier debugging and auditability.

**Changes:**

- `src/ondc/controllers/admin/customerTickets.controller.ts`
  Added a new controller to list tickets, fetch a single ticket, parse attachments, and expose attachment-only responses.

- `src/ondc/controllers/admin/issues.controller.ts`
  Expanded issue handling with status normalization, presented response shaping, message/history building, scoped issue fetch, issue detail API, add-message API, status update API, resolve API, and close API.

- `src/ondc/models/customerTicket.model.ts`
  Added a new model for `ondc_customer_ticket` with `findByTicketId`, `upsert`, `listAll`, `listByProvider`, and `listByStatus`.

- `src/ondc/models/issue.model.ts`
  Added `IssueDisplayStatus` and `OndcIssueAction` types plus new helpers: `findById`, `createIfMissing`, `parseActions`, and `appendAction`.

- `src/ondc/models/provider.model.ts`
  Extended provider queries and mapping to include seller name, seller email, seller phone, and business name from joined user and seller profile data.

- `src/ondc/routes/admin.route.ts`
  Registered new admin routes for issue detail/actions and customer ticket endpoints.

- `src/ondc/services/igm.service.ts`
  Major implementation update:
  normalized inbound issue payloads,
  derived refs/actors/actions when missing,
  enriched issues using provider and seller context,
  extracted descriptor attachments,
  persisted customer ticket records,
  rebuilt `on_issue` callback payloads from stored ticket data,
  and inserted outbound transaction logs for `on_issue` and `on_issue_status`.

- `implimentation.md`
  Add a new file where all data will be stored that what changes we are done and why.

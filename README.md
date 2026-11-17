# Zeiss store → eye-care request: API-backed starter

A VS Code-ready, **experimental, synthetic-test-only** project. The backend reads inventory and can either disable requests, save synthetic requests locally, or send a synthetic request to a configured gateway webhook. It does **not** create or configure an n8n workflow. Never enter real patient information; this is not production-ready.

## Run locally

Requires Node 24 LTS. Open the project folder in VS Code. First run:

```sh
npm ci
npm test
```

Create a private environment file **outside the project** (e.g. `~/.config/zeiss.env`), using `.env.example` as a key reference. Supply your inventory credentials from the approved secure channel; do not put credentials in source files, commit them, paste them into chat, or share them with users of the frontend. Then run:

```sh
node --env-file="$HOME/.config/zeiss.env" server.js
```

Open `http://127.0.0.1:3000`. Default `APP_MODE=api-preview` disables submissions. `APP_MODE=api-demo` saves synthetic requests in a local JSONL file; set `DEMO_REQUESTS_FILE` to a private path. Local files are not a production data store.

The bundled `config/stores.json` is fictional. For approved store data, use `STORES_FILE` as an absolute path to an access-controlled JSON array: `[{"id":"store-01","name":"Store name","pincode":"560100"}]`.

## Experimental webhook sender

`APP_MODE=api-webhook` enables a server-side POST for **synthetic test data only**; you must also set `WEBHOOK_SYNTHETIC_ONLY=true`. It refuses to start without gateway configuration. The project does not include real endpoint URLs or secrets.

Provide these server-side values via the private env file or approved secret manager:

- `WEBHOOK_URL`: route-owner-approved HTTPS external gateway URL under `api-external.medibuddy.in/w/`, not a raw n8n URL.
- `WEBHOOK_GATEWAY_KEY`: global gateway key.
- `WEBHOOK_AUTH_HEADER` and `WEBHOOK_AUTH_VALUE`: independently approved route-specific header and full value, e.g. an Authorization header/value if the owner approves that scheme. This generic sender supports a static header; HMAC, signed JWT and mTLS require an owner-approved adapter, not a placeholder.

The gateway requires the global key **and** independent route authentication; an auth marker is not a credential. Unknown/unapproved routes must stay blocked. The sender sends JSON in one POST, without redirect or retry: `schema_version`, UUID `request_id`, `submitted_at_utc`, `store_id`, `store_name`, `store_pincode`, `hospital_group_ref`, `hospital_name`, `hospital_city`, `hospital_locality`, `doctor_source_row_ref`, `doctor_name`, `patient_name`, `phone`, `preferred_date`, `preferred_slot`, `reason`, and `consent`. These fields are a **proposed** contract, not verified with the receiver. Exact route, method, payload, auth, acknowledgment, workflow action, retry and retention must be agreed with the gateway/workflow owner before testing a real route.

A receiving n8n workflow must be set up separately by its owner: a POST Webhook trigger with the owner-approved path behind the gateway, verification at the gateway, then validated persistence/routing and an agreed acknowledgement. This code is only the sending side; no Webhook node is deployed and no actual route has been tested. Do not treat a generic Webhook trigger, a blank workflow, or an HTTP 2xx alone as evidence of durable storage, care-team action, or an appointment. No automatic retry occurs; failures/timeouts may have been delivered. The UI shows the request reference when the backend can provide one and warns to check with the workflow owner. This UUID is not durably persisted and browser-level retry/reopen can create a different UUID: durable idempotency and reconciliation are missing.

## Local testing against the n8n webhook (synthetic data only)

For local development you can opt in to posting directly to `https://n8n-public.medibuddy.in/webhook/<uuid>` (or `/webhook-test/<uuid>`). This is **off by default** and only accepts that exact host/path shape; the gateway rules above still apply for any other route. Put these in `.env` (gitignored):

```
APP_MODE=api-webhook
WEBHOOK_SYNTHETIC_ONLY=true
WEBHOOK_ALLOW_DIRECT_N8N=true
WEBHOOK_URL=https://n8n-public.medibuddy.in/webhook/<uuid>
```

- `npm run webhook:test` sends one fake record to the webhook (no inventory credentials needed).
- `npm run dev` starts the app using `.env`.
- n8n **Test** URLs (`/webhook-test/`) only work while the workflow is in "Listen for test event"; **Production** URLs (`/webhook/`) need the workflow to be Active.
- A 2xx only proves n8n received the POST. Check the n8n Executions tab to see what the workflow did.

## What browser Inspect shows

The backend reads inventory and webhook credentials from its own process environment and makes outbound requests server-side. Those credentials and the backend webhook URL are not intentionally sent in HTML, JavaScript, or browser API responses, provided deployment and error handling remain configured correctly. A browser user **can** see the same-origin endpoints, their responses, displayed information, and their own submitted form data in DevTools/Network. Server operators, environment/process viewers, secret managers and logging/monitoring systems may have access to credentials or payloads. Never publish the private env file, expose backend logs, log sensitive bodies, or expose the app without appropriate access controls. If a credential was pasted in a shared chat, ask its owner to assess and rotate it as appropriate.

## Search behavior and data assumptions

The backend retrieves API pages (100 rows each, at most 20), ignores `totalHospitals`, and fails closed on malformed results, repeated/missing source row IDs, network failure or the page cap. Offset pagination is not a consistent snapshot. Inventory source coverage, `insurance=A`, pagination and eligibility require owner validation.

Active, complete rows with valid nonnegative API `Distance` ≤100 km are grouped by normalized hospital name + city + locality. This provisional grouping can collide and is not a verified branch identifier. Source `id` is a row reference, not a verified doctor identifier. Distance uses a store **pincode**, not exact location or road travel. Temporary Zeiss ordering uses `Number(Doctor_Surgeries_Count) === 1`; this is not established as a partner marker. Confirm the meaning with the data owner. Groups are sorted then capped at 50; all doctors in retained groups are displayed. Schedules and availability are indicative. Inventory is fetched again before submitting.

## Before any real patient use

Obtain owner-approved route admission, payload/auth contracts, purpose and consent, retention, monitoring, care-team handling and rollback. Implement authenticated access, perimeter rate limiting, audit, privacy and DPDP controls, appropriate residency, clinical/legal review, durable outbox and stable receiver-side idempotency, reconciliation, and explicit deployment approval. The in-process limiter and form consent are not a substitute. An accepted request is not a confirmed appointment.

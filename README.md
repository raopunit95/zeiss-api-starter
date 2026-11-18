# ZEISS store – nearby eye-care hospitals

Staff pick a ZEISS store, see nearby ophthalmology hospitals with their full doctor lists, and submit an appointment request that is sent to a workflow webhook.

## How it works

1. **Store list** – `config/stores.json` (id, name, 6-digit pincode) fills the dropdown.
2. **Hospitals** – for the chosen store pincode the server pages through the hospital list API (100 rows per page, up to 20 pages), keeps active rows within 100 km, groups them by hospital name + city + locality, and orders ZEISS hospitals first, then by distance (max 50).
3. **Full doctor list** – the list API does not return every doctor, so for each hospital the server calls `POST /doctor/getDoctorsOfHospital` with the hospital's name, address, speciality, pincode, state and city. If the list API has several records for one hospital with different addresses, each address is looked up and the doctors are merged (duplicates by name removed). Results are cached for 5 minutes (failures for 1 minute), five lookups run at a time, and if a lookup fails that hospital falls back to the doctors from the list API (a warning is logged).
4. **Request** – the browser posts the selection and patient details to `/api/requests`. The server re-loads the hospital and doctor data, validates everything, and sends one JSON POST to the webhook. A 2xx response means the webhook received it, not that downstream processing finished. Failures are reported as "may have been received" and are not retried automatically.

Credentials and the webhook URL stay on the server; the browser never sees them.

## Run locally

```bash
npm ci
cp .env.example .env     # then fill in the values
npm run dev              # http://127.0.0.1:3000
npm test
```

Requires Node 22.11 or newer.

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `INVENTORY_SOURCE`, `INVENTORY_XPI` | Hospital list API credentials (required) |
| `WEBHOOK_URL` | Destination for appointment requests (required) |
| `WEBHOOK_ALLOW_DIRECT_N8N=true` | Allows an `https://n8n-public.medibuddy.in/webhook/<uuid>` URL |
| `WEBHOOK_GATEWAY_KEY`, `WEBHOOK_AUTH_HEADER`, `WEBHOOK_AUTH_VALUE` | Needed for an `api-external.medibuddy.in/w/...` gateway route; the header pair is optional for direct n8n |
| `HOST`, `PORT` | Defaults `127.0.0.1`, `3000`. Use `HOST=0.0.0.0` when deploying |
| `TRUST_PROXY` | Number of proxy hops, so per-IP rate limiting sees real client addresses |
| `STORES_FILE` | Alternative store list path |

## Webhook payload

JSON with `schema_version`, `request_id`, `submitted_at_utc`, store (`store_id`, `store_name`, `store_pincode`), hospital (`hospital_group_ref`, `hospital_name`, `hospital_city`, `hospital_locality`), doctor (`doctor_source_row_ref`, `doctor_name`), patient (`patient_name`, `phone`, `preferred_date`, `preferred_slot`, `reason`) and `consent`.

## Checking the upstream APIs

```bash
npm run check:doctors -- 560008
```

Prints the field names returned by the hospital list API and the doctor API for the first hospital near that pincode, which is the quickest way to diagnose a missing-doctor problem.

## Notes

- The server is stateless; no patient data is written to disk.
- Hospital grouping by name + city + locality is a best-effort key, not an official hospital ID.
- The ZEISS badge uses the rule `Doctor_Surgeries_Count === 1` on the list API.

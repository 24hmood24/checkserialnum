# CheckSerialNum

Web app to check whether a device (phone, laptop, ...) is reported stolen before buying it,
report a theft, and register a purchase with a certificate.

Frontend: Vite + React. Backend: Express + MongoDB (`server/`). One Node process serves
both the API and the built frontend.

## Run locally

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and the API together (Vite proxies `/api`). Open the URL Vite prints.
Separately: `npm run dev:web` and `npm run dev:api` (http://localhost:3001).

The API needs `MONGODB_URI` (put it in a `.env` file at the root). Without MongoDB you can use
`USE_MEMORY_DB=1 npm run dev:api`; the data is lost when it stops.

## Production

```bash
npm run build
npm start
```

`PORT` defaults to 3001.

## Environment variables

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string (Atlas works fine) |
| `MONGODB_DB_NAME` | database name (default `checkserialnum`) |
| `SESSION_SECRET` | signs login tokens, use a long random value in production |
| `ADMIN_NATIONAL_ID`, `ADMIN_PASSWORD`, `ADMIN_PHONE`, `ADMIN_FULL_NAME` | admin account, see below |
| `WHATSAPP_PROVIDER` | `baileys`, `meta` or `console`, see below |
| `OTP_TTL_SECONDS` | validity of a code (default 300) |
| `OTP_RESEND_COOLDOWN_SECONDS` | delay between resends (default 60) |
| `OTP_MAX_SENDS_PER_PHONE_PER_HOUR` | messages per phone per hour (default 5) |
| `VITE_SUPPORT_CONTACT` | contact shown in the header/footer (build time, hidden if empty) |

## Admin account

Created on first start from `ADMIN_NATIONAL_ID` / `ADMIN_PASSWORD` / `ADMIN_PHONE`.
If `ADMIN_PASSWORD` is not set, development uses the demo password `adminpass`; with
`NODE_ENV=production` a random password is generated and printed once in the log. An admin
that still has the demo password is replaced the same way on the next start. Admin
accounts can't use "forgot password".

## Access rules

- The public tabs use their own endpoints: `POST /api/check` (exact serial match, returns
  only the status), and the `start` / confirm flow below.
- `/api/entities/*` is for admins, and for users reading their own records.
- Everything that lists users, reports or certificates is admin only.

## WhatsApp codes

Registration, theft reports, sales and phone changes need a code sent by WhatsApp before
anything is saved:

| Action | Code goes to |
|---|---|
| Register | the phone typed in the form |
| Theft report | the reporter |
| Sale (purchase tab, or "sell" in the dashboard) | the seller and the buyer, each one gets a different code, both are required |
| Change phone number | the new number |
| Forgot password | the registered phone |

Flow: `POST /api/register/start`, `/api/reports/start`, `/api/certificates/start` or
`/api/profile/phone/start` validates the request and sends the code(s);
`POST /api/actions/confirm` with the code(s) saves it (`/api/actions/resend` sends new
ones). Codes have 6 digits, last 5 minutes, work once, and 5 wrong tries cancel the request.

The phone field is filled from the national ID: `POST /api/lookup/phone-hint` returns a
masked number (`05****1234`) when the account exists. The real number stays on the server
and the code always goes to the phone saved on the account. When there is no account
(for example a shop selling to a customer), the number is typed and saved on the certificate.

A logged-in owner reporting a device from their dashboard doesn't need a code.

A code proves who holds the phone, not who owns the national ID.

### Providers

- `baileys`: WhatsApp Web linked to one number. Log in as admin and open
  `/whatsapp-link.html` to scan the QR (or use a pairing code). It is unofficial and the
  number can get banned, so use a dedicated one. The session is stored in the database
  (`whatsapp_auth`), run a single instance. On Render's free plan the service sleeps and
  disconnects, so the first request after a pause may fail.
- `meta`: official WhatsApp Business Cloud API. Needs `WHATSAPP_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME` (an approved authentication
  template), optional `WHATSAPP_TEMPLATE_LANG` (default `ar`) and
  `WHATSAPP_TEMPLATE_BUTTON=false` if the template has no copy-code button.
- `console`: prints the code in the log, for testing only.

With no provider configured in production, these actions answer 503.

## Tests

```bash
node server/smoke-test.mjs     # API
node server/baileys-test.mjs   # WhatsApp (Baileys) with a fake socket
```

Both run without MongoDB or WhatsApp.

## Deploy on Render

`render.yaml` is included:

1. Connect the repo in Render and create a Blueprint from it.
2. Fill `MONGODB_URI` and the admin / WhatsApp variables when asked.
3. Check the site on the `onrender.com` URL, then add the custom domain in
   Settings → Custom Domains and update the DNS records at your registrar.

Any other Node host works the same way: `npm run build`, then `npm start` with the
variables above.

# WhatsApp Business Cloud API setup

The app works **without** this. Every message can be sent manually with a prefilled WhatsApp link.
Connect the official Cloud API when you want the app to send messages by itself, in bulk, and on schedule.

> Meta’s screens change from time to time. If a button has a slightly different name, look for the
> nearest equivalent. Official docs: <https://developers.facebook.com/docs/whatsapp/cloud-api>

---

## How it works in this app

- Every committee connects **its own** sending number in the app: **Settings → WhatsApp → Connect a WhatsApp number** (owner only). Paste the *Phone number ID* and the *access token*.
- The token is stored in a database table that the browser can never read; only the server uses it (`src/lib/whatsapp.ts`, `POST https://graph.facebook.com/<version>/<PHONE_NUMBER_ID>/messages`).
- A message is marked **Sent** only when Meta returns a message ID. Errors are saved with Meta’s exact error text.
- WhatsApp only lets a business **start** a conversation with a **Meta-approved message template**.
  Each of the 6 app templates is linked to a Meta template name (Notifications → Templates).
  If a template has no Meta name, the app sends plain text. That only works if the member messaged your number in the last 24 hours.

---

## Step 1 — Create the Meta app (15 minutes)

1. Go to <https://developers.facebook.com> and log in with Facebook → **My Apps → Create app**.
2. Choose the use case for **WhatsApp** (“Connect with customers through WhatsApp”), give it a name (e.g. *Family Committee*), and link or create a **Business portfolio**.
3. Open **WhatsApp → API Setup**. You will see:
   - a free **test phone number** (the “From” number),
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`,
   - **WhatsApp Business Account ID** → `WHATSAPP_BUSINESS_ACCOUNT_ID`,
   - a **temporary access token** (valid ~24 hours) → `WHATSAPP_ACCESS_TOKEN` for a first test.
4. Under **To**, add your own WhatsApp number and confirm it with the code. With the test number you can only message numbers you add here (Meta limits this list to a few numbers).

Paste the values into the app: **Settings → WhatsApp → Connect a WhatsApp number**.

**Test it:** Settings → WhatsApp Cloud API → enter your number → **Test**. This sends Meta’s built-in `hello_world` template.

## Step 2 — Get a permanent token

The temporary token expires after about a day. For the real app:

1. Go to **Meta Business Suite → Settings (Business settings) → Users → System users → Add** (role: Admin).
2. **Assign assets**: add your app (full control) and your WhatsApp account (full control).
3. **Generate new token** → choose your app → expiry *Never* → permissions
   `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Paste it into **Settings → WhatsApp** (leave the token field empty later to keep it). Treat it like a password.

## Step 3 — Create and approve the 6 message templates

Open **WhatsApp Manager → Message templates → Create template** for each one:
- **Category:** Utility (these are account/payment updates, not marketing)
- **Name:** exactly as below
- **Language:** English (code `en`; if you pick “English (US)”, set the language code in the app to `en_US`)
- **Body:** copy the text from the app: **Notifications → Templates → open a template → “Text to submit to Meta for approval”**.
  That text already has `{{1}}`, `{{2}}`, … in the right order, plus sample values for Meta’s review.

| App message | Meta template name |
|---|---|
| A. Monthly Committee Reminder | `committee_monthly_reminder` |
| B. Winner Announcement | `committee_winner_announcement` |
| C. Payment Due Reminder | `committee_payment_due` |
| D. Payment Overdue Alert | `committee_payment_overdue` |
| E. Payment Received Confirmation | `committee_payment_received` |
| F. New Month Committee Update | `committee_new_month_update` |
| G. Personal Winner Message | `committee_winner_personal` — add an **Image header** when creating it; the app attaches the winner's banner automatically |

Rules that avoid rejections:
- The message must not start or end with a variable (the defaults start with “Assalam-o-Alaikum” and end with plain text).
- If you change wording in the app later, submit the same change to Meta (edit the template there) and keep the **parameter order** identical.
- Approval is often quick but can take longer. Until a template is approved, sends of that type fail with a clear Meta error in **Notifications → History**. You can retry them later.

## Step 4 — Delivery receipts (recommended)

This lets the app show **Delivered / Read / Failed** instead of only **Sent**.

1. Choose any random string as the verify token, and set it as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
2. Copy **App settings → Basic → App secret** into `WHATSAPP_APP_SECRET`. Redeploy.
3. In the Meta app: **WhatsApp → Configuration → Webhook → Edit**
   - Callback URL: `https://<your-app>.vercel.app/api/whatsapp/webhook`
   - Verify token: the same string as above → **Verify and save**
4. Under **Webhook fields**, subscribe to **messages**.

The endpoint checks Meta’s `X-Hub-Signature-256` signature, so nobody else can fake delivery updates.

## Using a family member's existing WhatsApp number (e.g. an aunt's)

Meta's **Coexistence** feature lets a number that is already used in the **WhatsApp Business app** also send through the Cloud API, so she can keep chatting from her phone. Requirements (Meta's rules):
- The number must be on the **WhatsApp Business app** (not the normal personal WhatsApp app). Switching from WhatsApp to WhatsApp Business on the same phone keeps the chats.
- App version 2.24.17 or newer, and the app should be opened at least every 14 days.
- Onboarding is done through a Meta **Solution Partner / Tech Provider** (QR-code flow). After onboarding you get a phone number ID and token — paste them into Settings → WhatsApp.

Alternative: register a separate, dedicated number for the committee directly in the Meta app (Step 5). That number then cannot be used in the WhatsApp app at the same time.

## Step 5 — Going live with your own number

The test number is for trying things out. For the family to receive messages from a proper number:

1. **WhatsApp → API Setup → Add phone number**. Use a number that is **not** currently registered on the normal WhatsApp or WhatsApp Business app (or delete that account first).
2. Set a display name (Meta reviews it) and verify the number by SMS/call.
3. Add a payment method in WhatsApp Manager. Meta charges per delivered template message, by category and country. Check current Pakistan rates at <https://developers.facebook.com/docs/whatsapp/pricing>.
4. Business verification raises your sending limits. For 17 members you are far below the starting limits.
5. Replace `WHATSAPP_PHONE_NUMBER_ID` with the new number’s ID and redeploy.

## Troubleshooting

| Error in History | Meaning / fix |
|---|---|
| `Meta error 190` | Token expired or wrong → generate a permanent token (Step 2) |
| `Meta error 131030` | Recipient not in the test number’s allowed list → add it in API Setup, or go live |
| `Meta error 132001` | Template name or language doesn’t exist / not approved yet → check name and language code |
| `Meta error 132000` | Number of parameters doesn’t match the approved template → fix “Meta parameter order” |
| `Meta error 131026` | Number can’t receive WhatsApp messages (not on WhatsApp, old app version, etc.) |
| `Meta error 131047` | You sent plain text outside the 24-hour window → set an approved Meta template name |
| “No WhatsApp number saved” | Add the number on the Members page |

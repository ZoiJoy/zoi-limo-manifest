# Black Car Reservations & Invoicing

A stand-alone app for taking black car bookings on the spot and sending the customer an invoice by **text** or **email**.
It works on a phone, tablet or computer, and you can add it to your home screen like a regular app.

## What it does

- **New booking in under a minute:** customer, service type (airport, point to point, hourly, event, corporate), one way or round trip, pickup and drop-off, flight, vehicle and chauffeur, notes.
- **Live pricing:** flat or hourly rate, extra stops, waiting, tolls, parking, meet & greet, child seat, other charges, discount, gratuity % (on the base fare) and tax %. A running total shows at the bottom of the screen.
- **Save & invoice:** after you save a new booking, the app opens a text (or email) that's ready to send, with a link to the customer's invoice.
- **Invoice page:** a clean page for each invoice that the customer can open from their phone and print or save as a PDF. The link is private and hard to guess.
- **Payments:** record a deposit or full payment (cash, card, Zelle, Cash App…). The balance and the Paid / Deposit / Balance due status update on their own.
- **Bookings list:** Upcoming, Today and Balance due tabs, search, and totals for rides today, bookings this month and money outstanding.
- **Book again:** reuse a returning customer's details, or pick them from the "Returning customer?" box.
- **Settings:** business details, default gratuity and tax, vehicles and chauffeurs, payment instructions, terms, and the text and email message templates.

## How messages are sent

| | Without setup | With setup (`.env`) |
|---|---|---|
| Text | Opens the Messages app on your phone with the text filled in. You tap send. | Sent straight from your Twilio business number |
| Email | Opens your mail app with the full invoice filled in | Sent by SMTP (Gmail, Outlook, etc.) as a formatted HTML invoice |

## Run it

Requires [Node.js](https://nodejs.org) 20.12 or newer.

```bash
cd app
npm install          # only needed for automatic email
cp .env.example .env # optional: password, Twilio, SMTP
npm start
```

Open http://localhost:3000. To use it from your phone on the same Wi-Fi, open `http://<your-computer-ip>:3000`.

Bookings are saved in `app/data/db.json`. Back up that file.

## Put it online (recommended)

For customers to open the invoice link, the app has to be reachable on the internet.
Deploy the `app` folder to any Node host (Render, Railway, Fly.io, a small VPS…), then set:

- `APP_PASSWORD`: so only you can open the booking screens. Customers can only see their own invoice link.
- `PUBLIC_URL`: for example `https://book.zoilimo.com`.
- `DATA_DIR`: a persistent disk or volume, so bookings aren't lost when the server redeploys.

### Gmail for automatic email
1. Turn on 2-Step Verification on the Google account.
2. Create an **App password** (Google Account → Security → App passwords).
3. In `.env`, set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=you@gmail.com` and `SMTP_PASS=<app password>`.

### Twilio for automatic texts
1. Create a Twilio account and buy a phone number. For US numbers, complete A2P 10DLC registration.
2. In `.env`, set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM=+1XXXXXXXXXX`.

## Tests

```bash
npm test
```

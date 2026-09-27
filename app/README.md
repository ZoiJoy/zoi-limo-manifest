# Black Car Reservations

A reservation and invoice app that runs **only on your phone**. You enter each booking for the customer, then send them the invoice by **text** or **email** from your own Messages or Mail app.

- There's no server, account or login. Bookings are saved on your phone.
- It doesn't take payments. The invoice tells the customer they can pay by **Venmo, Zelle, Cash App, Apple Pay or Cash**, and you mark what they paid.
- Once it's on your home screen, it works with no signal.

## Using it

1. **+ New booking:** customer name, phone and email, service type, pickup and drop-off, flight, vehicle, chauffeur and price. The total updates as you type.
2. **Save & invoice:** Messages opens with the full invoice already typed in. Tap send. You can also tap **Email invoice** to send it from your Mail app.
3. **Mark paid:** pick Venmo, Zelle, Cash App, Apple Pay or Cash. The invoice then shows **Paid**. Send it again if the customer wants a receipt.
4. **Settings:** your business info, your Venmo username, Zelle phone or email, Cash App $cashtag and Apple Pay number (these show on every invoice), default gratuity and tax, vehicles, chauffeurs and message wording.

## Open it in Claude (easiest)

The app is published as a private page on your Claude account. Open the link on your phone while signed in to Claude.
Bookings are saved privately in your Claude account, and only you can see them.
Inside Claude, tap **Copy invoice** and paste it into Messages or Mail. The **Open Messages** button may not work there.

To update that page after changing the code, run `node build-artifact.mjs`. It creates one self-contained `dist/reservations.html`, and that file gets published.

## Or put it on your phone from GitHub

The app has to be opened from a web address once. After that it lives on your home screen.

1. On GitHub, open the repository's **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Merge this branch into `main`. The "Publish app" action puts the app at
   `https://<your-github-username>.github.io/zoi-limo-manifest/app/`
3. Open that address on your phone:
   - **iPhone (Safari):** Share button → **Add to Home Screen**
   - **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**
4. Always open the app from the home-screen icon.

Your bookings never go to GitHub or anywhere else. The web page only delivers the app itself.

## Back up your bookings

Bookings are saved only on this phone, so they're lost if the phone is lost or you clear Safari/Chrome data.
Go to **Settings → Export backup** now and then, and save the file to Files, iCloud Drive or Google Drive.
**Restore backup** puts everything back on a new phone.

## For developers

Plain HTML/CSS/JavaScript with no build step or dependencies. `npm test` runs the pricing and invoice tests.
`npm start` serves the folder at http://localhost:8080.

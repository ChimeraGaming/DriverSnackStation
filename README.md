# Driver Snack Station

🟢 [Live Site](https://chimeragaming.github.io/DriverSnackStation/)

This is a small mobile-first snack station site I made for the delivery drivers who stop at our home.

The goal was simple:

- give drivers a quick thank you page
- let them grab a snack or drink
- let them tell us what they took
- let them suggest what we should stock next
- keep the public side anonymous and simple

## Why I Made This

We like putting out snacks and drinks for the people delivering to our home. This site gives them an easy way to scan a QR code, see what is available, and leave quick feedback if they want to.

I wanted it to feel personal, clean, and easy to use on a phone without looking like a big app.

## What Drivers Can Do

- see the current station status
- pick snacks and drinks from simple dropdowns
- add a missing snack if it is not listed
- suggest new items
- leave a short message
- submit anonymously
- view public trends once enough real data exists

## Privacy

This page does not ask drivers for an email address, phone number, or home address.

Submissions can be anonymous. The public page only shows grouped totals, approved notes, and general trends.

If someone types personal details into a note, those details are not meant to be shown publicly.

## Admin Side

There is also a simple admin page for me to:

- review submissions
- approve or hide snacks
- merge duplicates
- approve public comments
- update the current station status
- export feedback

Current admin page:

- `admin.html`

This uses a simple passcode setup for now. Before serious long-term use, real auth should be added.

## Main Files

- `index.html`
- `style.css`
- `script.js`
- `admin.html`
- `admin.js`
- `supabase-schema.sql`

## Setup Notes For Me

This site is static, so Supabase handles the saved submissions and public trend data.

### Supabase

1. Create a Supabase project.
2. Open the SQL editor.
3. Run `supabase-schema.sql`.
4. Set the admin passcode:

```sql
select public.set_admin_passcode('replace-this-passcode');
```

5. Copy the project URL.
6. Copy the publishable key or legacy anon key.
7. Paste those values into `index.html` and `admin.html`.

### GitHub Pages

This site is meant to be published from the root of the repo with GitHub Pages.

Expected public URL:

```text
https://chimeragaming.github.io/DriverSnackStation/
```

Expected admin URL:

```text
https://chimeragaming.github.io/DriverSnackStation/admin.html
```

## QR Code

Once the live site is up, the public page URL can be turned into a QR code and placed at the snack station so drivers can open it quickly from their phones.

## Starter Snacks

The starter snacks currently included are:

- Oreo Cookies
- Doritos
- Water
- Gatorade
- Powerade
- Goldfish Crackers

These can be changed later in Supabase or through the admin tools.

## Project Notes

- mobile first layout
- static site for GitHub Pages
- vanilla HTML, CSS, and JavaScript
- Supabase for data storage
- Hatcher Pass image in the header
- simple Alaska-style personal look

# Driver Snack Station

Driver Snack Station is a mobile first static site for a home delivery snack station. Delivery drivers can scan a QR code, say what they grabbed, request new snacks, and see anonymous trends. The site is built for GitHub Pages, so Supabase handles data storage.

## Files

- `index.html` public driver page
- `style.css` shared site styling
- `script.js` public page logic
- `admin.html` simple admin page
- `admin.js` admin page logic
- `supabase-schema.sql` database schema, starter data, RPC functions, and security setup

## Stack

- HTML
- CSS
- Vanilla JavaScript
- Supabase
- Optional EmailJS notifications

## 1. Create a Supabase project

1. Go to [Supabase](https://supabase.com/) and create a new project.
2. Wait for the database to finish provisioning.
3. Open `Project Settings`, then `API`.
4. Copy the `Project URL`.
5. Copy the `anon public` key.

## 2. Run the SQL schema

1. In Supabase, open the SQL Editor.
2. Paste the full contents of [`supabase-schema.sql`](/C:/Users/97Tur/OneDrive/Documents/GitHub/DriverSnackStation/supabase-schema.sql).
3. Run the script.
4. After the script succeeds, set the admin passcode:

```sql
select public.set_admin_passcode('replace-this-passcode');
```

That passcode is what you will type into the admin page.

## 3. Add your Supabase keys

Edit the config block near the top of [`index.html`](/C:/Users/97Tur/OneDrive/Documents/GitHub/DriverSnackStation/index.html):

```html
<script>
  window.DRIVER_SNACK_CONFIG = {
    supabaseUrl: "YOUR_SUPABASE_URL",
    supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
    emailjs: {
      enabled: false,
      publicKey: "",
      serviceId: "",
      templateId: ""
    }
  };
</script>
```

Edit the config block near the top of [`admin.html`](/C:/Users/97Tur/OneDrive/Documents/GitHub/DriverSnackStation/admin.html):

```html
<script>
  window.DRIVER_SNACK_CONFIG = {
    supabaseUrl: "YOUR_SUPABASE_URL",
    supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY"
  };
</script>
```

## 4. Optional EmailJS setup

If you want an email when a driver submits feedback:

1. Create an account at [EmailJS](https://www.emailjs.com/).
2. Create an email service.
3. Create a template.
4. Add the public key, service ID, and template ID inside the `emailjs` block in `index.html`.
5. Change `enabled: false` to `enabled: true`.

The public page will still work if EmailJS is disabled or not configured.

Suggested EmailJS template variables:

- `session_id`
- `selected_snacks`
- `custom_snack`
- `preferred_water_brand`
- `wants_added`
- `dislikes`
- `delivery_frequency`
- `area_delivery`
- `neighborhood_sighting`
- `wasilla_sighting`
- `message`
- `nickname`
- `submission_id`

## 5. Publish on GitHub Pages

1. Push this repo to GitHub.
2. Open the repo settings.
3. Open `Pages`.
4. Under `Build and deployment`, choose `Deploy from a branch`.
5. Pick your main branch and the root folder.
6. Save.
7. Wait for GitHub Pages to publish the site.

Your URL will usually look like:

```text
https://YOUR-USERNAME.github.io/DriverSnackStation/
```

## 6. Make a QR code

Once the GitHub Pages URL is live:

1. Copy the full site URL.
2. Use any QR code generator you trust.
3. Point it at the public page URL.
4. Print the QR code near the snack station.

If you want the admin page bookmarked for yourself, that URL will usually be:

```text
https://YOUR-USERNAME.github.io/DriverSnackStation/admin.html
```

## 7. Starter snacks

The starter snacks are seeded in [`supabase-schema.sql`](/C:/Users/97Tur/OneDrive/Documents/GitHub/DriverSnackStation/supabase-schema.sql):

- Oreo Cookies
- Doritos
- Water
- Gatorade
- Powerade
- Goldfish Crackers

To change the starter list later, you can:

1. Update the `insert into public.snack_items` block in the SQL file before first setup.
2. Use the admin page after setup to rename items, add aliases, change categories, hide items, approve pending items, or merge duplicates.
3. Run SQL updates directly in Supabase if you want bulk changes.

## 8. Admin page

The admin page can:

- view submissions
- view pending snacks
- approve snacks
- hide snacks
- delete inappropriate entries
- merge duplicate snacks
- rename snacks
- add aliases
- review `needs_review` items
- edit snack categories
- approve or hide comments
- change current station status
- export submissions as CSV
- view snack trends

Open [`admin.html`](/C:/Users/97Tur/OneDrive/Documents/GitHub/DriverSnackStation/admin.html), enter the passcode you set with `public.set_admin_passcode(...)`, and the dashboard will load through Supabase RPC functions.

### Important admin warning

This admin page uses a simple passcode gate because the site is static. It is good enough for a small personal setup, but it is not real production grade auth. Before serious use, move admin access to real Supabase Auth or a protected server layer.

## 9. Privacy

This project is built so the public page shows only anonymous summaries and approved content.

Public page output:

- current station status
- approved snack list
- anonymous grab totals
- anonymous request totals
- anonymous dislike totals
- grouped sighting counts
- approved comments
- anonymous vote totals

Not shown publicly:

- email addresses
- phone numbers
- street addresses
- tracking numbers
- exact timestamps
- session IDs
- raw private notes
- internal moderation notes

Automatic redaction is applied to public-safe text using the SQL helper `public.redact_sensitive_text(...)`.

## 10. Security notes

The SQL file:

- enables row level security on all main tables
- keeps direct table access locked down
- exposes public and admin data through RPC functions
- limits votes with a unique snack and session rule
- blocks self votes on user-submitted snacks

Recommended next steps if you keep using the project:

1. Move admin access to real Supabase Auth.
2. Rotate the admin passcode if it is shared.
3. Add rate limiting if traffic grows.
4. Keep the anon key in the site, but never put the Supabase service role key in these static files.

## 11. Design notes

- The site is mobile first and centers around a phone-width layout.
- The header uses `Images/HatcherPass.jpg`.
- The top image has a torn paper edge to separate the hero from the rest of the page.
- The design uses a dark background, cyan accents, and a red title accent.

## 12. Local preview

Because this is a static site, you can preview it with any simple local server. One example:

```powershell
python -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/
```

## 13. Public flow summary

1. Driver scans the QR code.
2. Driver sees the current station status and approved snack list.
3. Driver taps what they grabbed.
4. Driver can type a custom snack if it is missing.
5. The site checks for alias matches and close spellings.
6. The submission is saved to Supabase.
7. Public trends update through aggregated anonymous summaries.

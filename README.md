# GlowLink

GlowLink is a mobile audience LED control system for events. Participants open the public participant URL on their phones, and an operator controls colors, countdowns, and light modes from the admin page.

## Local Run

```powershell
npm start
```

- Participant: http://localhost:3000/
- Admin: http://localhost:3000/admin.html

## Render Deployment

Deploy as a Render Web Service.

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/healthz`
- Environment Variable: `ADMIN_PIN`

After deployment:

- Participant URL: `https://YOUR-SERVICE.onrender.com/`
- Admin tablet URL: `https://YOUR-SERVICE.onrender.com/admin.html`

Set `ADMIN_PIN` in Render so public users can join as participants while only the operator can send admin commands.

# GlowLink

GlowLink는 이벤트를 위한 모바일 오디언스 LED 제어 시스템입니다. 참가자는 휴대폰에서 공개 참가자 URL을 열고 운영자가 관리자 페이지에서 색상, 카운트다운 및 조명 모드를 제어할 수 있는 시스템입니다.

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

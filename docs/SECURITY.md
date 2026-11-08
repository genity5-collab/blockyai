# Security headers and DNS

## Headers (done, live)
Defined once in `scripts/security-headers.json` and applied to the Render static site as header rules on `/*`
(Render API: `POST /v1/services/{id}/headers`, one rule per header). Verify any time with `bash scripts/verify-security.sh`.

| Header | Value | Why |
|---|---|---|
| Content-Security-Policy | `default-src 'none'`, scripts/fonts/connect `'self'`, images from self, `data:`, `blob:`, Supabase Storage, Discord CDN, `frame-ancestors 'none'` | blocks injected scripts and framing |
| X-Frame-Options | `DENY` | clickjacking (older browsers) |
| Cross-Origin-Opener-Policy | `same-origin` | isolates the page from cross-origin popups |
| Cross-Origin-Resource-Policy | `same-origin` | other sites cannot embed our files |
| Referrer-Policy | `strict-origin-when-cross-origin` | limits referrer leakage |
| Permissions-Policy | camera, microphone, geolocation, payment, usb... all off | no unused browser powers |

`style-src` keeps `'unsafe-inline'` because React writes inline `style=` attributes; this does not allow script execution.
If you add a new image/API host, add it to `img-src` / `connect-src` in the JSON and re-apply the rule.

## Subresource Integrity
Fonts are self-hosted (`web-src/public/fonts`, `web-src/src/fonts.css`), so the site loads no external script or stylesheet and no SRI hash is needed.
(Pinning a hash on the Google Fonts CSS would break it: Google serves different CSS per browser.)

## Supabase
Email and anonymous signups are disabled (the app never used Supabase Auth; identity is the browser key or Discord login).

## DNS / email findings: not applicable to `blockyai.onrender.com`
The site is a CNAME inside Render's `onrender.com` zone (Route 53). Only Render can change those records.
* CAA: already set on `onrender.com` (DigiCert, Let's Encrypt).
* DMARC: already set on `onrender.com` by Render.
* SPF/DKIM/DMARC: BlockyAI sends no email (no MX record, no mail code).
* DNSSEC: not enabled on `onrender.com`; Render's decision.
* Server header `cloudflare`: Render's CDN; it cannot be removed from a static site and discloses no version.

### If you later add your own domain (e.g. blockyai.com)
Add it in Render > Custom Domains, then at your DNS provider:
```
CAA    0 issue "letsencrypt.org"            ; and: 0 issue "pki.goog" if Render uses Google
TXT    "v=spf1 -all"                        ; this domain sends no mail
TXT    _dmarc  "v=DMARC1; p=reject; adkim=s; aspf=s"
TXT    *._domainkey  "v=DKIM1; p="          ; empty key = no mail is signed
```
Turn on DNSSEC at the registrar (DS record at the parent). Verify with `dig TXT yourdomain`, `dig CAA yourdomain`, `dig DS yourdomain`.

/**
 * Goff Heating Form Handler — Cloudflare Worker
 * Sends branded HTML email via Gmail API using Google Service Account (JWT auth).
 *
 * Environment variables (set in Cloudflare dashboard as Secrets):
 *   GOOGLE_CLIENT_EMAIL   — openclaw-agent@killergrowth.iam.gserviceaccount.com
 *   GOOGLE_PRIVATE_KEY    — the PEM private key (-----BEGIN PRIVATE KEY-----\n...)
 *   FROM_EMAIL            — notifications@killergrowth.com
 *   TO_EMAIL              — brickley@killergrowth.com
 */

const GOFF_RED = '#C0504D';
const GOFF_DARK = '#2a1a1a';
const GHL_WEBHOOK = 'https://services.leadconnectorhq.com/hooks/9LCB8nE71m5ALhxql8kO/webhook-trigger/051258e4-a77b-4d21-823a-a6b8a699932c';

// ── Gmail JWT Auth ──────────────────────────────────────────────────────────

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getGmailAccessToken(clientEmail, privateKeyPem, subject) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    sub: subject,
    scope: 'https://www.googleapis.com/auth/gmail.send',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import private key
  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const keyBuffer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    enc.encode(signingInput)
  );

  const jwt = `${signingInput}.${base64url(signature)}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error(`Token error: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

async function sendGmail(accessToken, from, to, subject, htmlBody, replyTo) {
  const boundary = 'boundary_goff_' + Math.random().toString(36).slice(2);
  const rawEmail = [
    `From: ${from}`,
    `To: ${to}`,
    `Reply-To: ${replyTo || to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    htmlBody,
  ].join('\r\n');

  const encoded = btoa(unescape(encodeURIComponent(rawEmail)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail send error: ${JSON.stringify(data)}`);
  return data;
}

// ── Email Template ──────────────────────────────────────────────────────────

function buildEmailHtml(data) {
  const { firstName, lastName, email, phone, zip, message } = data;
  const fullName = `${firstName || ''} ${lastName || ''}`.trim() || 'Unknown';
  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/Indiana/Indianapolis',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>New Plumbing Lead - ${fullName}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background:${GOFF_RED};padding:28px 32px;text-align:center;">
              <img src="https://goff-heating-plumbing.pages.dev/images/goff-logo-white.png" alt="Goff Heating &amp; Air Conditioning" style="height:70px;width:auto;display:block;margin:0 auto;">
            </td>
          </tr>

          <!-- Alert banner -->
          <tr>
            <td style="background:#fff8f8;border-left:4px solid ${GOFF_RED};padding:16px 32px;">
              <p style="margin:0;font-size:18px;font-weight:700;color:${GOFF_DARK};">New Plumbing Lead Received</p>
              <p style="margin:4px 0 0;font-size:13px;color:#888;">${timestamp} (Indiana time)</p>
            </td>
          </tr>

          <!-- Contact info -->
          <tr>
            <td style="padding:28px 32px 16px;">
              <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#aaa;">Contact Information</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="padding-bottom:14px;vertical-align:top;">
                    <p style="margin:0;font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:1px;">Name</p>
                    <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:${GOFF_DARK};">${fullName}</p>
                  </td>
                  <td width="50%" style="padding-bottom:14px;vertical-align:top;">
                    <p style="margin:0;font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:1px;">Phone</p>
                    <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:${GOFF_RED};">
                      <a href="tel:${phone || ''}" style="color:${GOFF_RED};text-decoration:none;">${phone || '&mdash;'}</a>
                    </p>
                  </td>
                </tr>
                <tr>
                  <td width="50%" style="padding-bottom:14px;vertical-align:top;">
                    <p style="margin:0;font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:1px;">Email</p>
                    <p style="margin:4px 0 0;font-size:15px;color:${GOFF_DARK};">
                      ${email ? `<a href="mailto:${email}" style="color:#204ce5;text-decoration:none;">${email}</a>` : '&mdash;'}
                    </p>
                  </td>
                  <td width="50%" style="padding-bottom:14px;vertical-align:top;">
                    <p style="margin:0;font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:1px;">Zip Code</p>
                    <p style="margin:4px 0 0;font-size:16px;font-weight:600;color:${GOFF_DARK};">${zip || '&mdash;'}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #eee;margin:0;"></td></tr>

          <!-- Message -->
          <tr>
            <td style="padding:20px 32px 28px;">
              <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#aaa;">Their Message</p>
              <div style="background:#f9f9f9;border-radius:6px;padding:16px 20px;border-left:3px solid ${GOFF_RED};">
                <p style="margin:0;font-size:15px;color:${GOFF_DARK};line-height:1.6;">${message || '(no message provided)'}</p>
              </div>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 32px 32px;text-align:center;">
              ${phone ? `<a href="tel:${phone}" style="display:inline-block;background:${GOFF_RED};color:#fff;font-size:15px;font-weight:700;padding:14px 32px;border-radius:4px;text-decoration:none;letter-spacing:0.5px;">Call ${firstName || 'Them'} Now</a>` : ''}
              ${email ? `<p style="margin:12px 0 0;font-size:13px;color:#aaa;">or <a href="mailto:${email}" style="color:#204ce5;">${email}</a></p>` : ''}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f0f0f0;padding:16px 32px;text-align:center;border-top:1px solid #e0e0e0;">
              <p style="margin:0;font-size:12px;color:#aaa;">This lead came from the <strong>Goff Heating Plumbing Landing Page</strong> &mdash; managed by KillerGrowth.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Main Handler ────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let data;
    try {
      const ct = request.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        data = await request.json();
      } else {
        const fd = await request.formData();
        data = Object.fromEntries(fd.entries());
      }
    } catch (e) {
      return json({ error: 'Failed to parse request' }, 400);
    }

    const from = `Goff Plumbing Leads <${env.FROM_EMAIL}>`;
    const to = env.TO_EMAIL || 'brickley@killergrowth.com';
    const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unknown';
    const subject = `New Plumbing Lead: ${fullName}${data.phone ? ' - ' + data.phone : ''}`;

    try {
      // Email notification disabled — GHL webhook only
      // To re-enable: uncomment the Gmail send block below
      /*
      const accessToken = await getGmailAccessToken(
        env.GOOGLE_CLIENT_EMAIL,
        env.GOOGLE_PRIVATE_KEY,
        env.FROM_EMAIL
      );
      await sendGmail(accessToken, from, to, subject, buildEmailHtml(data), data.email);
      */

      // POST to GHL webhook
      try {
        await fetch(GHL_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: data.firstName || '',
            last_name: data.lastName || '',
            email: data.email || '',
            phone: data.phone || '',
            zip: data.zip || '',
            message: data.message || '',
            source: 'Goff Plumbing Landing Page',
          }),
        });
      } catch (webhookErr) {
        console.error('GHL webhook error (non-fatal):', webhookErr.message);
      }

      return json({ success: true });
    } catch (e) {
      console.error('Error:', e.message);
      return json({ error: e.message }, 500);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

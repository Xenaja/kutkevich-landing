// Cloudflare Worker — приём заявок с kutkevich.ru и отправка через Resend
// Переменная среды: RESEND_API_KEY (добавить как Secret в настройках Worker)

const ALLOWED_ORIGINS = ['https://kutkevich.ru', 'https://www.kutkevich.ru'];
const TO_EMAILS = ['lera@kutkevich.ru', 'sales@kutkevich.ru'];
const FROM_EMAIL = 'Сайт KUTKEVICH <noreply@kutkevich.ru>';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return corsHeaders(origin, null, 204);
    }

    if (request.method !== 'POST') {
      return corsHeaders(origin, JSON.stringify({ error: 'Method not allowed' }), 405);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return corsHeaders(origin, JSON.stringify({ error: 'Invalid JSON' }), 400);
    }

    const { name, phone, email, format, message, action } = data;

    if (!name || !phone) {
      return corsHeaders(origin, JSON.stringify({ error: 'Имя и телефон обязательны' }), 400);
    }

    const actionLabel = action === 'sample' ? 'Пробный набор' : 'Запрос КП';
    const subject = `${actionLabel} — ${name}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; color: #2d1f0e;">
        <h2 style="color: #c4a060;">Новая заявка с сайта kutkevich.ru</h2>
        <table style="width:100%; border-collapse:collapse;">
          <tr><td style="padding:8px 0; font-weight:bold; width:180px;">Тип заявки</td><td>${actionLabel}</td></tr>
          <tr><td style="padding:8px 0; font-weight:bold;">Имя</td><td>${escapeHtml(name)}</td></tr>
          <tr><td style="padding:8px 0; font-weight:bold;">Телефон</td><td>${escapeHtml(phone)}</td></tr>
          ${email ? `<tr><td style="padding:8px 0; font-weight:bold;">Email</td><td>${escapeHtml(email)}</td></tr>` : ''}
          ${format ? `<tr><td style="padding:8px 0; font-weight:bold;">Формат</td><td>${escapeHtml(format)}</td></tr>` : ''}
          ${message ? `<tr><td style="padding:8px 0; font-weight:bold; vertical-align:top;">Пожелания</td><td>${escapeHtml(message).replace(/\n/g, '<br>')}</td></tr>` : ''}
        </table>
      </div>
    `;

    const payload = {
      from: FROM_EMAIL,
      to: TO_EMAILS,
      subject,
      html,
    };
    if (email) payload.reply_to = email;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend error:', err);
      return corsHeaders(origin, JSON.stringify({ error: 'Ошибка отправки' }), 500);
    }

    return corsHeaders(origin, JSON.stringify({ ok: true }), 200);
  },
};

function corsHeaders(origin, body, status) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

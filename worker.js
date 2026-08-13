// Cloudflare Worker — приём заявок с kutkevich.ru
// Отправляет: 1) email через Resend  2) уведомление в Telegram-бот Валерии
// А также подписывает на email-цепочки Unisender (кнопки «Получить презентацию»).
//
// Переменные среды (Worker Secrets):
//   RESEND_API_KEY            — re_... из resend.com
//   TG_BOT_TOKEN              — токен бота из @BotFather
//   TG_CHAT_ID                — chat_id Валерии (узнать через https://api.telegram.org/bot<TOKEN>/getUpdates после первого /start)
//   UNISENDER_API_KEY         — API-ключ из Unisender (Личный кабинет → Интеграция и API → API-ключ)
//   UNISENDER_LIST_CHOCOLATE  — ID списка «Шоколадные конфеты» (триггер цепочки в Unisender)
//   UNISENDER_LIST_MARMELAD   — ID списка «Цукаты и мармелад»
//   UNISENDER_DOUBLE_OPTIN    — (необязательно) '3' = подписать сразу, без письма-подтверждения (по умолчанию),
//                               '0'/'4' = Unisender сам шлёт письмо-приглашение подтвердить подписку

const ALLOWED_ORIGINS = ['https://kutkevich.ru', 'https://www.kutkevich.ru'];
const TO_EMAILS = ['sales@kutkevich.ru'];
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

    // ── Подписка на email-цепочку Unisender (кнопки «Получить презентацию») ──
    if (action === 'presentation') {
      return await handlePresentation(env, origin, data);
    }

    if (!name || !phone) {
      return corsHeaders(origin, JSON.stringify({ error: 'Имя и телефон обязательны' }), 400);
    }

    const actionLabel = action === 'sample' ? 'Пробный набор' : 'Новая заявка';
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

    // Запускаем email и TG параллельно — медленный канал не блокирует второй
    const [emailRes, tgRes] = await Promise.allSettled([
      sendEmail(env, payload),
      sendTelegram(env, { actionLabel, name, phone, email, format, message }),
    ]);

    const emailOk = emailRes.status === 'fulfilled' && emailRes.value.ok;
    const tgOk = tgRes.status === 'fulfilled' && tgRes.value.ok;

    if (emailRes.status === 'rejected') console.error('Email exception:', emailRes.reason);
    if (tgRes.status === 'rejected') console.error('Telegram exception:', tgRes.reason);

    // Считаем заявку доставленной если прошёл хотя бы один канал
    if (!emailOk && !tgOk) {
      return corsHeaders(origin, JSON.stringify({ error: 'Не удалось доставить заявку' }), 500);
    }

    return corsHeaders(origin, JSON.stringify({ ok: true, email: emailOk, tg: tgOk }), 200);
  },
};

// ── Презентация: подписать email в нужный список Unisender + уведомить Валерию в TG ──
async function handlePresentation(env, origin, data) {
  const { email, name, segment } = data;

  const emailOk = typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  if (!emailOk) {
    return corsHeaders(origin, JSON.stringify({ error: 'Укажите корректный email' }), 400);
  }

  const seg = segment === 'marmelad' ? 'marmelad' : 'chocolate';
  const listId = seg === 'marmelad' ? env.UNISENDER_LIST_MARMELAD : env.UNISENDER_LIST_CHOCOLATE;
  const segLabel = seg === 'marmelad' ? 'Цукаты и мармелад' : 'Шоколадные конфеты';

  // Подписка в Unisender и уведомление в Telegram — параллельно
  const [uniRes, tgRes] = await Promise.allSettled([
    subscribeUnisender(env, { email: email.trim(), name, listId }),
    sendTelegram(env, {
      actionLabel: `Презентация: ${segLabel}`,
      name: name || '—',
      phone: '—',
      email: email.trim(),
    }),
  ]);

  const uniOk = uniRes.status === 'fulfilled' && uniRes.value.ok;
  if (uniRes.status === 'rejected') console.error('Unisender exception:', uniRes.reason);
  if (tgRes.status === 'rejected') console.error('Telegram exception:', tgRes.reason);

  // Подписка в цепочку — обязательный канал: без неё письма не уйдут
  if (!uniOk) {
    const reason = uniRes.status === 'fulfilled' ? uniRes.value.reason : String(uniRes.reason);
    console.error('Unisender subscribe failed:', reason);
    return corsHeaders(origin, JSON.stringify({ error: 'Не удалось оформить подписку' }), 500);
  }

  return corsHeaders(origin, JSON.stringify({ ok: true, segment: seg }), 200);
}

async function subscribeUnisender(env, { email, name, listId }) {
  if (!env.UNISENDER_API_KEY) return { ok: false, reason: 'no UNISENDER_API_KEY' };
  if (!listId) return { ok: false, reason: 'no list_id для сегмента' };

  const params = new URLSearchParams();
  params.set('format', 'json');
  params.set('api_key', env.UNISENDER_API_KEY);
  params.set('list_ids', String(listId));
  params.set('fields[email]', email);
  if (name) params.set('fields[Name]', name);
  // 3 = согласие уже получено на сайте (чекбоксы), контакт добавляется без письма-подтверждения.
  // 0/4 — Unisender сам вышлет письмо-приглашение подтвердить подписку (нам не нужно).
  params.set('double_optin', env.UNISENDER_DOUBLE_OPTIN || '3');
  // 2 = не перезатирать поля у уже существующего контакта
  params.set('overwrite', '2');

  const res = await fetch('https://api.unisender.com/ru/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  let body;
  try { body = await res.json(); } catch { body = null; }
  // Unisender отвечает 200 даже на ошибки — реальный статус в теле (result | error)
  if (!res.ok || !body || body.error) {
    return { ok: false, reason: (body && body.error) || `HTTP ${res.status}` };
  }
  return { ok: true, personId: body.result && body.result.person_id };
}

async function sendEmail(env, payload) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: 'no RESEND_API_KEY' };
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
    return { ok: false, reason: err };
  }
  return { ok: true };
}

async function sendTelegram(env, { actionLabel, name, phone, email, format, message }) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return { ok: false, reason: 'no TG env' };
  const lines = [
    `🎁 <b>Новая заявка — ${escapeHtml(actionLabel)}</b>`,
    '',
    `👤 <b>Имя:</b> ${escapeHtml(name)}`,
    `📞 <b>Телефон:</b> ${escapeHtml(phone)}`,
  ];
  if (email) lines.push(`📧 <b>Email:</b> ${escapeHtml(email)}`);
  if (format) lines.push(`🎯 <b>Формат:</b> ${escapeHtml(format)}`);
  if (message) lines.push('', `💬 <b>Пожелания:</b>`, escapeHtml(message));
  const text = lines.join('\n');

  const res = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TG_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('Telegram error:', err);
    return { ok: false, reason: err };
  }
  return { ok: true };
}

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

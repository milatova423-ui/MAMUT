/**
 * Función de servidor (Vercel) — /api/sunat-token
 *
 * Valida contra SUNAT el acceso completo: Id + Clave de la aplicación
 * (client_id / client_secret) y RUC + usuario SOL + Clave SOL.
 *
 * ¿Por qué existe? El navegador no puede llamar a SUNAT directamente (CORS).
 * Esta función hace la llamada desde el servidor y devuelve solo
 * { ok, error }. NUNCA devuelve ni guarda el token ni la Clave SOL.
 *
 * Solo habla con el servidor de seguridad de SUNAT (host fijo): no acepta
 * direcciones enviadas por el cliente, para que no sirva de proxy abierto.
 *
 * Alcance (scope) del token: por defecto el de la API de comprobantes/guías
 * (https://api-cpe.sunat.gob.pe). Para otra API de SUNAT (por ejemplo SIRE:
 * https://api-sire.sunat.gob.pe) define la variable de entorno SUNAT_SCOPE
 * en Vercel.
 */
const HOST = 'https://api-seguridad.sunat.gob.pe';
const SCOPE_POR_DEFECTO = 'https://api-cpe.sunat.gob.pe';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  }

  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b || '{}'); } catch (e) { b = {}; }
  }
  b = b || {};

  const clientId = String(b.client_id || '').trim();
  const clientSecret = String(b.client_secret || '').trim();
  const ruc = String(b.ruc || '').trim();
  const usuario = String(b.usuario || '').trim();
  const clave = String(b.clave || '');

  if (!clientId || !clientSecret) {
    return res.status(400).json({ ok: false, error: 'Falta el Id o la Clave de la aplicación.' });
  }
  if (!/^\d{11}$/.test(ruc)) {
    return res.status(400).json({ ok: false, error: 'El RUC debe tener 11 dígitos.' });
  }
  if (!usuario || !clave) {
    return res.status(400).json({ ok: false, error: 'Falta el usuario SOL o la Clave SOL.' });
  }

  const url = HOST + '/v1/clientessol/' + encodeURIComponent(clientId) + '/oauth2/token/';
  const form = new URLSearchParams({
    grant_type: 'password',
    scope: process.env.SUNAT_SCOPE || SCOPE_POR_DEFECTO,
    client_id: clientId,
    client_secret: clientSecret,
    username: ruc + usuario,
    password: clave,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: ctrl.signal,
    });

    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }

    if (r.ok && data && data.access_token) {
      return res.status(200).json({ ok: true, expires_in: data.expires_in || null });
    }

    const motivo = (data && (data.error_description || data.message || data.error)) || '';
    return res.status(200).json({
      ok: false,
      status: r.status,
      error: 'SUNAT rechazó el acceso' + (motivo ? ': ' + motivo : ' (código ' + r.status + ').'),
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      error: e && e.name === 'AbortError'
        ? 'SUNAT tardó demasiado en responder.'
        : 'No se pudo contactar a SUNAT desde el servidor.',
    });
  } finally {
    clearTimeout(timer);
  }
};

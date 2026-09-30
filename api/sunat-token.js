// api/sunat-token.js  (Vercel Serverless Function, va en la RAÍZ del repo: /api/sunat-token.js)
//
// Pide el token OAuth a SUNAT. Las credenciales se toman así:
//   1) Las que llegan en el POST (si las escribes en Configuración → opción avanzada), o
//   2) Las variables de entorno de Vercel (recomendado):
//      SUNAT_RUC, SUNAT_USER_SOL, SUNAT_PASS_SOL, SUNAT_CLIENT_ID, SUNAT_CLIENT_SECRET
//      (opcional: SUNAT_SCOPE)
//
// GET  -> comprueba que la función existe e indica qué credenciales hay en el servidor (sin valores)
// POST -> body JSON opcional: { ruc, usuario_sol, clave_sol, client_id, client_secret, scope? }

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // GET: comprueba que la función existe e indica qué credenciales hay en el servidor (sin mostrar valores)
  if (req.method === 'GET') {
    const hay = (k) => !!process.env[k];
    return res.status(200).json({
      ok: true,
      mensaje: 'Función sunat-token activa. Usa POST para pedir el token.',
      configuradas: {
        SUNAT_RUC: hay('SUNAT_RUC'),
        SUNAT_USER_SOL: hay('SUNAT_USER_SOL'),
        SUNAT_PASS_SOL: hay('SUNAT_PASS_SOL'),
        SUNAT_CLIENT_ID: hay('SUNAT_CLIENT_ID'),
        SUNAT_CLIENT_SECRET: hay('SUNAT_CLIENT_SECRET'),
      },
    });
  }

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const env = process.env;

  const ruc = String(b.ruc || env.SUNAT_RUC || '').trim();
  const usuarioSol = String(b.usuario_sol || env.SUNAT_USER_SOL || '').trim();
  const claveSol = String(b.clave_sol || env.SUNAT_PASS_SOL || '');
  const clientId = String(b.client_id || env.SUNAT_CLIENT_ID || '').trim();
  const clientSecret = String(b.client_secret || env.SUNAT_CLIENT_SECRET || '').trim();
  const scope = String(b.scope || env.SUNAT_SCOPE || 'https://api-cpe.sunat.gob.pe').trim();

  const faltan = [];
  if (!/^\d{11}$/.test(ruc)) faltan.push('RUC (11 dígitos)');
  if (!usuarioSol) faltan.push('Usuario SOL');
  if (!claveSol) faltan.push('Clave SOL');
  if (!clientId) faltan.push('Id de la API');
  if (!clientSecret) faltan.push('Clave de la API');
  if (faltan.length) {
    return res.status(400).json({
      ok: false,
      error: 'Falta: ' + faltan.join(', ') + '. Configúralo en Vercel → Settings → Environment Variables y haz Redeploy.',
    });
  }

  const body = new URLSearchParams({
    grant_type: 'password',
    scope,
    client_id: clientId,
    client_secret: clientSecret,
    username: ruc + usuarioSol, // RUC + usuario SOL, todo junto
    password: claveSol,
  });

  try {
    const r = await fetch(
      'https://api-seguridad.sunat.gob.pe/v1/clientessol/' + encodeURIComponent(clientId) + '/oauth2/token/',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
    );
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: data.error_description || data.error || 'SUNAT rechazó las credenciales (revisa RUC, usuario SOL, clave SOL, Id y Clave)',
      });
    }
    return res.status(200).json({
      ok: true,
      access_token: data.access_token,
      token_type: data.token_type,
      expires_in: data.expires_in,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'No se pudo contactar a SUNAT: ' + e.message });
  }
};

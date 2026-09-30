// api/sunat-token.js  (Vercel Serverless Function, va en la RAÍZ del repo: /api/sunat-token.js)
//
// Recibe por POST las credenciales que escribes en Configuración y le pide el
// token OAuth a SUNAT. También acepta variables de entorno como respaldo.
//
// Aplicación registrada en SUNAT (menú SOL > API SUNAT):
//   Nombre: SFE_SYSTEM
//   URL:    https://sfesystem.vercel.app/
//   Id:     cbdd60a1-de9a-4dac-bf8f-021bd46249d8
//   Clave:  E5AWuY4x+KML1WWMM0rd/w==
//   Fecha de registro: 29/09/2026
//
// Prioridad de cada dato: 1) Body JSON  2) Variable de entorno  3) Valor registrado en SUNAT (abajo)
//
// Body JSON (todos opcionales si ya están las variables de entorno / valores por defecto):
//   { ruc, usuario_sol, clave_sol, client_id, client_secret, scope? }

const SUNAT_APP = {
  nombre: 'SFE_SYSTEM',
  url: 'https://sfesystem.vercel.app/',
  client_id: 'cbdd60a1-de9a-4dac-bf8f-021bd46249d8',
  client_secret: 'E5AWuY4x+KML1WWMM0rd/w==',
  fecha_registro: '29/09/2026',
};

const SUNAT_SCOPE_DEFAULT = 'https://api-cpe.sunat.gob.pe';
const SUNAT_TOKEN_URL = (id) =>
  'https://api-seguridad.sunat.gob.pe/v1/clientessol/' + encodeURIComponent(id) + '/oauth2/token/';

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Abrir la URL en el navegador: sirve para comprobar que la función SÍ está desplegada
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      mensaje: 'Función sunat-token activa. Usa POST con tus credenciales.',
      aplicacion: {
        nombre: SUNAT_APP.nombre,
        url: SUNAT_APP.url,
        client_id: SUNAT_APP.client_id,
        fecha_registro: SUNAT_APP.fecha_registro,
      },
      requiere_en_post: ['ruc', 'usuario_sol', 'clave_sol'],
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido. Usa POST.' });
  }

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const env = process.env;

  const ruc = String(b.ruc || env.SUNAT_RUC || '').trim();
  const usuarioSol = String(b.usuario_sol || env.SUNAT_USER_SOL || '').trim();
  const claveSol = String(b.clave_sol || env.SUNAT_PASS_SOL || '');
  const clientId = String(b.client_id || env.SUNAT_CLIENT_ID || SUNAT_APP.client_id).trim();
  const clientSecret = String(b.client_secret || env.SUNAT_CLIENT_SECRET || SUNAT_APP.client_secret).trim();
  const scope = String(b.scope || env.SUNAT_SCOPE || SUNAT_SCOPE_DEFAULT).trim();

  const faltan = [];
  if (!/^\d{11}$/.test(ruc)) faltan.push('RUC (11 dígitos)');
  if (!usuarioSol) faltan.push('Usuario SOL');
  if (!claveSol) faltan.push('Clave SOL');
  if (!clientId) faltan.push('Id de la API');
  if (!clientSecret) faltan.push('Clave de la API');
  if (faltan.length) {
    return res.status(400).json({ ok: false, error: 'Falta: ' + faltan.join(', ') });
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
    // Conexión directa a SUNAT para obtener el token
    const r = await fetch(SUNAT_TOKEN_URL(clientId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
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
      aplicacion: SUNAT_APP.nombre,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'No se pudo contactar a SUNAT: ' + e.message });
  }
};

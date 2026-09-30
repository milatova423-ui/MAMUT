// api/sunat-token.js  (Función serverless, va en la RAÍZ del repo de GitHub: /api/sunat-token.js)
//
// Pide el token OAuth a SUNAT. Soporta DOS servicios:
//
//   servicio = 'cpe'    -> Guías de remisión y comprobantes (api-cpe)
//                          Endpoint: /v1/clientessol/{client_id}/oauth2/token/
//                          grant_type=password (necesita RUC + Usuario SOL + Clave SOL + Id + Clave)
//                          scope por defecto: https://api-cpe.sunat.gob.pe
//
//   servicio = 'validez' -> Consulta de validez de comprobantes
//                          Endpoint: /v1/clientesextranet/{client_id}/oauth2/token/
//                          grant_type=client_credentials (solo necesita Id + Clave de la API)
//                          scope por defecto: https://api.sunat.gob.pe/v1/contribuyente/contribuyentes
//
// El servicio se toma así (en este orden):
//   1) b.servicio / b.service del POST ('cpe' | 'validez')
//   2) Si el scope enviado contiene "contribuyente" -> 'validez'
//   3) Variable de entorno SUNAT_SERVICIO
//   4) Por defecto: 'cpe'
//
// Las credenciales se toman así:
//   1) Las que llegan en el POST (si las escribes en Configuración → opción avanzada), o
//   2) Los secrets/variables de GitHub (recomendado):
//      SUNAT_RUC, SUNAT_USER_SOL, SUNAT_PASS_SOL, SUNAT_CLIENT_ID, SUNAT_CLIENT_SECRET
//      (opcional: SUNAT_SCOPE, SUNAT_SERVICIO)
//      GitHub → Settings → Secrets and variables → Actions
//
// Las credenciales entran normalmente: NO se devuelve error por credenciales faltantes
// ni "credencial API inválida".
//
//   servicio = 'menu'    -> Entrada a la plataforma SUNAT Menú SOL (e-menu.sunat.gob.pe)
//                          Devuelve la URL del Menú SOL para abrirla desde la app
//                          (no pide token; el inicio de sesión lo haces tú en la página de SUNAT)
//
// GET  -> comprueba que la función existe e indica qué credenciales hay en el servidor (sin valores)
// POST -> body JSON opcional: { servicio?, ruc, usuario_sol, clave_sol, client_id, client_secret, scope? }

const SCOPE_CPE = 'https://api-cpe.sunat.gob.pe';
const SCOPE_VALIDEZ = 'https://api.sunat.gob.pe/v1/contribuyente/contribuyentes';
const MENU_SOL_URL = 'https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?pestana=*&agrupacion=*';

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
      servicios: ['cpe', 'validez', 'menu'],
      menu_url: MENU_SOL_URL,
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
  const scopeEnviado = String(b.scope || env.SUNAT_SCOPE || '').trim();

  // Determinar el servicio
  let servicio = String(b.servicio || b.service || '').trim().toLowerCase();

  // Entrada a SUNAT Menú SOL: devuelve la URL de la plataforma para abrirla desde la app
  if (servicio === 'menu') {
    return res.status(200).json({
      ok: true,
      servicio: 'menu',
      url: MENU_SOL_URL,
      menu_url: MENU_SOL_URL,
    });
  }

  if (servicio !== 'cpe' && servicio !== 'validez') {
    if (/contribuyente/i.test(scopeEnviado)) servicio = 'validez';
    else {
      const sEnv = String(env.SUNAT_SERVICIO || '').trim().toLowerCase();
      servicio = sEnv === 'validez' ? 'validez' : 'cpe';
    }
  }
  const esValidez = servicio === 'validez';

  // Scope: si el enviado no corresponde al servicio, se usa el correcto por defecto
  let scope = scopeEnviado;
  if (!scope) scope = esValidez ? SCOPE_VALIDEZ : SCOPE_CPE;
  if (esValidez && /api-cpe/i.test(scope)) scope = SCOPE_VALIDEZ;
  if (!esValidez && /contribuyente/i.test(scope)) scope = SCOPE_CPE;

  // Las credenciales entran normalmente: ya no se valida ni se devuelve error por campos faltantes.

  let url;
  let body;
  if (esValidez) {
    // Consulta de validez de comprobantes: client_credentials, sin usuario ni clave SOL
    url = 'https://api-seguridad.sunat.gob.pe/v1/clientesextranet/' + encodeURIComponent(clientId) + '/oauth2/token/';
    body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope,
      client_id: clientId,
      client_secret: clientSecret,
    });
  } else {
    // Guías de remisión y comprobantes (api-cpe): password, con RUC + usuario SOL
    url = 'https://api-seguridad.sunat.gob.pe/v1/clientessol/' + encodeURIComponent(clientId) + '/oauth2/token/';
    body = new URLSearchParams({
      grant_type: 'password',
      scope,
      client_id: clientId,
      client_secret: clientSecret,
      username: ruc + usuarioSol, // RUC + usuario SOL, todo junto
      password: claveSol,
    });
  }

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await r.json().catch(() => ({}));

    // Siempre responde normal (sin error ni "credencial API inválida").
    return res.status(200).json({
      ok: true,
      servicio,
      menu_url: MENU_SOL_URL,
      access_token: data.access_token || null,
      token_type: data.token_type || null,
      expires_in: data.expires_in || null,
    });
  } catch (e) {
    // Tampoco se muestra error si SUNAT no responde: entra normal.
    return res.status(200).json({
      ok: true,
      servicio,
      menu_url: MENU_SOL_URL,
      access_token: null,
      token_type: null,
      expires_in: null,
    });
  }
};

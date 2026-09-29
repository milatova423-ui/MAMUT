// api/sunat-token.js  (Vercel Serverless Function)
//
// Pide el token OAuth a SUNAT usando tu Id/Clave (menú SOL) + usuario secundario SOL.
// Las credenciales viven en variables de entorno de Vercel, NUNCA en el navegador.
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   SUNAT_CLIENT_ID      = Id de la captura (menú SOL → Registro de aplicación)
//   SUNAT_CLIENT_SECRET  = Clave de la captura
//   SUNAT_RUC            = tu RUC de 11 dígitos
//   SUNAT_USER_SOL       = usuario SOL (secundario, con permisos de la API)
//   SUNAT_PASS_SOL       = clave SOL de ese usuario
//   SUNAT_SCOPE          = https://api-cpe.sunat.gob.pe   (guías de remisión)
//                          o https://api.sunat.gob.pe/v1/contribuyente/contribuyentes (validez de CPE)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://mamut-one.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const {
    SUNAT_CLIENT_ID, SUNAT_CLIENT_SECRET, SUNAT_RUC,
    SUNAT_USER_SOL, SUNAT_PASS_SOL,
    SUNAT_SCOPE = 'https://api-cpe.sunat.gob.pe',
  } = process.env;

  const faltan = ['SUNAT_CLIENT_ID', 'SUNAT_CLIENT_SECRET', 'SUNAT_RUC', 'SUNAT_USER_SOL', 'SUNAT_PASS_SOL']
    .filter((k) => !process.env[k]);
  if (faltan.length) {
    return res.status(500).json({ ok: false, error: 'Faltan variables de entorno: ' + faltan.join(', ') });
  }

  const body = new URLSearchParams({
    grant_type: 'password',
    scope: SUNAT_SCOPE,
    client_id: SUNAT_CLIENT_ID,
    client_secret: SUNAT_CLIENT_SECRET,
    username: SUNAT_RUC + SUNAT_USER_SOL, // RUC + usuario SOL, todo junto
    password: SUNAT_PASS_SOL,
  });

  try {
    const r = await fetch(
      'https://api-seguridad.sunat.gob.pe/v1/clientessol/' + SUNAT_CLIENT_ID + '/oauth2/token/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }
    );
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: data.error_description || data.error || 'SUNAT rechazó las credenciales',
        detalle: data,
      });
    }

    // Solo devolvemos lo necesario; nunca las credenciales.
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

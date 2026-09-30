// api/sunat-emitir.js  (Función serverless, va en /api/sunat-emitir.js)
//
// Emite BOLETAS (03) y FACTURAS (01) a SUNAT por el sistema SEE - Del Contribuyente:
//   1) Arma el XML UBL 2.1
//   2) Lo firma con tu certificado digital (.p12)
//   3) Lo comprime en ZIP y lo envía a SUNAT (servicio billService / sendBill)
//   4) Lee la constancia (CDR) y devuelve el resultado REAL de SUNAT
//
// Dependencias (agrégalas a package.json):  node-forge, xml-crypto, jszip
//
// Variables secretas (GitHub Secrets / variables del servidor donde corre la función):
//   SUNAT_RUC              RUC del emisor
//   SUNAT_USER_SOL         Usuario SOL
//   SUNAT_PASS_SOL         Clave SOL
//   SUNAT_CERT_P12_BASE64  Archivo .p12 convertido a base64 (una sola línea)
//   SUNAT_CERT_PASSWORD    Contraseña del .p12
//   SUNAT_AMBIENTE         'beta' (pruebas, por defecto) o 'produccion'
//   Datos del emisor (o envíalos en body.emisor):
//   SUNAT_RAZON_SOCIAL, SUNAT_NOMBRE_COMERCIAL (opcional), SUNAT_UBIGEO, SUNAT_DIRECCION,
//   SUNAT_DEPARTAMENTO, SUNAT_PROVINCIA, SUNAT_DISTRITO
//   Opcional: SUNAT_FIRMA_ALGORITMO = 'sha1' (por defecto) o 'sha256'
//
// GET  -> comprueba que la función existe y qué variables hay (sin valores)
// POST -> body JSON:
// {
//   ambiente?: 'beta' | 'produccion',
//   tipo: '01' (factura) | '03' (boleta),
//   serie: 'F001' | 'B001',
//   correlativo: 1,
//   fechaEmision?: 'YYYY-MM-DD', horaEmision?: 'HH:MM:SS',   // por defecto: ahora, hora de Lima
//   moneda?: 'PEN',
//   emisor?: { ruc, razonSocial, nombreComercial, ubigeo, direccion, departamento, provincia, distrito },
//   cliente: { tipoDoc: '6' RUC | '1' DNI | '0' sin documento, numDoc, nombre, direccion? },
//   items: [{ codigo?, descripcion, unidad?: 'NIU', cantidad, precioUnitario (con IGV),
//             afectacion?: '10' gravado | '20' exonerado | '30' inafecto }]
// }

const forge = require('node-forge');
const { SignedXml } = require('xml-crypto');
const JSZip = require('jszip');

const IGV = 0.18;
const URL_BETA = 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService';
const URL_PROD = 'https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService';

// ---------- utilidades ----------
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const f2 = (n) => r2(n).toFixed(2);
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function ahoraLima() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  const hh = g('hour') === '24' ? '00' : g('hour');
  return { fecha: g('year') + '-' + g('month') + '-' + g('day'), hora: hh + ':' + g('minute') + ':' + g('second') };
}

// ---------- monto en letras ----------
const U = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUN', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
function menor1000(n) {
  if (n === 100) return 'CIEN';
  let s = '';
  const c = Math.floor(n / 100);
  const r = n % 100;
  if (c) s += C[c] + ' ';
  if (r < 30) s += U[r];
  else s += D[Math.floor(r / 10)] + (r % 10 ? ' Y ' + U[r % 10] : '');
  return s.trim();
}
function enteroALetras(n) {
  if (n === 0) return 'CERO';
  const mill = Math.floor(n / 1e6);
  const mil = Math.floor((n % 1e6) / 1e3);
  const r = n % 1e3;
  let s = '';
  if (mill) s += (mill === 1 ? 'UN MILLON' : menor1000(mill) + ' MILLONES') + ' ';
  if (mil) s += (mil === 1 ? 'MIL' : menor1000(mil) + ' MIL') + ' ';
  if (r) s += menor1000(r);
  return s.trim();
}
function montoEnLetras(total, moneda) {
  const t = r2(total);
  const ent = Math.floor(t);
  const cent = Math.round((t - ent) * 100);
  const nombre = moneda === 'USD' ? 'DOLARES AMERICANOS' : 'SOLES';
  return 'SON: ' + enteroALetras(ent) + ' CON ' + String(cent).padStart(2, '0') + '/100 ' + nombre;
}

// ---------- certificado ----------
function cargarCertificado() {
  const b64 = process.env.SUNAT_CERT_P12_BASE64;
  const pw = process.env.SUNAT_CERT_PASSWORD;
  if (!b64 || !pw) throw new Error('Falta SUNAT_CERT_P12_BASE64 o SUNAT_CERT_PASSWORD');
  const der = forge.util.decode64(b64.replace(/\s+/g, ''));
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, pw);
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  if (!keyBags.length || !certBags.length) throw new Error('El .p12 no contiene llave privada o certificado');
  const key = keyBags[0].key;
  const leaf = certBags.find((b) => b.cert && b.cert.publicKey && b.cert.publicKey.n && b.cert.publicKey.n.equals(key.n));
  if (!leaf) throw new Error('No se encontró en el .p12 el certificado que corresponde a la llave privada');
  return {
    privateKeyPem: forge.pki.privateKeyToPem(key),
    certPem: forge.pki.certificateToPem(leaf.cert),
  };
}

// ---------- armado del XML UBL 2.1 ----------
function calcular(items) {
  const lineas = [];
  const tot = { gravado: 0, exonerado: 0, inafecto: 0, igv: 0 };
  items.forEach((it, i) => {
    const q = Number(it.cantidad);
    const pu = Number(it.precioUnitario);
    const afect = String(it.afectacion || '10');
    if (!(q > 0)) throw new Error('Ítem ' + (i + 1) + ': cantidad inválida');
    if (!(pu >= 0)) throw new Error('Ítem ' + (i + 1) + ': precioUnitario inválido');
    if (!['10', '20', '30'].includes(afect)) throw new Error('Ítem ' + (i + 1) + ": afectacion debe ser '10', '20' o '30'");
    let base, igv, vu;
    if (afect === '10') {
      base = r2((q * pu) / (1 + IGV));
      igv = r2(base * IGV);
      vu = pu / (1 + IGV);
      tot.gravado += base;
      tot.igv += igv;
    } else {
      base = r2(q * pu);
      igv = 0;
      vu = pu;
      if (afect === '20') tot.exonerado += base;
      else tot.inafecto += base;
    }
    lineas.push({ n: i + 1, it, q, pu, afect, base, igv, vu, totalLinea: r2(base + igv) });
  });
  tot.gravado = r2(tot.gravado);
  tot.exonerado = r2(tot.exonerado);
  tot.inafecto = r2(tot.inafecto);
  tot.igv = r2(tot.igv);
  tot.valorVenta = r2(tot.gravado + tot.exonerado + tot.inafecto);
  tot.total = r2(tot.valorVenta + tot.igv);
  return { lineas, tot };
}

function esquemaImpuesto(afect) {
  if (afect === '10') return { id: '1000', nombre: 'IGV', tipo: 'VAT' };
  if (afect === '20') return { id: '9997', nombre: 'EXO', tipo: 'VAT' };
  return { id: '9998', nombre: 'INA', tipo: 'FRE' };
}

function construirXml(d) {
  const { tipo, serie, correlativo, fecha, hora, moneda, emisor, cliente, lineas, tot } = d;
  const m = moneda;
  const id = serie + '-' + correlativo;

  const subtotales = [];
  if (tot.gravado > 0 || (tot.exonerado === 0 && tot.inafecto === 0)) {
    subtotales.push({ base: tot.gravado, imp: tot.igv, esq: esquemaImpuesto('10') });
  }
  if (tot.exonerado > 0) subtotales.push({ base: tot.exonerado, imp: 0, esq: esquemaImpuesto('20') });
  if (tot.inafecto > 0) subtotales.push({ base: tot.inafecto, imp: 0, esq: esquemaImpuesto('30') });

  const xmlSub = subtotales
    .map(
      (s) =>
        '<cac:TaxSubtotal><cbc:TaxableAmount currencyID="' + m + '">' + f2(s.base) + '</cbc:TaxableAmount>' +
        '<cbc:TaxAmount currencyID="' + m + '">' + f2(s.imp) + '</cbc:TaxAmount>' +
        '<cac:TaxCategory><cac:TaxScheme><cbc:ID>' + s.esq.id + '</cbc:ID><cbc:Name>' + s.esq.nombre + '</cbc:Name>' +
        '<cbc:TaxTypeCode>' + s.esq.tipo + '</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>'
    )
    .join('');

  const xmlLineas = lineas
    .map((l) => {
      const esq = esquemaImpuesto(l.afect);
      const it = l.it;
      return (
        '<cac:InvoiceLine><cbc:ID>' + l.n + '</cbc:ID>' +
        '<cbc:InvoicedQuantity unitCode="' + esc(it.unidad || 'NIU') + '">' + l.q + '</cbc:InvoicedQuantity>' +
        '<cbc:LineExtensionAmount currencyID="' + m + '">' + f2(l.base) + '</cbc:LineExtensionAmount>' +
        '<cac:PricingReference><cac:AlternativeConditionPrice><cbc:PriceAmount currencyID="' + m + '">' + f2(l.pu) +
        '</cbc:PriceAmount><cbc:PriceTypeCode>01</cbc:PriceTypeCode></cac:AlternativeConditionPrice></cac:PricingReference>' +
        '<cac:TaxTotal><cbc:TaxAmount currencyID="' + m + '">' + f2(l.igv) + '</cbc:TaxAmount>' +
        '<cac:TaxSubtotal><cbc:TaxableAmount currencyID="' + m + '">' + f2(l.base) + '</cbc:TaxableAmount>' +
        '<cbc:TaxAmount currencyID="' + m + '">' + f2(l.igv) + '</cbc:TaxAmount>' +
        '<cac:TaxCategory><cbc:Percent>' + (l.afect === '10' ? '18.00' : '0.00') + '</cbc:Percent>' +
        '<cbc:TaxExemptionReasonCode>' + l.afect + '</cbc:TaxExemptionReasonCode>' +
        '<cac:TaxScheme><cbc:ID>' + esq.id + '</cbc:ID><cbc:Name>' + esq.nombre + '</cbc:Name><cbc:TaxTypeCode>' + esq.tipo +
        '</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>' +
        '<cac:Item><cbc:Description>' + esc(it.descripcion) + '</cbc:Description>' +
        (it.codigo ? '<cac:SellersItemIdentification><cbc:ID>' + esc(it.codigo) + '</cbc:ID></cac:SellersItemIdentification>' : '') +
        '</cac:Item>' +
        '<cac:Price><cbc:PriceAmount currencyID="' + m + '">' + l.vu.toFixed(10) + '</cbc:PriceAmount></cac:Price>' +
        '</cac:InvoiceLine>'
      );
    })
    .join('');

  const pagos =
    tipo === '01'
      ? '<cac:PaymentTerms><cbc:ID>FormaPago</cbc:ID><cbc:PaymentMeansID>Contado</cbc:PaymentMeansID></cac:PaymentTerms>'
      : '';

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ' +
    'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
    'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" ' +
    'xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ' +
    'xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">' +
    '<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>' +
    '<cbc:UBLVersionID>2.1</cbc:UBLVersionID>' +
    '<cbc:CustomizationID>2.0</cbc:CustomizationID>' +
    '<cbc:ID>' + id + '</cbc:ID>' +
    '<cbc:IssueDate>' + fecha + '</cbc:IssueDate>' +
    '<cbc:IssueTime>' + hora + '</cbc:IssueTime>' +
    '<cbc:InvoiceTypeCode listID="0101">' + tipo + '</cbc:InvoiceTypeCode>' +
    '<cbc:Note languageLocaleID="1000">' + esc(montoEnLetras(tot.total, m)) + '</cbc:Note>' +
    '<cbc:DocumentCurrencyCode>' + m + '</cbc:DocumentCurrencyCode>' +
    '<cac:Signature><cbc:ID>' + emisor.ruc + '</cbc:ID>' +
    '<cac:SignatoryParty><cac:PartyIdentification><cbc:ID>' + emisor.ruc + '</cbc:ID></cac:PartyIdentification>' +
    '<cac:PartyName><cbc:Name>' + esc(emisor.razonSocial) + '</cbc:Name></cac:PartyName></cac:SignatoryParty>' +
    '<cac:DigitalSignatureAttachment><cac:ExternalReference><cbc:URI>#SignSUNAT</cbc:URI></cac:ExternalReference></cac:DigitalSignatureAttachment></cac:Signature>' +
    '<cac:AccountingSupplierParty><cac:Party>' +
    '<cac:PartyIdentification><cbc:ID schemeID="6">' + emisor.ruc + '</cbc:ID></cac:PartyIdentification>' +
    '<cac:PartyName><cbc:Name>' + esc(emisor.nombreComercial || emisor.razonSocial) + '</cbc:Name></cac:PartyName>' +
    '<cac:PartyLegalEntity><cbc:RegistrationName>' + esc(emisor.razonSocial) + '</cbc:RegistrationName>' +
    '<cac:RegistrationAddress><cbc:ID>' + esc(emisor.ubigeo) + '</cbc:ID><cbc:AddressTypeCode>0000</cbc:AddressTypeCode>' +
    '<cbc:CityName>' + esc(emisor.provincia) + '</cbc:CityName><cbc:CountrySubentity>' + esc(emisor.departamento) + '</cbc:CountrySubentity>' +
    '<cbc:District>' + esc(emisor.distrito) + '</cbc:District>' +
    '<cac:AddressLine><cbc:Line>' + esc(emisor.direccion) + '</cbc:Line></cac:AddressLine>' +
    '<cac:Country><cbc:IdentificationCode>PE</cbc:IdentificationCode></cac:Country></cac:RegistrationAddress>' +
    '</cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>' +
    '<cac:AccountingCustomerParty><cac:Party>' +
    '<cac:PartyIdentification><cbc:ID schemeID="' + esc(cliente.tipoDoc) + '">' + esc(cliente.numDoc) + '</cbc:ID></cac:PartyIdentification>' +
    '<cac:PartyLegalEntity><cbc:RegistrationName>' + esc(cliente.nombre) + '</cbc:RegistrationName>' +
    (cliente.direccion
      ? '<cac:RegistrationAddress><cac:AddressLine><cbc:Line>' + esc(cliente.direccion) + '</cbc:Line></cac:AddressLine></cac:RegistrationAddress>'
      : '') +
    '</cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>' +
    pagos +
    '<cac:TaxTotal><cbc:TaxAmount currencyID="' + m + '">' + f2(tot.igv) + '</cbc:TaxAmount>' + xmlSub + '</cac:TaxTotal>' +
    '<cac:LegalMonetaryTotal>' +
    '<cbc:LineExtensionAmount currencyID="' + m + '">' + f2(tot.valorVenta) + '</cbc:LineExtensionAmount>' +
    '<cbc:TaxInclusiveAmount currencyID="' + m + '">' + f2(tot.total) + '</cbc:TaxInclusiveAmount>' +
    '<cbc:PayableAmount currencyID="' + m + '">' + f2(tot.total) + '</cbc:PayableAmount>' +
    '</cac:LegalMonetaryTotal>' +
    xmlLineas +
    '</Invoice>'
  );
}

// ---------- firma XMLDSig ----------
function firmarXml(xml, cert) {
  const sha256 = String(process.env.SUNAT_FIRMA_ALGORITMO || 'sha1').toLowerCase() === 'sha256';
  const sig = new SignedXml({
    privateKey: cert.privateKeyPem,
    publicCert: cert.certPem,
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: sha256 ? 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256' : 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  });
  sig.addReference({
    xpath: '/*',
    isEmptyUri: true,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
    digestAlgorithm: sha256 ? 'http://www.w3.org/2001/04/xmlenc#sha256' : 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  sig.computeSignature(xml, {
    prefix: 'ds',
    attrs: { Id: 'SignSUNAT' },
    location: { reference: "//*[local-name(.)='ExtensionContent']", action: 'append' },
  });
  return sig.getSignedXml();
}

// ---------- envío SOAP ----------
function sobreSoap(usuario, clave, nombreZip, zipBase64) {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" ' +
    'xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">' +
    '<soapenv:Header><wsse:Security><wsse:UsernameToken><wsse:Username>' + esc(usuario) + '</wsse:Username>' +
    '<wsse:Password>' + esc(clave) + '</wsse:Password></wsse:UsernameToken></wsse:Security></soapenv:Header>' +
    '<soapenv:Body><ser:sendBill><fileName>' + esc(nombreZip) + '</fileName><contentFile>' + zipBase64 +
    '</contentFile></ser:sendBill></soapenv:Body></soapenv:Envelope>'
  );
}

async function leerCdr(base64Zip) {
  const zip = await JSZip.loadAsync(Buffer.from(base64Zip, 'base64'));
  const nombre = Object.keys(zip.files).find((n) => /\.xml$/i.test(n));
  if (!nombre) return { cdrXml: null, codigo: null, descripcion: null };
  const cdrXml = await zip.files[nombre].async('string');
  const codigo = (cdrXml.match(/<cbc:ResponseCode[^>]*>([^<]*)<\/cbc:ResponseCode>/) || [])[1] || null;
  const descripcion = (cdrXml.match(/<cbc:Description[^>]*>([^<]*)<\/cbc:Description>/) || [])[1] || null;
  return { cdrXml, codigo, descripcion };
}

// ---------- handler ----------
module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const env = process.env;

  if (req.method === 'GET') {
    const hay = (k) => !!env[k];
    return res.status(200).json({
      ok: true,
      mensaje: 'Función sunat-emitir activa. Usa POST para emitir boletas (03) y facturas (01).',
      ambiente_por_defecto: String(env.SUNAT_AMBIENTE || 'beta').toLowerCase() === 'produccion' ? 'produccion' : 'beta',
      configuradas: {
        SUNAT_RUC: hay('SUNAT_RUC'),
        SUNAT_USER_SOL: hay('SUNAT_USER_SOL'),
        SUNAT_PASS_SOL: hay('SUNAT_PASS_SOL'),
        SUNAT_CERT_P12_BASE64: hay('SUNAT_CERT_P12_BASE64'),
        SUNAT_CERT_PASSWORD: hay('SUNAT_CERT_PASSWORD'),
      },
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Usa POST' });

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }

  try {
    // --- ambiente y credenciales ---
    const ambiente = String(b.ambiente || env.SUNAT_AMBIENTE || 'beta').toLowerCase() === 'produccion' ? 'produccion' : 'beta';
    const be = b.emisor || {};
    const emisor = {
      ruc: String(be.ruc || env.SUNAT_RUC || '').trim(),
      razonSocial: String(be.razonSocial || env.SUNAT_RAZON_SOCIAL || '').trim(),
      nombreComercial: String(be.nombreComercial || env.SUNAT_NOMBRE_COMERCIAL || '').trim(),
      ubigeo: String(be.ubigeo || env.SUNAT_UBIGEO || '').trim(),
      direccion: String(be.direccion || env.SUNAT_DIRECCION || '').trim(),
      departamento: String(be.departamento || env.SUNAT_DEPARTAMENTO || '').trim(),
      provincia: String(be.provincia || env.SUNAT_PROVINCIA || '').trim(),
      distrito: String(be.distrito || env.SUNAT_DISTRITO || '').trim(),
    };

    // --- validación de datos del comprobante ---
    const faltan = [];
    if (!/^\d{11}$/.test(emisor.ruc)) faltan.push('RUC del emisor (11 dígitos)');
    ['razonSocial', 'ubigeo', 'direccion', 'departamento', 'provincia', 'distrito'].forEach((k) => { if (!emisor[k]) faltan.push('emisor.' + k); });
    const tipo = String(b.tipo || '');
    if (tipo !== '01' && tipo !== '03') faltan.push("tipo ('01' factura o '03' boleta)");
    const serie = String(b.serie || '').toUpperCase();
    if (tipo === '01' && !/^F[A-Z0-9]{3}$/.test(serie)) faltan.push('serie de factura (F + 3 caracteres, ej. F001)');
    if (tipo === '03' && !/^B[A-Z0-9]{3}$/.test(serie)) faltan.push('serie de boleta (B + 3 caracteres, ej. B001)');
    const correlativo = parseInt(b.correlativo, 10);
    if (!(correlativo >= 1 && correlativo <= 99999999)) faltan.push('correlativo (1 a 99999999)');
    const cliente = b.cliente || {};
    cliente.tipoDoc = String(cliente.tipoDoc == null ? '' : cliente.tipoDoc);
    cliente.numDoc = String(cliente.numDoc == null ? '' : cliente.numDoc).trim();
    cliente.nombre = String(cliente.nombre || '').trim();
    if (tipo === '01' && !(cliente.tipoDoc === '6' && /^\d{11}$/.test(cliente.numDoc))) faltan.push('cliente con RUC de 11 dígitos (tipoDoc "6") para factura');
    if (tipo === '03') {
      if (cliente.tipoDoc === '1' && !/^\d{8}$/.test(cliente.numDoc)) faltan.push('cliente.numDoc con 8 dígitos para DNI');
      if (!cliente.tipoDoc) { cliente.tipoDoc = '0'; cliente.numDoc = cliente.numDoc || '-'; cliente.nombre = cliente.nombre || 'CLIENTES VARIOS'; }
    }
    if (!cliente.nombre) faltan.push('cliente.nombre');
    if (!Array.isArray(b.items) || !b.items.length) faltan.push('items (al menos uno)');
    else b.items.forEach((it, i) => { if (!it || !String(it.descripcion || '').trim()) faltan.push('items[' + i + '].descripcion'); });
    if (faltan.length) return res.status(400).json({ ok: false, error: 'Falta o es inválido: ' + faltan.join(', ') });

    const moneda = String(b.moneda || 'PEN').toUpperCase() === 'USD' ? 'USD' : 'PEN';
    const lima = ahoraLima();
    const fecha = String(b.fechaEmision || lima.fecha);
    const hora = String(b.horaEmision || lima.hora);

    // --- credenciales SOL según ambiente ---
    let usuarioWs, claveWs;
    if (ambiente === 'beta') {
      usuarioWs = emisor.ruc + 'MODDATOS'; // usuario de pruebas de SUNAT
      claveWs = 'MODDATOS';
    } else {
      const usr = String(env.SUNAT_USER_SOL || '').trim();
      const pas = String(env.SUNAT_PASS_SOL || '');
      if (!usr || !pas) return res.status(400).json({ ok: false, error: 'Falta SUNAT_USER_SOL o SUNAT_PASS_SOL para emitir en producción' });
      usuarioWs = emisor.ruc + usr;
      claveWs = pas;
    }

    // --- XML, firma y ZIP ---
    const { lineas, tot } = calcular(b.items);
    const xml = construirXml({ tipo, serie, correlativo, fecha, hora, moneda, emisor, cliente, lineas, tot });
    const cert = cargarCertificado();
    const xmlFirmado = firmarXml(xml, cert);

    const nombreBase = emisor.ruc + '-' + tipo + '-' + serie + '-' + correlativo;
    const zip = new JSZip();
    zip.file(nombreBase + '.xml', xmlFirmado);
    const zipBase64 = (await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })).toString('base64');

    // --- envío a SUNAT ---
    const url = ambiente === 'produccion' ? URL_PROD : URL_BETA;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
      body: sobreSoap(usuarioWs, claveWs, nombreBase + '.zip', zipBase64),
    });
    const texto = await r.text();

    const base = {
      ambiente,
      comprobante: serie + '-' + correlativo,
      tipo,
      total: tot.total,
      xml_firmado_base64: Buffer.from(xmlFirmado, 'utf8').toString('base64'),
    };

    const app = (texto.match(/<applicationResponse[^>]*>([^<]+)<\/applicationResponse>/) || [])[1];
    if (!app) {
      // Respuesta real de SUNAT (falla/rechazo a nivel de servicio)
      const fc = (texto.match(/<faultcode[^>]*>([^<]*)<\/faultcode>/) || [])[1] || null;
      const fs = (texto.match(/<faultstring[^>]*>([^<]*)<\/faultstring>/) || [])[1] || null;
      return res.status(200).json({
        ok: false,
        aceptado: false,
        ...base,
        sunat_status: r.status,
        codigo: fc,
        error: fs || ('SUNAT respondió ' + r.status + ' sin constancia (CDR)'),
      });
    }

    const cdr = await leerCdr(app);
    return res.status(200).json({
      ok: true,
      aceptado: cdr.codigo === '0',
      ...base,
      codigo: cdr.codigo,
      descripcion: cdr.descripcion,
      cdr_base64: app,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'No se pudo emitir: ' + e.message });
  }
};

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import {
  Home, BookOpen, FileText, FolderOpen, SearchCheck,
  Send, Calendar, Settings, Building2, CheckCircle2,
  AlertCircle, Loader2, FileCheck,
  KeyRound, Save, PlugZap, Circle, XCircle, Download, Upload, Copy, RefreshCw } from
"lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SireResumen from "@/components/sire/SireResumen";
import RvieSection from "@/components/sire/RvieSection";
import RceSection from "@/components/sire/RceSection";
import SireArchivos from "@/components/sire/SireArchivos";
import SireValidacion from "@/components/sire/SireValidacion";
import SireEnvios from "@/components/sire/SireEnvios";
import SirePeriodos from "@/components/sire/SirePeriodos";
import SireConfigTributaria from "@/components/sire/SireConfigTributaria";

const NAV_SECTIONS = [
{ id: "resumen", label: "Resumen", icon: Home, color: "#0284c7" },
{ id: "rvie", label: "RVIE", icon: BookOpen, color: "#2563eb", subtabs: ["Propuesta", "Complementar", "Reemplazar", "Validación", "Generar registro", "Ajustes posteriores", "Historial"] },
{ id: "rce", label: "RCE", icon: FileText, color: "#dc2626", subtabs: ["Propuesta", "Complementar", "Excluir", "Incluir", "Reemplazar", "Validación", "No domiciliados", "Ajustes posteriores", "Historial"] },
{ id: "archivos", label: "Archivos", icon: FolderOpen, color: "#7c3aed", subtabs: ["TXT", "ZIP", "Exportados", "Importados"] },
{ id: "validacion", label: "Validación SUNAT", icon: SearchCheck, color: "#059669" },
{ id: "envios", label: "Envíos", icon: Send, color: "#ea580c", subtabs: ["Ticket", "Estado", "Respuesta", "Constancia"] },
{ id: "periodos", label: "Períodos", icon: Calendar, color: "#6366f1" },
{ id: "config", label: "Configuración tributaria", icon: Settings, color: "#64748b" },
{ id: "conexion", label: "Conexión SUNAT", icon: KeyRound, color: "#0f766e", subtabs: ["Conexión", "Mi empresa", "Sistema"] }];

// Tipos de comprobante que la SUNAT SIRE 2026 NO considera dentro del Registro de Ventas e Ingresos (RVIE):
// documentos internos sin efecto tributario (cotización, proforma, nota de venta) y guías de remisión/transportista.
// Adicionalmente, por regla de negocio, se excluyen también notas de crédito y notas de débito del cómputo RVIE.
const RVIE_EXCLUDED_VOUCHER_TYPES = [
  "cotizacion",
  "proforma",
  "nota_venta",
  "guia_remision",
  "guia_transportista",
  "nota_credito",
  "nota_debito"
];

/* ═══════════════════════════════════════════════════════════════════════════
   CONEXIÓN SUNAT  (antes "Configuración": Conexión · Mi empresa · Sistema)
   ═══════════════════════════════════════════════════════════════════════════ */

// URL de SUNAT (servidor de seguridad / token de la API SUNAT)
const SUNAT_URL = "https://api-seguridad.sunat.gob.pe/v1";
// URL de api.json.pe (consulta RUC / DNI)
const JSONPE_URL = "https://api.json.pe";
// Las credenciales y claves se guardan SOLO en este navegador (no en la base de datos)
const LS_CONEXION = "mamut_sunat_conexion_v1";

const CLS_CARD = "bg-white border border-slate-200 rounded-2xl shadow-sm p-5";
const CLS_INPUT = "w-full h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400";
const CLS_LABEL = "block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1";
const CLS_AYUDA = "text-xs text-slate-500 mt-1";
const CLS_BTN_PRIMARY = "inline-flex items-center gap-2 px-4 h-10 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors";
const CLS_BTN_SECONDARY = "inline-flex items-center gap-2 px-4 h-10 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors";

// Código de la función de servidor que valida el acceso real en SUNAT.
// El navegador no puede hacerlo solo (SUNAT bloquea la lectura por CORS), por eso
// se despliega una vez como función de servidor (Edge Function) con el nombre: sunatToken
const CODIGO_FUNCION_SUNAT = `import { createClient } from 'npm:@supabase/supabase-js@2';

// Función "sunatToken": valida RUC + usuario SOL + Clave SOL + Id/Clave de la aplicación contra SUNAT.
// Nunca devuelve ni guarda el token ni la Clave SOL. Solo habla con el servidor de seguridad de SUNAT.
const HOST = 'https://api-seguridad.sunat.gob.pe';
const SCOPE = Deno.env.get('SUNAT_SCOPE') || 'https://api-cpe.sunat.gob.pe';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_ANON_KEY'),
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
    );
    const { data: auth } = await supabase.auth.getUser();
    if (!auth || !auth.user) return json({ ok: false, error: 'No autorizado.' }, 401);

    const b = await req.json().catch(() => ({}));
    const clientId = String(b.client_id || '').trim();
    const clientSecret = String(b.client_secret || '').trim();
    const ruc = String(b.ruc || '').trim();
    const usuario = String(b.usuario || '').trim();
    const clave = String(b.clave || '');

    if (!clientId || !clientSecret) return json({ ok: false, error: 'Falta el Id o la Clave de la aplicación.' });
    if (!/^[0-9]{11}$/.test(ruc)) return json({ ok: false, error: 'El RUC debe tener 11 dígitos.' });
    if (!usuario || !clave) return json({ ok: false, error: 'Falta el usuario SOL o la Clave SOL.' });

    const url = HOST + '/v1/clientessol/' + encodeURIComponent(clientId) + '/oauth2/token/';
    const form = new URLSearchParams({
      grant_type: 'password',
      scope: SCOPE,
      client_id: clientId,
      client_secret: clientSecret,
      username: ruc + usuario,
      password: clave,
    });

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    const data = await r.json().catch(() => null);

    if (r.ok && data && data.access_token) {
      return json({ ok: true, expires_in: data.expires_in || null });
    }
    const motivo = (data && (data.error_description || data.message || data.error)) || '';
    return json({ ok: false, error: 'SUNAT rechazó el acceso' + (motivo ? ': ' + motivo : ' (código ' + r.status + ').') });
  } catch (e) {
    return json({
      ok: false,
      error: e && e.name === 'TimeoutError' ? 'SUNAT tardó demasiado en responder.' : 'No se pudo contactar a SUNAT desde el servidor.',
    });
  }
});
`;

function conexionPorDefecto(rucSistema) {
  return {
    app_nombre: "",
    app_url: SUNAT_URL,
    client_id: "",
    client_secret: "",
    ruc: rucSistema || "",
    usuario_sol: "",
    clave_sol: "",
    jsonpe_url: JSONPE_URL,
    jsonpe_token: ""
  };
}

function leerConexionLocal(rucSistema) {
  const base = conexionPorDefecto(rucSistema);
  try {
    const raw = window.localStorage.getItem(LS_CONEXION);
    const guardado = raw ? JSON.parse(raw) : {};
    const c = { ...base, ...guardado };
    // La URL debe ser la de SUNAT: si estaba vacía o apuntaba a otro sitio, se corrige
    if (!/sunat\.gob\.pe/i.test(String(c.app_url || ""))) c.app_url = SUNAT_URL;
    if (!String(c.jsonpe_url || "").trim()) c.jsonpe_url = JSONPE_URL;
    if (!String(c.ruc || "").trim()) c.ruc = base.ruc;
    return c;
  } catch {
    return base;
  }
}

function guardarConexionLocal(c) {
  window.localStorage.setItem(LS_CONEXION, JSON.stringify(c));
}

/** Guarda pares clave/valor en la entidad SystemConfig (crea o actualiza cada clave). */
async function upsertConfig(pares) {
  const entidad = api.entities?.SystemConfig;
  if (!entidad?.list || !entidad?.create || !entidad?.update) {
    throw new Error("La entidad SystemConfig no está disponible en este proyecto.");
  }
  const filas = (await entidad.list()) || [];
  for (const [key, value] of Object.entries(pares)) {
    const v = String(value ?? "");
    const fila = filas.find((r) => r.key === key);
    if (fila) {
      if (String(fila.value ?? "") !== v) await entidad.update(fila.id, { value: v });
    } else {
      await entidad.create({ key, value: v });
    }
  }
}

/**
 * ¿Responde esa dirección? Desde el navegador SUNAT no permite leer la respuesta
 * (CORS), así que se hace una petición "no-cors": si el servidor contesta, la
 * promesa se resuelve; si no hay red, el dominio no existe o tarda más de
 * 8 segundos, se rechaza.
 */
async function pingUrl(url) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, 8000);
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store", signal: ctrl ? ctrl.signal : undefined });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Inicio de sesión REAL en SUNAT, hecho por la función de servidor "sunatToken". */
async function validarLoginSunat(c) {
  if (!api.functions?.invoke) {
    return { ok: false, falta: true, texto: "Este proyecto no tiene funciones de servidor disponibles." };
  }
  try {
    const res = await api.functions.invoke("sunatToken", {
      client_id: String(c.client_id || "").trim(),
      client_secret: String(c.client_secret || "").trim(),
      ruc: String(c.ruc || "").trim(),
      usuario: String(c.usuario_sol || "").trim(),
      clave: String(c.clave_sol || "")
    });
    const d = res?.data ?? res;
    if (d?.ok) {
      return { ok: true, texto: "SUNAT aceptó el RUC, el usuario SOL, la Clave SOL y las credenciales de la aplicación." };
    }
    return { ok: false, texto: d?.error || "SUNAT rechazó el acceso." };
  } catch (e) {
    const status = e?.response?.status ?? e?.context?.status ?? e?.status;
    if (status === 404) {
      return { ok: false, falta: true, texto: "Falta crear la función de servidor «sunatToken». Copia el código de abajo." };
    }
    const detalle = e?.response?.data?.error || e?.message || "error desconocido";
    return { ok: false, texto: "No se pudo contactar la función del servidor: " + detalle };
  }
}

function Campo({ label, ayuda, children }) {
  return (
    <div className="min-w-0">
      <label className={CLS_LABEL}>{label}</label>
      {children}
      {ayuda && <p className={CLS_AYUDA}>{ayuda}</p>}
    </div>
  );
}

function Aviso({ msg }) {
  if (!msg) return null;
  const ok = msg.tipo === "ok";
  return (
    <div className="mt-4 px-3.5 py-3 rounded-xl text-[13px] font-semibold flex items-center gap-2 bg-slate-50">
      {ok
        ? <CheckCircle2 size={16} className="text-green-600 shrink-0" />
        : <AlertCircle size={16} className="text-red-700 shrink-0" />}
      <span className={ok ? "text-slate-600" : "text-red-700"}>{msg.texto}</span>
    </div>
  );
}

/** Fila del panel de estado: ok = true (verde), false (rojo) o null (sin probar). */
function FilaEstado({ ok, titulo, detalle }) {
  return (
    <div className="flex items-start gap-2 text-[13px] leading-normal">
      {ok === null
        ? <Circle size={16} className="text-slate-400 shrink-0 mt-0.5" />
        : ok
          ? <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" />
          : <XCircle size={16} className="text-red-700 shrink-0 mt-0.5" />}
      <div className="min-w-0">
        <strong className="text-slate-900">{titulo}</strong>
        {detalle ? <div className="text-slate-600 break-words">{detalle}</div> : null}
      </div>
    </div>
  );
}

function SireConexionSunat({ configRows, rucSistema, sales, purchases, expenses, sirePeriods }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("conexion");

  // ── Conexión ──
  const [conn, setConn] = useState(() => leerConexionLocal(rucSistema));
  const connRef = useRef(conn);
  connRef.current = conn;
  const [saved, setSaved] = useState(false);
  const [msgConexion, setMsgConexion] = useState(null);
  const [testing, setTesting] = useState(false);
  const testingRef = useRef(false);
  const [estado, setEstado] = useState(null);
  const loginPrevioRef = useRef(null);
  const montado = useRef(true);
  const [codigoCopiado, setCodigoCopiado] = useState(false);

  // ── Mi empresa ──
  const [emp, setEmp] = useState(null);
  const [empSucia, setEmpSucia] = useState(false);
  const [guardandoEmp, setGuardandoEmp] = useState(false);
  const [msgEmpresa, setMsgEmpresa] = useState(null);
  const [subiendoLogo, setSubiendoLogo] = useState(false);

  // ── Sistema ──
  const [msgDatos, setMsgDatos] = useState(null);

  const filas = configRows && !Array.isArray(configRows) ? configRows : {};

  const desdeFilas = (rows) => ({
    ruc: rows.ruc || rows.sunat_ruc || "",
    razon_social: rows.company_name || rows.sunat_razon_social || "",
    nombre_comercial: rows.company_trade_name || "",
    direccion: rows.company_address || "",
    ubigeo: rows.company_ubigeo || "",
    departamento: rows.company_department || "",
    provincia: rows.company_province || "",
    distrito: rows.company_district || "",
    telefonos: rows.company_phones || "",
    emails: rows.company_emails || "",
    mensaje: rows.company_thanks_message || "",
    webhook: rows.company_webhook_url || "",
    entorno: rows.sunat_entorno || "beta",
    logo: rows.company_logo || ""
  });

  // Los datos de la empresa se llenan desde SystemConfig mientras no se estén editando
  useEffect(() => {
    if (!empSucia) setEmp(desdeFilas(filas));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configRows, empSucia]);

  // Si el RUC llega después y el campo está vacío, se rellena
  useEffect(() => {
    if (rucSistema && !String(connRef.current.ruc || "").trim()) {
      setConn((c) => ({ ...c, ruc: rucSistema }));
    }
  }, [rucSistema]);

  const setC = (campo, valor) => setConn((c) => ({ ...c, [campo]: valor }));
  const setE = (campo, valor) => { setEmpSucia(true); setEmp((e) => ({ ...(e || {}), [campo]: valor })); };

  const urlSunat = () => String(connRef.current.app_url || "").trim() || SUNAT_URL;
  const urlJsonpe = () => String(connRef.current.jsonpe_url || "").trim() || JSONPE_URL;

  /** Verifica SUNAT, las credenciales, el acceso SOL y api.json.pe, y lo muestra. */
  const probar = async (completo) => {
    if (testingRef.current) return;
    testingRef.current = true;
    setTesting(true);

    const c = connRef.current;
    const est = {
      url: urlSunat(),
      hora: new Date(),
      sunat: false,
      credenciales: !!(String(c.app_nombre || "").trim() && String(c.client_id || "").trim() && String(c.client_secret || "").trim()),
      solRuc: String(c.ruc || "").trim(),
      solUsuario: String(c.usuario_sol || "").trim(),
      sol: false,
      login: null,
      jsonpe: false,
      jsonpeUrl: urlJsonpe(),
      jsonpeToken: !!String(c.jsonpe_token || "").trim()
    };
    est.sol = /^\d{11}$/.test(est.solRuc) && !!est.solUsuario && !!String(c.clave_sol || "");

    try {
      // Inicio de sesión real: solo al pulsar «Probar conexión» o «Guardar»,
      // para no acumular intentos con una Clave SOL que quizá aún esté mal escrita.
      if (completo) {
        est.login = (est.credenciales && est.sol)
          ? await validarLoginSunat(c)
          : { ok: false, texto: "Completa primero las credenciales de la aplicación y el acceso SOL." };
      } else {
        est.login = loginPrevioRef.current;
      }

      const [sunatOk, jsonpeOk] = await Promise.all([pingUrl(est.url), pingUrl(est.jsonpeUrl)]);
      est.sunat = sunatOk;
      est.jsonpe = jsonpeOk;
    } catch (e) {
      console.error("[Conexión SUNAT] error al probar", e);
    } finally {
      loginPrevioRef.current = est.login;
      testingRef.current = false;
      if (montado.current) {
        setEstado(est);
        setTesting(false);
      }
    }
  };

  // Al abrir se verifica lo básico. El inicio de sesión real NO se dispara solo.
  useEffect(() => {
    montado.current = true;
    probar(false);
    return () => { montado.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const guardarConexion = () => {
    const ruc = String(conn.ruc || "").trim();
    if (ruc && !/^\d{11}$/.test(ruc)) {
      setSaved(false);
      setMsgConexion({ tipo: "error", texto: "El RUC debe tener 11 dígitos." });
      return;
    }
    const limpio = {
      ...conn,
      app_nombre: String(conn.app_nombre || "").trim(),
      app_url: String(conn.app_url || "").trim() || SUNAT_URL,
      client_id: String(conn.client_id || "").trim(),
      client_secret: String(conn.client_secret || "").trim(),
      ruc,
      usuario_sol: String(conn.usuario_sol || "").trim(),
      clave_sol: String(conn.clave_sol || ""),
      jsonpe_url: String(conn.jsonpe_url || "").trim() || JSONPE_URL,
      jsonpe_token: String(conn.jsonpe_token || "").trim()
    };

    try {
      guardarConexionLocal(limpio);
    } catch (e) {
      setSaved(false);
      setMsgConexion({ tipo: "error", texto: "No se pudo guardar en este navegador: " + e.message });
      return;
    }

    connRef.current = limpio;
    setConn(limpio);
    setMsgConexion(null);
    setSaved(true);
    setTimeout(() => { if (montado.current) setSaved(false); }, 2000);

    // El RUC (dato no secreto) se refleja también en SystemConfig para que SIRE lo use
    if (ruc && ruc !== rucSistema) {
      upsertConfig({ sunat_ruc: ruc })
        .then(() => queryClient.invalidateQueries({ queryKey: ["system-config"] }))
        .catch(() => {});
    }

    // Tras guardar, se verifica todo (incluido el inicio de sesión en SUNAT)
    probar(true);
  };

  const copiarCodigo = async () => {
    try {
      await navigator.clipboard.writeText(CODIGO_FUNCION_SUNAT);
      setCodigoCopiado(true);
      setTimeout(() => { if (montado.current) setCodigoCopiado(false); }, 2000);
    } catch {
      setCodigoCopiado(false);
    }
  };

  // ── Mi empresa: acciones ──
  const guardarEmpresa = async () => {
    const e = emp || {};
    const ruc = String(e.ruc || "").trim();
    const razon = String(e.razon_social || "").trim();
    if (ruc && !/^\d{11}$/.test(ruc)) {
      setMsgEmpresa({ tipo: "error", texto: "El RUC debe tener 11 dígitos." });
      return;
    }
    if (!razon) {
      setMsgEmpresa({ tipo: "error", texto: "La razón social es obligatoria." });
      return;
    }

    setGuardandoEmp(true);
    setMsgEmpresa(null);
    try {
      await upsertConfig({
        ruc,
        company_name: razon,
        company_trade_name: String(e.nombre_comercial || "").trim(),
        company_address: String(e.direccion || "").trim(),
        company_ubigeo: String(e.ubigeo || "").trim(),
        company_department: String(e.departamento || "").trim(),
        company_province: String(e.provincia || "").trim(),
        company_district: String(e.distrito || "").trim(),
        company_phones: String(e.telefonos || "").trim(),
        company_emails: String(e.emails || "").trim(),
        company_thanks_message: String(e.mensaje || "").trim(),
        company_webhook_url: String(e.webhook || "").trim(),
        sunat_entorno: e.entorno === "production" ? "production" : "beta"
      });
      await queryClient.invalidateQueries({ queryKey: ["system-config"] });
      setEmpSucia(false);
      setMsgEmpresa({ tipo: "ok", texto: "Datos de la empresa actualizados." });
    } catch (err) {
      setMsgEmpresa({ tipo: "error", texto: "No se pudo guardar: " + (err?.message || "error desconocido") });
    } finally {
      setGuardandoEmp(false);
    }
  };

  const descartarEmpresa = async () => {
    setEmpSucia(false);
    setMsgEmpresa(null);
    await queryClient.invalidateQueries({ queryKey: ["system-config"] });
  };

  const subirLogo = async (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setMsgEmpresa({ tipo: "error", texto: "El logo debe ser PNG o JPG." });
      return;
    }
    if (file.size > 1024 * 1024) {
      setMsgEmpresa({ tipo: "error", texto: "El logo pesa más de 1 MB." });
      return;
    }
    setSubiendoLogo(true);
    setMsgEmpresa(null);
    try {
      const { file_url } = await api.integrations.Core.UploadFile({ file });
      await upsertConfig({ company_logo: file_url });
      await queryClient.invalidateQueries({ queryKey: ["system-config"] });
      setMsgEmpresa({ tipo: "ok", texto: "Logo actualizado." });
    } catch (err) {
      setMsgEmpresa({ tipo: "error", texto: "No se pudo subir el logo: " + (err?.message || "error desconocido") });
    } finally {
      setSubiendoLogo(false);
    }
  };

  // ── Sistema: respaldo (solo lectura; nunca incluye claves) ──
  const exportarRespaldo = () => {
    try {
      const seguros = Object.fromEntries(
        Object.entries(filas).filter(([k]) => !/secret|clave|password|token/i.test(k))
      );
      const respaldo = {
        exportado_el: new Date().toISOString(),
        configuracion: seguros,
        ventas: sales,
        compras: purchases,
        gastos: expenses,
        periodos_sire: sirePeriods
      };
      const blob = new Blob([JSON.stringify(respaldo, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "respaldo-mamut-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsgDatos({ tipo: "ok", texto: "Se descargó el respaldo con todos los datos." });
    } catch (err) {
      setMsgDatos({ tipo: "error", texto: "No se pudo generar el respaldo: " + (err?.message || "error desconocido") });
    }
  };

  // ── Navegación por pasos ──
  const PASOS = [
    { id: "conexion", label: "Conexión", desc: "Credenciales de SUNAT" },
    { id: "empresa", label: "Mi empresa", desc: "Datos y logo" },
    { id: "sistema", label: "Sistema", desc: "Respaldo" }
  ];
  const completado = (id) => {
    if (id === "conexion") return !!(estado && estado.credenciales && estado.sol);
    if (id === "empresa") return !!(emp && emp.ruc && emp.razon_social);
    return (sales?.length || 0) + (purchases?.length || 0) > 0;
  };

  // ── Panel de estado ──
  const renderEstado = () => {
    if (testing) {
      return (
        <div className="mb-5 px-4 py-3.5 rounded-2xl bg-slate-50 flex items-center gap-2.5">
          <Loader2 size={20} className="animate-spin text-slate-400" />
          <span className="text-sm font-bold text-slate-900">Verificando conexión con SUNAT...</span>
        </div>
      );
    }
    if (!estado) {
      return (
        <div className="mb-5 px-4 py-3.5 rounded-2xl bg-slate-50 flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />
          <span className="text-sm font-bold text-slate-900">Sin verificar</span>
          <span className="text-[13px] text-slate-600">Pulsa «Probar conexión».</span>
        </div>
      );
    }
    const todoOk = estado.sunat && estado.credenciales && estado.sol && !!(estado.login && estado.login.ok);
    const hora = estado.hora ? estado.hora.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
    return (
      <div className="mb-5 p-4 rounded-2xl bg-slate-50">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className={todoOk ? "w-2.5 h-2.5 rounded-full bg-green-600 shrink-0" : "w-2.5 h-2.5 rounded-full bg-red-700 shrink-0"} />
          <span className="text-[15px] font-extrabold text-slate-900">{todoOk ? "Conectado" : "Sin conexión completa"}</span>
          {hora && <span className="text-xs text-slate-400 ml-auto">Verificado a las {hora}</span>}
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <FilaEstado ok={estado.sunat} titulo={estado.sunat ? "SUNAT responde" : "SUNAT no responde"} detalle={estado.url} />
          <FilaEstado
            ok={estado.credenciales}
            titulo={estado.credenciales ? "Credenciales completas" : "Credenciales incompletas"}
            detalle={estado.credenciales ? "" : "Falta el nombre de la aplicación, el Id o la Clave."} />
          <FilaEstado
            ok={estado.sol}
            titulo={estado.sol ? "Acceso SOL completo" : "Acceso SOL incompleto"}
            detalle={estado.sol ? "RUC " + estado.solRuc + " · usuario " + estado.solUsuario : "Falta el RUC (11 dígitos), el usuario SOL o la Clave SOL."} />
          <FilaEstado
            ok={estado.login ? estado.login.ok : null}
            titulo={estado.login ? (estado.login.ok ? "Inicio de sesión en SUNAT correcto" : "SUNAT no aceptó el acceso") : "Acceso a SUNAT sin probar"}
            detalle={estado.login ? estado.login.texto : "Pulsa «Probar conexión» para validar RUC, usuario SOL, Clave SOL, Id y Clave."} />
        </div>
        <div className="mt-3.5 pt-3.5 border-t border-slate-200">
          <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-2">Consulta RUC / DNI</div>
          <div className="flex flex-col gap-2">
            <FilaEstado ok={estado.jsonpe} titulo={estado.jsonpe ? "api.json.pe responde" : "api.json.pe no responde"} detalle={estado.jsonpeUrl} />
            <FilaEstado
              ok={estado.jsonpeToken}
              titulo={estado.jsonpeToken ? "Token cargado" : "Falta el token"}
              detalle={estado.jsonpeToken ? "" : "Ingresa el Bearer token de api.json.pe."} />
          </div>
        </div>
        {estado.login && estado.login.falta && (
          <details className="mt-3.5 pt-3.5 border-t border-slate-200" open>
            <summary className="cursor-pointer text-[13px] font-bold text-slate-900">
              Crear la función «sunatToken» (una sola vez)
            </summary>
            <ol className="mt-2 text-xs text-slate-600 leading-relaxed list-decimal pl-5">
              <li>En tu repositorio de funciones de servidor crea una función con el nombre <strong>sunatToken</strong>.</li>
              <li>Pega este código y despliégala.</li>
              <li>Vuelve aquí y pulsa <strong>Probar conexión</strong>.</li>
            </ol>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={copiarCodigo} className={CLS_BTN_SECONDARY}>
                <Copy size={16} /> {codigoCopiado ? "¡Copiado!" : "Copiar código"}
              </button>
            </div>
            <pre className="mt-2 p-3 rounded-lg bg-slate-900 text-slate-100 text-[11px] leading-relaxed overflow-x-auto max-h-72">{CODIGO_FUNCION_SUNAT}</pre>
          </details>
        )}
      </div>
    );
  };

  // ── Pestaña 1: Conexión ──
  const renderConexion = () => (
    <div className={CLS_CARD}>
      <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
        <KeyRound size={20} /> Credenciales de SUNAT
      </h2>
      <p className="text-xs text-slate-600 leading-relaxed mt-1 mb-5">
        Datos de la aplicación registrada en SUNAT: Menú SOL → Empresas → Credenciales de API SUNAT.
      </p>

      {renderEstado()}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <Campo label="Nombre de la aplicación">
          <input className={CLS_INPUT} value={conn.app_nombre} onChange={(e) => setC("app_nombre", e.target.value)} placeholder="SIST_FACT E" />
        </Campo>
        <Campo label="URL de SUNAT" ayuda="Dirección de SUNAT contra la que se verifica la conexión.">
          <input className={CLS_INPUT + " font-mono"} value={conn.app_url} onChange={(e) => setC("app_url", e.target.value)} placeholder={SUNAT_URL} />
        </Campo>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-3.5">
        <Campo label="Id (client_id)">
          <input className={CLS_INPUT + " font-mono"} value={conn.client_id} onChange={(e) => setC("client_id", e.target.value)} placeholder="Id que entrega SUNAT" autoComplete="off" />
        </Campo>
        <Campo label="Clave (client_secret)">
          <input type="password" className={CLS_INPUT + " font-mono"} value={conn.client_secret} onChange={(e) => setC("client_secret", e.target.value)} placeholder="Clave que entrega SUNAT" autoComplete="off" />
        </Campo>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-5 pt-5 border-t border-slate-100">
        <Campo label="RUC">
          <input
            className={CLS_INPUT + " font-mono"}
            value={conn.ruc}
            onChange={(e) => setC("ruc", e.target.value.replace(/\D/g, ""))}
            maxLength={11}
            inputMode="numeric"
            placeholder="20607827410"
            autoComplete="off" />
        </Campo>
        <Campo label="Usuario SOL">
          <input className={CLS_INPUT + " font-mono"} value={conn.usuario_sol} onChange={(e) => setC("usuario_sol", e.target.value)} placeholder="Usuario SOL" autoComplete="off" />
        </Campo>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-3.5">
        <Campo label="Clave SOL" ayuda="Se guarda solo en este navegador.">
          <input type="password" className={CLS_INPUT + " font-mono"} value={conn.clave_sol} onChange={(e) => setC("clave_sol", e.target.value)} placeholder="Clave SOL" autoComplete="new-password" />
        </Campo>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-5 pt-5 border-t border-slate-100">
        <Campo label="URL de api.json.pe (consulta RUC / DNI)" ayuda="Dirección contra la que se verifica la conexión.">
          <input className={CLS_INPUT + " font-mono"} value={conn.jsonpe_url} onChange={(e) => setC("jsonpe_url", e.target.value)} placeholder={JSONPE_URL} />
        </Campo>
        <Campo label="Token de api.json.pe" ayuda="Se usa para autocompletar clientes y proveedores desde SUNAT y RENIEC.">
          <input type="password" className={CLS_INPUT + " font-mono"} value={conn.jsonpe_token} onChange={(e) => setC("jsonpe_token", e.target.value)} placeholder="Bearer token de api.json.pe" autoComplete="off" />
        </Campo>
      </div>

      <Aviso msg={msgConexion} />

      <div className="flex items-center gap-2 flex-wrap mt-5">
        <button type="button" onClick={guardarConexion} className={CLS_BTN_PRIMARY}>
          <Save size={16} /> Guardar
        </button>
        <button type="button" onClick={() => probar(true)} disabled={testing} className={CLS_BTN_SECONDARY}>
          {testing ? <Loader2 size={16} className="animate-spin" /> : <PlugZap size={16} />}
          {testing ? "Probando..." : "Probar conexión"}
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-green-600">
            <CheckCircle2 size={16} /> Guardado
          </span>
        )}
      </div>
    </div>
  );

  // ── Pestaña 2: Mi empresa ──
  const renderEmpresa = () => {
    const e = emp || {};
    const razon = e.razon_social || e.nombre_comercial || "Mi empresa";
    return (
      <div className="space-y-4">
        <div className={CLS_CARD}>
          <div className="flex items-center gap-4 flex-wrap">
            {e.logo
              ? <img src={e.logo} alt="Logo" className="w-16 h-16 rounded-2xl object-contain bg-slate-50 shrink-0" />
              : <span className="w-16 h-16 rounded-2xl bg-slate-50 text-slate-400 flex items-center justify-center shrink-0"><Building2 size={28} /></span>}
            <div className="flex-1 min-w-[12rem]">
              <div className="font-extrabold text-[17px] text-slate-900 tracking-tight leading-snug">{razon}</div>
              <div className="font-mono text-xs text-slate-500 mt-0.5">RUC {e.ruc || "—"}</div>
              <div className="flex gap-1.5 flex-wrap mt-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-50 text-slate-600">
                  <span className={e.entorno === "production" ? "w-1.5 h-1.5 rounded-full bg-green-600" : "w-1.5 h-1.5 rounded-full bg-slate-400"} />
                  {e.entorno === "production" ? "Producción" : "Beta / pruebas"}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className={CLS_CARD}>
          <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
            <Building2 size={20} /> Datos de la empresa
          </h2>
          <p className="text-xs text-slate-500 mt-1 mb-5">Se guardan en la configuración del sistema y salen impresos en los comprobantes.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Campo label="RUC">
              <input className={CLS_INPUT + " font-mono"} value={e.ruc || ""} onChange={(ev) => setE("ruc", ev.target.value.replace(/\D/g, ""))} maxLength={11} inputMode="numeric" />
            </Campo>
            <Campo label="Nombre comercial">
              <input className={CLS_INPUT} value={e.nombre_comercial || ""} onChange={(ev) => setE("nombre_comercial", ev.target.value)} />
            </Campo>
          </div>
          <div className="mt-3.5">
            <Campo label="Razón social">
              <input className={CLS_INPUT} value={e.razon_social || ""} onChange={(ev) => setE("razon_social", ev.target.value)} />
            </Campo>
          </div>
          <div className="mt-3.5">
            <Campo label="Dirección fiscal">
              <input className={CLS_INPUT} value={e.direccion || ""} onChange={(ev) => setE("direccion", ev.target.value)} />
            </Campo>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mt-3.5">
            <Campo label="Ubigeo">
              <input className={CLS_INPUT + " font-mono"} value={e.ubigeo || ""} onChange={(ev) => setE("ubigeo", ev.target.value)} maxLength={6} placeholder="150101" />
            </Campo>
            <Campo label="Departamento">
              <input className={CLS_INPUT} value={e.departamento || ""} onChange={(ev) => setE("departamento", ev.target.value)} />
            </Campo>
            <Campo label="Provincia">
              <input className={CLS_INPUT} value={e.provincia || ""} onChange={(ev) => setE("provincia", ev.target.value)} />
            </Campo>
            <Campo label="Distrito">
              <input className={CLS_INPUT} value={e.distrito || ""} onChange={(ev) => setE("distrito", ev.target.value)} />
            </Campo>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-3.5">
            <Campo label="Teléfonos" ayuda="Separa varios con comas.">
              <input className={CLS_INPUT} value={e.telefonos || ""} onChange={(ev) => setE("telefonos", ev.target.value)} placeholder="+51 999 888 777" />
            </Campo>
            <Campo label="Correos" ayuda="Separa varios con comas.">
              <input className={CLS_INPUT} value={e.emails || ""} onChange={(ev) => setE("emails", ev.target.value)} placeholder="ventas@miempresa.pe" />
            </Campo>
          </div>

          <div className="mt-3.5">
            <Campo label="Mensaje de agradecimiento" ayuda="Se imprime al pie de los comprobantes.">
              <input className={CLS_INPUT} value={e.mensaje || ""} onChange={(ev) => setE("mensaje", ev.target.value)} placeholder="Gracias por su compra" />
            </Campo>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-3.5">
            <Campo label="Webhook" ayuda="Aquí se avisan los cambios de estado.">
              <input className={CLS_INPUT} value={e.webhook || ""} onChange={(ev) => setE("webhook", ev.target.value)} placeholder="https://miempresa.pe/sunat-webhook" />
            </Campo>
            <Campo label="Entorno" ayuda="En producción los comprobantes son reales ante SUNAT.">
              <select className={CLS_INPUT} value={e.entorno === "production" ? "production" : "beta"} onChange={(ev) => setE("entorno", ev.target.value)}>
                <option value="beta">Beta (pruebas)</option>
                <option value="production">Producción</option>
              </select>
            </Campo>
          </div>

          <Aviso msg={msgEmpresa} />

          <div className="flex gap-2 flex-wrap mt-5">
            <button type="button" onClick={guardarEmpresa} disabled={guardandoEmp} className={CLS_BTN_PRIMARY}>
              {guardandoEmp ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {guardandoEmp ? "Guardando..." : "Guardar cambios"}
            </button>
            <button type="button" onClick={descartarEmpresa} className={CLS_BTN_SECONDARY}>
              <RefreshCw size={16} /> Descartar y recargar
            </button>
          </div>
        </div>

        <div className={CLS_CARD}>
          <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
            <Upload size={20} /> Logo
          </h2>
          <p className="text-xs text-slate-500 mt-1 mb-4">Aparece en tus comprobantes. PNG o JPG.</p>
          <div className="flex items-center gap-4 flex-wrap">
            {e.logo
              ? <img src={e.logo} alt="Logo actual" className="w-[5.5rem] h-[5.5rem] rounded-2xl object-contain bg-slate-50 shrink-0" />
              : <span className="w-[5.5rem] h-[5.5rem] rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center shrink-0 text-[10px] font-bold">Sin logo</span>}
            <div className="flex-1 min-w-[12rem]">
              <label className={CLS_BTN_SECONDARY + " cursor-pointer"}>
                {subiendoLogo ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {subiendoLogo ? "Subiendo..." : (e.logo ? "Cambiar logo" : "Subir logo")}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  disabled={subiendoLogo}
                  onChange={(ev) => { subirLogo(ev.target.files && ev.target.files[0]); ev.target.value = ""; }} />
              </label>
              <p className="text-xs text-slate-400 mt-2">Recomendado: cuadrado, fondo transparente, máximo 1 MB.</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Pestaña 3: Sistema ──
  const renderSistema = () => {
    const conteos = [
      ["ventas", sales?.length || 0],
      ["compras", purchases?.length || 0],
      ["gastos", expenses?.length || 0],
      ["períodos SIRE", sirePeriods?.length || 0]
    ];
    return (
      <div className={CLS_CARD}>
        <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
          <Download size={20} /> Respaldo de datos
        </h2>
        <p className="text-xs text-slate-600 leading-relaxed mt-1">
          Exporta un JSON con las ventas, compras, gastos, períodos SIRE y la configuración de la empresa.
          Nunca incluye claves ni tokens. Es solo lectura: no modifica ni borra nada.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          {conteos.map(([nombre, cant]) => (
            <div key={nombre} className="px-3 py-2 bg-slate-50 rounded-lg">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{nombre}</div>
              <div className="font-extrabold text-lg text-slate-900">{cant}</div>
            </div>
          ))}
        </div>
        <Aviso msg={msgDatos} />
        <div className="flex gap-2 flex-wrap mt-4">
          <button type="button" onClick={exportarRespaldo} className={CLS_BTN_SECONDARY}>
            <Download size={16} /> Exportar JSON
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      <nav className="flex gap-2 overflow-x-auto mb-5" role="tablist" aria-label="Secciones de conexión">
        {PASOS.map((p, i) => {
          const activa = tab === p.id;
          const hecho = completado(p.id);
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => setTab(p.id)}
              className={
                activa
                  ? "flex items-center gap-2.5 flex-1 min-w-0 px-3.5 py-2.5 text-left rounded-xl bg-white shadow-md"
                  : "flex items-center gap-2.5 flex-1 min-w-0 px-3.5 py-2.5 text-left rounded-xl bg-transparent hover:bg-slate-100"}>
              <span
                className={
                  activa
                    ? "shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-extrabold bg-blue-600 text-white"
                    : hecho
                      ? "shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-extrabold bg-blue-100 text-blue-600"
                      : "shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-extrabold bg-slate-200 text-slate-500"}>
                {hecho && !activa ? <CheckCircle2 size={14} /> : i + 1}
              </span>
              <span className="min-w-0 flex flex-col">
                <span className={activa ? "text-[13px] font-bold text-slate-900 truncate" : "text-[13px] font-bold text-slate-500 truncate"}>{p.label}</span>
                <span className="hidden sm:block text-[11px] font-medium text-slate-400 truncate">{p.desc}</span>
              </span>
            </button>);

        })}
      </nav>
      {tab === "conexion" ? renderConexion() : tab === "empresa" ? renderEmpresa() : renderSistema()}
    </div>);

}

export default function Sire() {
  const [activeSection, setActiveSection] = useState("resumen");
  const today = new Date();
  const [selectedPeriod, setSelectedPeriod] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  );

  const { data: sales = [] } = useQuery({ queryKey: ["sales"], queryFn: () => api.entities.Sale.list("-created_date", 500) });
  const { data: purchases = [] } = useQuery({ queryKey: ["purchases"], queryFn: () => api.entities.Purchase.list("-created_date", 500) });
  const { data: expenses = [] } = useQuery({ queryKey: ["expenses"], queryFn: () => api.entities.Expense.list() });
  const { data: sirePeriods = [] } = useQuery({ queryKey: ["sire_periods"], queryFn: () => api.entities.SirePeriod.list("-created_date", 200) });
  const { data: configRows = [] } = useQuery({
    queryKey: ["system-config"],
    queryFn: async () => {
      try {
        const rows = (await api.entities.SystemConfig?.list?.()) || [];
        return Object.fromEntries(rows.map((r) => [r.key, r.value]));
      } catch {return {};}
    }
  });

  const ruc = configRows.ruc || configRows.sunat_ruc || "";
  const companyName = configRows.company_name || configRows.sunat_razon_social || "";

  const periods = useMemo(() => {
    const set = new Set();
    sales.forEach((s) => s.date && set.add(s.date.slice(0, 7)));
    purchases.forEach((p) => p.date && set.add(p.date.slice(0, 7)));
    set.add(selectedPeriod);
    return [...set].sort().reverse().slice(0, 24);
  }, [sales, purchases, selectedPeriod]);

  const periodLabel = useMemo(() => {
    const [y, m] = selectedPeriod.split("-");
    return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("es-PE", { month: "long", year: "numeric" });
  }, [selectedPeriod]);

  const rvieSales = useMemo(() => sales.filter((s) => {
    const vt = (s.voucher_type || "").toLowerCase();
    return !RVIE_EXCLUDED_VOUCHER_TYPES.includes(vt) && s.date?.startsWith(selectedPeriod);
  }), [sales, selectedPeriod]);

  const rcePurchases = useMemo(() => purchases.filter((p) => p.date?.startsWith(selectedPeriod)), [purchases, selectedPeriod]);

  const renderSection = () => {
    switch (activeSection) {
      case "resumen":
        return <SireResumen sales={sales} purchases={purchases} expenses={expenses} sirePeriods={sirePeriods} selectedPeriod={selectedPeriod} ruc={ruc} companyName={companyName} />;
      case "rvie":
        return <RvieSection sales={sales} rvieSales={rvieSales} selectedPeriod={selectedPeriod} periodLabel={periodLabel} ruc={ruc} sirePeriods={sirePeriods} />;
      case "rce":
        return <RceSection purchases={purchases} rcePurchases={rcePurchases} expenses={expenses} selectedPeriod={selectedPeriod} periodLabel={periodLabel} ruc={ruc} sirePeriods={sirePeriods} />;
      case "archivos":
        return <SireArchivos sales={sales} purchases={purchases} selectedPeriod={selectedPeriod} ruc={ruc} periodLabel={periodLabel} />;
      case "validacion":
        return <SireValidacion rvieSales={rvieSales} rcePurchases={rcePurchases} selectedPeriod={selectedPeriod} periodLabel={periodLabel} />;
      case "envios":
        return <SireEnvios sirePeriods={sirePeriods} selectedPeriod={selectedPeriod} periodLabel={periodLabel} />;
      case "periodos":
        return <SirePeriodos sirePeriods={sirePeriods} sales={sales} purchases={purchases} />;
      case "config":
        return <SireConfigTributaria configRows={configRows} />;
      case "conexion":
        return <SireConexionSunat configRows={configRows} rucSistema={ruc} sales={sales} purchases={purchases} expenses={expenses} sirePeriods={sirePeriods} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="relative overflow-hidden" style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #1e40af 50%, #1e3a8a 100%)" }}>
        
        <div className="relative px-6 md:px-8 pt-8 pb-6 text-gray-950 bg-gray-950">
          <div className="flex items-center gap-4 mb-2">
            

            
            <div>
              <h1 className="font-black text-white uppercase tracking-tight [font-family:'Abril_Fatface',_system-ui] text-4xl md:text-5xl">SIRE</h1>
              <p className="text-blue-100 text-sm mt-0.5">Sistema Integrado de Registros Electrónicos · RVIE + RCE</p>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {ruc && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white/10 text-blue-100 border border-white/20"><Building2 size={12} /> RUC: {ruc}</span>}
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">🌿 IGV 0% — Ley Amazonía</span>
          </div>
        </div>
        <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #3b82f6, #1e40af, #6366f1)" }} />
      </div>

      {/* Content */}
      <div className="p-4 md:p-6 space-y-4">
        {/* Top bar: período + navegación horizontal */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-100 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">Período:</label>
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger className="h-9 text-sm w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {periods.map((p) => {
                    const [y, m] = p.split("-");
                    const label = new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("es-PE", { month: "long", year: "numeric" });
                    return <SelectItem key={p} value={p} className="text-sm">{label.charAt(0).toUpperCase() + label.slice(1)}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          <nav className="flex items-center gap-1 px-2 py-2 overflow-x-auto">
            {NAV_SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                  isActive ? "text-white shadow-md" : "text-slate-600 hover:bg-slate-50"}`
                  }
                  style={isActive ? { background: `linear-gradient(135deg, ${section.color}dd, ${section.color})` } : {}}>
                  
                  <Icon size={16} style={{ color: isActive ? "white" : section.color }} />
                  <span>{section.label}</span>
                  {section.subtabs &&
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-400"}`}>
                      {section.subtabs.length}
                    </span>
                  }
                </button>);

            })}
          </nav>
        </div>

        {/* Main content */}
        <div className="min-w-0">
          {renderSection()}
        </div>
      </div>
    </div>);

}

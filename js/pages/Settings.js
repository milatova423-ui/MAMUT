var App = window.App || (window.App = {});

/**
 * Configuración en tres pasos:
 *   1. Conexión  — credenciales de la aplicación registrada en SUNAT (Menú SOL):
 *                  nombre, URL de SUNAT, Id y Clave, más el acceso con RUC,
 *                  usuario SOL y Clave SOL. Muestra el ESTADO de la conexión
 *                  (SUNAT alcanzable, credenciales, acceso SOL, API de facturación).
 *   2. Mi empresa — datos reales traídos de GET /empresa, editables con
 *      PUT /empresa, más logo (POST /empresa/logo) y certificado
 *      (POST /empresa/certificado).
 *   3. Sistema   — rubro (identidad visual), respaldo y borrado de datos.
 */
(function () {
  // Paleta sobria: superficies neutras y el primario solo donde es la marca
  // del sistema (pestaña activa y botón principal). El verde y el rojo se
  // reservan para el icono de los avisos, nunca para pintar bloques enteros.
  var PRIMARIO = 'rgb(37 99 235)';
  var SUPERFICIE = 'rgb(248 250 252)';
  var TEXTO = 'rgb(15 23 42)';
  var TEXTO2 = 'rgb(71 85 105)';
  var TENUE = 'rgb(148 163 184)';
  var OK = 'rgb(22 163 74)';
  var ERROR = 'rgb(190 40 40)';

  // URL de SUNAT (servidor de seguridad / token de la API SUNAT)
  var SUNAT_URL = 'https://api-seguridad.sunat.gob.pe/v1';

  // URL de api.json.pe (consulta RUC / DNI)
  var JSONPE_URL = 'https://api.json.pe';

  var TABS = [
    { id: 'conexion', label: 'Conexión', desc: 'Credenciales de SUNAT' },
    { id: 'empresa', label: 'Mi empresa', desc: 'Datos, logo y certificado' },
    { id: 'sistema', label: 'Sistema', desc: 'Catálogo y respaldo' },
  ];

  var REGIMENES = {
    general: 'Régimen General (IGV 18%)',
    mype: 'Régimen MYPE',
    mype_restaurantes: 'MYPE Restaurantes (Ley 31556)',
    nrus: 'Nuevo RUS (solo boletas)',
    especial: 'Régimen Especial',
  };

  /** Une un valor que la API puede devolver como texto o como arreglo. */
  function unir(valor) {
    if (Array.isArray(valor)) return valor.filter(Boolean).join(', ');
    return valor == null ? '' : String(valor);
  }

  /** Separa "a, b" en ["a","b"] para los campos que la API espera como arreglo. */
  function partir(texto) {
    return String(texto || '')
      .split(',')
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
  }

  function primero(obj, claves) {
    for (var i = 0; i < claves.length; i++) {
      var v = obj[claves[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return '';
  }

  App.Settings = class Settings {
    constructor() {
      this.container = null;
      this.router = null;
      this.tab = 'conexion';

      // Conexión
      this.config = App.getConfig();
      this.sunat = App.api.getCredencialesSunat(); // { app_nombre, app_url, client_id, client_secret }
      // La URL debe ser la de SUNAT: si estaba vacía o apuntaba a otro sitio, se corrige
      if (!/sunat\.gob\.pe/i.test(String(this.sunat.app_url || ''))) {
        this.sunat.app_url = SUNAT_URL;
      }
      this.saved = false;
      this.testing = false;
      this.testResult = null;
      this.msgConexion = null;

      // Estado de la conexión: null = sin verificar
      // { sunat: bool, credenciales: bool, api: bool, apiError: string, url: string, hora: Date }
      this.estadoConexion = null;

      // Empresa (API)
      this.empresa = null;
      this.cargandoEmpresa = false;
      this.errorEmpresa = null;
      this.guardandoEmpresa = false;
      this.msgEmpresa = null;
      this.subiendo = null; // 'logo' | 'certificado'

      // Sistema
      this.datosMsg = null;
      this.negocioMsg = null;
      this.borrarMsg = null;
    }

    render(container, router) {
      this.container = container;
      this.router = router;
      this._renderHTML();
      this._bind();
      if (App.isConfigured()) this._cargarEmpresa();
      // Al abrir se verifica lo básico. El inicio de sesión real en SUNAT NO se
      // dispara solo: se hace al pulsar «Probar conexión» o «Guardar», para no
      // acumular intentos con una Clave SOL que quizá aún esté mal escrita.
      this._probar(false);
    }

    _rerender() {
      this._renderHTML();
      this._bind();
    }

    // ═══ Estructura ═══════════════════════════════════════════
    _renderHTML() {
      var self = this;

      this.container.innerHTML = ''
        + '<div>'
          + '<h1 class="page-title" style="margin-bottom: 1.25rem;">'
            + '<i data-lucide="settings" class="w-7 h-7"></i> Configuración'
          + '</h1>'

          + this._navHTML()

          + '<div style="margin-top: 1.25rem;">'
            + (this.tab === 'conexion' ? this._tabConexionHTML()
              : this.tab === 'empresa' ? this._tabEmpresaHTML()
              : this._tabSistemaHTML())
          + '</div>'

          + this._estilosHTML()
        + '</div>';

      App.refreshIcons();
    }

    /** ¿Ese paso ya está resuelto? Se marca con un check en la navegación. */
    _completado(id) {
      if (id === 'conexion') return App.api.credencialesSunatConfiguradas() || App.isConfigured();
      if (id === 'empresa') return !!this.empresa;
      return App.DB.all('productos').length > 0;
    }

    /**
     * Navegación en forma de pasos: número, título y subtítulo. El paso activo
     * se levanta sobre fondo blanco y el ya resuelto muestra un check. Sin
     * color: la jerarquía la dan el contraste y la sombra.
     */
    _navHTML() {
      var self = this;
      return '<nav class="cfg-nav" role="tablist" aria-label="Secciones de configuración">'
        + TABS.map(function (t, i) {
          var activa = self.tab === t.id;
          var hecho = self._completado(t.id);
          return '<button type="button" role="tab" aria-selected="' + activa + '"'
            + ' class="cfg-nav-item' + (activa ? ' is-active' : '') + (hecho ? ' is-done' : '') + '" data-tab="' + t.id + '">'
            + '<span class="cfg-nav-num" aria-hidden="true">'
              + (hecho && !activa
                ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="width: 0.75rem; height: 0.75rem;"><polyline points="20 6 9 17 4 12"></polyline></svg>'
                : (i + 1))
            + '</span>'
            + '<span class="cfg-nav-txt">'
              + '<span class="cfg-nav-label">' + t.label + '</span>'
              + '<span class="cfg-nav-desc">' + t.desc + '</span>'
            + '</span>'
            + '</button>';
        }).join('')
        + '</nav>';
    }

    /**
     * Rejillas de la pantalla. Todo arranca en una columna (móvil) y va
     * abriéndose para aprovechar el ancho completo en pantallas grandes:
     * la página ya no lleva max-width propio, usa el del contenedor general.
     */
    _estilosHTML() {
      return '<style>'
        // ─── Navegación por pasos ─────────────────────────────
        // Sin bandeja de fondo: los pasos van directos sobre la página
        + '.cfg-nav { display: flex; gap: 0.5rem; overflow-x: auto; scrollbar-width: none; }'
        + '.cfg-nav::-webkit-scrollbar { display: none; }'
        + '.cfg-nav-item { display: flex; align-items: center; gap: 0.625rem; flex: 1 1 0; min-width: 0;'
          + ' padding: 0.7rem 0.875rem; text-align: left; background: transparent; border: none;'
          + ' border-radius: 0.75rem; cursor: pointer; transition: background-color 0.16s, box-shadow 0.16s; }'
        + '.cfg-nav-item:hover:not(.is-active) { background: rgb(241 245 249); }'
        + '.cfg-nav-item:focus-visible { outline: none; box-shadow: 0 0 0 3px rgb(59 130 246 / 0.25); }'
        + '.cfg-nav-item.is-active { background: white; box-shadow: 0 1px 2px rgb(15 23 42 / 0.05), 0 6px 16px -6px rgb(15 23 42 / 0.18); }'

        // Los círculos de paso llevan el primario del proyecto
        + '.cfg-nav-num { flex-shrink: 0; width: 1.75rem; height: 1.75rem; border-radius: 9999px;'
          + ' display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800;'
          + ' background: rgb(226 232 240); color: rgb(100 116 139); transition: background-color 0.16s, color 0.16s; }'
        + '.cfg-nav-item:hover:not(.is-active) .cfg-nav-num { background: rgb(203 213 225); }'
        + '.cfg-nav-item.is-done .cfg-nav-num { background: rgb(219 234 254); color: ' + PRIMARIO + '; }'
        + '.cfg-nav-item.is-active .cfg-nav-num { background: ' + PRIMARIO + '; color: white;'
          + ' box-shadow: 0 2px 8px -2px rgb(37 99 235 / 0.5); }'

        + '.cfg-nav-txt { min-width: 0; display: flex; flex-direction: column; }'
        + '.cfg-nav-label { font-size: 0.8125rem; font-weight: 700; color: rgb(100 116 139); white-space: nowrap;'
          + ' overflow: hidden; text-overflow: ellipsis; transition: color 0.16s; }'
        + '.cfg-nav-item.is-active .cfg-nav-label { color: rgb(15 23 42); }'
        + '.cfg-nav-desc { font-size: 11px; font-weight: 500; color: rgb(148 163 184); white-space: nowrap;'
          + ' overflow: hidden; text-overflow: ellipsis; margin-top: 0.05rem; }'
        + '@media (max-width: 720px) { .cfg-nav-desc { display: none; } .cfg-nav-item { padding: 0.6rem 0.75rem; } }'
        + '@media (prefers-reduced-motion: reduce) { .cfg-nav-item, .cfg-nav-num, .cfg-nav-label { transition: none; } }'

        // Dos tarjetas de igual peso
        + '.cfg-duo { display: grid; grid-template-columns: 1fr; gap: 1rem; align-items: start; }'
        // Campos dentro de una tarjeta
        + '.cfg-grid { display: grid; grid-template-columns: 1fr; gap: 0.875rem; }'
        + '.cfg-grid-4 { display: grid; grid-template-columns: 1fr; gap: 0.875rem; }'
        + '.cfg-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }'
        + '.cfg-conteos { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }'
        + '.cfg-acciones { display: flex; gap: 0.5rem; flex-wrap: wrap; }'
        + '.cfg-perfil { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }'

        + '@media (min-width: 640px) {'
          + '.cfg-grid { grid-template-columns: repeat(2, 1fr); }'
          + '.cfg-grid-4 { grid-template-columns: repeat(2, 1fr); }'
          + '.cfg-stats { grid-template-columns: repeat(5, 1fr); }'
          + '.cfg-conteos { grid-template-columns: repeat(3, 1fr); }'
        + '}'
        + '@media (min-width: 1024px) {'
          + '.cfg-duo { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem; }'
          + '.cfg-grid-4 { grid-template-columns: repeat(4, 1fr); }'
        + '}'
        + '</style>';
    }

    _msgHTML(msg) {
      if (!msg) return '';
      var ok = msg.tipo === 'ok';
      return '<div style="margin-top: 1rem; padding: 0.75rem 0.875rem; border-radius: 0.75rem; font-size: 0.8125rem; font-weight: 600;'
        + ' display: flex; align-items: center; gap: 0.5rem; background: ' + SUPERFICIE + '; color: ' + (ok ? TEXTO2 : ERROR) + ';">'
        + '<i data-lucide="' + (ok ? 'check-circle-2' : 'alert-circle') + '" class="w-4 h-4" style="color: ' + (ok ? OK : ERROR) + '; flex-shrink: 0;"></i> '
        + App.escapeHtml(msg.texto)
        + '</div>';
    }

    _campo(label, inputHTML, ayuda) {
      return '<div>'
        + '<label class="label">' + label + '</label>'
        + inputHTML
        + (ayuda ? '<p class="text-xs" style="color: rgb(100 116 139); margin-top: 0.25rem;">' + ayuda + '</p>' : '')
        + '</div>';
    }

    // ═══ 1. Conexión (SUNAT) ══════════════════════════════════
    _urlSunat() {
      return String(this.sunat.app_url || '').trim() || SUNAT_URL;
    }

    _urlJsonpe() {
      return String(this.config.jsonpe_url || '').trim() || JSONPE_URL;
    }

    /**
     * Panel de estado: dice si HAY o NO conexión. Tres comprobaciones:
     *   - SUNAT alcanzable (la URL responde desde este navegador)
     *   - Credenciales SUNAT completas (nombre, Id y Clave)
     *   - API de facturación (GET /empresa responde con las credenciales guardadas)
     */
    _estadoConexionHTML() {
      var est = this.estadoConexion;

      function fila(ok, titulo, detalle) {
        return '<div style="display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.8125rem; line-height: 1.5;">'
          + '<i data-lucide="' + (ok === null ? 'circle-dashed' : ok ? 'check-circle-2' : 'x-circle') + '" class="w-4 h-4" style="color: ' + (ok === null ? TENUE : ok ? OK : ERROR) + '; flex-shrink: 0; margin-top: 0.15rem;"></i>'
          + '<div style="min-width: 0;">'
            + '<strong style="color: ' + TEXTO + ';">' + titulo + '</strong>'
            + (detalle ? '<div style="color: ' + TEXTO2 + '; word-break: break-word;">' + App.escapeHtml(detalle) + '</div>' : '')
          + '</div>'
        + '</div>';
      }

      // Probando
      if (this.testing) {
        return '<div style="margin-bottom: 1.25rem; padding: 0.875rem 1rem; border-radius: 0.875rem; background: ' + SUPERFICIE + '; display: flex; align-items: center; gap: 0.625rem;">'
          + '<i data-lucide="loader-2" class="w-5 h-5 icon-spin" style="color: ' + TENUE + ';"></i>'
          + '<span style="font-size: 0.875rem; font-weight: 700; color: ' + TEXTO + ';">Verificando conexión con SUNAT...</span>'
        + '</div>';
      }

      // Aún sin verificar
      if (!est) {
        return '<div style="margin-bottom: 1.25rem; padding: 0.875rem 1rem; border-radius: 0.875rem; background: ' + SUPERFICIE + '; display: flex; align-items: center; gap: 0.625rem;">'
          + '<span style="width: 0.6rem; height: 0.6rem; border-radius: 9999px; background: ' + TENUE + '; flex-shrink: 0;"></span>'
          + '<span style="font-size: 0.875rem; font-weight: 700; color: ' + TEXTO + ';">Sin verificar</span>'
          + '<span style="font-size: 0.8125rem; color: ' + TEXTO2 + ';">Pulsa «Probar conexión».</span>'
        + '</div>';
      }

      var todoOk = est.sunat && est.credenciales && est.sol && !!(est.login && est.login.ok) && est.api;
      var hora = est.hora ? est.hora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

      return '<div style="margin-bottom: 1.25rem; padding: 1rem; border-radius: 0.875rem; background: ' + SUPERFICIE + ';">'
        + '<div style="display: flex; align-items: center; gap: 0.625rem; flex-wrap: wrap;">'
          + '<span style="width: 0.6rem; height: 0.6rem; border-radius: 9999px; background: ' + (todoOk ? OK : ERROR) + '; flex-shrink: 0;"></span>'
          + '<span style="font-size: 0.9375rem; font-weight: 800; color: ' + TEXTO + ';">'
            + (todoOk ? 'Conectado' : 'Sin conexión completa')
          + '</span>'
          + (hora ? '<span style="font-size: 0.75rem; color: ' + TENUE + '; margin-left: auto;">Verificado a las ' + hora + '</span>' : '')
        + '</div>'
        + '<div style="margin-top: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem;">'
          + fila(est.sunat, est.sunat ? 'SUNAT responde' : 'SUNAT no responde', est.url)
          + fila(est.credenciales, est.credenciales ? 'Credenciales completas' : 'Credenciales incompletas',
              est.credenciales ? '' : 'Falta el nombre de la aplicación, el Id o la Clave.')
          + fila(est.sol, est.sol ? 'Acceso SOL completo' : 'Acceso SOL incompleto',
              est.sol ? 'RUC ' + est.solRuc + ' · usuario ' + est.solUsuario : 'Falta el RUC (11 dígitos), el usuario SOL o la Clave SOL.')
          + fila(est.login ? est.login.ok : null,
              est.login ? (est.login.ok ? 'Inicio de sesión en SUNAT correcto' : 'SUNAT no aceptó el acceso') : 'Acceso a SUNAT sin probar',
              est.login ? est.login.texto : 'Pulsa «Probar conexión» para validar RUC, usuario SOL, Clave SOL, Id y Clave.')
          + fila(est.api, est.api ? 'API de facturación conectada' : 'API de facturación sin conexión',
              est.api ? '' : est.apiError)
        + '</div>'
        + '<div style="margin-top: 0.875rem; padding-top: 0.875rem; border-top: 1px solid rgb(226 232 240);">'
          + '<div style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: ' + TENUE + '; margin-bottom: 0.5rem;">Consulta RUC / DNI</div>'
          + '<div style="display: flex; flex-direction: column; gap: 0.5rem;">'
            + fila(est.jsonpe, est.jsonpe ? 'api.json.pe responde' : 'api.json.pe no responde', est.jsonpeUrl)
            + fila(est.jsonpeToken, est.jsonpeToken ? 'Token cargado' : 'Falta el token',
                est.jsonpeToken ? '' : 'Ingresa el Bearer token de api.json.pe.')
          + '</div>'
        + '</div>'
      + '</div>';
    }

    _tabConexionHTML() {
      var s = this.sunat;
      var c = this.config;

      return ''
        + '<div class="card">'
          + '<h2 class="section-title"><i data-lucide="key-round" class="w-5 h-5"></i> Credenciales de SUNAT</h2>'
          + '<p class="text-xs" style="color: rgb(71 85 105); line-height: 1.6; margin-bottom: 1.25rem;">'
            + 'Datos de la aplicación registrada en SUNAT: Menú SOL → Empresas → Credenciales de API SUNAT.'
          + '</p>'

          + this._estadoConexionHTML()

          + '<div class="cfg-grid">'
            + this._campo('Nombre de la aplicación', '<input id="s-sunat-app-nombre" class="input" value="' + App.escapeHtml(s.app_nombre || '') + '" placeholder="SIST_FACT E" />')
            + this._campo('URL de SUNAT', '<input id="s-sunat-app-url" class="input font-mono" value="' + App.escapeHtml(this._urlSunat()) + '" placeholder="' + SUNAT_URL + '" />',
                'Dirección de SUNAT contra la que se verifica la conexión.')
          + '</div>'

          + '<div class="cfg-grid" style="margin-top: 0.875rem;">'
            + this._campo('Id (client_id)', '<input id="s-sunat-id" class="input font-mono" value="' + App.escapeHtml(s.client_id || '') + '" placeholder="Id que entrega SUNAT" autocomplete="off" />')
            + this._campo('Clave (client_secret)', '<input id="s-sunat-secret" type="password" class="input font-mono" value="' + App.escapeHtml(s.client_secret || '') + '" placeholder="Clave que entrega SUNAT" autocomplete="off" />')
          + '</div>'

          + '<div class="cfg-grid" style="margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px solid rgb(241 245 249);">'
            + this._campo('RUC', '<input id="s-sol-ruc" class="input font-mono" value="' + App.escapeHtml(c.sunat_ruc || '') + '" maxlength="11" inputmode="numeric" placeholder="20607827410" autocomplete="off" />')
            + this._campo('Usuario SOL', '<input id="s-sol-usuario" class="input font-mono" value="' + App.escapeHtml(c.sunat_usuario_sol || '') + '" placeholder="Usuario SOL" autocomplete="off" />')
          + '</div>'
          + '<div class="cfg-grid" style="margin-top: 0.875rem;">'
            + this._campo('Clave SOL', '<input id="s-sol-clave" type="password" class="input font-mono" value="' + App.escapeHtml(c.sunat_clave_sol || '') + '" placeholder="Clave SOL" autocomplete="new-password" />',
                'Se guarda solo en este navegador.')
          + '</div>'

          + '<div class="cfg-grid" style="margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px solid rgb(241 245 249);">'
            + this._campo('URL de api.json.pe <span style="color: rgb(148 163 184); font-weight: 400;">(consulta RUC / DNI)</span>',
                '<input id="s-jsonpe-url" class="input font-mono" value="' + App.escapeHtml(this._urlJsonpe()) + '" placeholder="' + JSONPE_URL + '" />',
                'Dirección contra la que se verifica la conexión.')
            + this._campo('Token de api.json.pe',
                '<input id="s-jsonpe-token" type="password" class="input font-mono" value="' + App.escapeHtml(c.jsonpe_token || '') + '" placeholder="Bearer token de api.json.pe" />',
                'Se usa para autocompletar clientes y proveedores desde SUNAT y RENIEC.')
          + '</div>'

          + this._msgHTML(this.msgConexion)

          + '<div class="cfg-acciones" style="margin-top: 1.25rem; align-items: center;">'
            + '<button id="s-save" class="btn-primary"><i data-lucide="save" class="w-4 h-4"></i> Guardar</button>'
            + '<button id="s-test" class="btn-secondary" ' + (this.testing ? 'disabled' : '') + '>'
              + (this.testing
                ? '<i data-lucide="loader-2" class="w-4 h-4 icon-spin"></i> Probando...'
                : '<i data-lucide="plug-zap" class="w-4 h-4"></i> Probar conexión')
            + '</button>'
            + (this.saved
              ? '<span style="font-size: 0.8125rem; font-weight: 600; color: rgb(22 163 74); display: inline-flex; align-items: center; gap: 0.25rem;">'
                + '<i data-lucide="check-circle-2" class="w-4 h-4"></i> Guardado</span>'
              : '')
          + '</div>'

          + this._testResultHTML()
        + '</div>';
    }

    _testResultHTML() {
      if (!this.testResult) return '';
      if (this.testResult.success) {
        var e = this.testResult.empresa || {};
        return ''
          + '<div style="margin-top: 1rem; padding: 1rem; border-radius: 0.875rem; background: ' + SUPERFICIE + ';">'
            + '<div style="font-weight: 700; color: ' + TEXTO + '; display: flex; align-items: center; gap: 0.5rem;">'
              + '<i data-lucide="check-circle-2" class="w-5 h-5" style="color: ' + OK + ';"></i> Conexión exitosa'
            + '</div>'
            + '<div style="margin-top: 0.625rem; font-size: 0.8125rem; color: ' + TEXTO2 + '; line-height: 1.7;">'
              + '<div><strong style="color: ' + TEXTO + ';">' + App.escapeHtml(primero(e, ['razon_social', 'nombre_comercial']) || '—') + '</strong></div>'
              + '<div>RUC ' + App.escapeHtml(e.ruc || '—') + ' · Plan ' + App.escapeHtml(unir(e.plan) || '—') + ' · Entorno ' + App.escapeHtml(e.entorno || '—') + '</div>'
            + '</div>'
            + '<div class="cfg-acciones" style="margin-top: 0.875rem;">'
              + '<button id="s-ir-empresa" class="btn-primary text-sm">Ver datos de mi empresa <i data-lucide="arrow-right" class="w-4 h-4"></i></button>'
              + '<button id="s-goto-dashboard" class="btn-secondary text-sm">Ir al inicio</button>'
            + '</div>'
          + '</div>';
      }
      return ''
        + '<div style="margin-top: 1rem; padding: 1rem; border-radius: 0.875rem; background: ' + SUPERFICIE + ';">'
          + '<div style="font-weight: 700; color: ' + TEXTO + '; display: flex; align-items: center; gap: 0.5rem;">'
            + '<i data-lucide="x-circle" class="w-5 h-5" style="color: ' + ERROR + ';"></i> No se pudo conectar'
          + '</div>'
          + '<div style="margin-top: 0.5rem; font-size: 0.8125rem; color: ' + ERROR + ';">' + App.escapeHtml(this.testResult.error) + '</div>'
        + '</div>';
    }

    // ═══ 2. Mi empresa ════════════════════════════════════════
    _tabEmpresaHTML() {
      if (!App.isConfigured()) {
        return this._avisoHTML('plug', 'Primero conecta la API',
          'Ingresa tu api_key y api_secret en la pestaña <strong>Conexión</strong>. Con eso el sistema podrá traer los datos de tu empresa.',
          'Ir a Conexión', 's-ir-conexion');
      }
      if (this.cargandoEmpresa) {
        return '<div class="card" style="text-align: center; padding: 3rem 1rem; color: rgb(100 116 139);">'
          + '<i data-lucide="loader-2" class="w-8 h-8 icon-spin" style="margin: 0 auto 0.75rem; display: block;"></i>'
          + 'Trayendo los datos de tu empresa...'
          + '</div>';
      }
      if (this.errorEmpresa) {
        return this._avisoHTML('alert-circle', 'No se pudieron traer los datos',
          App.escapeHtml(this.errorEmpresa), 'Reintentar', 's-recargar-empresa');
      }
      if (!this.empresa) return '';

      var e = this.empresa;
      return this._perfilHTML(e)
        + this._formEmpresaHTML(e)
        + '<div class="cfg-duo">' + this._logoHTML(e) + this._certificadoHTML(e) + '</div>';
    }

    _avisoHTML(icono, titulo, texto, botonTexto, botonId) {
      return '<div class="card" style="text-align: center; padding: 2.5rem 1.5rem;">'
        + '<span style="width: 3rem; height: 3rem; border-radius: 0.875rem; background: rgb(241 245 249); color: rgb(100 116 139); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 0.875rem;">'
          + '<i data-lucide="' + icono + '" class="w-6 h-6"></i>'
        + '</span>'
        + '<div style="font-weight: 700; color: rgb(15 23 42);">' + titulo + '</div>'
        + '<p class="text-xs" style="color: rgb(100 116 139); margin-top: 0.5rem; line-height: 1.6; max-width: 24rem; margin-left: auto; margin-right: auto;">' + texto + '</p>'
        + '<button id="' + botonId + '" class="btn-primary" style="margin-top: 1.25rem;">' + botonTexto + '</button>'
        + '</div>';
    }

    /** Cabecera con logo, identidad y los indicadores del plan/régimen. */
    _perfilHTML(e) {
      var logo = e._logo;
      var regimen = REGIMENES[e.tax_regime] || e.tax_regime || '—';
      var esProduccion = String(e.entorno).toLowerCase() === 'production';

      /** Etiqueta neutra; el estado se distingue por un punto, no por el fondo. */
      function chip(texto, colorPunto) {
        return '<span class="badge" style="background: ' + SUPERFICIE + '; color: ' + TEXTO2 + '; gap: 0.375rem;">'
          + (colorPunto
            ? '<span style="width: 0.4rem; height: 0.4rem; border-radius: 9999px; background: ' + colorPunto + ';"></span>'
            : '')
          + App.escapeHtml(texto)
          + '</span>';
      }

      function dato(label, valor) {
        return '<div style="padding: 0.5rem 0.75rem; background: ' + SUPERFICIE + '; border-radius: 0.625rem;">'
          + '<div style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: ' + TENUE + ';">' + label + '</div>'
          + '<div style="font-weight: 700; font-size: 0.8125rem; margin-top: 0.125rem; color: ' + TEXTO + '; overflow: hidden; text-overflow: ellipsis;">' + App.escapeHtml(valor || '—') + '</div>'
          + '</div>';
      }

      return ''
        + '<div class="card" style="margin-bottom: 1rem;">'
          + '<div class="cfg-perfil">'
            + (logo
              ? '<img src="' + App.escapeHtml(logo) + '" alt="Logo" style="width: 4rem; height: 4rem; border-radius: 0.875rem; object-fit: contain; background: ' + SUPERFICIE + '; flex-shrink: 0;" />'
              : '<span style="width: 4rem; height: 4rem; border-radius: 0.875rem; background: ' + SUPERFICIE + '; color: ' + TENUE + '; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">'
                + '<i data-lucide="building-2" class="w-7 h-7"></i></span>')
            + '<div style="flex: 1; min-width: 12rem;">'
              + '<div style="font-weight: 800; font-size: 1.0625rem; color: ' + TEXTO + '; letter-spacing: -0.02em; line-height: 1.3;">'
                + App.escapeHtml(primero(e, ['razon_social', 'nombre_comercial']) || 'Mi empresa') + '</div>'
              + '<div class="font-mono text-xs" style="color: rgb(100 116 139); margin-top: 0.125rem;">RUC ' + App.escapeHtml(e.ruc || '—') + '</div>'
              + '<div style="display: flex; gap: 0.375rem; flex-wrap: wrap; margin-top: 0.5rem;">'
                + chip(esProduccion ? 'Producción' : 'Beta / pruebas', esProduccion ? OK : TENUE)
                + (e.plan ? chip('Plan ' + unir(e.plan), null) : '')
              + '</div>'
            + '</div>'
          + '</div>'
          + '<div class="cfg-stats" style="margin-top: 1rem;">'
            + dato('Régimen', regimen)
            + dato('IGV vigente', e.tasa_igv_vigente != null ? e.tasa_igv_vigente + '%' : '—')
            + dato('Ubigeo', e.ubigeo)
            + dato('Distrito', e.distrito)
            + dato('Entorno', e.entorno)
          + '</div>'
        + '</div>';
    }

    _formEmpresaHTML(e) {
      return ''
        + '<div class="card" style="margin-bottom: 1rem;">'
          + '<h2 class="section-title"><i data-lucide="pencil" class="w-5 h-5"></i> Datos de la empresa</h2>'
          + '<p class="text-xs" style="color: rgb(100 116 139); margin-bottom: 1.25rem;">'
            + 'Se guardan en tu cuenta de la API y salen impresos en los comprobantes.'
          + '</p>'

          + '<div class="cfg-grid">'
            + this._campo('RUC', '<input id="e-ruc" class="input font-mono" value="' + App.escapeHtml(e.ruc || '') + '" maxlength="11" />')
            + this._campo('Nombre comercial', '<input id="e-nombre-comercial" class="input" value="' + App.escapeHtml(e.nombre_comercial || '') + '" />')
          + '</div>'
          + '<div style="margin-top: 0.875rem;">'
            + this._campo('Razón social', '<input id="e-razon-social" class="input" value="' + App.escapeHtml(e.razon_social || '') + '" />')
          + '</div>'
          + '<div style="margin-top: 0.875rem;">'
            + this._campo('Dirección fiscal', '<input id="e-direccion" class="input" value="' + App.escapeHtml(e.direccion || '') + '" />')
          + '</div>'

          + '<div class="cfg-grid-4" style="margin-top: 0.875rem;">'
            + this._campo('Ubigeo', '<input id="e-ubigeo" class="input font-mono" value="' + App.escapeHtml(e.ubigeo || '') + '" maxlength="6" placeholder="150101" />')
            + this._campo('Departamento', '<input id="e-departamento" class="input" value="' + App.escapeHtml(e.departamento || '') + '" />')
            + this._campo('Provincia', '<input id="e-provincia" class="input" value="' + App.escapeHtml(e.provincia || '') + '" />')
            + this._campo('Distrito', '<input id="e-distrito" class="input" value="' + App.escapeHtml(e.distrito || '') + '" />')
          + '</div>'

          + '<div class="cfg-grid" style="margin-top: 0.875rem;">'
            + this._campo('Teléfonos', '<input id="e-telefonos" class="input" value="' + App.escapeHtml(unir(e.telefonos)) + '" placeholder="+51 999 888 777" />', 'Separa varios con comas.')
            + this._campo('Correos', '<input id="e-emails" class="input" value="' + App.escapeHtml(unir(e.emails)) + '" placeholder="ventas@miempresa.pe" />', 'Separa varios con comas.')
          + '</div>'

          + '<div style="margin-top: 0.875rem;">'
            + this._campo('Mensaje de agradecimiento', '<input id="e-mensaje" class="input" value="' + App.escapeHtml(e.mensaje_agradecimiento || '') + '" placeholder="Gracias por su compra" />', 'Se imprime al pie de los comprobantes.')
          + '</div>'
          + '<div class="cfg-grid" style="margin-top: 0.875rem;">'
            + this._campo('Webhook', '<input id="e-webhook" class="input" value="' + App.escapeHtml(e.webhook_url || '') + '" placeholder="https://miempresa.pe/sunat-webhook" />', 'La API avisa aquí los cambios de estado.')
            + this._campo('Entorno',
                '<select id="e-entorno" class="input js-select">'
                + '<option value="beta"' + (String(e.entorno) !== 'production' ? ' selected' : '') + '>Beta (pruebas)</option>'
                + '<option value="production"' + (String(e.entorno) === 'production' ? ' selected' : '') + '>Producción</option>'
                + '</select>',
                'En producción los comprobantes son reales ante SUNAT.')
          + '</div>'

          + this._msgHTML(this.msgEmpresa)

          + '<div class="cfg-acciones" style="margin-top: 1.25rem;">'
            + '<button id="e-guardar" class="btn-primary" ' + (this.guardandoEmpresa ? 'disabled' : '') + '>'
              + (this.guardandoEmpresa
                ? '<i data-lucide="loader-2" class="w-4 h-4 icon-spin"></i> Guardando...'
                : '<i data-lucide="save" class="w-4 h-4"></i> Guardar cambios')
            + '</button>'
            + '<button id="e-recargar" class="btn-secondary"><i data-lucide="refresh-cw" class="w-4 h-4"></i> Descartar y recargar</button>'
          + '</div>'
        + '</div>';
    }

    _logoHTML(e) {
      var logo = e._logo;
      return ''
        + '<div class="card">'
          + '<h2 class="section-title"><i data-lucide="image" class="w-5 h-5"></i> Logo</h2>'
          + '<p class="text-xs" style="color: rgb(100 116 139); margin-bottom: 1rem;">Aparece en los PDF de tus comprobantes. PNG o JPG.</p>'
          + '<div class="cfg-perfil">'
            + (logo
              ? '<img src="' + App.escapeHtml(logo) + '" alt="Logo actual" style="width: 5.5rem; height: 5.5rem; border-radius: 0.875rem; object-fit: contain; background: rgb(248 250 252); flex-shrink: 0;" />'
              : '<span style="width: 5.5rem; height: 5.5rem; border-radius: 0.875rem; background: rgb(241 245 249); color: rgb(148 163 184); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.25rem; flex-shrink: 0; font-size: 10px; font-weight: 700;">'
                + '<i data-lucide="image-off" class="w-5 h-5"></i> Sin logo</span>')
            + '<div style="flex: 1; min-width: 12rem;">'
              + '<input id="e-logo-file" type="file" accept="image/png,image/jpeg" style="display: none;" />'
              + '<button id="e-logo-btn" class="btn-secondary" ' + (this.subiendo === 'logo' ? 'disabled' : '') + '>'
                + (this.subiendo === 'logo'
                  ? '<i data-lucide="loader-2" class="w-4 h-4 icon-spin"></i> Subiendo...'
                  : '<i data-lucide="upload" class="w-4 h-4"></i> ' + (logo ? 'Cambiar logo' : 'Subir logo'))
              + '</button>'
              + '<p class="text-xs" style="color: rgb(148 163 184); margin-top: 0.5rem;">Recomendado: cuadrado, fondo transparente, máximo 1 MB.</p>'
            + '</div>'
          + '</div>'
        + '</div>';
    }

    _certificadoHTML(e) {
      var cert = e.certificado || {};
      var vence = primero(cert, ['vence_el', 'fecha_vencimiento', 'valid_to', 'expira']) || primero(e, ['certificado_vence']);
      var tiene = !!(vence || cert.nombre || e.tiene_certificado);

      return ''
        + '<div class="card">'
          + '<h2 class="section-title"><i data-lucide="file-badge" class="w-5 h-5"></i> Certificado digital</h2>'
          + '<div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; background: ' + SUPERFICIE + '; border-radius: 0.75rem; margin-bottom: 1rem;">'
            + '<i data-lucide="' + (tiene ? 'shield-check' : 'shield-alert') + '" class="w-5 h-5" style="color: ' + (tiene ? OK : TENUE) + '; flex-shrink: 0;"></i>'
            + '<div style="font-size: 0.8125rem; color: ' + TEXTO2 + ';">'
              + (tiene
                ? '<strong style="color: ' + TEXTO + ';">Certificado cargado</strong>' + (vence ? ' · vence el ' + App.escapeHtml(String(vence)) : '')
                : '<strong style="color: ' + TEXTO + ';">Sin certificado</strong> · súbelo para poder firmar comprobantes')
            + '</div>'
          + '</div>'

          + this._campo('Archivo .pfx', '<input id="e-cert-file" type="file" accept=".pfx,.p12" class="input" style="padding: 0.5rem 0.75rem;" />')
          + '<div style="margin-top: 0.875rem;">'
            + this._campo('Contraseña del certificado', '<input id="e-cert-pass" type="password" class="input" placeholder="Contraseña del .pfx" />')
          + '</div>'
          + '<div class="cfg-acciones" style="margin-top: 1rem;">'
            + '<button id="e-cert-btn" class="btn-secondary" ' + (this.subiendo === 'certificado' ? 'disabled' : '') + '>'
              + (this.subiendo === 'certificado'
                ? '<i data-lucide="loader-2" class="w-4 h-4 icon-spin"></i> Subiendo...'
                : '<i data-lucide="upload" class="w-4 h-4"></i> Subir certificado')
            + '</button>'
          + '</div>'
          + '<p class="text-xs" style="color: rgb(100 116 139); margin-top: 0.75rem;">Úsalo también para renovar el certificado cuando venza.</p>'
        + '</div>';
    }

    // ═══ 3. Sistema ═══════════════════════════════════════════
    _tabSistemaHTML() {
      var actual = App.DB.rubro();
      var rubros = App.DB.rubros();

      var totalRegistros = App.DB.COLECCIONES.reduce(function (s, col) {
        return s + App.DB.all(col).length;
      }, 0);

      return ''
        + '<div class="cfg-duo">'
          + '<div class="card">'
            + '<h2 class="section-title"><i data-lucide="layout-grid" class="w-5 h-5"></i> Rubro del negocio</h2>'
            + '<p class="text-xs" style="color: rgb(71 85 105); line-height: 1.6; margin-bottom: 1rem;">'
              + 'Define el nombre, el icono y el color con los que se presenta el sistema. '
              + 'No añade ni borra ningún dato.'
            + '</p>'
            + '<div class="cfg-acciones">'
              + '<select id="e-rubro" class="input js-select" data-search="true" data-placeholder="Elige un rubro" data-search-placeholder="Buscar rubro..." style="flex: 1; min-width: 14rem;">'
                + '<option value="">Elige un rubro</option>'
                + rubros.map(function (r) {
                  return '<option value="' + r.id + '"' + (actual && r.id === actual.id ? ' selected' : '') + '>' + App.escapeHtml(r.nombre) + '</option>';
                }).join('')
              + '</select>'
              + '<button id="e-cargar-rubro" class="btn-secondary"><i data-lucide="check" class="w-4 h-4"></i> Aplicar</button>'
            + '</div>'
            + this._msgHTML(this.negocioMsg)
          + '</div>'

          + '<div class="card">'
            + '<h2 class="section-title"><i data-lucide="database" class="w-5 h-5"></i> Respaldo de datos</h2>'
            + '<p class="text-xs" style="color: rgb(71 85 105); line-height: 1.6;">'
              + 'Todo vive en este navegador. Exporta un JSON para respaldarlo o llevarlo a otro equipo; '
              + 'es lo único que permite recuperar los datos si se borran.'
            + '</p>'
            + '<div class="cfg-conteos" style="margin-top: 1rem;">'
              + App.DB.COLECCIONES.map(function (col) {
                return '<div style="padding: 0.5rem 0.75rem; background: rgb(248 250 252); border-radius: 0.625rem;">'
                  + '<div style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: rgb(148 163 184);">' + col + '</div>'
                  + '<div style="font-weight: 800; font-size: 1.125rem;">' + App.DB.all(col).length + '</div>'
                  + '</div>';
              }).join('')
            + '</div>'
            + this._msgHTML(this.datosMsg)
            + '<div class="cfg-acciones" style="margin-top: 1rem;">'
              + '<button id="s-exportar" class="btn-secondary"><i data-lucide="download" class="w-4 h-4"></i> Exportar JSON</button>'
              + '<button id="s-importar" class="btn-secondary"><i data-lucide="upload" class="w-4 h-4"></i> Importar JSON</button>'
              + '<input id="s-archivo" type="file" accept="application/json,.json" style="display: none;" />'
            + '</div>'
          + '</div>'
        + '</div>'

        // Va aparte y al final: son las dos acciones sin vuelta atrás
        + '<div class="card" style="margin-top: 1rem;">'
          + '<h2 class="section-title" style="color: ' + ERROR + ';"><i data-lucide="trash-2" class="w-5 h-5"></i> Borrar datos</h2>'
          + '<p class="text-xs" style="color: rgb(71 85 105); line-height: 1.6;">'
            + 'No se puede deshacer. Exporta antes si quieres conservar algo.'
          + '</p>'
          + this._msgHTML(this.borrarMsg)
          + '<div class="cfg-duo" style="margin-top: 1rem;">'
            + '<div style="padding: 0.875rem; background: rgb(248 250 252); border-radius: 0.75rem;">'
              + '<div style="font-size: 0.875rem; font-weight: 700; color: rgb(15 23 42);">Vaciar el negocio</div>'
              + '<p class="text-xs" style="color: rgb(100 116 139); line-height: 1.6; margin: 0.375rem 0 0.75rem;">'
                + 'Borra los <strong>' + App.fmtNumber(totalRegistros, 0) + '</strong> registros de productos, categorías, clientes, '
                + 'proveedores, compras e inventario, y los datos de la empresa. '
                + 'Conserva tu usuario y las credenciales SUNAT.'
              + '</p>'
              + '<button id="s-borrar-datos" class="btn-secondary" style="color: ' + ERROR + ';">'
                + '<i data-lucide="eraser" class="w-4 h-4"></i> Borrar los datos'
              + '</button>'
            + '</div>'
            + '<div style="padding: 0.875rem; background: rgb(248 250 252); border-radius: 0.75rem;">'
              + '<div style="font-size: 0.875rem; font-weight: 700; color: rgb(15 23 42);">Dejarlo como recién instalado</div>'
              + '<p class="text-xs" style="color: rgb(100 116 139); line-height: 1.6; margin: 0.375rem 0 0.75rem;">'
                + 'Lo anterior y además tu <strong>usuario</strong>, la sesión y las <strong>credenciales SUNAT</strong>. '
                + 'El sistema vuelve al registro del primer usuario.'
              + '</p>'
              + '<button id="s-borrar-todo" class="btn-danger">'
                + '<i data-lucide="rotate-ccw" class="w-4 h-4"></i> Restablecer todo'
              + '</button>'
            + '</div>'
          + '</div>'
        + '</div>';
    }

    // ═══ Eventos ══════════════════════════════════════════════
    _bind() {
      var self = this;
      var c = this.container;

      c.querySelectorAll('[data-tab]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.tab = btn.dataset.tab;
          self._rerender();
          if (self.tab === 'empresa' && App.isConfigured() && !self.empresa && !self.cargandoEmpresa) {
            self._cargarEmpresa();
          }
        });
      });

      if (this.tab === 'conexion') this._bindConexion();
      if (this.tab === 'empresa') this._bindEmpresa();
      if (this.tab === 'sistema') this._bindSistema();
    }

    _bindConexion() {
      var self = this;
      var c = this.container;

      // Credenciales SUNAT
      [['#s-sunat-app-nombre', 'app_nombre'], ['#s-sunat-app-url', 'app_url'],
       ['#s-sunat-id', 'client_id'], ['#s-sunat-secret', 'client_secret']].forEach(function (par) {
        var el = c.querySelector(par[0]);
        if (!el) return;
        el.addEventListener('input', function (e) {
          self.sunat[par[1]] = e.target.value;
        });
      });

      // Token json.pe
      var jp = c.querySelector('#s-jsonpe-token');
      if (jp) jp.addEventListener('input', function (e) { self.config.jsonpe_token = e.target.value; });

      // Acceso SOL (RUC, usuario, clave)
      [['#s-sol-ruc', 'sunat_ruc'], ['#s-sol-usuario', 'sunat_usuario_sol'], ['#s-sol-clave', 'sunat_clave_sol']].forEach(function (par) {
        var el = c.querySelector(par[0]);
        if (!el) return;
        el.addEventListener('input', function (e) {
          self.config[par[1]] = par[1] === 'sunat_ruc' ? e.target.value.replace(/\D/g, '') : e.target.value;
        });
      });

      // URL json.pe
      var jpu = c.querySelector('#s-jsonpe-url');
      if (jpu) jpu.addEventListener('input', function (e) { self.config.jsonpe_url = e.target.value; });

      var save = c.querySelector('#s-save');
      if (save) save.addEventListener('click', function () { self._guardarConfig(); });

      var test = c.querySelector('#s-test');
      if (test) test.addEventListener('click', function () { self._probar(true); });

      var irEmpresa = c.querySelector('#s-ir-empresa');
      if (irEmpresa) irEmpresa.addEventListener('click', function () {
        self.tab = 'empresa';
        self._rerender();
        if (!self.empresa) self._cargarEmpresa();
      });

      var irInicio = c.querySelector('#s-goto-dashboard');
      if (irInicio) irInicio.addEventListener('click', function () { self.router.navigate('/'); });
    }

    _bindEmpresa() {
      var self = this;
      var c = this.container;

      var irConexion = c.querySelector('#s-ir-conexion');
      if (irConexion) irConexion.addEventListener('click', function () { self.tab = 'conexion'; self._rerender(); });

      var recargar = c.querySelector('#s-recargar-empresa') || c.querySelector('#e-recargar');
      if (recargar) recargar.addEventListener('click', function () { self._cargarEmpresa(); });

      var guardar = c.querySelector('#e-guardar');
      if (guardar) guardar.addEventListener('click', function () { self._guardarEmpresa(); });

      var logoBtn = c.querySelector('#e-logo-btn');
      var logoFile = c.querySelector('#e-logo-file');
      if (logoBtn && logoFile) {
        logoBtn.addEventListener('click', function () { logoFile.click(); });
        logoFile.addEventListener('change', function () {
          if (logoFile.files && logoFile.files[0]) self._subirLogo(logoFile.files[0]);
        });
      }

      var certBtn = c.querySelector('#e-cert-btn');
      if (certBtn) certBtn.addEventListener('click', function () { self._subirCertificado(); });
    }

    _bindSistema() {
      var self = this;
      var c = this.container;

      c.querySelector('#e-cargar-rubro').addEventListener('click', function () { self._cargarRubro(); });

      var archivo = c.querySelector('#s-archivo');

      c.querySelector('#s-exportar').addEventListener('click', function () {
        App.DB.descargarExport();
        self._msg('datosMsg', 'ok', 'Se descargó el respaldo con todos los datos.');
      });

      c.querySelector('#s-importar').addEventListener('click', function () { archivo.click(); });

      archivo.addEventListener('change', function () {
        var file = archivo.files && archivo.files[0];
        if (!file) return;
        var lector = new FileReader();
        lector.onload = function () {
          try {
            var cols = App.DB.importar(JSON.parse(lector.result));
            self._msg('datosMsg', 'ok', 'Se importaron: ' + cols.join(', ') + '.');
          } catch (e) {
            self._msg('datosMsg', 'error', 'No se pudo importar: ' + e.message);
          }
        };
        lector.readAsText(file);
        archivo.value = '';
      });

      c.querySelector('#s-borrar-datos').addEventListener('click', function () { self._borrarDatos(); });
      c.querySelector('#s-borrar-todo').addEventListener('click', function () { self._restablecerTodo(); });
    }

    _msg(campo, tipo, texto) {
      this[campo] = { tipo: tipo, texto: texto };
      this._rerender();
    }

    // ═══ Acciones: conexión ═══════════════════════════════════
    _guardarConfig() {
      var self = this;

      // La URL siempre es la de SUNAT: si se deja vacía, se usa la oficial
      this.sunat.app_url = this._urlSunat();

      // 0) Acceso SOL: el RUC, si se ingresó, debe tener 11 dígitos
      var ruc = String(this.config.sunat_ruc || '').trim();
      if (ruc && !/^\d{11}$/.test(ruc)) {
        this.saved = false;
        this.msgConexion = { tipo: 'error', texto: 'El RUC debe tener 11 dígitos.' };
        this._rerender();
        return;
      }
      this.config.sunat_ruc = ruc;
      this.config.sunat_usuario_sol = String(this.config.sunat_usuario_sol || '').trim();
      this.config.sunat_clave_sol = String(this.config.sunat_clave_sol || '');

      // 1) Credenciales SUNAT: se validan y se guardan
      try {
        App.api.guardarCredencialesSunat(this.sunat);
      } catch (e) {
        this.saved = false;
        this.msgConexion = { tipo: 'error', texto: e.message };
        this._rerender();
        return;
      }

      // 2) Se reflejan también en la configuración general
      this.config.sunat_client_id = String(this.sunat.client_id || '').trim();
      this.config.sunat_client_secret = String(this.sunat.client_secret || '').trim();
      this.config.jsonpe_url = this._urlJsonpe();
      App.saveConfig(this.config);

      this.msgConexion = null;
      this.saved = true;
      this._rerender();
      setTimeout(function () {
        if (!self.container.isConnected) return;
        self.saved = false;
        self._rerender();
      }, 2000);

      // Tras guardar, se verifica todo (incluido el inicio de sesión en SUNAT)
      this._probar(true);
    }

    /**
     * ¿Responde SUNAT? Desde el navegador SUNAT no permite leer la respuesta
     * (CORS), así que se hace una petición "no-cors": si el servidor contesta,
     * la promesa se resuelve; si no hay red, el dominio no existe o tarda más
     * de 8 segundos, se rechaza.
     */
    async _pingSunat(url) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
      try {
        await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
        return true;
      } catch (e) {
        return false;
      } finally {
        clearTimeout(timer);
      }
    }

    /**
     * Inicio de sesión REAL en SUNAT, hecho por la función de servidor
     * /api/sunat-token (el navegador no puede hacerlo por CORS).
     */
    async _validarLoginSunat() {
      var s = this.sunat;
      var c = this.config;
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 20000);
      try {
        var r = await fetch('/api/sunat-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: String(s.client_id || '').trim(),
            client_secret: String(s.client_secret || '').trim(),
            ruc: String(c.sunat_ruc || '').trim(),
            usuario: String(c.sunat_usuario_sol || '').trim(),
            clave: String(c.sunat_clave_sol || ''),
          }),
          signal: ctrl ? ctrl.signal : undefined,
        });
        if (r.status === 404) {
          return { ok: false, texto: 'Falta publicar la función del servidor /api/sunat-token (archivo api/sunat-token.js).' };
        }
        var d = null;
        try { d = await r.json(); } catch (e) { d = null; }
        if (!d) return { ok: false, texto: 'Respuesta inválida del servidor (código ' + r.status + ').' };
        if (d.ok) {
          return { ok: true, texto: 'SUNAT aceptó el RUC, el usuario SOL, la Clave SOL y las credenciales de la aplicación.' };
        }
        return { ok: false, texto: d.error || 'SUNAT rechazó el acceso.' };
      } catch (e) {
        return { ok: false, texto: e && e.name === 'AbortError'
          ? 'El servidor tardó demasiado en responder.'
          : 'No se pudo contactar la función del servidor: ' + e.message };
      } finally {
        clearTimeout(timer);
      }
    }

    /** Verifica SUNAT, las credenciales y la API de facturación, y lo muestra. */
    async _probar(completo) {
      if (this.testing) return;

      App.saveConfig(this.config);
      this.testing = true;
      this.testResult = null;
      this._rerender();

      var url = this._urlSunat();
      var s = this.sunat;
      var estado = {
        url: url,
        hora: new Date(),
        sunat: false,
        jsonpe: false,
        jsonpeUrl: '',
        jsonpeToken: false,
        login: null,
        sol: false,
        solRuc: '',
        solUsuario: '',
        credenciales: !!(String(s.app_nombre || '').trim() && String(s.client_id || '').trim() && String(s.client_secret || '').trim()),
        api: false,
        apiError: '',
      };

      // 0) Acceso SOL: RUC de 11 dígitos, usuario y clave presentes
      estado.solRuc = String(this.config.sunat_ruc || '').trim();
      estado.solUsuario = String(this.config.sunat_usuario_sol || '').trim();
      estado.sol = /^\d{11}$/.test(estado.solRuc) && !!estado.solUsuario && !!String(this.config.sunat_clave_sol || '');

      // 0b) Inicio de sesión real en SUNAT (solo al pulsar Probar / Guardar)
      var previo = this.estadoConexion && this.estadoConexion.login ? this.estadoConexion.login : null;
      if (completo) {
        estado.login = (estado.credenciales && estado.sol)
          ? await this._validarLoginSunat()
          : { ok: false, texto: 'Completa primero las credenciales de la aplicación y el acceso SOL.' };
      } else {
        estado.login = previo;
      }

      // 1) SUNAT
      estado.sunat = await this._pingSunat(url);

      // 1b) api.json.pe: servidor alcanzable + token cargado
      estado.jsonpeUrl = this._urlJsonpe();
      estado.jsonpeToken = !!String(this.config.jsonpe_token || '').trim();
      estado.jsonpe = await this._pingSunat(estado.jsonpeUrl);

      // 2) API de facturación (solo si ya hay api_key / api_secret)
      if (!App.isConfigured()) {
        estado.apiError = 'Falta ingresar la api_key y el api_secret de la API.';
      } else {
        try {
          var res = await App.api.getEmpresa();
          estado.api = true;
          this.testResult = { success: true, empresa: res.data || {} };
          this._recibirEmpresa(res.data);
        } catch (e) {
          estado.apiError = /failed to fetch/i.test(String(e.message))
            ? 'El navegador no pudo comunicarse con la API (' + (App.getConfig().base_url || 'base_url sin definir') + '). Puede ser dirección incorrecta, bloqueo CORS o falta de red. Abre F12 → Consola para ver el motivo exacto.'
            : e.message;
          this.testResult = { success: false, error: e.message };
        }
      }

      this.estadoConexion = estado;
      this.testing = false;
      if (this.container && this.container.isConnected) this._rerender();
    }

    // ═══ Acciones: empresa ════════════════════════════════════
    /** Aplana la respuesta de la API a la forma que usan los formularios. */
    _normalizarEmpresa(data) {
      var d = data || {};
      var e = Object.assign({}, d);
      e._logo = primero(d, ['logo_url', 'logo', 'url_logo', 'logotipo']);
      if (e._logo && !/^(https?:|data:)/.test(e._logo)) {
        // Ruta relativa: se resuelve contra el host de la API
        var base = (App.getConfig().base_url || '').replace(/\/api\/v1\/?$/, '');
        e._logo = base.replace(/\/$/, '') + '/' + String(e._logo).replace(/^\//, '');
      }
      return e;
    }

    _recibirEmpresa(data) {
      if (!data) return;
      this.empresa = this._normalizarEmpresa(data);
      this.errorEmpresa = null;

      // El nombre del menú pasa a ser el real de la empresa
      App.DB.guardarEmpresa({
        nombre_comercial: this.empresa.nombre_comercial || this.empresa.razon_social || '',
        razon_social: this.empresa.razon_social || '',
        ruc: this.empresa.ruc || '',
        direccion: this.empresa.direccion || '',
        telefono: unir(this.empresa.telefonos),
        email: unir(this.empresa.emails),
      });
      App.aplicarTitulo();
      if (App.refrescarMarca) App.refrescarMarca();
    }

    async _cargarEmpresa() {
      this.cargandoEmpresa = true;
      this.errorEmpresa = null;
      this.msgEmpresa = null;
      if (this.tab === 'empresa') this._rerender();

      try {
        var res = await App.api.getEmpresa();
        this._recibirEmpresa(res.data);
      } catch (e) {
        this.errorEmpresa = e.message;
        this.empresa = null;
      } finally {
        this.cargandoEmpresa = false;
        this._rerender();
      }
    }

    _leerFormEmpresa() {
      var c = this.container;
      var val = function (sel) { var el = c.querySelector(sel); return el ? el.value.trim() : ''; };
      return {
        ruc: val('#e-ruc'),
        razon_social: val('#e-razon-social'),
        nombre_comercial: val('#e-nombre-comercial'),
        direccion: val('#e-direccion'),
        ubigeo: val('#e-ubigeo'),
        departamento: val('#e-departamento'),
        provincia: val('#e-provincia'),
        distrito: val('#e-distrito'),
        telefonos: partir(val('#e-telefonos')),
        emails: partir(val('#e-emails')),
        mensaje_agradecimiento: val('#e-mensaje'),
        webhook_url: val('#e-webhook'),
        entorno: c.querySelector('#e-entorno') ? c.querySelector('#e-entorno').value : 'beta',
      };
    }

    async _guardarEmpresa() {
      var datos = this._leerFormEmpresa();

      if (datos.ruc && !/^\d{11}$/.test(datos.ruc)) {
        this._msg('msgEmpresa', 'error', 'El RUC debe tener 11 dígitos.');
        return;
      }
      if (!datos.razon_social) {
        this._msg('msgEmpresa', 'error', 'La razón social es obligatoria.');
        return;
      }

      this.guardandoEmpresa = true;
      this.msgEmpresa = null;
      this._rerender();

      try {
        var res = await App.api.actualizarEmpresa(datos);
        this._recibirEmpresa(res.data || Object.assign({}, this.empresa, datos));
        this.msgEmpresa = { tipo: 'ok', texto: 'Datos de la empresa actualizados.' };
      } catch (e) {
        var detalle = e.errors ? ' ' + Object.values(e.errors).join(' ') : '';
        this.msgEmpresa = { tipo: 'error', texto: e.message + detalle };
      } finally {
        this.guardandoEmpresa = false;
        this._rerender();
      }
    }

    async _subirLogo(file) {
      this.subiendo = 'logo';
      this.msgEmpresa = null;
      this._rerender();

      try {
        await App.api.subirLogo(file);
        this.msgEmpresa = { tipo: 'ok', texto: 'Logo actualizado.' };
        this.subiendo = null;
        await this._cargarEmpresa();
        return;
      } catch (e) {
        this.msgEmpresa = { tipo: 'error', texto: 'No se pudo subir el logo: ' + e.message };
      } finally {
        this.subiendo = null;
        this._rerender();
      }
    }

    async _subirCertificado() {
      var c = this.container;
      var input = c.querySelector('#e-cert-file');
      var pass = c.querySelector('#e-cert-pass');
      var file = input && input.files ? input.files[0] : null;

      if (!file) {
        this._msg('msgEmpresa', 'error', 'Elige el archivo .pfx del certificado.');
        return;
      }
      if (!pass.value) {
        this._msg('msgEmpresa', 'error', 'Ingresa la contraseña del certificado.');
        return;
      }

      this.subiendo = 'certificado';
      this.msgEmpresa = null;
      this._rerender();

      try {
        await App.api.subirCertificado(file, pass.value);
        this.msgEmpresa = { tipo: 'ok', texto: 'Certificado actualizado.' };
        this.subiendo = null;
        await this._cargarEmpresa();
        return;
      } catch (e) {
        this.msgEmpresa = { tipo: 'error', texto: 'No se pudo subir el certificado: ' + e.message };
      } finally {
        this.subiendo = null;
        this._rerender();
      }
    }

    // ═══ Acciones: sistema ════════════════════════════════════
    /** Solo cambia la identidad visual: no toca ningún dato. */
    _cargarRubro() {
      var self = this;
      var nuevo = this.container.querySelector('#e-rubro').value;

      if (!nuevo) {
        this._msg('negocioMsg', 'error', 'Elige un rubro de la lista.');
        return;
      }

      App.DB.elegirRubro(nuevo)
        .then(function () {
          if (App.refrescarMarca) App.refrescarMarca();
          App.aplicarTitulo();
          self._msg('negocioMsg', 'ok', 'Rubro aplicado.');
        })
        .catch(function (e) { self._msg('negocioMsg', 'error', 'No se pudo aplicar: ' + e.message); });
    }

    _borrarDatos() {
      var total = App.DB.COLECCIONES.reduce(function (s, col) {
        return s + App.DB.all(col).length;
      }, 0);

      if (!window.confirm(
        'Se borrarán ' + total + ' registros (productos, categorías, clientes, proveedores, '
        + 'compras e inventario) y los datos de la empresa.\n\n'
        + 'Esto NO se puede deshacer. ¿Continuar?'
      )) return;

      var borrado = App.DB.borrarDatos();
      var detalle = Object.keys(borrado)
        .filter(function (col) { return borrado[col] > 0; })
        .map(function (col) { return borrado[col] + ' ' + col; })
        .join(', ');

      if (App.refrescarMarca) App.refrescarMarca();
      App.aplicarTitulo();
      this._msg('borrarMsg', 'ok', detalle
        ? 'Sistema vaciado. Se borraron: ' + detalle + '.'
        : 'No había nada que borrar.');
    }

    /**
     * Deja el navegador como recién instalado. Al quitar el usuario la sesión
     * deja de ser válida, así que se recarga la página: el arranque manda solo
     * al registro del primer usuario.
     */
    _restablecerTodo() {
      if (!window.confirm(
        'Se borrará TODO en este navegador: los datos del negocio, tu usuario y '
        + 'las credenciales SUNAT.\n\nTendrás que registrarte de nuevo. '
        + 'Esto NO se puede deshacer. ¿Continuar?'
      )) return;
      if (!window.confirm('Última confirmación: ¿borrar todo y volver al registro inicial?')) return;

      App.DB.borrarDatos();
      App.borrarCuenta();
      window.location.hash = '#/registro';
      window.location.reload();
    }
  };
})();

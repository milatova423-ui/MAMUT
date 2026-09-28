(function () {
  var root = document.getElementById('root');
  var sidebar = null;
  var sidebarOpen = false;
  var sidebarCollapsed = false;

  var router = new App.Router([
    { path: '/login',              handler: function () { return new App.Login(); } },
    { path: '/registro',           handler: function () { return new App.Registro(); } },
    { path: '/',                   handler: function () { return new App.Dashboard(); } },
    { path: '/configuracion',      handler: function () { return new App.Settings(); } },
    { path: '/nueva-factura',      handler: function () { return new App.NewInvoice(); } },
    { path: '/nueva-boleta',       handler: function () { return new App.NewBoleta(); } },
    { path: '/nueva-nc',           handler: function () { return new App.NewCreditNote(); } },
    { path: '/nueva-nd',           handler: function () { return new App.NewDebitNote(); } },
    { path: '/nueva-guia',         handler: function () { return new App.NewDispatchGuide(); } },
    { path: '/resumenes',          handler: function () { return new App.Summaries(); } },
    { path: '/anulaciones',        handler: function () { return new App.Anulaciones(); } },
    { path: '/documentos/:tipo',   handler: function (params) { return new App.DocumentList(params.tipo); } },
    { path: '/productos',          handler: function () { return new App.Productos(); } },
    { path: '/categorias',         handler: function () { return new App.Categorias(); } },
    { path: '/clientes',           handler: function () { return new App.Contactos('clientes'); } },
    { path: '/proveedores',        handler: function () { return new App.Contactos('proveedores'); } },
    { path: '/compras',            handler: function () { return new App.Compras(); } },
    { path: '/inventario',         handler: function () { return new App.Inventario(); } },
  ]);

  // El ancho manda: en escritorio el menú es una columna fija y en móvil un
  // cajón. Una sola media query, la misma que usa css/components/sidebar.css.
  var ESCRITORIO = window.matchMedia('(min-width: 1024px)');
  var CLAVE_MENU = 'sistema_v1_menu_colapsado';

  function leerColapsado() {
    try { return localStorage.getItem(CLAVE_MENU) === '1'; } catch (e) { return false; }
  }
  function guardarColapsado(valor) {
    try { localStorage.setItem(CLAVE_MENU, valor ? '1' : '0'); } catch (e) { /* modo privado */ }
  }

  /**
   * Único punto que toca el DOM del menú: el CSS decide cómo se ve cada
   * estado en cada ancho, aquí solo se anota cuál es el estado.
   */
  function aplicarMenu() {
    var shell = document.getElementById('app-shell');
    if (!shell) return;

    var enEscritorio = ESCRITORIO.matches;
    var cajonAbierto = !enEscritorio && sidebarOpen;

    shell.setAttribute('data-menu', sidebarOpen ? 'abierto' : 'cerrado');
    shell.setAttribute('data-escritorio', sidebarCollapsed ? 'oculto' : 'visible');

    // Fuera de pantalla no debe recibir foco ni lectores de pantalla
    var aside = document.getElementById('app-sidebar');
    var oculto = enEscritorio ? sidebarCollapsed : !sidebarOpen;
    if (aside) {
      aside.setAttribute('aria-hidden', String(oculto));
      if ('inert' in aside) aside.inert = oculto;
    }

    var abrirBtn = document.getElementById('btn-open-sidebar');
    if (abrirBtn) abrirBtn.setAttribute('aria-expanded', String(cajonAbierto));

    // El fondo no se mueve mientras el cajón lo tapa
    document.body.style.overflow = cajonAbierto ? 'hidden' : '';
  }

  /** Enfoca sin romper nada si el botón todavía no existe. */
  function enfocar(id) {
    var el = document.getElementById(id);
    if (el) el.focus();
  }

  function toggleSidebar(open) {
    sidebarOpen = open;
    aplicarMenu();
    if (ESCRITORIO.matches) return;
    // El foco acompaña al cajón: entra en él al abrir, vuelve al botón al cerrar
    enfocar(open ? 'sidebar-close' : 'btn-open-sidebar');
  }

  function toggleSidebarDesktop(collapsed) {
    sidebarCollapsed = collapsed;
    guardarColapsado(collapsed);
    aplicarMenu();
    // Se pliega desde un botón que al plegarse desaparece: el foco pasa al que
    // sí queda a la vista, para no dejarlo suelto en el <body>.
    enfocar(collapsed ? 'btn-expand-sidebar' : 'sidebar-collapse');
  }

  // Al cruzar el punto de ruptura el cajón móvil deja de tener sentido
  function alCambiarAncho() {
    if (ESCRITORIO.matches && sidebarOpen) sidebarOpen = false;
    aplicarMenu();
  }
  if (ESCRITORIO.addEventListener) ESCRITORIO.addEventListener('change', alCambiarAncho);
  else if (ESCRITORIO.addListener) ESCRITORIO.addListener(alCambiarAncho);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !sidebarOpen) return;
    if (document.querySelector('[data-modal-overlay]')) return; // el modal cierra primero
    toggleSidebar(false);
  });

  function doLogout() {
    App.logout();
    router.navigate('/login');
  }

  function renderShell(currentPath) {
    var marca = App.branding();
    root.innerHTML = ''
      + '<div id="app-shell" class="app-shell" data-menu="cerrado" data-escritorio="visible">'
        + '<div id="app-overlay" class="app-overlay"></div>'
        + '<div class="app-sidebar-espacio" aria-hidden="true"></div>'
        + '<aside id="app-sidebar" class="app-sidebar" aria-label="Menú principal">'
          + '<div id="sidebar-content" class="app-sidebar-interior"></div>'
        + '</aside>'
        + '<button id="btn-expand-sidebar" type="button" class="btn-expandir" title="Mostrar menú" aria-label="Mostrar menú">'
          + '<i data-lucide="panel-left-open" class="w-5 h-5"></i>'
        + '</button>'
        + '<div class="app-col">'
          + '<header class="app-topbar">'
            + '<button id="btn-open-sidebar" type="button" class="btn-menu" aria-label="Abrir menú" aria-controls="app-sidebar" aria-expanded="false">'
              + '<i data-lucide="menu" class="w-5 h-5"></i>'
            + '</button>'
            + '<div class="app-topbar-marca">'
              + '<span id="marca-icono" class="app-topbar-logo" style="background: ' + marca.color + ';">'
                + '<i data-lucide="' + marca.icono + '" class="w-4 h-4"></i>'
              + '</span>'
              + '<span id="marca-nombre" class="app-topbar-nombre">' + App.escapeHtml(marca.nombre) + '</span>'
            + '</div>'
            + '<span class="app-topbar-hueco" aria-hidden="true"></span>'
          + '</header>'
          + '<main class="app-main">'
            + '<div class="app-main-interior">'
              + '<div id="page-container"></div>'
            + '</div>'
          + '</main>'
        + '</div>'
      + '</div>';

    sidebarOpen = false;
    sidebarCollapsed = leerColapsado();
    aplicarMenu();

    sidebar = new App.Sidebar({
      currentPath: currentPath,
      onNavigate: function (path) {
        router.navigate(path);
        toggleSidebar(false);
      },
      onClose: function () { toggleSidebar(false); },
      onLogout: doLogout,
      onCollapseDesktop: function () { toggleSidebarDesktop(true); },
    });
    sidebar.render(document.getElementById('sidebar-content'));

    document.getElementById('btn-open-sidebar').addEventListener('click', function () { toggleSidebar(true); });
    document.getElementById('app-overlay').addEventListener('click', function () { toggleSidebar(false); });

    var expandBtn = document.getElementById('btn-expand-sidebar');
    if (expandBtn) expandBtn.addEventListener('click', function () { toggleSidebarDesktop(false); });

    App.refreshIcons();
  }

  /** Refresca el nombre y el ícono del negocio sin recargar la página. */
  App.refrescarMarca = function () {
    var m = App.branding();
    if (sidebar) sidebar.update(router.currentPath());
    var icono = document.getElementById('marca-icono');
    var nombre = document.getElementById('marca-nombre');
    if (icono) {
      icono.style.background = m.color;
      icono.innerHTML = '<i data-lucide="' + m.icono + '" class="w-4 h-4"></i>';
    }
    if (nombre) nombre.textContent = m.nombre;
    App.refreshIcons();
  };

  router.onNavigate(function (page, path) {
    var hayUsuarios = App.hayUsuarios();

    // 1) Primera vez: no existe ninguna cuenta → crear la del primer usuario
    if (!hayUsuarios && path !== '/registro') {
      router.navigate('/registro');
      return;
    }
    if (hayUsuarios && path === '/registro') {
      router.navigate(App.isLoggedIn() ? '/' : '/login');
      return;
    }

    // 2) No autenticado → forzar /login
    if (hayUsuarios && !App.isLoggedIn() && path !== '/login') {
      router.navigate('/login');
      return;
    }

    // 3) Autenticado + /login → mandar al inicio
    if (App.isLoggedIn() && path === '/login') {
      router.navigate('/');
      return;
    }

    // 4) /login y /registro se renderizan sin shell (pantalla completa)
    if (path === '/login' || path === '/registro') {
      sidebar = null;
      document.body.style.overflow = ''; // el shell se va con el cajón abierto
      root.innerHTML = '';
      page.render(root, router);
      return;
    }

    // 5) Autenticado pero sin config → /configuracion
    if (!App.isConfigured() && path !== '/configuracion') {
      router.navigate('/configuracion');
      return;
    }

    // 6) Renderizado normal con shell
    if (!document.getElementById('sidebar-content')) {
      renderShell(path);
    } else {
      sidebar.update(path);
    }

    var container = document.getElementById('page-container');
    container.innerHTML = '';
    page.render(container, router);

    // Ahora scrollea la página (antes lo hacía el <main>): al cambiar de
    // pantalla hay que volver arriba.
    window.scrollTo(0, 0);
  });

  /**
   * Red de seguridad: solo se ve si falta data/seed.js (por ejemplo si se copió
   * la carpeta sin ese archivo). Con seed.js presente el sistema arranca igual
   * abriendo index.html con doble clic que servido por HTTP.
   */
  function pantallaSinDatos(err) {
    root.innerHTML = ''
      + '<div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.5rem; background: rgb(241 245 249);">'
        + '<div class="card" style="max-width: 32rem;">'
          + '<h1 class="section-title" style="color: rgb(153 27 27);">'
            + '<i data-lucide="database-backup" class="w-5 h-5"></i> Faltan los datos del sistema'
          + '</h1>'
          + '<p style="color: rgb(51 65 85); line-height: 1.6;">'
            + 'No se encontró el archivo <code style="background: rgb(241 245 249); padding: 0.125rem 0.375rem; border-radius: 0.375rem;">data/seed.js</code>. '
            + 'Asegúrate de copiar la carpeta completa, con <strong>data/</strong>, <strong>css/</strong> y <strong>js/</strong> junto a index.html.'
          + '</p>'
          + '<p class="text-xs font-mono" style="color: rgb(148 163 184); margin-top: 1rem;">' + App.escapeHtml(err && err.message) + '</p>'
          + '<button id="reintentar" class="btn-primary" style="margin-top: 1.25rem;">'
            + '<i data-lucide="refresh-cw" class="w-4 h-4"></i> Reintentar</button>'
        + '</div>'
      + '</div>';
    App.refreshIcons();
    document.getElementById('reintentar').addEventListener('click', function () { window.location.reload(); });
  }

  // Los datos (productos, clientes, proveedores, compras, inventario) tienen que
  // estar en memoria antes de renderizar cualquier página.
  App.DB.init()
    .then(function () {
      App.aplicarTitulo();
      router.start();
    })
    .catch(pantallaSinDatos);
})();

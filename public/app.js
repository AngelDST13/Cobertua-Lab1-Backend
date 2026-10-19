/**
 * Panel de pedidos · Laboratorio #1
 *
 * Frontend sin dependencias. Lo sirve JSON Server desde /public en
 * http://localhost:3000. Lee y crea pedidos en JSON Server y los envía al
 * webhook de n8n, que aplica las clases POO y responde con la decisión.
 *
 * Las reglas de cobertura (cantones de la GAM) llegan de cobertura.js, que se
 * genera desde src/config/reglasNegocio.js con "npm run build:n8n".
 *
 * Todo dato externo se inserta con textContent (nunca innerHTML).
 */
import { COBERTURA } from './cobertura.js';

// ───────────────────────── Configuración y almacenamiento ─────────────────────────

const PREFIJO = 'panel.';
const almacen = {
  leer(clave, porDefecto = null) {
    try {
      return localStorage.getItem(PREFIJO + clave) ?? porDefecto;
    } catch {
      return porDefecto;
    }
  },
  guardar(clave, valor) {
    try {
      localStorage.setItem(PREFIJO + clave, valor);
    } catch {
      // modo privado o almacenamiento bloqueado: se usa solo en memoria
    }
  },
};

const origenJsonServer = location.port === '3000' ? location.origin : 'http://localhost:3000';
const config = {
  webhookUrl: almacen.leer('webhookUrl', 'http://localhost:5678/webhook/pedidos/verificar-cobertura'),
  clave: almacen.leer('clave', ''),
  jsonServerUrl: almacen.leer('jsonServerUrl', origenJsonServer),
};

/** Mismos parámetros que CONFIG_TENDENCIA en src/config/reglasNegocio.js. */
const TENDENCIA = { ventana: 10, minimoPorBloque: 2, umbralCambio: 0.1 };

const IPS_EJEMPLO = [
  ['Costa Rica', '201.191.20.10'],
  ['EE. UU.', '8.8.8.8'],
  ['España', '81.38.10.12'],
  ['Privada', '192.168.1.15'],
  ['Mal escrita', '999.1.1.1'],
];

const PEDIDOS_EJEMPLO = {
  'Escazú · con entrega': {
    ip: '201.191.20.10',
    cliente: { nombre: 'Daniela Rojas', email: 'daniela.rojas@example.com' },
    direccionEnvio: { provincia: 'San José', canton: 'Escazú', ciudad: 'San Rafael', detalle: '200 m oeste del parque, casa 22' },
    items: [
      { sku: 'TAB-010', descripcion: 'Tablet 10 pulgadas', cantidad: 1, precioUnitario: 60, pesoKg: 0.6 },
      { sku: 'FUN-010', descripcion: 'Funda protectora', cantidad: 1, precioUnitario: 8, pesoKg: 0.1 },
    ],
  },
  'Cartago · envío gratis': {
    ip: '201.191.20.10',
    cliente: { nombre: 'Andrés Quesada', email: 'andres.quesada@example.com' },
    direccionEnvio: { provincia: 'Cartago', canton: 'Cartago', ciudad: 'Oriental', detalle: 'Frente a la Basílica, apto 3' },
    items: [{ sku: 'CAM-4K', descripcion: 'Cámara de acción 4K', cantidad: 1, precioUnitario: 180, pesoKg: 0.4 }],
  },
  'Pérez Zeledón · fuera de la GAM': {
    ip: '201.191.20.10',
    cliente: { nombre: 'Luis Fallas', email: 'luis.fallas@example.com' },
    direccionEnvio: { provincia: 'San José', canton: 'Pérez Zeledón', ciudad: 'San Isidro de El General', detalle: 'Barrio Sinaí, casa 10' },
    items: [{ sku: 'AUD-220', descripcion: 'Audífonos inalámbricos', cantidad: 1, precioUnitario: 45, pesoKg: 0.4 }],
  },
  'Limón · fuera de la GAM': {
    ip: '201.191.20.10',
    cliente: { nombre: 'Karla Brown', email: 'karla.brown@example.com' },
    direccionEnvio: { provincia: 'Limón', canton: 'Limón', ciudad: 'Limón centro', detalle: 'Barrio Roosevelt, casa 5' },
    items: [{ sku: 'LAM-LED', descripcion: 'Lámpara LED', cantidad: 2, precioUnitario: 22, pesoKg: 0.9 }],
  },
};

const ETIQUETAS_ESTADO = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado', en_revision: 'En revisión' };
const ETIQUETAS_MOTIVO = {
  APROBADO: 'Aprobado',
  ESTRUCTURA_INVALIDA: 'Datos incompletos',
  IP_INVALIDA: 'IP inválida o privada',
  IP_NO_GEOLOCALIZABLE: 'IP no ubicable',
  SIN_COBERTURA: 'Sin cobertura',
  PESO_EXCEDIDO: 'Peso excedido',
  RESTRICCION_INTERNACIONAL: 'Restricción internacional',
  RIESGO_IA: 'Riesgo alto (IA)',
  SERVICIO_NO_DISPONIBLE: 'Servicio no disponible',
};

const estado = { pedidos: [], ejecuciones: [], filtro: 'todos', modo: 'existente', vista: 'procesar' };

// ───────────────────────── Utilidades de DOM ─────────────────────────

const $ = (selector) => document.querySelector(selector);

/** Crea un elemento; los hijos de texto se insertan como texto plano (seguro). */
const h = (etiqueta, atributos = {}, ...hijos) => {
  const elemento = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === 'class') elemento.className = valor;
    else if (clave.startsWith('on')) elemento.addEventListener(clave.slice(2), valor);
    else if (clave === 'dataset') Object.assign(elemento.dataset, valor);
    else elemento.setAttribute(clave, valor === true ? '' : valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    elemento.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return elemento;
};

const icono = (id, clase = 'icono') => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', clase);
  svg.setAttribute('aria-hidden', 'true');
  const uso = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  uso.setAttribute('href', `#${id}`);
  svg.append(uso);
  return svg;
};

const dinero = (valor) => (valor === null || valor === undefined ? '—' : `$${Number(valor).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const porcentaje = (valor) => `${Math.round(valor * 100)} %`;
const fechaCorta = (iso) => (iso ? new Date(iso).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const enumerar = (lista) => (lista.length <= 1 ? lista.join('') : `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}`);

const insigniaEstado = (valor) => h('span', { class: 'insignia', dataset: { estado: valor ?? 'pendiente' } }, ETIQUETAS_ESTADO[valor] ?? valor ?? 'Pendiente');

const avisar = (mensaje, tipo = 'info') => {
  const aviso = h('div', { class: 'aviso', dataset: { tipo }, role: tipo === 'error' ? 'alert' : 'status' }, mensaje);
  $('#avisos').append(aviso);
  setTimeout(() => aviso.remove(), 5000);
};

// ───────────────────────── Cobertura (misma regla que ValidadorCobertura) ─────────────────────────

const normalizar = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const INDICE_CANTONES = new Map(
  Object.entries(COBERTURA.cantones).flatMap(([provincia, lista]) => lista.map((canton) => [normalizar(canton), { canton, provincia }])),
);
const PROVINCIAS = Object.keys(COBERTURA.cantones);
const tieneEntrega = (canton, provincia) => (COBERTURA.cantonesGAM[provincia] ?? []).includes(canton);
const TOTAL_GAM = Object.values(COBERTURA.cantonesGAM).flat().length;
const TOTAL_CANTONES = INDICE_CANTONES.size;

const ubicarCanton = (nombre) => {
  const clave = normalizar(nombre);
  const oficial = COBERTURA.alias[clave];
  return INDICE_CANTONES.get(oficial ? normalizar(oficial) : clave) ?? null;
};

/** Vista previa de la regla R2 para una dirección; la decisión real la toma n8n. */
const evaluarDestino = (direccion = {}) => {
  if (direccion.pais && direccion.pais !== 'CR') return { cubierto: false, motivo: `Solo entregamos dentro de Costa Rica (el destino es ${direccion.pais}).` };
  const ubicacion = ubicarCanton(direccion.canton ?? direccion.ciudad);
  if (!ubicacion) return { cubierto: false, motivo: 'No se reconoce el cantón de entrega.' };
  if (direccion.provincia && normalizar(direccion.provincia) !== normalizar(ubicacion.provincia)) {
    return { cubierto: false, motivo: `${ubicacion.canton} pertenece a ${ubicacion.provincia}, no a ${direccion.provincia}.`, ...ubicacion };
  }
  return tieneEntrega(ubicacion.canton, ubicacion.provincia)
    ? { cubierto: true, motivo: `${ubicacion.canton} está dentro de la GAM.`, ...ubicacion }
    : { cubierto: false, motivo: `${ubicacion.canton} (${ubicacion.provincia}) está fuera de la GAM.`, ...ubicacion };
};

const describirDestino = (direccion = {}) => [direccion.ciudad, direccion.canton, direccion.provincia, direccion.pais === 'CR' ? null : direccion.pais].filter(Boolean).join(', ');

/** Caja verde/roja que explica si la dirección tiene entrega. `deUnPedido` añade la consecuencia y el enlace. */
const cajaCobertura = (direccion, deUnPedido = true) => {
  const resultado = evaluarDestino(direccion);
  const zona = COBERTURA.zona;
  return h(
    'div',
    { class: 'caja-cobertura', dataset: { cubierto: String(resultado.cubierto) } },
    h('span', { class: 'caja-cobertura-icono', 'aria-hidden': 'true' }, resultado.cubierto ? '✓' : '✕'),
    h(
      'div',
      {},
      h('strong', {}, resultado.cubierto ? 'Con cobertura' : 'Sin cobertura'),
      h('span', {}, resultado.cubierto ? `${resultado.motivo} Entrega en ${zona.diasEntrega} días hábiles.` : `${resultado.motivo}${deUnPedido ? ' Este pedido se rechazará.' : ''}`),
      resultado.cubierto || !deUnPedido ? null : h('button', { type: 'button', class: 'boton-enlace', onclick: () => irA('cobertura') }, 'Ver dónde hay cobertura'),
    ),
  );
};

// ───────────────────────── Navegación entre vistas ─────────────────────────

const VISTAS = ['procesar', 'cobertura', 'pedidos'];

const irA = (vista) => {
  if (!VISTAS.includes(vista)) vista = 'procesar';
  estado.vista = vista;
  for (const nombre of VISTAS) {
    $(`#nav-${nombre}`).setAttribute('aria-selected', String(nombre === vista));
    $(`#vista-${nombre}`).classList.toggle('oculto', nombre !== vista);
  }
  if (location.hash !== `#${vista}`) history.replaceState(null, '', `#${vista}`);
  window.scrollTo({ top: 0 });
};

document.querySelectorAll('[data-vista]').forEach((boton) => boton.addEventListener('click', () => irA(boton.dataset.vista)));
document.querySelectorAll('[data-ir]').forEach((boton) => boton.addEventListener('click', () => irA(boton.dataset.ir)));
window.addEventListener('hashchange', () => irA(location.hash.slice(1)));

// ───────────────────────── Tema día / noche ─────────────────────────

const aplicarTema = (tema) => {
  document.documentElement.dataset.theme = tema;
  const boton = $('#boton-tema');
  const siguiente = tema === 'dark' ? 'día' : 'noche';
  boton.replaceChildren(icono(tema === 'dark' ? 'i-sol' : 'i-luna'));
  boton.title = `Cambiar a modo ${siguiente}`;
  boton.setAttribute('aria-label', `Cambiar a modo ${siguiente}`);
};

$('#boton-tema').addEventListener('click', () => {
  const nuevo = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  almacen.guardar('tema', nuevo);
  aplicarTema(nuevo);
});

// ───────────────────────── Servicios ─────────────────────────

const conTiempoLimite = (ms) => AbortSignal.timeout(ms);

const jsonServer = async (ruta, opciones = {}) => {
  const respuesta = await fetch(`${config.jsonServerUrl}${ruta}`, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...(opciones.headers ?? {}) },
    signal: conTiempoLimite(8000),
  });
  if (!respuesta.ok) throw new Error(`JSON Server respondió ${respuesta.status}`);
  return respuesta.json();
};

const verificarServicios = async () => {
  const marcar = (id, ok) => {
    const elemento = $(id);
    elemento.dataset.estado = ok ? 'ok' : 'caido';
    elemento.title = ok ? 'En línea' : 'Sin respuesta';
  };
  try {
    await jsonServer('/pedidos?_limit=1');
    marcar('#estado-json', true);
  } catch {
    marcar('#estado-json', false);
  }
  try {
    // /healthz no tiene CORS: una respuesta opaca basta para saber que n8n está arriba
    await fetch(`${new URL(config.webhookUrl).origin}/healthz`, { mode: 'no-cors', signal: conTiempoLimite(5000) });
    marcar('#estado-n8n', true);
  } catch {
    marcar('#estado-n8n', false);
  }
};

const cargarDatos = async () => {
  try {
    const [pedidos, ejecuciones] = await Promise.all([jsonServer('/pedidos'), jsonServer('/ejecuciones?_sort=fecha&_order=desc&_limit=60')]);
    estado.pedidos = pedidos;
    estado.ejecuciones = ejecuciones;
    pintarSelectorPedidos();
    pintarTabla();
    pintarTendencia();
  } catch (error) {
    avisar(`No se pudo leer JSON Server (${error.message}). ¿Está corriendo "npm run db"?`, 'error');
  }
};

// ───────────────────────── Paso 1 · pedido existente ─────────────────────────

const pintarSelectorPedidos = () => {
  const select = $('#select-pedido');
  const seleccionado = select.value;
  const procesables = estado.pedidos.filter((p) => p.estado === 'pendiente' || p.estado === 'en_revision');
  select.replaceChildren(
    ...(procesables.length
      ? procesables.map((p) => {
          const cobertura = evaluarDestino(p.direccionEnvio);
          return h('option', { value: p.id }, `${p.id} · ${p.cliente?.nombre ?? 'Sin nombre'} · ${describirDestino(p.direccionEnvio)} ${cobertura.cubierto ? '✓' : '✕ sin cobertura'}`);
        })
      : [h('option', { value: '' }, 'No hay pedidos pendientes: crea uno nuevo')]),
  );
  if (procesables.some((p) => p.id === seleccionado)) select.value = seleccionado;
  pintarFichaExistente();
};

const pintarFichaExistente = () => {
  const pedido = estado.pedidos.find((p) => p.id === $('#select-pedido').value);
  if (!pedido) {
    $('#ficha-existente').replaceChildren();
    return;
  }
  const subtotal = (pedido.items ?? []).reduce((suma, i) => suma + i.cantidad * i.precioUnitario, 0);
  $('#ficha-existente').replaceChildren(
    h(
      'div',
      { class: 'ficha' },
      h('div', {}, h('span', {}, 'Cliente'), h('strong', {}, pedido.cliente?.nombre ?? '—')),
      h('div', {}, h('span', {}, 'Entrega en'), h('strong', {}, describirDestino(pedido.direccionEnvio) || '—')),
      h('div', {}, h('span', {}, 'Artículos'), h('strong', {}, `${pedido.items?.length ?? 0} · ${dinero(subtotal)}`)),
    ),
    cajaCobertura(pedido.direccionEnvio),
  );
  actualizarAvisoProcesar();
};

$('#select-pedido').addEventListener('change', pintarFichaExistente);

const cambiarModo = (modo) => {
  estado.modo = modo;
  $('#tab-existente').setAttribute('aria-selected', String(modo === 'existente'));
  $('#tab-nuevo').setAttribute('aria-selected', String(modo === 'nuevo'));
  $('#panel-existente').classList.toggle('oculto', modo !== 'existente');
  $('#panel-nuevo').classList.toggle('oculto', modo !== 'nuevo');
  actualizarAvisoProcesar();
};

$('#tab-existente').addEventListener('click', () => cambiarModo('existente'));
$('#tab-nuevo').addEventListener('click', () => cambiarModo('nuevo'));

// ───────────────────────── Paso 1 · pedido nuevo ─────────────────────────

const pintarCantones = (cantonSeleccionado = null) => {
  const provincia = $('#envio-provincia').value;
  const cantones = COBERTURA.cantones[provincia] ?? [];
  const conEntrega = cantones.filter((c) => tieneEntrega(c, provincia));
  const sinEntrega = cantones.filter((c) => !tieneEntrega(c, provincia));
  const grupo = (etiqueta, lista) => (lista.length ? h('optgroup', { label: etiqueta }, lista.map((c) => h('option', { value: c }, c))) : null);
  $('#envio-canton').replaceChildren(
    ...[grupo(`Con entrega (${conEntrega.length})`, conEntrega), grupo(`Sin entrega (${sinEntrega.length})`, sinEntrega)].filter(Boolean),
  );
  if (cantonSeleccionado && cantones.includes(cantonSeleccionado)) $('#envio-canton').value = cantonSeleccionado;
  pintarCoberturaPrevia();
};

const direccionNueva = () => ({
  pais: 'CR',
  provincia: $('#envio-provincia').value,
  canton: $('#envio-canton').value,
  ciudad: $('#envio-ciudad').value.trim(),
  detalle: $('#envio-detalle').value.trim(),
});

const pintarCoberturaPrevia = () => {
  $('#cobertura-previa').replaceChildren(cajaCobertura(direccionNueva()));
  actualizarResumenNuevo();
  actualizarAvisoProcesar();
};

$('#envio-provincia').addEventListener('change', () => pintarCantones());
$('#envio-canton').addEventListener('change', pintarCoberturaPrevia);

const filaItem = (item = { sku: '', descripcion: '', cantidad: 1, precioUnitario: '', pesoKg: '' }) => {
  const entrada = (campo, tipo, extra = {}) =>
    h('input', { 'aria-label': campo, 'data-campo': campo, type: tipo, value: item[campo] ?? '', oninput: actualizarResumenNuevo, ...extra });
  return h(
    'tr',
    {},
    h('td', {}, entrada('sku', 'text', { maxlength: 40, class: 'mono', placeholder: 'SKU' })),
    h('td', {}, entrada('descripcion', 'text', { maxlength: 80, placeholder: 'Descripción' })),
    h('td', {}, entrada('cantidad', 'number', { min: 1, max: 100, step: 1 })),
    h('td', {}, entrada('precioUnitario', 'number', { min: 0.01, step: 0.01 })),
    h('td', {}, entrada('pesoKg', 'number', { min: 0, step: 0.1 })),
    h(
      'td',
      {},
      h(
        'button',
        {
          type: 'button',
          class: 'boton boton-icono',
          'aria-label': 'Quitar artículo',
          title: 'Quitar artículo',
          onclick: (evento) => {
            evento.currentTarget.closest('tr').remove();
            actualizarResumenNuevo();
          },
        },
        icono('i-basura'),
      ),
    ),
  );
};

const leerItems = () =>
  [...$('#items').querySelectorAll('tr')].map((fila) => {
    const valor = (campo) => fila.querySelector(`[data-campo="${campo}"]`).value.trim();
    return {
      sku: valor('sku'),
      descripcion: valor('descripcion'),
      cantidad: Number.parseInt(valor('cantidad'), 10),
      precioUnitario: Number.parseFloat(valor('precioUnitario')),
      pesoKg: Number.parseFloat(valor('pesoKg')),
    };
  });

/** Estimación del envío con la fórmula de Pedido.calcularCostoEnvio() (sin recargo por clima). */
const estimarEnvio = (subtotal, peso) => {
  const zona = COBERTURA.zona;
  if (peso > zona.pesoMaximoKg) return { texto: `Supera el máximo de ${zona.pesoMaximoKg} kg: se rechazará`, problema: true };
  if (zona.envioGratisDesde !== null && subtotal >= zona.envioGratisDesde) return { texto: 'Gratis (compra ≥ $' + zona.envioGratisDesde + ')' };
  return { texto: `≈ ${dinero(zona.tarifaBase + Math.ceil(peso) * zona.tarifaPorKg)}` };
};

function actualizarResumenNuevo() {
  const items = leerItems();
  const subtotal = items.reduce((suma, i) => suma + (i.cantidad || 0) * (i.precioUnitario || 0), 0);
  const peso = items.reduce((suma, i) => suma + (i.cantidad || 0) * (i.pesoKg || 0), 0);
  const cubierto = evaluarDestino(direccionNueva()).cubierto;
  const envio = cubierto ? estimarEnvio(subtotal, peso) : { texto: 'No aplica (sin cobertura)', problema: true };
  const dato = (etiqueta, valor, problema = false) => h('div', { class: problema ? 'problema' : null }, h('span', {}, etiqueta), h('strong', {}, valor));
  $('#resumen-nuevo').replaceChildren(
    dato('Artículos', String(items.length)),
    dato('Subtotal', dinero(subtotal)),
    dato('Peso', `${peso.toFixed(2)} kg`, peso > COBERTURA.zona.pesoMaximoKg),
    dato('Envío estimado', envio.texto, envio.problema),
  );
}

const cargarEjemploPedido = (nombre) => {
  const ejemplo = PEDIDOS_EJEMPLO[nombre];
  $('#cliente-nombre').value = ejemplo.cliente.nombre;
  $('#cliente-email').value = ejemplo.cliente.email;
  $('#envio-provincia').value = ejemplo.direccionEnvio.provincia;
  $('#envio-ciudad').value = ejemplo.direccionEnvio.ciudad;
  $('#envio-detalle').value = ejemplo.direccionEnvio.detalle;
  $('#items').replaceChildren(...ejemplo.items.map(filaItem));
  $('#ip-cliente').value = ejemplo.ip;
  marcarChipIp();
  pintarCantones(ejemplo.direccionEnvio.canton);
  for (const chip of $('#ejemplos-pedido').querySelectorAll('.chip')) chip.setAttribute('aria-pressed', String(chip.dataset.nombre === nombre));
};

/** Validación en el navegador para dar feedback rápido; la regla real (R1) vive en la clase Pedido. */
const construirPedidoNuevo = () => {
  const errores = [];
  const nombre = $('#cliente-nombre').value.trim();
  const email = $('#cliente-email').value.trim();
  const direccionEnvio = direccionNueva();
  const items = leerItems();

  if (!nombre) errores.push('el nombre del cliente');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errores.push('un correo válido');
  if (!direccionEnvio.canton) errores.push('el cantón');
  if (!direccionEnvio.ciudad) errores.push('el distrito o barrio');
  if (!direccionEnvio.detalle) errores.push('las señas exactas');
  if (items.length === 0) errores.push('al menos un artículo');
  items.forEach((item, indice) => {
    if (!item.sku || !(item.cantidad >= 1) || !(item.precioUnitario > 0) || !(item.pesoKg >= 0)) {
      errores.push(`completar el artículo ${indice + 1}`);
    }
  });
  if (errores.length) throw new Error(`Falta ${enumerar(errores)}.`);

  return {
    id: `PED-${Date.now().toString(36).toUpperCase()}`,
    cliente: { nombre, email },
    direccionEnvio,
    items,
    estado: 'pendiente',
    ipCliente: null,
    historial: [],
    creadoEn: new Date().toISOString(),
  };
};

// ───────────────────────── Paso 2 · IP del cliente ─────────────────────────

const marcarChipIp = () => {
  const ip = $('#ip-cliente').value.trim();
  for (const chip of $('#ejemplos-ip').querySelectorAll('.chip')) chip.setAttribute('aria-pressed', String(chip.dataset.ip === ip));
};

const usarMiIp = async (evento) => {
  const chip = evento.currentTarget;
  chip.disabled = true;
  try {
    const respuesta = await fetch('http://ip-api.com/json/?fields=query,country', { signal: conTiempoLimite(6000) });
    const datos = await respuesta.json();
    $('#ip-cliente').value = datos.query;
    marcarChipIp();
    avisar(`Tu IP pública es ${datos.query} (${datos.country}).`, 'ok');
  } catch {
    avisar('No se pudo obtener tu IP pública.', 'error');
  } finally {
    chip.disabled = false;
  }
};

$('#ip-cliente').addEventListener('input', marcarChipIp);

// ───────────────────────── Paso 3 · procesar (webhook n8n) ─────────────────────────

/** Avisa antes de enviar si la vista previa ya sabe que no hay cobertura. */
function actualizarAvisoProcesar() {
  const direccion = estado.modo === 'nuevo' ? direccionNueva() : estado.pedidos.find((p) => p.id === $('#select-pedido').value)?.direccionEnvio;
  const aviso = $('#aviso-procesar');
  const sinCobertura = direccion && !evaluarDestino(direccion).cubierto;
  aviso.dataset.tipo = sinCobertura ? 'alerta' : '';
  aviso.textContent = sinCobertura
    ? 'Este destino está fuera de la cobertura: n8n lo rechazará con el motivo «Sin cobertura». Puedes enviarlo igual para probar el flujo.'
    : 'n8n verifica la cobertura, calcula el envío, consulta el clima y pide a DeepSeek un análisis de riesgo.';
}

const mensajeErrorWebhook = (status, cuerpo) => {
  if (status === 403) return 'n8n rechazó la clave del webhook. Revísala en Ajustes.';
  if (status === 404 && /not registered/i.test(cuerpo)) return 'El webhook no está registrado: activa el workflow en n8n (o usa la URL /webhook-test con "Listen for test event").';
  return null;
};

const procesar = async () => {
  if (!config.clave) {
    avisar('Configura primero la clave del webhook (X-API-Key).', 'error');
    abrirAjustes();
    return;
  }
  const ipCliente = $('#ip-cliente').value.trim();
  if (!ipCliente) {
    avisar('Escribe la IP del cliente (paso 2) o elige un ejemplo.', 'error');
    $('#ip-cliente').focus();
    return;
  }
  const boton = $('#boton-procesar');

  let pedidoId;
  try {
    if (estado.modo === 'nuevo') {
      const nuevo = construirPedidoNuevo();
      await jsonServer('/pedidos', { method: 'POST', body: JSON.stringify(nuevo) });
      pedidoId = nuevo.id;
      avisar(`Pedido ${pedidoId} creado.`, 'ok');
    } else {
      pedidoId = $('#select-pedido').value;
      if (!pedidoId) throw new Error('Elige un pedido pendiente o crea uno nuevo.');
    }
  } catch (error) {
    avisar(error.message, 'error');
    return;
  }

  boton.disabled = true;
  boton.replaceChildren(icono('i-recargar', 'icono girando'), h('span', {}, 'Procesando…'));
  $('#resultado').replaceChildren(h('div', { class: 'resultado-vacio' }, icono('i-recargar', 'icono icono-grande girando'), h('strong', {}, `Procesando ${pedidoId}…`), h('span', {}, 'n8n consulta ip-api, Open-Meteo y DeepSeek; puede tardar unos segundos.')));
  $('.tarjeta-resultado').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const inicio = performance.now();

  try {
    const respuesta = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': config.clave },
      body: JSON.stringify({ pedidoId, ipCliente }),
      signal: conTiempoLimite(120000),
    });
    const texto = await respuesta.text();
    const problema = mensajeErrorWebhook(respuesta.status, texto);
    if (problema) throw new Error(problema);

    let datos;
    try {
      datos = JSON.parse(texto);
    } catch {
      throw new Error(`Respuesta inesperada de n8n (HTTP ${respuesta.status}).`);
    }
    $('#tiempo-respuesta').textContent = `HTTP ${respuesta.status} · ${(Math.round(performance.now() - inicio) / 1000).toFixed(1)} s`;
    pintarResultado(datos, respuesta.status, pedidoId);
  } catch (error) {
    const mensaje = error.name === 'TypeError' ? 'No se pudo contactar a n8n. ¿Está corriendo en el puerto 5678?' : error.message;
    $('#resultado').replaceChildren(h('div', { class: 'resultado-vacio' }, h('strong', {}, 'No se obtuvo respuesta'), h('span', {}, mensaje)));
    avisar(mensaje, 'error');
  } finally {
    boton.disabled = false;
    boton.replaceChildren(icono('i-enviar'), h('span', {}, 'Procesar pedido'));
    await cargarDatos();
  }
};

$('#boton-procesar').addEventListener('click', procesar);

// ───────────────────────── Resultado ─────────────────────────

/** En qué paso del flujo se resolvió el pedido, según el código de motivo. */
const pasoDeCorte = (r) =>
  ({
    ESTRUCTURA_INVALIDA: 0,
    IP_INVALIDA: 1,
    IP_NO_GEOLOCALIZABLE: 1,
    SIN_COBERTURA: 2,
    RESTRICCION_INTERNACIONAL: 4,
    PESO_EXCEDIDO: 5,
    RIESGO_IA: 6,
    SERVICIO_NO_DISPONIBLE: r.geolocalizacion ? 6 : 1,
  })[r.codigoMotivo] ?? null;

const construirPasos = (r) => {
  const corte = pasoDeCorte(r);
  const geo = r.geolocalizacion;
  const clima = r.clima;
  const ia = r.analisisIA;
  const nivelCorte = r.estado === 'en_revision' ? 'alerta' : 'error';

  const pasos = [
    ['Datos del pedido completos', 'Cliente, dirección y artículos.'],
    ['Ubicación de la IP (ip-api)', geo ? `${geo.ciudad ?? ''}, ${geo.pais} (${geo.codigoPais})${geo.proxy ? ' · proxy/VPN' : ''}${geo.hosting ? ' · hosting' : ''}` : r.motivo],
    ['Cobertura: Costa Rica y cantón de la GAM', r.zonaEnvio ? `Entrega dentro de la GAM` : r.motivo],
    [
      'Clima en la zona (Open-Meteo)',
      clima?.disponible ? `${clima.descripcion}, ${clima.temperaturaC} °C${clima.severo ? ` · severo: ${clima.motivos.join(', ')} → recargo` : ''}` : 'No disponible: se continúa sin recargo',
    ],
    ['Restricciones del tipo de pedido', r.tipoPedido === 'internacional' ? 'Pedido internacional' : 'Pedido nacional: sin restricciones extra'],
    ['Costo de envío', r.costoEnvio !== null && r.costoEnvio !== undefined ? `${dinero(r.costoEnvio)} · total ${dinero(r.total)}` : r.motivo],
    ['Análisis de riesgo (DeepSeek)', ia ? `Riesgo ${ia.riesgo} · puntaje ${ia.puntaje}/100` : r.motivo],
    ['Decisión guardada', `${ETIQUETAS_ESTADO[r.estado] ?? r.estado} · ${ETIQUETAS_MOTIVO[r.codigoMotivo] ?? r.codigoMotivo}`],
    ['Alerta por correo al equipo', r.notificacion?.programada ? `Enviada (${r.notificacion.nivel})` : 'No hizo falta'],
  ];

  return pasos.map(([titulo, detalle], indice) => {
    let estadoPaso = 'ok';
    let marca = '✓';
    let texto = detalle;
    if (indice === 3 && (!clima?.disponible || clima.severo)) [estadoPaso, marca] = ['alerta', '!'];
    if (corte !== null && indice === corte) [estadoPaso, marca] = [nivelCorte, nivelCorte === 'alerta' ? '!' : '✕'];
    if (corte !== null && indice > corte && indice < 7) [estadoPaso, marca, texto] = ['omitido', '–', 'No se ejecutó: el pedido se resolvió antes'];
    if (indice === 7) [estadoPaso, marca] = r.estado === 'aprobado' ? ['ok', '✓'] : r.estado === 'en_revision' ? ['alerta', '!'] : ['error', '✕'];
    if (indice === 8 && !r.notificacion?.programada) [estadoPaso, marca] = ['omitido', '–'];
    return h(
      'li',
      { class: 'paso', dataset: { estado: estadoPaso } },
      h('span', { class: 'paso-icono', 'aria-hidden': 'true' }, marca),
      h('div', {}, h('div', { class: 'paso-titulo' }, titulo), h('div', { class: 'paso-detalle' }, texto)),
    );
  });
};

const TITULOS_RESULTADO = {
  aprobado: 'Pedido aprobado',
  rechazado: 'Pedido rechazado',
  en_revision: 'Requiere revisión manual',
};

const pintarResultado = (r, status, pedidoId) => {
  const contenedor = $('#resultado');

  if (!r.estado) {
    // Respuesta "sin cambios" (400, 404, 409, 503…) o error interno
    contenedor.replaceChildren(
      h('div', { class: 'veredicto', dataset: { estado: 'en_revision' } }, h('span', { class: 'veredicto-icono', 'aria-hidden': 'true' }, '!'), h('div', {}, h('strong', {}, `Sin cambios en ${r.pedidoId ?? pedidoId}`), h('span', {}, `${r.mensaje ?? 'Sin detalle'} (HTTP ${status})`))),
    );
    return;
  }

  const geo = r.geolocalizacion;
  const clima = r.clima;
  const ia = r.analisisIA;
  const pedido = estado.pedidos.find((p) => p.id === r.pedidoId);
  const marca = { aprobado: '✓', rechazado: '✕', en_revision: '!' }[r.estado] ?? '•';
  const sinCobertura = r.codigoMotivo === 'SIN_COBERTURA';

  const datos = [
    ['Entrega en', pedido ? describirDestino(pedido.direccionEnvio) : '—'],
    ['Subtotal', dinero(r.subtotal)],
    ['Envío', r.costoEnvio === 0 ? 'Gratis' : dinero(r.costoEnvio)],
    ['Total', dinero(r.total)],
    ['IP ubicada en', geo ? `${geo.ciudad ?? ''} ${geo.codigoPais}` : '—'],
    ['Clima', clima?.disponible ? `${clima.descripcion} ${clima.temperaturaC}°` : '—'],
  ];

  contenedor.replaceChildren(
    h(
      'div',
      { class: 'veredicto', dataset: { estado: r.estado } },
      h('span', { class: 'veredicto-icono', 'aria-hidden': 'true' }, marca),
      h(
        'div',
        {},
        h('strong', {}, `${TITULOS_RESULTADO[r.estado] ?? r.estado} · ${r.pedidoId}`),
        h('span', {}, r.motivo),
        sinCobertura ? h('button', { type: 'button', class: 'boton-enlace', onclick: () => irA('cobertura') }, 'Ver dónde hay cobertura') : null,
      ),
    ),
    h('div', { class: 'datos' }, datos.map(([etiqueta, valor]) => h('div', { class: 'dato' }, h('span', {}, etiqueta), h('strong', {}, valor)))),
    ia
      ? h(
          'div',
          { class: 'ia' },
          h('h3', {}, `Análisis de DeepSeek · ${ia.viable ? 'viable' : 'no viable'} · riesgo ${ia.riesgo} (${ia.puntaje}/100)`),
          h('ul', {}, ia.motivos.map((motivo) => h('li', {}, motivo))),
          h('blockquote', {}, `Mensaje para el cliente: “${ia.mensajeCliente}”`),
        )
      : null,
    h('details', { class: 'recorrido', open: r.estado !== 'aprobado' }, h('summary', {}, 'Recorrido paso a paso en n8n'), h('ol', { class: 'pasos' }, construirPasos(r))),
    r.tendencia ? h('p', { class: 'subtitulo nota-tendencia' }, `Tendencia: ${r.tendencia.conclusion}`) : null,
  );
};

// ───────────────────────── Vista de cobertura ─────────────────────────

const pintarCobertura = () => {
  const zona = COBERTURA.zona;
  $('#aviso-cantones').textContent = String(TOTAL_GAM);

  const hecho = (titulo, valor, nota) => h('div', { class: 'hecho' }, h('span', {}, titulo), h('strong', {}, valor), h('small', {}, nota));
  $('#hechos-cobertura').replaceChildren(
    hecho('Cantones con entrega', `${TOTAL_GAM} de ${TOTAL_CANTONES}`, `en ${enumerar(Object.keys(COBERTURA.cantonesGAM))}`),
    hecho('Tarifa de envío', `${dinero(zona.tarifaBase)} + ${dinero(zona.tarifaPorKg)}/kg`, `gratis en compras desde ${dinero(zona.envioGratisDesde)}`),
    hecho('Tiempo de entrega', `${zona.diasEntrega} días`, 'hábiles, +$2 si hay tormenta'),
    hecho('Peso máximo', `${zona.pesoMaximoKg} kg`, 'por pedido'),
  );

  // Dónde NO hay cobertura
  const provinciasSinNada = PROVINCIAS.filter((p) => !COBERTURA.cantonesGAM[p]);
  const parciales = PROVINCIAS.filter((p) => COBERTURA.cantonesGAM[p]).map((provincia) => ({
    provincia,
    fuera: COBERTURA.cantones[provincia].filter((c) => !tieneEntrega(c, provincia)),
  }));
  const totalFuera = TOTAL_CANTONES - TOTAL_GAM;

  $('#sin-cobertura').replaceChildren(
    h('li', {}, h('strong', {}, 'Fuera de Costa Rica.'), ' No hacemos envíos internacionales, y también se rechaza la compra si la IP del cliente está en otro país.'),
    h('li', {}, h('strong', {}, `Provincias completas: ${enumerar(provinciasSinNada)}.`), ` Ninguno de sus ${provinciasSinNada.reduce((s, p) => s + COBERTURA.cantones[p].length, 0)} cantones tiene entrega.`),
    h(
      'li',
      {},
      h('strong', {}, 'Cantones fuera de la GAM en las otras provincias:'),
      h('ul', { class: 'lista-fuera' }, parciales.map(({ provincia, fuera }) => h('li', {}, h('span', { class: 'lista-fuera-provincia' }, `${provincia} (${fuera.length})`), fuera.join(', ')))),
    ),
    h('li', {}, h('strong', {}, 'Direcciones que no se pueden ubicar.'), ' Si el cantón no existe o no corresponde a la provincia indicada, el pedido se rechaza para no despachar a ciegas.'),
  );
  $('#sin-cobertura').before(h('p', { class: 'resumen-fuera' }, `En total, ${totalFuera} de los ${TOTAL_CANTONES} cantones del país quedan sin entrega.`));

  // Mapa por provincia
  $('#provincias').replaceChildren(
    ...PROVINCIAS.map((provincia) => {
      const cantones = COBERTURA.cantones[provincia];
      const con = cantones.filter((c) => tieneEntrega(c, provincia)).length;
      return h(
        'div',
        { class: 'provincia', dataset: { cobertura: con === 0 ? 'ninguna' : con === cantones.length ? 'total' : 'parcial' } },
        h('div', { class: 'provincia-cabecera' }, h('h3', {}, provincia), h('span', { class: 'provincia-cuenta' }, con === 0 ? 'Sin cobertura' : `${con} de ${cantones.length} con entrega`)),
        h('div', { class: 'medidor', role: 'img', 'aria-label': `${con} de ${cantones.length} cantones con entrega` }, h('i', { style: `width:${(con / cantones.length) * 100}%` })),
        h(
          'ul',
          { class: 'cantones' },
          cantones.map((canton) => {
            const si = tieneEntrega(canton, provincia);
            return h('li', { class: 'canton', dataset: { entrega: String(si) } }, h('span', { 'aria-hidden': 'true' }, si ? '✓' : '✕'), canton, h('span', { class: 'solo-lector' }, si ? ' (con entrega)' : ' (sin entrega)'));
          }),
        ),
      );
    }),
  );

  // Buscador
  $('#lista-cantones').replaceChildren(...[...INDICE_CANTONES.values()].map(({ canton, provincia }) => h('option', { value: canton }, provincia)));
};

$('#buscar-canton').addEventListener('input', (evento) => {
  const texto = evento.target.value.trim();
  const destino = $('#resultado-busqueda');
  if (!texto) return destino.replaceChildren();
  const ubicacion = ubicarCanton(texto);
  if (!ubicacion) {
    destino.replaceChildren(h('p', { class: 'subtitulo' }, `«${texto}» no coincide con ningún cantón todavía.`));
    return;
  }
  destino.replaceChildren(cajaCobertura({ pais: 'CR', canton: ubicacion.canton, provincia: ubicacion.provincia }, false));
});

// ───────────────────────── Tendencia (misma regla que HistorialTendencia) ─────────────────────────

const tasas = (registros) => {
  const total = registros.length || 1;
  const contar = (condicion) => registros.filter(condicion).length;
  return {
    total: registros.length,
    rechazo: contar((r) => r.estado === 'rechazado') / total,
    sinCobertura: contar((r) => r.codigoMotivo === 'SIN_COBERTURA') / total,
    aprobacion: contar((r) => r.estado === 'aprobado') / total,
  };
};

const analizarTendencia = (registros) => {
  const validos = registros.filter((r) => r && r.estado && r.fecha).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, TENDENCIA.ventana * 2);
  const mitad = Math.ceil(validos.length / 2);
  const recientes = tasas(validos.slice(0, mitad));
  const anteriores = tasas(validos.slice(mitad));
  const suficiente = recientes.total >= TENDENCIA.minimoPorBloque && anteriores.total >= TENDENCIA.minimoPorBloque;
  const clasificar = (a, b) => (a - b > TENDENCIA.umbralCambio ? 'empeorando' : b - a > TENDENCIA.umbralCambio ? 'mejorando' : 'estable');
  return {
    suficiente,
    recientes,
    anteriores,
    rechazo: suficiente ? clasificar(recientes.rechazo, anteriores.rechazo) : 'datos_insuficientes',
    cobertura: suficiente ? clasificar(recientes.sinCobertura, anteriores.sinCobertura) : 'datos_insuficientes',
  };
};

const FLECHAS = { mejorando: '↓ mejorando', empeorando: '↑ empeorando', estable: '→ estable', datos_insuficientes: 'sin datos suficientes' };

const pintarTendencia = () => {
  const t = analizarTendencia(estado.ejecuciones);
  const kpi = (etiqueta, valor, nota, tono = null) => h('div', { class: 'kpi', dataset: { tono } }, h('span', {}, etiqueta), h('strong', {}, valor), h('small', {}, nota));
  const tono = (tendencia) => (tendencia === 'empeorando' ? 'mal' : tendencia === 'mejorando' ? 'bien' : null);

  $('#kpis').replaceChildren(
    kpi('Ejecuciones', String(estado.ejecuciones.length), `${t.recientes.total} recientes · ${t.anteriores.total} anteriores`),
    kpi('Aprobación', porcentaje(t.recientes.aprobacion), `antes ${porcentaje(t.anteriores.aprobacion)}`),
    kpi('Rechazo', porcentaje(t.recientes.rechazo), `antes ${porcentaje(t.anteriores.rechazo)} · ${FLECHAS[t.rechazo]}`, tono(t.rechazo)),
    kpi('Sin cobertura', porcentaje(t.recientes.sinCobertura), `antes ${porcentaje(t.anteriores.sinCobertura)} · ${FLECHAS[t.cobertura]}`, tono(t.cobertura)),
  );

  $('#tendencia-texto').textContent = t.suficiente
    ? `Comparando las últimas ${t.recientes.total} ejecuciones con las ${t.anteriores.total} anteriores: el rechazo está ${FLECHAS[t.rechazo].split(' ')[1]} y los pedidos sin cobertura están ${FLECHAS[t.cobertura].split(' ')[1]}.`
    : `Hay ${estado.ejecuciones.length} ejecuciones; se necesitan al menos ${TENDENCIA.minimoPorBloque * 2} para hablar de tendencia.`;

  const ultimas = [...estado.ejecuciones].sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-40);
  $('#franja').replaceChildren(
    ...ultimas.map((e) =>
      h('button', {
        class: 'franja-celda',
        role: 'listitem',
        dataset: { estado: e.estado },
        'aria-label': `${e.pedidoId}: ${ETIQUETAS_ESTADO[e.estado] ?? e.estado}, ${ETIQUETAS_MOTIVO[e.codigoMotivo] ?? e.codigoMotivo ?? ''}, ${fechaCorta(e.fecha)}`,
        onmouseenter: (evento) => mostrarTooltip(evento, e),
        onfocus: (evento) => mostrarTooltip(evento, e),
        onmouseleave: ocultarTooltip,
        onblur: ocultarTooltip,
        onclick: () => abrirDetalle(e.pedidoId),
      }),
    ),
  );
  $('#eje-inicio').textContent = ultimas.length ? fechaCorta(ultimas[0].fecha) : '';
  $('#eje-fin').textContent = ultimas.length ? fechaCorta(ultimas.at(-1).fecha) : 'Sin ejecuciones todavía';
};

const mostrarTooltip = (evento, ejecucion) => {
  const tooltip = $('#tooltip');
  tooltip.replaceChildren(
    h('strong', {}, ejecucion.pedidoId),
    h('div', {}, `${ETIQUETAS_ESTADO[ejecucion.estado] ?? ejecucion.estado} · ${ETIQUETAS_MOTIVO[ejecucion.codigoMotivo] ?? ejecucion.codigoMotivo ?? '—'}`),
    h('div', {}, `${ejecucion.zonaEnvio ? `Zona ${ejecucion.zonaEnvio}` : 'Sin zona'} · IP ${ejecucion.paisIP ?? '—'}`),
    ejecucion.riesgoIA ? h('div', {}, `Riesgo IA: ${ejecucion.riesgoIA}`) : null,
    h('div', {}, fechaCorta(ejecucion.fecha)),
  );
  tooltip.classList.remove('oculto');
  const caja = evento.currentTarget.getBoundingClientRect();
  const ancho = tooltip.offsetWidth;
  tooltip.style.left = `${Math.min(window.innerWidth - ancho - 8, Math.max(8, caja.left + caja.width / 2 - ancho / 2))}px`;
  tooltip.style.top = `${caja.top - tooltip.offsetHeight - 8}px`;
};

const ocultarTooltip = () => $('#tooltip').classList.add('oculto');

// ───────────────────────── Tabla de pedidos ─────────────────────────

const FILTROS = [
  ['todos', 'Todos'],
  ['pendiente', 'Pendientes'],
  ['aprobado', 'Aprobados'],
  ['rechazado', 'Rechazados'],
  ['en_revision', 'En revisión'],
];

const pintarFiltros = () => {
  $('#filtros').replaceChildren(
    ...FILTROS.map(([valor, etiqueta]) => {
      const cantidad = valor === 'todos' ? estado.pedidos.length : estado.pedidos.filter((p) => p.estado === valor).length;
      return h(
        'button',
        {
          class: 'chip',
          'aria-pressed': String(estado.filtro === valor),
          onclick: () => {
            estado.filtro = valor;
            pintarTabla();
          },
        },
        `${etiqueta} (${cantidad})`,
      );
    }),
  );
};

const pintarTabla = () => {
  pintarFiltros();
  const filas = estado.pedidos
    .filter((p) => estado.filtro === 'todos' || p.estado === estado.filtro)
    .sort((a, b) => String(b.fechaEvaluacion ?? b.creadoEn ?? '').localeCompare(String(a.fechaEvaluacion ?? a.creadoEn ?? '')));

  $('#tabla-pedidos').replaceChildren(
    ...(filas.length
      ? filas.map((p) => {
          const cobertura = evaluarDestino(p.direccionEnvio);
          return h(
            'tr',
            {
              tabindex: 0,
              onclick: () => abrirDetalle(p.id),
              onkeydown: (evento) => evento.key === 'Enter' && abrirDetalle(p.id),
            },
            h('td', { class: 'mono' }, p.id),
            h('td', {}, p.cliente?.nombre ?? '—'),
            h(
              'td',
              {},
              h('div', { class: 'celda-entrega' }, h('span', { class: 'punto-cobertura', dataset: { cubierto: String(cobertura.cubierto) }, title: cobertura.cubierto ? 'Dentro de la GAM' : 'Fuera de cobertura' }), describirDestino(p.direccionEnvio) || '—'),
            ),
            h('td', {}, insigniaEstado(p.estado)),
            h('td', { class: 'numero' }, p.costoEnvio === 0 ? 'Gratis' : dinero(p.costoEnvio)),
            h('td', { class: 'numero' }, dinero(p.total)),
            h('td', { class: 'motivo-corto', title: p.motivo ?? '' }, p.motivo ?? '—'),
          );
        })
      : [h('tr', {}, h('td', { colspan: 7, class: 'subtitulo' }, 'No hay pedidos con este estado.'))]),
  );
};

// ───────────────────────── Detalle de pedido ─────────────────────────

const lista = (pares) =>
  h(
    'dl',
    { class: 'lista-definiciones' },
    pares.filter(([, valor]) => valor !== undefined).flatMap(([clave, valor]) => [h('dt', {}, clave), h('dd', {}, valor ?? '—')]),
  );

const seccion = (titulo, contenido) => h('section', { class: 'detalle-seccion' }, h('h3', {}, titulo), contenido);

const abrirDetalle = async (id) => {
  let p = estado.pedidos.find((pedido) => pedido.id === id);
  try {
    p = await jsonServer(`/pedidos/${encodeURIComponent(id)}`);
  } catch {
    // se usa la copia en memoria
  }
  if (!p) return avisar(`El pedido ${id} ya no existe en JSON Server.`, 'error');

  const geo = p.geolocalizacion;
  const clima = p.clima;
  const ia = p.analisisIA;

  $('#detalle-titulo').replaceChildren(`Pedido ${p.id} `, insigniaEstado(p.estado));
  $('#detalle-cuerpo').replaceChildren(
    p.motivo ? h('p', { class: 'motivo' }, p.motivo) : null,
    seccion('Cobertura del destino', cajaCobertura(p.direccionEnvio)),
    seccion(
      'Cliente y envío',
      lista([
        ['Cliente', p.cliente?.nombre],
        ['Correo', p.cliente?.email],
        ['Entrega en', `${p.direccionEnvio?.detalle ?? ''} · ${describirDestino(p.direccionEnvio)}`],
        ['Zona', p.zonaEnvio],
        ['Subtotal / envío / total', `${dinero(p.subtotal)} / ${dinero(p.costoEnvio)} / ${dinero(p.total)}`],
        ['Motivo', ETIQUETAS_MOTIVO[p.codigoMotivo] ?? p.codigoMotivo],
      ]),
    ),
    seccion(
      'Artículos',
      h(
        'div',
        { class: 'tabla-contenedor' },
        h(
          'table',
          { class: 'tabla' },
          h('thead', {}, h('tr', {}, h('th', {}, 'SKU'), h('th', {}, 'Descripción'), h('th', { class: 'numero' }, 'Cant.'), h('th', { class: 'numero' }, 'Precio'), h('th', { class: 'numero' }, 'Peso'))),
          h(
            'tbody',
            {},
            (p.items ?? []).map((i) =>
              h('tr', {}, h('td', { class: 'mono' }, i.sku), h('td', {}, i.descripcion), h('td', { class: 'numero' }, i.cantidad), h('td', { class: 'numero' }, dinero(i.precioUnitario)), h('td', { class: 'numero' }, `${i.pesoKg} kg`)),
            ),
          ),
        ),
      ),
    ),
    geo
      ? seccion(
          'Ubicación de la IP (ip-api)',
          lista([
            ['IP', p.ipCliente],
            ['Ubicación', `${geo.ciudad ?? ''}, ${geo.region ?? ''}, ${geo.pais} (${geo.codigoPais})`],
            ['Proveedor', geo.proveedor],
            ['Proxy / hosting', `${geo.proxy ? 'Sí' : 'No'} / ${geo.hosting ? 'Sí' : 'No'}`],
          ]),
        )
      : null,
    clima
      ? seccion(
          'Clima (Open-Meteo)',
          clima.disponible
            ? lista([
                ['Condición', `${clima.descripcion}${clima.severo ? ' · SEVERO' : ''}`],
                ['Temperatura', `${clima.temperaturaC} °C`],
                ['Precipitación / viento', `${clima.precipitacionMm} mm / ${clima.vientoKmH} km/h`],
              ])
            : h('p', { class: 'subtitulo' }, 'No disponible al momento de evaluar.'),
        )
      : null,
    ia
      ? seccion(
          'Análisis de DeepSeek',
          h(
            'div',
            { class: 'ia' },
            h('h3', {}, `${ia.viable ? 'Viable' : 'No viable'} · riesgo ${ia.riesgo} (${ia.puntaje}/100) · ${ia.modelo ?? ''}`),
            h('ul', {}, ia.motivos.map((m) => h('li', {}, m))),
            h('blockquote', {}, `“${ia.mensajeCliente}”`),
          ),
        )
      : null,
    seccion(
      'Historial de estados',
      (p.historial ?? []).length
        ? h('ol', { class: 'pasos' }, p.historial.map((paso) => h('li', { class: 'paso', dataset: { estado: paso.a === 'aprobado' ? 'ok' : paso.a === 'rechazado' ? 'error' : 'alerta' } }, h('span', { class: 'paso-icono' }, '•'), h('div', {}, h('div', { class: 'paso-titulo' }, `${ETIQUETAS_ESTADO[paso.de] ?? paso.de} → ${ETIQUETAS_ESTADO[paso.a] ?? paso.a}`), h('div', { class: 'paso-detalle' }, `${fechaCorta(paso.fecha)} · ${paso.motivo}`)))))
        : h('p', { class: 'subtitulo' }, 'Todavía no se ha procesado.'),
    ),
  );
  $('#dialogo-detalle').showModal();
};

$('#dialogo-detalle').addEventListener('click', (evento) => {
  if (evento.target === evento.currentTarget || evento.target.closest('[data-cerrar]')) evento.currentTarget.close();
});

// ───────────────────────── Ajustes ─────────────────────────

function abrirAjustes() {
  $('#ajuste-webhook').value = config.webhookUrl;
  $('#ajuste-clave').value = config.clave;
  $('#ajuste-json').value = config.jsonServerUrl;
  $('#dialogo-ajustes').showModal();
}

$('#boton-ajustes').addEventListener('click', abrirAjustes);

$('#dialogo-ajustes').addEventListener('close', () => {
  if ($('#dialogo-ajustes').returnValue !== 'guardar') return;
  config.webhookUrl = $('#ajuste-webhook').value.trim();
  config.clave = $('#ajuste-clave').value.trim();
  config.jsonServerUrl = $('#ajuste-json').value.trim().replace(/\/$/, '');
  almacen.guardar('webhookUrl', config.webhookUrl);
  almacen.guardar('clave', config.clave);
  almacen.guardar('jsonServerUrl', config.jsonServerUrl);
  avisar('Ajustes guardados.', 'ok');
  verificarServicios();
  cargarDatos();
});

$('#boton-recargar').addEventListener('click', async () => {
  await Promise.all([verificarServicios(), cargarDatos()]);
  avisar('Datos actualizados.', 'ok');
});

// ───────────────────────── Inicio ─────────────────────────

const iniciar = () => {
  aplicarTema(document.documentElement.dataset.theme);
  irA(location.hash.slice(1) || 'procesar');

  $('#envio-provincia').replaceChildren(
    ...PROVINCIAS.map((provincia) => h('option', { value: provincia }, COBERTURA.cantonesGAM[provincia] ? provincia : `${provincia} (sin cobertura)`)),
  );
  $('#ejemplos-pedido').replaceChildren(
    ...Object.keys(PEDIDOS_EJEMPLO).map((nombre) => h('button', { type: 'button', class: 'chip', dataset: { nombre }, onclick: () => cargarEjemploPedido(nombre) }, nombre)),
  );
  $('#ejemplos-ip').replaceChildren(
    ...IPS_EJEMPLO.map(([nombre, ip]) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          dataset: { ip },
          title: ip,
          onclick: () => {
            $('#ip-cliente').value = ip;
            marcarChipIp();
          },
        },
        nombre,
      ),
    ),
    h('button', { type: 'button', class: 'chip', onclick: usarMiIp }, 'Mi IP pública'),
  );
  $('#agregar-item').addEventListener('click', () => {
    $('#items').append(filaItem());
    actualizarResumenNuevo();
  });
  for (const id of ['#envio-ciudad', '#envio-detalle']) $(id).addEventListener('input', actualizarAvisoProcesar);

  pintarCobertura();
  cargarEjemploPedido(Object.keys(PEDIDOS_EJEMPLO)[0]);
  $('#ip-cliente').value = '201.191.20.10';
  marcarChipIp();

  verificarServicios();
  cargarDatos();
  setInterval(verificarServicios, 30000);

  if (!config.clave) setTimeout(abrirAjustes, 400);
};

iniciar();

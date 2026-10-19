/**
 * Definición del workflow de n8n como código.
 *
 * scripts/generar-nodos-n8n.js usa construirWorkflowPrincipal() para escribir el
 * JSON importable, inyectando en los nodos Code el código generado desde src/.
 * Editar aquí (no en el JSON) para que nada se desincronice.
 */

/** Nombres de nodo: se usan en conexiones, expresiones y adaptadores. */
export const NODOS = Object.freeze({
  webhook: 'Recibir pedido',
  configuracion: 'Configuración',
  consultarPedido: 'Consultar pedido en JSON Server',
  geolocalizar: 'Geolocalizar IP (ip-api)',
  consultarClima: 'Consultar clima (Open-Meteo)',
  combinar: 'Combinar geolocalización y clima',
  evaluarCobertura: 'Evaluar cobertura (POO)',
  siCobertura: '¿Tiene cobertura?',
  analizarIA: 'Analizar riesgo con DeepSeek',
  consolidar: 'Consolidar decisión (POO)',
  siActualizar: '¿Requiere actualizar el pedido?',
  actualizarPedido: 'Actualizar pedido en JSON Server',
  registrarEjecucion: 'Registrar ejecución en historial',
  consultarHistorial: 'Consultar historial de ejecuciones',
  analizarTendencia: 'Analizar tendencia (POO)',
  responderResultado: 'Responder resultado',
  siNotificar: '¿Requiere notificación?',
  enviarCorreo: 'Enviar alerta por correo',
  responderSinCambios: 'Responder sin cambios',
  registrarError: 'Registrar error inesperado',
  responderError: 'Responder error interno',
});

const URL_JSON_SERVER_POR_DEFECTO = 'http://localhost:3000';

/**
 * Proveedor del modelo DeepSeek (API compatible con OpenAI en ambos casos):
 *  - OpenRouter:      https://openrouter.ai/api/v1/chat/completions · deepseek/deepseek-chat
 *  - DeepSeek directo: https://api.deepseek.com/chat/completions     · deepseek-chat
 * Se cambia en el nodo "Configuración" junto con la credencial "DeepSeek API".
 */
const IA_POR_DEFECTO = { url: 'https://openrouter.ai/api/v1/chat/completions', modelo: 'deepseek/deepseek-chat' };

/** Reto 3 · Destinatario y remitente de las alertas (se cambian en "Configuración"). */
const CORREO_POR_DEFECTO = { alertas: 'alertas@example.com', remitente: 'alertas@example.com' };

const CAMPOS_IP_API = 'status,message,country,countryCode,regionName,city,lat,lon,isp,proxy,hosting,query';
const CAMPOS_CLIMA = 'temperature_2m,precipitation,weather_code,wind_speed_10m';

/** Expresión n8n que lee un campo del cuerpo del webhook sin fallar si no hay cuerpo. */
const campoWebhook = (campo) => `encodeURIComponent(String(($('${NODOS.webhook}').first().json.body || {}).${campo} || ''))`;

const configuracion = `$('${NODOS.configuracion}').first().json`;
const urlJsonServer = `${configuracion}.jsonServerUrl`;

/** La decisión viene de la fase 2 si DeepSeek se consultó, o de la fase 1 si no. */
const decisionTomada = `($('${NODOS.consolidar}').isExecuted ? $('${NODOS.consolidar}') : $('${NODOS.evaluarCobertura}')).first().json`;
const notificacion = `$('${NODOS.analizarTendencia}').first().json.notificacion`;

/** Política común de los nodos HTTP: reintento corto y nunca detener el flujo; la clase decide. */
const TOLERANCIA_A_FALLAS = { retryOnFail: true, maxTries: 2, waitBetweenTries: 1000, onError: 'continueRegularOutput' };

/**
 * Nodos Code: las fallas previstas ya las resuelven las clases; si aun así algo lanza
 * una excepción (bug), sale por la salida de error hacia el registro de errores
 * del mismo flujo en lugar de dejar al cliente del webhook sin respuesta.
 */
const SALIDA_DE_ERROR = { onError: 'continueErrorOutput' };

const OPCIONES_CONDICION = { caseSensitive: true, leftValue: '', typeValidation: 'strict' };

const condicionIgualA = (id, expresion, valor) => ({
  conditions: {
    options: OPCIONES_CONDICION,
    conditions: [{ id, leftValue: expresion, rightValue: valor, operator: { type: 'string', operation: 'equals' } }],
    combinator: 'and',
  },
  options: {},
});

const condicionVerdadera = (id, expresion) => ({
  conditions: {
    options: OPCIONES_CONDICION,
    conditions: [{ id, leftValue: expresion, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  },
  options: {},
});

const nota = (id, contenido, posicion, ancho, alto, color) => ({
  parameters: { content: contenido, width: ancho, height: alto, color },
  id,
  name: `Nota ${id.slice(-1).toUpperCase()}`,
  type: 'n8n-nodes-base.stickyNote',
  typeVersion: 1,
  position: posicion,
});

/** Conexión de un nodo a uno o varios destinos por salida; index = entrada del destino. */
const destino = (node, index = 0) => ({ node, type: 'main', index });
const conectar = (...salidas) => ({
  main: salidas.map((salida) => salida.map((nodo) => (typeof nodo === 'string' ? destino(nodo) : nodo))),
});

const httpRequest = (id, nombre, posicion, parametros, extra = {}) => ({
  parameters: parametros,
  id,
  name: nombre,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: posicion,
  ...TOLERANCIA_A_FALLAS,
  ...extra,
});

const nodoCode = (id, nombre, posicion, jsCode, extra = {}) => ({
  parameters: { jsCode, ...extra },
  id,
  name: nombre,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: posicion,
  ...SALIDA_DE_ERROR,
});

const responder = (id, nombre, posicion, cuerpo, codigo) => ({
  parameters: { respondWith: 'json', responseBody: cuerpo, options: { responseCode: codigo } },
  id,
  name: nombre,
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.1,
  position: posicion,
});

/**
 * Workflow principal:
 * Webhook → JSON Server → ip-api ─┬──────────────────────┐
 *                                  └→ Open-Meteo ─→ Merge ┴→ Code POO → IF → DeepSeek → Code POO
 * → PATCH → historial → tendencia (Code POO) → respuesta + correo.
 * @param {{ codigoEvaluarCobertura: string, codigoConsolidarDecision: string, codigoAnalizarTendencia: string }} codigos
 */
export const construirWorkflowPrincipal = ({ codigoEvaluarCobertura, codigoConsolidarDecision, codigoAnalizarTendencia }) => ({
  name: '[Laboratorio1] pedidos - verificar cobertura geográfica',
  nodes: [
    nota(
      'a1000000-0000-4000-8000-00000000009a',
      '## 1 · Entrada, geolocalización y clima\nWebhook con **Header Auth** (`X-API-Key`): `{ "pedidoId", "ipCliente" }`.\n**Reto 2:** ip-api y Open-Meteo (con la lat/lon de la IP) se unen en el nodo **Merge** antes de decidir.',
      [-60, 60],
      1300,
      200,
      7,
    ),
    nota(
      'a1000000-0000-4000-8000-00000000009b',
      '## 2 · Lógica POO\nLos 3 nodos Code contienen **las mismas clases de `src/`** (Pedido → PedidoNacional / PedidoInternacional, ValidadorCobertura, AnalizadorClima, AnalizadorRiesgoIA, HistorialTendencia, NotificadorAlertas, GestorPedidos), generadas con `npm run build:n8n`. No editar aquí.',
      [1260, 60],
      900,
      200,
      4,
    ),
    nota(
      'a1000000-0000-4000-8000-00000000009c',
      '## 3 · Historial, tendencia y alertas\n**Reto 4:** cada decisión se guarda en `/ejecuciones` y `HistorialTendencia` concluye si el rechazo mejora o empeora.\n**Reto 3:** rechazos por cobertura o riesgo y fallas críticas se notifican por correo (SMTP).',
      [2180, 60],
      1500,
      200,
      5,
    ),
    nota(
      'a1000000-0000-4000-8000-00000000009d',
      '## 4 · Errores inesperados\nSi un nodo Code lanza una excepción no prevista, su **salida de error** registra la falla en `/erroresFlujo` y responde **500**.',
      [1500, 700],
      700,
      160,
      3,
    ),
    {
      parameters: {
        httpMethod: 'POST',
        path: 'pedidos/verificar-cobertura',
        authentication: 'headerAuth',
        responseMode: 'responseNode',
        options: { allowedOrigins: '*' },
      },
      id: 'a1000000-0000-4000-8000-000000000001',
      name: NODOS.webhook,
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 320],
      webhookId: 'b7c2f0a4-5d1e-4c3a-9f8e-2a6d4b1c0e91',
      credentials: { httpHeaderAuth: { id: '', name: 'Webhook pedidos (Header Auth)' } },
    },
    {
      parameters: {
        mode: 'raw',
        jsonOutput:
          `{\n  "jsonServerUrl": "${URL_JSON_SERVER_POR_DEFECTO}",\n  "iaUrl": "${IA_POR_DEFECTO.url}",\n  "iaModelo": "${IA_POR_DEFECTO.modelo}",\n` +
          `  "correoAlertas": "${CORREO_POR_DEFECTO.alertas}",\n  "correoRemitente": "${CORREO_POR_DEFECTO.remitente}"\n}\n`,
        options: {},
      },
      id: 'a1000000-0000-4000-8000-000000000002',
      name: NODOS.configuracion,
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [220, 320],
    },
    httpRequest('a1000000-0000-4000-8000-000000000003', NODOS.consultarPedido, [440, 320], {
      url: `={{ ${urlJsonServer} }}/pedidos/{{ ${campoWebhook('pedidoId')} }}`,
      options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 5000 },
    }),
    httpRequest('a1000000-0000-4000-8000-000000000004', NODOS.geolocalizar, [660, 320], {
      url: `=http://ip-api.com/json/{{ ${campoWebhook('ipCliente')} }}?fields=${CAMPOS_IP_API}&lang=es`,
      options: { timeout: 5000 },
    }),
    httpRequest('a1000000-0000-4000-8000-000000000015', NODOS.consultarClima, [880, 460], {
      url: `=https://api.open-meteo.com/v1/forecast?latitude={{ $json.lat }}&longitude={{ $json.lon }}&current=${CAMPOS_CLIMA}&timezone=auto`,
      options: { timeout: 5000 },
    }),
    {
      parameters: { mode: 'combine', combineBy: 'combineByPosition', options: {} },
      id: 'a1000000-0000-4000-8000-000000000016',
      name: NODOS.combinar,
      type: 'n8n-nodes-base.merge',
      typeVersion: 3,
      position: [1100, 320],
    },
    nodoCode('a1000000-0000-4000-8000-000000000005', NODOS.evaluarCobertura, [1320, 320], codigoEvaluarCobertura),
    {
      parameters: condicionIgualA('c1000000-0000-4000-8000-000000000001', '={{ $json.accion }}', 'evaluar_ia'),
      id: 'a1000000-0000-4000-8000-000000000006',
      name: NODOS.siCobertura,
      type: 'n8n-nodes-base.if',
      typeVersion: 2,
      position: [1540, 320],
    },
    httpRequest(
      'a1000000-0000-4000-8000-000000000007',
      NODOS.analizarIA,
      [1760, 200],
      {
        method: 'POST',
        url: `={{ ${configuracion}.iaUrl }}`,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify(Object.assign({}, $json.solicitudIA, { model: ${configuracion}.iaModelo })) }}`,
        options: { timeout: 30000 },
      },
      { credentials: { httpHeaderAuth: { id: '', name: 'DeepSeek API' } } },
    ),
    nodoCode('a1000000-0000-4000-8000-000000000008', NODOS.consolidar, [1980, 200], codigoConsolidarDecision),
    {
      parameters: condicionIgualA('c1000000-0000-4000-8000-000000000002', '={{ $json.accion }}', 'actualizar'),
      id: 'a1000000-0000-4000-8000-000000000009',
      name: NODOS.siActualizar,
      type: 'n8n-nodes-base.if',
      typeVersion: 2,
      position: [1760, 440],
    },
    httpRequest('a1000000-0000-4000-8000-000000000010', NODOS.actualizarPedido, [2200, 320], {
      method: 'PATCH',
      url: `={{ ${urlJsonServer} }}/pedidos/{{ encodeURIComponent($json.pedidoId) }}`,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.actualizacion) }}',
      options: { timeout: 5000 },
    }),
    httpRequest('a1000000-0000-4000-8000-000000000017', NODOS.registrarEjecucion, [2420, 320], {
      method: 'POST',
      url: `={{ ${urlJsonServer} }}/ejecuciones`,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify(${decisionTomada}.registroHistorial) }}`,
      options: { timeout: 5000 },
    }),
    httpRequest(
      'a1000000-0000-4000-8000-000000000018',
      NODOS.consultarHistorial,
      [2640, 320],
      { url: `={{ ${urlJsonServer} }}/ejecuciones?_sort=fecha&_order=desc&_limit=20`, options: { timeout: 5000 } },
      { alwaysOutputData: true },
    ),
    nodoCode('a1000000-0000-4000-8000-000000000019', NODOS.analizarTendencia, [2860, 320], codigoAnalizarTendencia),
    responder(
      'a1000000-0000-4000-8000-000000000011',
      NODOS.responderResultado,
      [3080, 220],
      '={{ JSON.stringify($json.respuesta) }}',
      '={{ $json.httpStatus }}',
    ),
    {
      parameters: condicionVerdadera('c1000000-0000-4000-8000-000000000003', `={{ ${notificacion}.debeNotificar }}`),
      id: 'a1000000-0000-4000-8000-000000000020',
      name: NODOS.siNotificar,
      type: 'n8n-nodes-base.if',
      typeVersion: 2,
      position: [3080, 440],
    },
    {
      parameters: {
        fromEmail: `={{ ${configuracion}.correoRemitente }}`,
        toEmail: `={{ ${configuracion}.correoAlertas }}`,
        subject: `={{ ${notificacion}.asunto }}`,
        emailFormat: 'html',
        html: `={{ ${notificacion}.html }}`,
        options: { appendAttribution: false },
      },
      id: 'a1000000-0000-4000-8000-000000000021',
      name: NODOS.enviarCorreo,
      type: 'n8n-nodes-base.emailSend',
      typeVersion: 2.1,
      position: [3300, 420],
      credentials: { smtp: { id: '', name: 'SMTP account' } },
      onError: 'continueRegularOutput',
    },
    responder(
      'a1000000-0000-4000-8000-000000000012',
      NODOS.responderSinCambios,
      [1980, 560],
      '={{ JSON.stringify({ ok: false, pedidoId: $json.pedidoId, mensaje: $json.mensaje }) }}',
      '={{ $json.httpStatus }}',
    ),
    httpRequest(
      'a1000000-0000-4000-8000-000000000013',
      NODOS.registrarError,
      [1540, 900],
      {
        method: 'POST',
        url: `={{ ${urlJsonServer} }}/erroresFlujo`,
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ flujo: $workflow.name, nodo: $prevNode.name, mensaje: String($json.error && $json.error.message ? $json.error.message : $json.error).slice(0, 500), pedidoId: ($('${NODOS.webhook}').first().json.body || {}).pedidoId || null, ejecucionId: $execution.id, fecha: $now.toISO() }) }}`,
        options: { timeout: 5000 },
      },
      { retryOnFail: false },
    ),
    responder(
      'a1000000-0000-4000-8000-000000000014',
      NODOS.responderError,
      [1760, 900],
      '={{ JSON.stringify({ ok: false, mensaje: "Error interno al evaluar el pedido; el equipo fue notificado" }) }}',
      500,
    ),
  ],
  connections: {
    [NODOS.webhook]: conectar([NODOS.configuracion]),
    [NODOS.configuracion]: conectar([NODOS.consultarPedido]),
    [NODOS.consultarPedido]: conectar([NODOS.geolocalizar]),
    // Reto 2 · ip-api va directo al Merge (entrada 1) y también alimenta a Open-Meteo (entrada 2)
    [NODOS.geolocalizar]: conectar([destino(NODOS.combinar, 0), NODOS.consultarClima]),
    [NODOS.consultarClima]: conectar([destino(NODOS.combinar, 1)]),
    [NODOS.combinar]: conectar([NODOS.evaluarCobertura]),
    // Nodos Code: salida 0 = éxito, salida 1 = error inesperado
    [NODOS.evaluarCobertura]: conectar([NODOS.siCobertura], [NODOS.registrarError]),
    [NODOS.siCobertura]: conectar([NODOS.analizarIA], [NODOS.siActualizar]),
    [NODOS.analizarIA]: conectar([NODOS.consolidar]),
    [NODOS.consolidar]: conectar([NODOS.actualizarPedido], [NODOS.registrarError]),
    [NODOS.siActualizar]: conectar([NODOS.actualizarPedido], [NODOS.responderSinCambios]),
    [NODOS.actualizarPedido]: conectar([NODOS.registrarEjecucion]),
    [NODOS.registrarEjecucion]: conectar([NODOS.consultarHistorial]),
    [NODOS.consultarHistorial]: conectar([NODOS.analizarTendencia]),
    // La respuesta sale primero; el correo se envía después sin retrasar al cliente
    [NODOS.analizarTendencia]: conectar([NODOS.responderResultado, NODOS.siNotificar], [NODOS.registrarError]),
    [NODOS.siNotificar]: conectar([NODOS.enviarCorreo]),
    [NODOS.registrarError]: conectar([NODOS.responderError]),
  },
  pinData: {},
  settings: { executionOrder: 'v1' },
  active: false,
});

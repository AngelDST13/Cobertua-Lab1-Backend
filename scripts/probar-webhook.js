/**
 * Prueba de punta a punta contra el workflow activo en n8n.
 *
 *   npm run probar -- <clave X-API-Key>
 *   (o la variable de entorno N8N_WEBHOOK_KEY)
 *
 * Restaura db.json, envía un POST por cada caso, compara la respuesta con lo
 * esperado y verifica el estado guardado en JSON Server. Requiere JSON Server
 * (npm run db) y n8n con el workflow activo.
 *
 * Nota: abrir la URL del webhook en el navegador hace un GET y n8n responde 404
 * ("not registered for GET requests"). El webhook solo acepta POST.
 */
import { copyFileSync } from 'node:fs';

const URL_WEBHOOK = process.env.N8N_WEBHOOK_URL ?? 'http://localhost:5678/webhook/pedidos/verificar-cobertura';
const URL_JSON_SERVER = process.env.JSON_SERVER_URL ?? 'http://localhost:3000';
const CLAVE = process.argv[2] ?? process.env.N8N_WEBHOOK_KEY;

if (!CLAVE) {
  console.error('Falta la clave del webhook: npm run probar -- <clave>  (o N8N_WEBHOOK_KEY)');
  process.exit(1);
}

/** estado: estado esperado en JSON Server (null = el pedido no debe cambiar). */
const CASOS = [
  { nombre: 'Sin clave → bloqueado', cuerpo: { pedidoId: 'PED-1003', ipCliente: '8.8.8.8' }, sinClave: true, http: 403 },
  { nombre: 'R2 · Destino fuera de Costa Rica', cuerpo: { pedidoId: 'PED-1003', ipCliente: '201.191.20.10' }, http: 200, estado: ['rechazado'], codigo: 'SIN_COBERTURA', correo: true },
  { nombre: 'Nacional → clima + DeepSeek deciden', cuerpo: { pedidoId: 'PED-1001', ipCliente: '201.191.20.10' }, http: 200, estado: ['aprobado', 'rechazado', 'en_revision'], tipo: 'nacional' },
  { nombre: 'R2 · Cantón fuera de la GAM (Grecia)', cuerpo: { pedidoId: 'PED-1008', ipCliente: '201.191.20.10' }, http: 200, estado: ['rechazado'], codigo: 'SIN_COBERTURA', correo: true },
  { nombre: 'R2 · IP fuera de cobertura', cuerpo: { pedidoId: 'PED-1005', ipCliente: '81.38.10.12' }, http: 200, estado: ['rechazado'], codigo: 'SIN_COBERTURA', correo: true },
  { nombre: 'R1 · IP privada', cuerpo: { pedidoId: 'PED-1002', ipCliente: '192.168.1.15' }, http: 200, estado: ['rechazado'] },
  { nombre: 'R1 · IP mal formada', cuerpo: { pedidoId: 'PED-1007', ipCliente: '999.1.1.1' }, http: 200, estado: ['rechazado'] },
  { nombre: 'R5 · Pedido ya procesado', cuerpo: { pedidoId: 'PED-1006', ipCliente: '8.8.8.8' }, http: 409, estado: null },
  { nombre: 'Pedido inexistente', cuerpo: { pedidoId: 'PED-9999', ipCliente: '8.8.8.8' }, http: 404, estado: null },
  { nombre: 'Solicitud sin pedidoId', cuerpo: { ipCliente: '8.8.8.8' }, http: 400, estado: null },
];

const enviar = async ({ cuerpo, sinClave }) => {
  const encabezados = { 'Content-Type': 'application/json' };
  if (!sinClave) encabezados['X-API-Key'] = CLAVE;
  const respuesta = await fetch(URL_WEBHOOK, { method: 'POST', headers: encabezados, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(90_000) });
  const texto = await respuesta.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    // respuestas de n8n como "Authorization data is wrong!" no son JSON
  }
  return { http: respuesta.status, json, texto };
};

const leerPedido = async (id) => {
  const respuesta = await fetch(`${URL_JSON_SERVER}/pedidos/${encodeURIComponent(id)}`);
  return respuesta.ok ? respuesta.json() : null;
};

const verificarServicio = async (nombre, url) => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch {
    console.error(`✖ ${nombre} no responde en ${url}. Levántalo antes de probar.`);
    process.exit(1);
  }
};

await verificarServicio('JSON Server', `${URL_JSON_SERVER}/pedidos`);
await verificarServicio('n8n', new URL('/healthz', URL_WEBHOOK).href);

copyFileSync(new URL('../datos/db.seed.json', import.meta.url), new URL('../db.json', import.meta.url));
await new Promise((resolver) => setTimeout(resolver, 1500)); // json-server --watch recarga el archivo

let fallas = 0;
for (const caso of CASOS) {
  const antes = caso.cuerpo.pedidoId ? await leerPedido(caso.cuerpo.pedidoId) : null;
  const { http, json, texto } = await enviar(caso);
  const despues = caso.cuerpo.pedidoId ? await leerPedido(caso.cuerpo.pedidoId) : null;

  const problemas = [];
  if (http !== caso.http) problemas.push(`HTTP ${http}, se esperaba ${caso.http}`);
  if (caso.estado && !caso.estado.includes(despues?.estado)) problemas.push(`estado guardado "${despues?.estado}", se esperaba ${caso.estado.join(' | ')}`);
  if (caso.estado === null && antes && despues?.estado !== antes.estado) problemas.push('el pedido cambió y no debía');
  if (caso.costoMinimo !== undefined && !(despues?.costoEnvio >= caso.costoMinimo)) problemas.push(`envío ${despues?.costoEnvio}, se esperaba ≥ ${caso.costoMinimo}`);
  if (caso.tipo && json?.tipoPedido !== caso.tipo) problemas.push(`tipo "${json?.tipoPedido}", se esperaba ${caso.tipo}`);
  if (caso.codigo && json?.codigoMotivo !== caso.codigo) problemas.push(`código "${json?.codigoMotivo}", se esperaba ${caso.codigo}`);
  if (caso.estado && http === 200 && !json?.tendencia?.conclusion) problemas.push('la respuesta no trae la tendencia (Reto 4)');
  if (caso.correo !== undefined && json?.notificacion?.programada !== caso.correo) problemas.push(`correo programado = ${json?.notificacion?.programada}`);

  const extras = [json?.tipoPedido, json?.clima?.disponible ? `clima: ${json.clima.descripcion}${json.clima.severo ? ' (severo)' : ''}` : null, json?.notificacion?.programada ? '✉ correo' : null].filter(Boolean);
  const detalle = `${json?.motivo ?? json?.mensaje ?? texto.slice(0, 120)}${extras.length ? `  {${extras.join(' · ')}}` : ''}`;
  if (problemas.length === 0) {
    console.log(`✔ ${caso.nombre}  [HTTP ${http}${despues && caso.estado ? ` · ${despues.estado}` : ''}]  ${detalle}`);
  } else {
    fallas += 1;
    console.log(`✖ ${caso.nombre}: ${problemas.join('; ')}\n    respuesta: ${texto.slice(0, 300)}`);
  }
}

const ejecuciones = await (await fetch(`${URL_JSON_SERVER}/ejecuciones`)).json();
console.log(`
ℹ Reto 4 · historial: ${ejecuciones.length} ejecuciones registradas en /ejecuciones`);

const deepSeek = await leerPedido('PED-1003');
if (deepSeek?.estado === 'en_revision') {
  console.log('\nℹ PED-1003 quedó en_revision: DeepSeek no respondió. Revisa la credencial "DeepSeek API" en n8n (Bearer <tu API key>).');
}

copyFileSync(new URL('../datos/db.seed.json', import.meta.url), new URL('../db.json', import.meta.url));
console.log(`\n${CASOS.length - fallas}/${CASOS.length} casos correctos · db.json restaurado`);
process.exit(fallas === 0 ? 0 : 1);

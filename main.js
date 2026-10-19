/**
 * Demostración independiente de las clases POO (sin n8n, sin red).
 *
 *   npm start      →  node main.js
 *
 * Parte 1: clases usadas de forma directa (Pedido, ValidadorCobertura).
 * Parte 2: Reto 1 · herencia y polimorfismo (PedidoNacional / PedidoInternacional).
 * Parte 3: flujo completo con GestorPedidos, alimentado con respuestas simuladas
 *          de JSON Server, ip-api, Open-Meteo y DeepSeek idénticas a las de n8n,
 *          incluyendo historial, tendencia (Reto 4) y alertas por correo (Reto 3).
 */
import {
  ACCIONES,
  AnalizadorClima,
  GestorPedidos,
  HistorialTendencia,
  Pedido,
  ValidadorCobertura,
  crearPedido,
} from './src/index.js';
import {
  CLIMA,
  GEO,
  IA,
  ZONAS_PRUEBA,
  cargarPedidosSemilla,
  combinarGeoYClima,
  respuestaServicioCaido,
  simularConsultaPedido,
} from './datos/respuestasSimuladas.js';

const pedidosSemilla = cargarPedidosSemilla();
const registro = (id) => pedidosSemilla.find((pedido) => pedido.id === id);
const validador = new ValidadorCobertura();

const titulo = (texto) => console.log(`\n${'='.repeat(78)}\n${texto}\n${'='.repeat(78)}`);

// ─────────────────────────────────────────────────────────────────────
titulo('PARTE 1 · Clases usadas de forma directa');
// ─────────────────────────────────────────────────────────────────────

const pedido = new Pedido(registro('PED-1002'));
console.log(`Pedido ${pedido.id} · subtotal $${pedido.subtotal} · peso ${pedido.pesoTotalKg} kg`);
console.log('validarEstructura():', pedido.validarEstructura());

for (const ip of ['201.191.20.10', '192.168.1.15', '999.10.10.1', '2001:db8::1', '2800:860:1::5']) {
  const { valida, motivo } = validador.validarIP(ip);
  console.log(`validarIP("${ip}") → ${valida ? 'válida' : `inválida: ${motivo}`}`);
}

const geo = validador.procesarGeolocalizacion(GEO.costaRica);
const zonaNacional = validador.determinarZona(geo.codigoPais);
console.log(`Geolocalización: ${geo.ciudad}, ${geo.pais} → zona ${zonaNacional.codigo}`);
console.log(`Pedido base · calcularCostoEnvio(${zonaNacional.codigo}): $${pedido.calcularCostoEnvio(zonaNacional)}`);

// R2 · Solo se entrega en los cantones de la GAM
for (const direccion of [
  { pais: 'CR', provincia: 'San José', canton: 'Escazú' },
  { pais: 'CR', provincia: 'Cartago', ciudad: 'Tres Ríos' },
  { pais: 'CR', provincia: 'San José', canton: 'Pérez Zeledón' },
  { pais: 'CR', provincia: 'Guanacaste', canton: 'Liberia' },
  { pais: 'PA', canton: 'Ciudad de Panamá' },
]) {
  const destino = validador.evaluarDestino(direccion);
  console.log(`evaluarDestino(${direccion.canton ?? direccion.ciudad}) → ${destino.cubierto ? `con cobertura (${destino.canton}, ${destino.provincia})` : destino.motivo}`);
}

// ─────────────────────────────────────────────────────────────────────
titulo('PARTE 2 · Reto 1: herencia y polimorfismo');
// ─────────────────────────────────────────────────────────────────────

const climaNormal = new AnalizadorClima().interpretar(CLIMA.despejado);
const climaTormenta = new AnalizadorClima().interpretar(CLIMA.tormenta);
console.log(`Clima normal: ${climaNormal.descripcion} · Clima severo: ${climaTormenta.descripcion} (${climaTormenta.motivos.join(', ')})`);

// El mismo código recorre pedidos de distinto tipo: cada uno calcula a su manera.
// La tienda solo entrega en la GAM; las zonas internacionales son de prueba (ZONAS_PRUEBA).
const zonaPorPais = { CR: zonaNacional, US: ZONAS_PRUEBA.NORTEAMERICA, PA: ZONAS_PRUEBA.CENTROAMERICA };
const flota = ['PED-1002', 'PED-1001', 'PED-1003', 'PED-1004'].map((id) => crearPedido(registro(id)));
const filas = flota.map((p) => {
  const zona = zonaPorPais[p.direccionEnvio.pais];
  const normal = crearPedido(registro(p.id)).calcularCostoEnvio(zona, climaNormal);
  const conTormenta = crearPedido(registro(p.id)).calcularCostoEnvio(zona, climaTormenta);
  return {
    pedido: p.id,
    clase: p.constructor.name,
    zona: zona.codigo,
    subtotal: p.subtotal,
    'envío normal': normal,
    'envío con tormenta': conTormenta,
    restricciones: p.validarRestricciones().length || '-',
  };
});
console.table(filas);
console.log('PedidoNacional: recargo climático fijo de $2 y respeta el envío gratis.');
console.log('PedidoInternacional: seguro de 1.5 % (mín. $3), +20 % por clima y límites aduaneros:');
console.log(' ', flota[3].validarRestricciones());

// ─────────────────────────────────────────────────────────────────────
titulo('PARTE 3 · Flujo completo (misma lógica que los 3 nodos Code de n8n)');
// ─────────────────────────────────────────────────────────────────────

let reloj = Date.parse('2026-10-19T15:00:00.000Z');
const gestor = new GestorPedidos({ ahora: () => new Date((reloj += 60_000)).toISOString() });
const historialEjecuciones = []; // simula la colección "ejecuciones" de JSON Server

/** Reproduce el recorrido del workflow: Merge → Fase 1 → IF → DeepSeek → Fase 2 → PATCH → historial → Fase 3. */
const procesarComoN8n = ({ pedidoId, ipCliente, respuestaGeo, respuestaClima = CLIMA.despejado, respuestaIA }) => {
  const combinado = combinarGeoYClima(respuestaGeo, respuestaClima); // nodo Merge
  let decision = gestor.evaluarCobertura({
    entrada: { pedidoId, ipCliente },
    respuestaPedido: simularConsultaPedido(pedidosSemilla, pedidoId),
    respuestaGeo: combinado,
    respuestaClima: combinado,
  });
  if (decision.accion === ACCIONES.EVALUAR_IA) decision = gestor.consolidarDecision({ resultadoCobertura: decision, respuestaIA });
  if (decision.accion !== ACCIONES.ACTUALIZAR) return { decision, cierre: null };

  historialEjecuciones.push(decision.registroHistorial); // POST /ejecuciones
  const cierre = gestor.cerrarEjecucion({
    decision,
    respuestaGuardado: { id: decision.pedidoId, ...decision.actualizacion }, // PATCH exitoso
    historial: [...historialEjecuciones],
  });
  return { decision, cierre };
};

const escenarios = [
  { nombre: 'Nacional con envío gratis', pedidoId: 'PED-1001', ipCliente: '201.191.20.10', respuestaGeo: GEO.costaRica, respuestaIA: IA.riesgoBajo },
  { nombre: 'R2 · Destino fuera de Costa Rica', pedidoId: 'PED-1003', ipCliente: '201.191.20.10', respuestaGeo: GEO.costaRica },
  { nombre: 'R2 · Cantón fuera de la GAM', pedidoId: 'PED-1008', ipCliente: '201.191.20.10', respuestaGeo: GEO.costaRica },
  { nombre: 'Nacional con tormenta', pedidoId: 'PED-1002', ipCliente: '201.191.20.10', respuestaGeo: GEO.costaRica, respuestaClima: CLIMA.tormenta, respuestaIA: IA.riesgoBajo },
  { nombre: 'R1 · IP privada', pedidoId: 'PED-1002', ipCliente: '192.168.1.15', respuestaGeo: GEO.ipNoUbicable },
  { nombre: 'R2 · País sin cobertura', pedidoId: 'PED-1005', ipCliente: '81.38.10.12', respuestaGeo: GEO.espana },
  { nombre: 'R3 · Peso excedido', pedidoId: 'PED-1007', ipCliente: '201.191.20.10', respuestaGeo: GEO.costaRica },
  { nombre: 'R4 · DeepSeek: riesgo alto', pedidoId: 'PED-1002', ipCliente: '201.191.20.10', respuestaGeo: GEO.costaRica, respuestaIA: IA.riesgoAlto },
  { nombre: 'R5 · Pedido ya procesado', pedidoId: 'PED-1006', ipCliente: '201.191.20.10', respuestaGeo: GEO.costaRica },
  { nombre: 'Error · ip-api caída', pedidoId: 'PED-1002', ipCliente: '201.191.20.10', respuestaGeo: respuestaServicioCaido() },
  { nombre: 'Error · Open-Meteo caído (no bloquea)', pedidoId: 'PED-1002', ipCliente: '201.191.20.10', respuestaGeo: GEO.costaRica, respuestaClima: respuestaServicioCaido(), respuestaIA: IA.riesgoBajo },
  { nombre: 'Error · DeepSeek caída', pedidoId: 'PED-1001', ipCliente: '201.191.20.10', respuestaGeo: GEO.costaRica, respuestaIA: respuestaServicioCaido('Request failed with status code 503') },
  { nombre: 'Error · Pedido inexistente', pedidoId: 'PED-9999', ipCliente: '201.191.20.10', respuestaGeo: GEO.costaRica },
];

const resumen = escenarios.map((escenario) => {
  const { decision, cierre } = procesarComoN8n(escenario);
  const pedidoFinal = decision.pedido;

  console.log(`\n▶ ${escenario.nombre} [${escenario.pedidoId}]`);
  if (!cierre) {
    console.log(`  sin cambios · HTTP ${decision.httpStatus} · ${decision.mensaje}`);
  } else {
    console.log(`  ${pedidoFinal.tipo} · ${pedidoFinal.estado} (${pedidoFinal.codigoMotivo}) · ${pedidoFinal.motivo}`);
    if (pedidoFinal.costoEnvio !== null) console.log(`  envío $${pedidoFinal.costoEnvio} (${pedidoFinal.zonaEnvio}) · total $${pedidoFinal.total}`);
    if (pedidoFinal.clima?.disponible) console.log(`  clima: ${pedidoFinal.clima.descripcion}${pedidoFinal.clima.severo ? ' · SEVERO' : ''}`);
    if (cierre.notificacion.debeNotificar) console.log(`  ✉ correo: ${cierre.notificacion.asunto}`);
  }

  return {
    escenario: escenario.nombre,
    tipo: pedidoFinal?.tipo ?? '-',
    estado: pedidoFinal?.estado ?? `HTTP ${decision.httpStatus}`,
    envio: pedidoFinal?.costoEnvio ?? '-',
    correo: cierre?.notificacion.debeNotificar ? cierre.notificacion.nivel : '-',
  };
});

titulo('Resumen');
console.table(resumen);

titulo('Reto 4 · Tendencia del historial');
const tendencia = new HistorialTendencia().analizar(historialEjecuciones);
console.log(`Ejecuciones registradas: ${historialEjecuciones.length}`);
console.log(`Rechazo: ${tendencia.tendenciaRechazo} · Sin cobertura: ${tendencia.tendenciaCobertura}`);
console.log(tendencia.conclusion);

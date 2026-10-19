/**
 * Adaptadores n8n: las únicas líneas de los nodos Code que NO vienen de src/.
 *
 * Solo leen las salidas de los nodos anteriores con $('Nombre del nodo') y
 * delegan en GestorPedidos. Toda regla de negocio está en las clases.
 * Los nombres de nodo deben coincidir con los de definicionWorkflow.js.
 */
import { NODOS } from './definicionWorkflow.js';

export const ADAPTADOR_EVALUAR_COBERTURA = `// Entradas: cuerpo del webhook, respuesta de JSON Server y el ítem del Merge (ip-api + Open-Meteo)
const webhook = $('${NODOS.webhook}').first().json;
const geolocalizacionYClima = $('${NODOS.combinar}').first().json;

const resultado = new GestorPedidos().evaluarCobertura({
  entrada: webhook.body ?? {},
  respuestaPedido: $('${NODOS.consultarPedido}').first().json,
  respuestaGeo: geolocalizacionYClima,
  respuestaClima: geolocalizacionYClima,
});

return [{ json: resultado }];`;

export const ADAPTADOR_CONSOLIDAR_DECISION = `// Entradas: resultado de la fase 1 y respuesta de DeepSeek
const resultado = new GestorPedidos().consolidarDecision({
  resultadoCobertura: $('${NODOS.evaluarCobertura}').first().json,
  respuestaIA: $('${NODOS.analizarIA}').first().json,
});

return [{ json: resultado }];`;

export const ADAPTADOR_ANALIZAR_TENDENCIA = `// Entradas: decisión (fase 2 si se consultó DeepSeek, si no fase 1), pedido guardado e historial
const nodoDecision = $('${NODOS.consolidar}').isExecuted ? $('${NODOS.consolidar}') : $('${NODOS.evaluarCobertura}');

const resultado = new GestorPedidos().cerrarEjecucion({
  decision: nodoDecision.first().json,
  respuestaGuardado: $('${NODOS.actualizarPedido}').first().json,
  historial: $input.all().map((item) => item.json),
});

return [{ json: resultado }];`;

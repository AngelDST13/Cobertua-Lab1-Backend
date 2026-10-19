/**
 * Garantiza la sincronización POO ↔ n8n:
 *  1. Los archivos versionados en n8n/ son exactamente lo que genera el script.
 *  2. El workflow es un solo flujo con todos los nodos que piden el laboratorio y los retos.
 *  3. El código de los 3 nodos Code, ejecutado con $() y $input simulados,
 *     produce el mismo resultado que las clases de src/.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { GestorPedidos } from '../src/index.js';
import {
  CLIMA,
  GEO,
  IA,
  cargarPedidosSemilla,
  combinarGeoYClima,
  respuestaServicioCaido,
  simularConsultaPedido,
} from '../datos/respuestasSimuladas.js';
import { NODOS } from '../n8n/definicionWorkflow.js';
import { SALIDAS, generarArtefactos } from '../scripts/generar-nodos-n8n.js';

const artefactos = generarArtefactos();
const workflow = JSON.parse(artefactos[SALIDAS.workflowPrincipal]);
const nodo = (nombre) => workflow.nodes.find((n) => n.name === nombre);
const leerVersionado = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Ejecuta el código de un nodo Code como lo haría n8n (cuerpo de función con $ y $input). */
const ejecutarNodoCode = (codigo, salidasNodos, itemsEntrada) => {
  const $ = (nombre) => ({
    isExecuted: nombre in salidasNodos,
    first: () => {
      if (!(nombre in salidasNodos)) throw new Error(`Nodo no simulado: ${nombre}`);
      return { json: salidasNodos[nombre] };
    },
  });
  const $input = { first: () => ({ json: itemsEntrada[0] }), all: () => itemsEntrada.map((json) => ({ json })) };
  return new Function('$', '$input', codigo)($, $input);
};

/** Las fechas dependen del reloj; se comparan aparte. */
const sinFechas = (resultado) => JSON.parse(JSON.stringify(resultado, (clave, valor) => (clave === 'fechaEvaluacion' || clave === 'fecha' ? '<fecha>' : valor)));

describe('n8n · archivos generados al día', () => {
  for (const ruta of Object.values(SALIDAS)) {
    it(`${ruta} coincide con "npm run build:n8n"`, () => {
      assert.equal(leerVersionado(ruta), artefactos[ruta], `Ejecuta "npm run build:n8n" y vuelve a confirmar ${ruta}`);
    });
  }

  it('los nodos Code del workflow contienen el código generado', () => {
    assert.equal(nodo(NODOS.evaluarCobertura).parameters.jsCode, artefactos[SALIDAS.codigoEvaluar]);
    assert.equal(nodo(NODOS.consolidar).parameters.jsCode, artefactos[SALIDAS.codigoConsolidar]);
    assert.equal(nodo(NODOS.analizarTendencia).parameters.jsCode, artefactos[SALIDAS.codigoTendencia]);
  });

  it('el código de los nodos incluye la jerarquía de clases (Reto 1)', () => {
    const codigo = artefactos[SALIDAS.codigoEvaluar];
    assert.match(codigo, /class PedidoNacional extends Pedido/);
    assert.match(codigo, /class PedidoInternacional extends Pedido/);
    assert.match(codigo, /class HistorialTendencia/);
  });

  it('es un solo flujo con todos los nodos obligatorios y de los retos', () => {
    const de = (tipo) => workflow.nodes.filter((n) => n.type === `n8n-nodes-base.${tipo}`);
    const urls = de('httpRequest').map((n) => `${n.parameters.method ?? 'GET'} ${n.parameters.url}`);
    const configuracion = JSON.parse(nodo(NODOS.configuracion).parameters.jsonOutput);

    assert.equal(de('webhook').length, 1, 'Webhook Trigger');
    assert.ok(urls.some((url) => url.startsWith('GET') && url.includes('/pedidos/')), 'HTTP 1: JSON Server');
    assert.ok(urls.some((url) => url.includes('ip-api.com/json/')), 'HTTP 2: ip-api');
    assert.ok(urls.some((url) => url.startsWith('POST') && url.includes('.iaUrl')), 'HTTP 3: modelo de IA');
    assert.match(configuracion.iaModelo, /deepseek/, 'el modelo configurado es DeepSeek');
    assert.ok(de('if').length >= 1, 'IF');
    assert.equal(de('code').length, 3, 'Code (POO)');
    assert.ok(urls.some((url) => url.startsWith('PATCH') && url.includes('/pedidos/')), 'HTTP final: PATCH');
    assert.ok(urls.some((url) => url.includes('api.open-meteo.com')), 'Reto 2: Open-Meteo');
    assert.equal(de('merge').length, 1, 'Reto 2: Merge');
    assert.equal(de('emailSend').length, 1, 'Reto 3: correo');
    assert.ok(urls.some((url) => url.startsWith('POST') && url.includes('/ejecuciones')), 'Reto 4: historial');
    assert.equal(de('errorTrigger').length, 0, 'sin Error Trigger: no requiere un segundo workflow');
  });

  it('el Merge recibe ip-api en la entrada 1 y Open-Meteo en la entrada 2', () => {
    const entradas = Object.entries(workflow.connections).flatMap(([origen, { main }]) =>
      main.flat().filter((d) => d.node === NODOS.combinar).map((d) => [origen, d.index]),
    );
    assert.deepEqual(entradas.sort(), [[NODOS.consultarClima, 1], [NODOS.geolocalizar, 0]]);
  });

  it('los nodos Code envían errores inesperados a la rama de registro', () => {
    for (const nombre of [NODOS.evaluarCobertura, NODOS.consolidar, NODOS.analizarTendencia]) {
      assert.equal(nodo(nombre).onError, 'continueErrorOutput');
      assert.equal(workflow.connections[nombre].main[1][0].node, NODOS.registrarError);
    }
  });

  it('todas las conexiones apuntan a nodos existentes', () => {
    const nombres = new Set(workflow.nodes.map((n) => n.name));
    for (const [origen, { main }] of Object.entries(workflow.connections)) {
      assert.ok(nombres.has(origen), origen);
      main.flat().forEach(({ node }) => assert.ok(nombres.has(node), node));
    }
  });
});

describe('n8n · el código de los nodos Code se comporta igual que las clases', () => {
  const pedidos = cargarPedidosSemilla();
  const gestor = new GestorPedidos();
  const historial = [
    { estado: 'aprobado', codigoMotivo: 'APROBADO', fecha: '2026-10-18T10:00:00.000Z' },
    { estado: 'rechazado', codigoMotivo: 'SIN_COBERTURA', fecha: '2026-10-19T10:00:00.000Z' },
  ];

  const escenarios = [
    { nombre: 'aprobado (nacional)', pedidoId: 'PED-1001', ip: '201.191.20.10', geo: GEO.costaRica, ia: IA.riesgoBajo },
    { nombre: 'rechazo por IA', pedidoId: 'PED-1002', ip: '201.191.20.10', geo: GEO.costaRica, ia: IA.riesgoAlto },
    { nombre: 'clima severo', pedidoId: 'PED-1002', ip: '201.191.20.10', geo: GEO.costaRica, clima: CLIMA.tormenta, ia: IA.riesgoBajo },
    { nombre: 'DeepSeek caída', pedidoId: 'PED-1001', ip: '201.191.20.10', geo: GEO.costaRica, ia: respuestaServicioCaido() },
    { nombre: 'cantón fuera de la GAM', pedidoId: 'PED-1008', ip: '201.191.20.10', geo: GEO.costaRica },
    { nombre: 'sin cobertura', pedidoId: 'PED-1005', ip: '81.38.10.12', geo: GEO.espana },
    { nombre: 'IP privada', pedidoId: 'PED-1002', ip: '10.0.0.8', geo: GEO.ipNoUbicable },
    { nombre: 'ya procesado', pedidoId: 'PED-1006', ip: '201.191.20.10', geo: GEO.costaRica },
  ];

  for (const escenario of escenarios) {
    it(escenario.nombre, () => {
      const entrada = { pedidoId: escenario.pedidoId, ipCliente: escenario.ip };
      const respuestaPedido = simularConsultaPedido(pedidos, escenario.pedidoId);
      const combinado = combinarGeoYClima(escenario.geo, escenario.clima ?? CLIMA.despejado);

      const salidas = {
        [NODOS.webhook]: { headers: {}, params: {}, query: {}, body: entrada },
        [NODOS.consultarPedido]: respuestaPedido,
        [NODOS.combinar]: combinado,
      };

      // Fase 1
      const [{ json: faseN8n }] = ejecutarNodoCode(artefactos[SALIDAS.codigoEvaluar], salidas, [combinado]);
      const faseClases = gestor.evaluarCobertura({ entrada, respuestaPedido, respuestaGeo: combinado, respuestaClima: combinado });
      assert.deepEqual(sinFechas(faseN8n), sinFechas(faseClases));
      salidas[NODOS.evaluarCobertura] = faseN8n;

      // Fase 2 (solo si hubo cobertura)
      let decisionClases = faseClases;
      if (faseClases.accion === 'evaluar_ia') {
        salidas[NODOS.analizarIA] = escenario.ia;
        const [{ json: decisionN8n }] = ejecutarNodoCode(artefactos[SALIDAS.codigoConsolidar], salidas, [escenario.ia]);
        decisionClases = gestor.consolidarDecision({ resultadoCobertura: faseClases, respuestaIA: escenario.ia });
        assert.deepEqual(sinFechas(decisionN8n), sinFechas(decisionClases));
        salidas[NODOS.consolidar] = decisionN8n;
      }
      if (decisionClases.accion !== 'actualizar') return;

      // Fase 3
      const guardado = { id: decisionClases.pedidoId, ...decisionClases.actualizacion };
      salidas[NODOS.actualizarPedido] = guardado;
      const [{ json: cierreN8n }] = ejecutarNodoCode(artefactos[SALIDAS.codigoTendencia], salidas, historial);
      const cierreClases = gestor.cerrarEjecucion({ decision: decisionClases, respuestaGuardado: guardado, historial });
      assert.deepEqual(sinFechas(cierreN8n), sinFechas(cierreClases));
    });
  }
});

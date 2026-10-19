import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACCIONES, ErrorNegocio, GestorPedidos } from '../src/index.js';
import { CLIMA, GEO, IA, cargarPedidosSemilla, combinarGeoYClima, respuestaServicioCaido, simularConsultaPedido } from '../datos/respuestasSimuladas.js';

const FECHA = '2026-10-19T15:00:00.000Z';
const gestor = new GestorPedidos({ ahora: () => FECHA });
const pedidos = cargarPedidosSemilla();

/** Simula lo que entrega el Merge: ip-api + Open-Meteo en un solo ítem. */
const fase1 = (pedidoId, ipCliente, respuestaGeo, respuestaPedido = simularConsultaPedido(pedidos, pedidoId), clima = CLIMA.despejado) => {
  const combinado = combinarGeoYClima(respuestaGeo, clima);
  return gestor.evaluarCobertura({ entrada: { pedidoId, ipCliente }, respuestaPedido, respuestaGeo: combinado, respuestaClima: combinado });
};

describe('GestorPedidos · evaluarCobertura', () => {
  it('pedido con cobertura (cantón de la GAM) → evaluar_ia con solicitud para DeepSeek', () => {
    const resultado = fase1('PED-1002', '201.191.20.10', GEO.costaRica);
    assert.equal(resultado.accion, ACCIONES.EVALUAR_IA);
    assert.equal(resultado.evaluacion.zonaEnvio, 'GAM');
    assert.equal(resultado.evaluacion.cantonEntrega, 'San Pablo, Heredia');
    assert.equal(resultado.evaluacion.tipoPedido, 'nacional');
    assert.equal(resultado.evaluacion.costoEnvio, 4.25);
    assert.ok(resultado.solicitudIA.messages.length === 2);
  });

  it('acepta alias populares del cantón (Tres Ríos → La Unión)', () => {
    const pedido = { ...pedidos.find((p) => p.id === 'PED-1002'), direccionEnvio: { pais: 'CR', provincia: 'Cartago', ciudad: 'Tres Ríos', detalle: 'Casa 3' } };
    const resultado = fase1('PED-1002', '201.191.20.10', GEO.costaRica, simularConsultaPedido([pedido], 'PED-1002'));
    assert.equal(resultado.evaluacion.cantonEntrega, 'La Unión, Cartago');
  });

  const rechazos = [
    ['R1 IP privada', 'PED-1002', '192.168.1.15', GEO.costaRica, /privada o reservada/],
    ['R1 IP mal formada', 'PED-1002', '300.1.1.1', GEO.costaRica, /formato de IP/],
    ['IP que ip-api no ubica', 'PED-1002', '201.191.20.10', GEO.ipNoUbicable, /no pudo ubicar/],
    ['R2 IP fuera de Costa Rica', 'PED-1001', '81.38.10.12', GEO.espana, /Sin cobertura: la IP .* solo atendemos compras desde Costa Rica/],
    ['R2 destino fuera de Costa Rica', 'PED-1005', '201.191.20.10', GEO.costaRica, /solo hacemos entregas dentro de Costa Rica \(el destino es ES\)/],
    ['R2 destino internacional (antes de las restricciones)', 'PED-1004', '201.191.20.10', GEO.costaRica, /solo hacemos entregas dentro de Costa Rica/],
    ['R2 Alajuela fuera de la GAM', 'PED-1008', '201.191.20.10', GEO.costaRica, /Grecia \(Alajuela\) está fuera de la Gran Área Metropolitana/],
    ['R2 Guanacaste fuera de la GAM', 'PED-1009', '201.191.20.10', GEO.costaRica, /Liberia \(Guanacaste\) está fuera/],
    ['R3 peso excedido', 'PED-1007', '201.191.20.10', GEO.costaRica, /supera el máximo/],
  ];
  for (const [caso, pedidoId, ip, geo, motivoEsperado] of rechazos) {
    it(`${caso} → rechazado`, () => {
      const resultado = fase1(pedidoId, ip, geo);
      assert.equal(resultado.accion, ACCIONES.ACTUALIZAR);
      assert.equal(resultado.actualizacion.estado, 'rechazado');
      assert.match(resultado.actualizacion.motivo, motivoEsperado);
      assert.equal(resultado.actualizacion.fechaEvaluacion, FECHA);
    });
  }

  it('Reto 2 · clima severo encarece el envío', () => {
    const nacional = fase1('PED-1002', '201.191.20.10', GEO.costaRica, undefined, CLIMA.tormenta);
    assert.equal(nacional.evaluacion.costoEnvio, 6.25); // 4.25 + 2 fijo
    assert.equal(nacional.evaluacion.clima.severo, true);
  });

  it('Reto 2 · Open-Meteo caído no bloquea el pedido', () => {
    const resultado = fase1('PED-1002', '201.191.20.10', GEO.costaRica, undefined, respuestaServicioCaido());
    assert.equal(resultado.accion, ACCIONES.EVALUAR_IA);
    assert.equal(resultado.evaluacion.clima.disponible, false);
    assert.equal(resultado.evaluacion.costoEnvio, 4.25);
  });

  it('ip-api caída → en_revision (no se rechaza al cliente por una falla nuestra)', () => {
    const resultado = fase1('PED-1002', '201.191.20.10', respuestaServicioCaido());
    assert.equal(resultado.actualizacion.estado, 'en_revision');
  });

  const omisiones = [
    ['sin pedidoId', undefined, undefined, 400],
    ['pedidoId con caracteres no permitidos', '../erroresFlujo', undefined, 400],
    ['pedido inexistente', 'PED-9999', undefined, 404],
    ['JSON Server caído', 'PED-1001', respuestaServicioCaido('connect ECONNREFUSED'), 503],
    ['registro que no corresponde', 'PED-1001', { statusCode: 200, body: [] }, 502],
    ['R5 pedido ya aprobado', 'PED-1006', undefined, 409],
  ];
  for (const [caso, pedidoId, respuestaPedido, httpStatus] of omisiones) {
    it(`${caso} → omitir ${httpStatus}`, () => {
      const resultado = fase1(pedidoId, '201.191.20.10', GEO.costaRica, respuestaPedido ?? simularConsultaPedido(pedidos, pedidoId));
      assert.equal(resultado.accion, ACCIONES.OMITIR);
      assert.equal(resultado.httpStatus, httpStatus);
      assert.equal(resultado.actualizacion, null);
    });
  }
});

describe('GestorPedidos · consolidarDecision', () => {
  const coberturaOK = () => fase1('PED-1001', '201.191.20.10', GEO.costaRica);

  it('riesgo bajo → aprobado con costo y mensaje al cliente', () => {
    const { actualizacion } = gestor.consolidarDecision({ resultadoCobertura: coberturaOK(), respuestaIA: IA.riesgoBajo });
    assert.equal(actualizacion.estado, 'aprobado');
    assert.equal(actualizacion.costoEnvio, 0);
    assert.equal(actualizacion.total, 110);
    assert.ok(actualizacion.analisisIA.mensajeCliente.length > 0);
    assert.equal(actualizacion.historial.length, 1);
  });

  it('riesgo alto → rechazado', () => {
    const resultadoCobertura = fase1('PED-1002', '201.191.20.10', GEO.costaRica);
    const { actualizacion } = gestor.consolidarDecision({ resultadoCobertura, respuestaIA: IA.riesgoAlto });
    assert.equal(actualizacion.estado, 'rechazado');
    assert.match(actualizacion.motivo, /riesgo alto/);
  });

  it('DeepSeek caída o respuesta inválida → en_revision', () => {
    for (const respuestaIA of [respuestaServicioCaido(), IA.respuestaNoJSON]) {
      const { actualizacion } = gestor.consolidarDecision({ resultadoCobertura: coberturaOK(), respuestaIA });
      assert.equal(actualizacion.estado, 'en_revision');
    }
  });

  it('rechaza ser llamado fuera de la fase correcta', () => {
    assert.throws(() => gestor.consolidarDecision({ resultadoCobertura: { accion: 'omitir' }, respuestaIA: IA.riesgoBajo }), ErrorNegocio);
  });
});

describe('GestorPedidos · cerrarEjecucion (Retos 3 y 4)', () => {
  const historialPrevio = [
    { estado: 'aprobado', codigoMotivo: 'APROBADO', fecha: '2026-10-18T10:00:00.000Z' },
    { estado: 'aprobado', codigoMotivo: 'APROBADO', fecha: '2026-10-18T11:00:00.000Z' },
    { estado: 'rechazado', codigoMotivo: 'SIN_COBERTURA', fecha: '2026-10-19T10:00:00.000Z' },
    { estado: 'rechazado', codigoMotivo: 'SIN_COBERTURA', fecha: '2026-10-19T11:00:00.000Z' },
  ];

  it('rechazo por cobertura → respuesta 200, tendencia y correo programado', () => {
    const decision = fase1('PED-1005', '81.38.10.12', GEO.espana);
    const guardado = { id: 'PED-1005', ...decision.actualizacion };
    const { httpStatus, respuesta, notificacion } = gestor.cerrarEjecucion({ decision, respuestaGuardado: guardado, historial: historialPrevio });
    assert.equal(httpStatus, 200);
    assert.equal(respuesta.codigoMotivo, 'SIN_COBERTURA');
    assert.equal(respuesta.tendencia.tendenciaRechazo, 'empeorando');
    assert.equal(notificacion.debeNotificar, true);
    assert.equal(notificacion.nivel, 'advertencia');
    assert.equal(decision.registroHistorial.codigoMotivo, 'SIN_COBERTURA');
  });

  it('aprobado → sin correo', () => {
    const decision = gestor.consolidarDecision({ resultadoCobertura: fase1('PED-1001', '201.191.20.10', GEO.costaRica), respuestaIA: IA.riesgoBajo });
    const { respuesta, notificacion } = gestor.cerrarEjecucion({ decision, respuestaGuardado: { id: 'PED-1001', ...decision.actualizacion } });
    assert.equal(respuesta.estado, 'aprobado');
    assert.equal(respuesta.tipoPedido, 'nacional');
    assert.equal(notificacion.debeNotificar, false);
  });

  it('PATCH fallido → 502 con la decisión igualmente informada', () => {
    const decision = fase1('PED-1005', '81.38.10.12', GEO.espana);
    const { httpStatus, respuesta } = gestor.cerrarEjecucion({ decision, respuestaGuardado: respuestaServicioCaido() });
    assert.equal(httpStatus, 502);
    assert.equal(respuesta.estado, 'rechazado');
  });
});

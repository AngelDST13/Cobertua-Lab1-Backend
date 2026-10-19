import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnalizadorClima, HistorialTendencia, NotificadorAlertas } from '../src/index.js';
import { CLIMA, respuestaServicioCaido } from '../datos/respuestasSimuladas.js';

describe('Reto 2 · AnalizadorClima', () => {
  const analizador = new AnalizadorClima();

  it('clima normal no es severo', () => {
    const clima = analizador.interpretar(CLIMA.despejado);
    assert.equal(clima.disponible, true);
    assert.equal(clima.severo, false);
    assert.equal(clima.descripcion, 'Parcialmente nublado');
  });

  it('tormenta o lluvia fuerte es severo', () => {
    const clima = analizador.interpretar(CLIMA.tormenta);
    assert.equal(clima.severo, true);
    assert.deepEqual(clima.motivos, ['Tormenta eléctrica', 'Precipitación de 14.6 mm']);
  });

  it('servicio caído → no disponible, sin bloquear', () => {
    for (const respuesta of [respuestaServicioCaido(), undefined, { status: 'success' }]) {
      assert.deepEqual(analizador.interpretar(respuesta), { disponible: false, severo: false, descripcion: 'Clima no disponible', motivos: [] });
    }
  });
});

describe('Reto 4 · HistorialTendencia', () => {
  const historial = new HistorialTendencia();
  const registro = (estado, codigoMotivo, hora) => ({ estado, codigoMotivo, fecha: `2026-10-19T${String(hora).padStart(2, '0')}:00:00.000Z` });

  it('con pocos datos no concluye', () => {
    const tendencia = historial.analizar([registro('aprobado', 'APROBADO', 1)]);
    assert.equal(tendencia.tendenciaRechazo, 'datos_insuficientes');
  });

  it('detecta empeoramiento (más rechazos recientes)', () => {
    const datos = [registro('aprobado', 'APROBADO', 1), registro('aprobado', 'APROBADO', 2), registro('rechazado', 'SIN_COBERTURA', 3), registro('rechazado', 'SIN_COBERTURA', 4)];
    const tendencia = historial.analizar(datos);
    assert.equal(tendencia.tendenciaRechazo, 'empeorando');
    assert.equal(tendencia.tendenciaCobertura, 'empeorando');
    assert.equal(tendencia.recientes.rechazo, 1);
    assert.equal(tendencia.anteriores.rechazo, 0);
    assert.match(tendencia.conclusion, /está empeorando/);
  });

  it('detecta mejora y es independiente del orden de entrada', () => {
    const datos = [registro('aprobado', 'APROBADO', 4), registro('rechazado', 'PESO_EXCEDIDO', 1), registro('aprobado', 'APROBADO', 3), registro('rechazado', 'IP_INVALIDA', 2)];
    const tendencia = historial.analizar(datos);
    assert.equal(tendencia.tendenciaRechazo, 'mejorando');
    assert.equal(tendencia.tendenciaCobertura, 'estable');
  });

  it('ignora registros inválidos (errores de JSON Server, ítems vacíos)', () => {
    assert.equal(historial.analizar([{}, { error: 'x' }, null]).recientes.total, 0);
  });

  it('crearRegistro no incluye datos personales', () => {
    const fila = HistorialTendencia.crearRegistro({ id: 'P1', tipo: 'nacional', estado: 'aprobado', cliente: { email: 'a@b.com' }, geolocalizacion: { codigoPais: 'CR' } }, 'f');
    assert.ok(!JSON.stringify(fila).includes('a@b.com'));
    assert.equal(fila.paisIP, 'CR');
  });
});

describe('Reto 3 · NotificadorAlertas', () => {
  const notificador = new NotificadorAlertas();
  const tendencia = { conclusion: 'estable' };

  it('notifica rechazos por cobertura y riesgo, no aprobaciones', () => {
    assert.equal(notificador.evaluar({ id: 'P1', estado: 'rechazado', codigoMotivo: 'SIN_COBERTURA' }, tendencia).nivel, 'advertencia');
    assert.equal(notificador.evaluar({ id: 'P1', estado: 'rechazado', codigoMotivo: 'RIESGO_IA' }, tendencia).nivel, 'critico');
    assert.equal(notificador.evaluar({ id: 'P1', estado: 'aprobado', codigoMotivo: 'APROBADO' }, tendencia).debeNotificar, false);
  });

  it('incluye el análisis de DeepSeek y escapa HTML', () => {
    const pedido = {
      id: 'P1',
      estado: 'rechazado',
      codigoMotivo: 'RIESGO_IA',
      motivo: '<script>alert(1)</script>',
      analisisIA: { viable: false, riesgo: 'alto', puntaje: 90, motivos: ['reventa'], mensajeCliente: 'Hola' },
    };
    const { html, asunto } = notificador.evaluar(pedido, tendencia);
    assert.match(asunto, /CRÍTICO/);
    assert.match(html, /Análisis de DeepSeek/);
    assert.match(html, /puntaje 90/);
    assert.ok(!html.includes('<script>'));
  });
});

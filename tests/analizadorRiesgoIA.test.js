import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnalizadorRiesgoIA, ErrorIntegracion, Pedido, ValidadorCobertura, ZONAS_COBERTURA } from '../src/index.js';
import { GEO, IA, cargarPedidosSemilla, respuestaDeepSeek, respuestaServicioCaido } from '../datos/respuestasSimuladas.js';

const analizador = new AnalizadorRiesgoIA();

describe('AnalizadorRiesgoIA · construirSolicitud', () => {
  it('arma el cuerpo de DeepSeek sin datos personales del cliente', () => {
    const pedido = new Pedido(cargarPedidosSemilla()[0]);
    pedido.calcularCostoEnvio(ZONAS_COBERTURA[0]);
    const geolocalizacion = new ValidadorCobertura().procesarGeolocalizacion(GEO.costaRica);

    const solicitud = analizador.construirSolicitud(pedido, { zonaEnvio: ZONAS_COBERTURA[0], geolocalizacion, senalesRiesgo: [] });
    const texto = JSON.stringify(solicitud);

    assert.equal(solicitud.model, 'deepseek-chat');
    assert.deepEqual(solicitud.response_format, { type: 'json_object' });
    assert.ok(!texto.includes(pedido.cliente.email));
    assert.ok(!texto.includes(pedido.cliente.nombre));
    assert.ok(!texto.includes(pedido.direccionEnvio.detalle));
  });
});

describe('AnalizadorRiesgoIA · interpretarRespuesta', () => {
  it('valida y normaliza una respuesta correcta', () => {
    const analisis = analizador.interpretarRespuesta(IA.riesgoBajo);
    assert.equal(analisis.riesgo, 'bajo');
    assert.equal(analisis.viable, true);
  });

  it('acepta JSON envuelto en bloque markdown', () => {
    const analisis = analizador.interpretarRespuesta(
      respuestaDeepSeek('```json\n{"viable":true,"riesgo":"medio","puntaje":40,"motivos":[],"mensajeCliente":"ok"}\n```'),
    );
    assert.equal(analisis.riesgo, 'medio');
  });

  const invalidas = {
    'servicio caído': respuestaServicioCaido(),
    'sin choices': { choices: [] },
    'texto no JSON': IA.respuestaNoJSON,
    'riesgo fuera de catálogo': respuestaDeepSeek({ viable: true, riesgo: 'nulo', puntaje: 1, motivos: [], mensajeCliente: '' }),
    'puntaje fuera de rango': respuestaDeepSeek({ viable: true, riesgo: 'bajo', puntaje: 150, motivos: [], mensajeCliente: '' }),
  };
  for (const [caso, respuesta] of Object.entries(invalidas)) {
    it(`${caso} → ErrorIntegracion`, () => {
      assert.throws(() => analizador.interpretarRespuesta(respuesta), ErrorIntegracion);
    });
  }
});

describe('AnalizadorRiesgoIA · R4 decidir', () => {
  const base = { viable: true, riesgo: 'bajo', puntaje: 10, motivos: ['ok'], mensajeCliente: '' };
  it('aprueba riesgo bajo o medio bajo el umbral', () => {
    assert.equal(analizador.decidir(base).aprobar, true);
    assert.equal(analizador.decidir({ ...base, riesgo: 'medio', puntaje: 69 }).aprobar, true);
  });
  it('rechaza no viable, riesgo alto o puntaje sobre el umbral', () => {
    assert.equal(analizador.decidir({ ...base, viable: false }).aprobar, false);
    assert.equal(analizador.decidir({ ...base, riesgo: 'alto' }).aprobar, false);
    assert.equal(analizador.decidir({ ...base, riesgo: 'medio', puntaje: 70 }).aprobar, false);
  });
});

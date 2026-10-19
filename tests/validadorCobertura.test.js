import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorIntegracion, ErrorNegocio, ValidadorCobertura } from '../src/index.js';
import { GEO, respuestaServicioCaido } from '../datos/respuestasSimuladas.js';

const validador = new ValidadorCobertura();

describe('ValidadorCobertura · R1 validarIP', () => {
  const casos = [
    ['201.191.20.10', true],
    ['8.8.8.8', true],
    ['2800:860:1::5', true],
    ['2001:4860:4860:0000:0000:0000:0000:8888', true],
    ['192.168.1.15', false],
    ['10.0.0.1', false],
    ['172.20.5.1', false],
    ['127.0.0.1', false],
    ['100.64.0.1', false],
    ['169.254.1.1', false],
    ['203.0.113.7', false],
    ['::1', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['2001:db8::1', false],
    ['256.1.1.1', false],
    ['01.2.3.4', false],
    ['1.2.3', false],
    ['1:2:3:4:5:6:7:8:9', false],
    ['1::2::3', false],
    ['hola', false],
    ['', false],
    [undefined, false],
  ];

  for (const [ip, esperado] of casos) {
    it(`${String(ip)} → ${esperado ? 'válida' : 'inválida'}`, () => {
      assert.equal(validador.validarIP(ip).valida, esperado);
    });
  }
});

describe('ValidadorCobertura · procesarGeolocalizacion', () => {
  it('normaliza una respuesta exitosa', () => {
    const geo = validador.procesarGeolocalizacion(GEO.costaRica);
    assert.equal(geo.codigoPais, 'CR');
    assert.equal(geo.proxy, false);
  });

  it('servicio caído → ErrorIntegracion', () => {
    assert.throws(() => validador.procesarGeolocalizacion(respuestaServicioCaido()), ErrorIntegracion);
    assert.throws(() => validador.procesarGeolocalizacion(undefined), ErrorIntegracion);
    assert.throws(() => validador.procesarGeolocalizacion({ status: 'success' }), ErrorIntegracion);
  });

  it('status "fail" → ErrorNegocio', () => {
    assert.throws(() => validador.procesarGeolocalizacion(GEO.ipNoUbicable), ErrorNegocio);
  });
});

describe('ValidadorCobertura · R2 determinarZona y señales', () => {
  it('solo acepta compras desde Costa Rica', () => {
    assert.equal(validador.determinarZona('CR').codigo, 'GAM');
    for (const pais of ['PA', 'US', 'ES']) assert.equal(validador.determinarZona(pais), null);
  });

  const destinos = [
    [{ pais: 'CR', provincia: 'San José', canton: 'Escazú' }, true],
    [{ pais: 'CR', provincia: 'Heredia', canton: 'belen' }, true], // sin tilde ni mayúscula
    [{ pais: 'CR', provincia: 'San José', ciudad: 'Coronado' }, true], // alias en "ciudad" (pedidos antiguos)
    [{ pais: 'CR', provincia: 'Cartago', canton: 'El Guarco' }, true],
    [{ pais: 'CR', provincia: 'Alajuela', canton: 'Atenas' }, true],
    [{ pais: 'CR', provincia: 'San José', canton: 'Pérez Zeledón' }, false], // San José, pero fuera de la GAM
    [{ pais: 'CR', provincia: 'Alajuela', canton: 'San Carlos' }, false],
    [{ pais: 'CR', provincia: 'Heredia', canton: 'Sarapiquí' }, false],
    [{ pais: 'CR', provincia: 'Cartago', canton: 'Turrialba' }, false],
    [{ pais: 'CR', provincia: 'Limón', canton: 'Limón' }, false],
    [{ pais: 'CR', provincia: 'Heredia', canton: 'Escazú' }, false], // provincia equivocada
    [{ pais: 'CR', canton: 'Narnia' }, false],
    [{ pais: 'PA', canton: 'Escazú' }, false],
  ];
  for (const [direccion, cubierto] of destinos) {
    it(`destino ${direccion.canton ?? direccion.ciudad} (${direccion.provincia ?? direccion.pais}) → ${cubierto ? 'con' : 'sin'} cobertura`, () => {
      const resultado = validador.evaluarDestino(direccion);
      assert.equal(resultado.cubierto, cubierto, resultado.motivo);
      if (cubierto) assert.equal(resultado.zona.codigo, 'GAM');
      else assert.match(resultado.motivo, /^Sin cobertura/);
    });
  }

  it('advierte (sin rechazar) si la IP de Costa Rica está fuera de las provincias de la GAM', () => {
    const geo = validador.procesarGeolocalizacion({ ...GEO.costaRica, regionName: 'Provincia de Guanacaste' });
    assert.deepEqual(validador.detectarSenalesRiesgo(geo, 'CR'), ['La IP se ubica en Provincia de Guanacaste, fuera de las provincias de la GAM']);
  });

  it('detecta proxy, hosting y país distinto al de envío', () => {
    const geo = validador.procesarGeolocalizacion(GEO.panamaConVPN);
    assert.equal(validador.detectarSenalesRiesgo(geo, 'CR').length, 3);
    assert.equal(validador.detectarSenalesRiesgo(validador.procesarGeolocalizacion(GEO.costaRica), 'CR').length, 0);
  });
});

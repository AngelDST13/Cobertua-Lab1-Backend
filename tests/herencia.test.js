import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Pedido, PedidoInternacional, PedidoNacional, ZONAS_COBERTURA, crearPedido } from '../src/index.js';
import { ZONAS_PRUEBA, cargarPedidosSemilla } from '../datos/respuestasSimuladas.js';

const [NACIONAL] = ZONAS_COBERTURA; // GAM
const { CENTROAMERICA, NORTEAMERICA } = ZONAS_PRUEBA;
const registro = (id) => cargarPedidosSemilla().find((pedido) => pedido.id === id);
const CLIMA_SEVERO = { disponible: true, severo: true };

describe('Reto 1 · fábrica y herencia', () => {
  it('crea la subclase según el país de destino', () => {
    const nacional = crearPedido(registro('PED-1001'));
    const internacional = crearPedido(registro('PED-1003'));
    assert.ok(nacional instanceof PedidoNacional && nacional instanceof Pedido);
    assert.ok(internacional instanceof PedidoInternacional && internacional instanceof Pedido);
    assert.equal(nacional.tipo, 'nacional');
    assert.equal(internacional.tipo, 'internacional');
  });

  it('se reconstruye como la misma subclase desde toJSON()', () => {
    const pedido = crearPedido(registro('PED-1003'));
    assert.ok(crearPedido(JSON.parse(JSON.stringify(pedido))) instanceof PedidoInternacional);
  });
});

describe('Reto 1 · polimorfismo en calcularCostoEnvio()', () => {
  it('nacional: tarifa base, envío gratis y recargo climático fijo', () => {
    assert.equal(crearPedido(registro('PED-1002')).calcularCostoEnvio(NACIONAL), 4.25);
    assert.equal(crearPedido(registro('PED-1002')).calcularCostoEnvio(NACIONAL, CLIMA_SEVERO), 6.25);
    assert.equal(crearPedido(registro('PED-1001')).calcularCostoEnvio(NACIONAL, CLIMA_SEVERO), 0); // gratis se respeta
  });

  it('internacional: suma seguro y recargo climático porcentual', () => {
    assert.equal(crearPedido(registro('PED-1003')).calcularCostoEnvio(NORTEAMERICA), 51.15); // 48 + 1.5 % de 210
    assert.equal(crearPedido(registro('PED-1003')).calcularCostoEnvio(NORTEAMERICA, CLIMA_SEVERO), 60.75); // 57.6 + 3.15
  });

  it('el seguro internacional respeta el mínimo de $3', () => {
    const pequeno = crearPedido({ ...registro('PED-1003'), items: [{ sku: 'X', cantidad: 1, precioUnitario: 20, pesoKg: 0.5 }] });
    assert.equal(pequeno.seguroInternacional, 3);
  });

  it('el mismo arreglo de pedidos se recorre sin saber su tipo', () => {
    const costos = [crearPedido(registro('PED-1002')), crearPedido(registro('PED-1001'))].map((pedido) => pedido.calcularCostoEnvio(CENTROAMERICA));
    assert.deepEqual(costos, [14.5, 17]); // ambos nacionales con zona forzada: misma fórmula base
  });
});

describe('Reto 1 · polimorfismo en validarRestricciones()', () => {
  it('nacional no tiene restricciones', () => {
    assert.deepEqual(crearPedido({ ...registro('PED-1004'), direccionEnvio: { ...registro('PED-1004').direccionEnvio, pais: 'CR' } }).validarRestricciones(), []);
  });

  it('internacional limita unidades por SKU y valor declarado', () => {
    const incumplimientos = crearPedido(registro('PED-1004')).validarRestricciones();
    assert.equal(incumplimientos.length, 2);
    assert.match(incumplimientos[0], /12 unidades de CEL-PRO/);
    assert.match(incumplimientos[1], /valor declarado/);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ESTADOS, ErrorNegocio, Pedido, ZONAS_COBERTURA } from '../src/index.js';
import { ZONAS_PRUEBA, cargarPedidosSemilla } from '../datos/respuestasSimuladas.js';

const [NACIONAL] = ZONAS_COBERTURA; // GAM
const { CENTROAMERICA, NORTEAMERICA } = ZONAS_PRUEBA;
const pedidoDeSemilla = (id) => new Pedido(cargarPedidosSemilla().find((registro) => registro.id === id));

describe('Pedido · R1 validarEstructura', () => {
  it('acepta un pedido completo', () => {
    assert.deepEqual(pedidoDeSemilla('PED-1001').validarEstructura(), { valido: true, errores: [] });
  });

  it('reporta todos los errores juntos', () => {
    const pedido = new Pedido({
      id: 'X',
      cliente: { nombre: 'Ana', email: 'ana@' },
      direccionEnvio: { pais: 'cr', ciudad: 'Escazú', detalle: 'Casa 1' },
      items: [{ sku: 'A', cantidad: 0, precioUnitario: -5, pesoKg: 1 }],
    });
    const { valido, errores } = pedido.validarEstructura();
    assert.equal(valido, false);
    assert.equal(errores.length, 4); // email, país, cantidad, precio
  });
});

describe('Pedido · R3 calcularCostoEnvio', () => {
  it('cobra tarifa base + kg facturables redondeados hacia arriba', () => {
    const pedido = pedidoDeSemilla('PED-1002'); // 0.4 kg, subtotal 45
    assert.equal(pedido.calcularCostoEnvio(NACIONAL), 4.25); // 3.5 + 1 × 0.75
    assert.equal(pedido.total, 49.25);
    assert.equal(pedido.zonaEnvio, 'GAM');
  });

  it('aplica envío gratis al alcanzar el umbral de la zona', () => {
    assert.equal(pedidoDeSemilla('PED-1001').calcularCostoEnvio(NACIONAL), 0); // subtotal 110 ≥ 75
  });

  it('no aplica envío gratis en zonas sin umbral', () => {
    const pedido = pedidoDeSemilla('PED-1001');
    assert.equal(pedido.calcularCostoEnvio(CENTROAMERICA), 17); // 12 + 2 × 2.5
  });

  it('lanza PESO_EXCEDIDO si supera el máximo de la zona', () => {
    const pedido = pedidoDeSemilla('PED-1003'); // 6.5 kg
    assert.equal(pedido.calcularCostoEnvio(NORTEAMERICA), 48);
    const pesado = pedidoDeSemilla('PED-1007'); // 40 kg
    assert.throws(() => pesado.calcularCostoEnvio(NACIONAL), (error) => error instanceof ErrorNegocio && error.codigo === 'PESO_EXCEDIDO');
  });
});

describe('Pedido · R5 estados', () => {
  it('solo procesa pendientes o en revisión', () => {
    assert.equal(pedidoDeSemilla('PED-1001').puedeProcesarse(), true);
    assert.equal(pedidoDeSemilla('PED-1006').puedeProcesarse(), false);
  });

  it('registra la transición en el historial', () => {
    const pedido = pedidoDeSemilla('PED-1002');
    pedido.rechazar('motivo de prueba', '2026-10-19T00:00:00.000Z');
    assert.equal(pedido.estado, ESTADOS.RECHAZADO);
    assert.deepEqual(pedido.historial.at(-1), { de: 'pendiente', a: 'rechazado', motivo: 'motivo de prueba', fecha: '2026-10-19T00:00:00.000Z' });
  });

  it('impide transiciones desde estados finales', () => {
    const pedido = pedidoDeSemilla('PED-1006');
    assert.throws(() => pedido.rechazar('x', 'f'), (error) => error.codigo === 'TRANSICION_INVALIDA');
  });

  it('impide aprobar sin costo de envío', () => {
    assert.throws(() => pedidoDeSemilla('PED-1002').aprobar('x', 'f'), (error) => error.codigo === 'SIN_COSTO_ENVIO');
  });

  it('se reconstruye igual desde toJSON()', () => {
    const pedido = pedidoDeSemilla('PED-1002');
    pedido.calcularCostoEnvio(NACIONAL);
    assert.deepEqual(Pedido.desdeRegistro(JSON.parse(JSON.stringify(pedido))).toJSON(), pedido.toJSON());
  });
});

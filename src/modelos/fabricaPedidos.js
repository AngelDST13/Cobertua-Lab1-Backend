import { PAIS_ORIGEN } from '../config/reglasNegocio.js';
import { ErrorNegocio } from '../errores/errores.js';
import { PedidoInternacional } from './PedidoInternacional.js';
import { PedidoNacional } from './PedidoNacional.js';

/**
 * Reto 1 · Fábrica: decide qué subclase instanciar según el país de destino.
 * Es el único lugar que conoce las subclases; el resto del sistema trabaja
 * con la interfaz de Pedido y deja que el polimorfismo haga el resto.
 *
 * @param {object} registro Registro de JSON Server (o salida de toJSON()).
 * @returns {PedidoNacional|PedidoInternacional}
 */
export const crearPedido = (registro) => {
  if (!registro || typeof registro !== 'object' || Array.isArray(registro)) {
    throw new ErrorNegocio('REGISTRO_INVALIDO', 'El registro del pedido no es un objeto válido');
  }
  const esNacional = registro.direccionEnvio?.pais === PAIS_ORIGEN;
  return esNacional ? new PedidoNacional(registro) : new PedidoInternacional(registro);
};

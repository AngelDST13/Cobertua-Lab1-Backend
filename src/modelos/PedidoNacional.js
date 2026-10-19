import { CARGOS_ENVIO, TIPOS_PEDIDO } from '../config/reglasNegocio.js';
import { redondearMoneda } from '../utils/utilidades.js';
import { Pedido } from './Pedido.js';

/**
 * Pedido con destino en Costa Rica (Reto 1 · herencia).
 *
 * Polimorfismo: usa la tarifa base, conserva el envío gratis sobre el umbral
 * y, si el clima es severo, suma un recargo FIJO (moto/camión local con desvío).
 */
export class PedidoNacional extends Pedido {
  get tipo() {
    return TIPOS_PEDIDO.NACIONAL;
  }

  calcularCostoEnvio(zona, clima = null) {
    const costoBase = super.calcularCostoEnvio(zona);
    const aplicaRecargo = costoBase > 0 && clima?.severo === true;
    const costo = aplicaRecargo ? redondearMoneda(costoBase + CARGOS_ENVIO.recargoClimaNacionalFijo) : costoBase;

    this.costoEnvio = costo;
    return costo;
  }

  /** Los envíos nacionales no tienen restricciones aduaneras. */
  validarRestricciones() {
    return [];
  }
}

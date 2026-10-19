/**
 * Tipos de error del dominio.
 *
 * Distinguirlos permite decidir la ruta de salida:
 *  - ErrorNegocio     → el pedido incumple una regla  → se RECHAZA.
 *  - ErrorIntegracion → un servicio externo falló     → se deja EN REVISIÓN
 *                       (no castigamos al cliente por una caída nuestra).
 *  - Cualquier otro   → error de programación         → se propaga y n8n
 *                       lo envía al Error Workflow.
 */

export class ErrorNegocio extends Error {
  /**
   * @param {string} codigo  Código estable para reportes (ej. "PESO_EXCEDIDO").
   * @param {string} mensaje Explicación legible que se guarda como motivo.
   */
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.codigo = codigo;
  }
}

export class ErrorIntegracion extends Error {
  /**
   * @param {string} servicio Servicio que falló (ej. "ip-api", "DeepSeek").
   * @param {string} detalle  Qué ocurrió, sin datos sensibles.
   */
  constructor(servicio, detalle) {
    super(`${servicio}: ${detalle}`);
    this.name = 'ErrorIntegracion';
    this.servicio = servicio;
  }
}

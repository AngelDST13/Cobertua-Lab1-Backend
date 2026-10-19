/**
 * Funciones auxiliares sin estado, compartidas por las clases.
 */

/** Redondea un monto a 2 decimales evitando errores de coma flotante (0.1 + 0.2). */
export const redondearMoneda = (valor) => Math.round((valor + Number.EPSILON) * 100) / 100;

/** true si el valor es un texto con al menos un carácter visible. */
export const esTextoNoVacio = (valor) => typeof valor === 'string' && valor.trim().length > 0;

/** Recorta un texto para no guardar ni reenviar entradas excesivamente largas. */
export const recortarTexto = (valor, largoMaximo) => String(valor ?? '').slice(0, largoMaximo);

/** Escapa texto para insertarlo en HTML (correos): los datos vienen de fuera. */
export const escaparHtml = (valor) =>
  String(valor ?? '').replace(/[&<>"']/g, (caracter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[caracter]);

/** "San Rafael, Escazú, San José, CR": une las partes de la dirección que existan. */
export const describirDestino = (direccion = {}) =>
  [direccion.ciudad, direccion.canton, direccion.provincia, direccion.pais].filter(esTextoNoVacio).join(', ');

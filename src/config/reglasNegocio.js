/**
 * Parámetros de las reglas de negocio.
 *
 * Todo lo que el negocio puede querer ajustar (zonas, tarifas, límites,
 * umbrales de riesgo) vive aquí, separado de la lógica. Este archivo se
 * incrusta también en los nodos Code de n8n (ver scripts/generar-nodos-n8n.js),
 * por eso un cambio aquí se refleja en ambos lados.
 */

/** Estados posibles de un pedido en JSON Server. */
export const ESTADOS = Object.freeze({
  PENDIENTE: 'pendiente',
  EN_REVISION: 'en_revision',
  APROBADO: 'aprobado',
  RECHAZADO: 'rechazado',
});

/**
 * R5 · Máquina de estados: desde qué estado se puede pasar a cuál.
 * "aprobado" y "rechazado" son finales.
 */
export const TRANSICIONES_PERMITIDAS = Object.freeze({
  pendiente: Object.freeze(['aprobado', 'rechazado', 'en_revision']),
  en_revision: Object.freeze(['aprobado', 'rechazado', 'en_revision']),
  aprobado: Object.freeze([]),
  rechazado: Object.freeze([]),
});

/** R5 · Solo estos estados entran al flujo (idempotencia ante reenvíos). */
export const ESTADOS_PROCESABLES = Object.freeze(['pendiente', 'en_revision']);

/** Qué debe hacer n8n con el resultado de cada fase. */
export const ACCIONES = Object.freeze({
  EVALUAR_IA: 'evaluar_ia', // cobertura verificada → consultar DeepSeek
  ACTUALIZAR: 'actualizar', // decisión tomada → PATCH en JSON Server
  OMITIR: 'omitir', // no se toca el pedido (no existe, ya procesado, etc.)
});

/**
 * R2 y R3 · Zonas con cobertura y su tarifa de envío (USD).
 * Solo se vende dentro de Costa Rica y solo se entrega en la GAM
 * (ver CANTONES_GAM). `paises` indica desde dónde se acepta la compra (IP).
 * envioGratisDesde: subtotal a partir del cual el envío es gratis (null = nunca).
 */
export const ZONAS_COBERTURA = Object.freeze([
  Object.freeze({
    codigo: 'GAM',
    nombre: 'Gran Área Metropolitana',
    paises: Object.freeze(['CR']),
    tarifaBase: 3.5,
    tarifaPorKg: 0.75,
    pesoMaximoKg: 30,
    envioGratisDesde: 75,
    diasEntrega: '1-2',
  }),
]);

/** R2 · Los 84 cantones de Costa Rica por provincia (para reconocer la dirección de entrega). */
export const CANTONES_COSTA_RICA = Object.freeze({
  'San José': Object.freeze([
    'San José', 'Escazú', 'Desamparados', 'Puriscal', 'Tarrazú', 'Aserrí', 'Mora', 'Goicoechea', 'Santa Ana', 'Alajuelita',
    'Vázquez de Coronado', 'Acosta', 'Tibás', 'Moravia', 'Montes de Oca', 'Turrubares', 'Dota', 'Curridabat', 'Pérez Zeledón', 'León Cortés Castro',
  ]),
  Alajuela: Object.freeze([
    'Alajuela', 'San Ramón', 'Grecia', 'San Mateo', 'Atenas', 'Naranjo', 'Palmares', 'Poás', 'Orotina', 'San Carlos',
    'Zarcero', 'Sarchí', 'Upala', 'Los Chiles', 'Guatuso', 'Río Cuarto',
  ]),
  Cartago: Object.freeze(['Cartago', 'Paraíso', 'La Unión', 'Jiménez', 'Turrialba', 'Alvarado', 'Oreamuno', 'El Guarco']),
  Heredia: Object.freeze(['Heredia', 'Barva', 'Santo Domingo', 'Santa Bárbara', 'San Rafael', 'San Isidro', 'Belén', 'Flores', 'San Pablo', 'Sarapiquí']),
  Guanacaste: Object.freeze(['Liberia', 'Nicoya', 'Santa Cruz', 'Bagaces', 'Carrillo', 'Cañas', 'Abangares', 'Tilarán', 'Nandayure', 'La Cruz', 'Hojancha']),
  Puntarenas: Object.freeze([
    'Puntarenas', 'Esparza', 'Buenos Aires', 'Montes de Oro', 'Osa', 'Quepos', 'Golfito', 'Coto Brus', 'Parrita', 'Corredores',
    'Garabito', 'Monteverde', 'Puerto Jiménez',
  ]),
  Limón: Object.freeze(['Limón', 'Pococí', 'Siquirres', 'Talamanca', 'Matina', 'Guácimo']),
});

/** R2 · Los 31 cantones de la Gran Área Metropolitana: los únicos con entrega. */
export const CANTONES_GAM = Object.freeze({
  'San José': Object.freeze([
    'San José', 'Escazú', 'Desamparados', 'Aserrí', 'Mora', 'Goicoechea', 'Santa Ana', 'Alajuelita', 'Vázquez de Coronado', 'Tibás',
    'Moravia', 'Montes de Oca', 'Curridabat',
  ]),
  Alajuela: Object.freeze(['Alajuela', 'Atenas', 'Poás']),
  Cartago: Object.freeze(['Cartago', 'Paraíso', 'La Unión', 'Alvarado', 'Oreamuno', 'El Guarco']),
  Heredia: Object.freeze(['Heredia', 'Barva', 'Santo Domingo', 'Santa Bárbara', 'San Rafael', 'San Isidro', 'Belén', 'Flores', 'San Pablo']),
});

/** Nombres populares o antiguos que la gente escribe en lugar del cantón oficial. */
export const ALIAS_CANTONES = Object.freeze({
  coronado: 'Vázquez de Coronado',
  'vasquez de coronado': 'Vázquez de Coronado',
  'tres rios': 'La Unión',
  'valverde vega': 'Sarchí',
  'leon cortes': 'León Cortés Castro',
  'san isidro de el general': 'Pérez Zeledón',
  'ciudad quesada': 'San Carlos',
  aguirre: 'Quepos',
  jaco: 'Garabito',
});

/** R1 · Límites de estructura del pedido. */
export const LIMITES_PEDIDO = Object.freeze({
  maxItems: 50,
  maxCantidadPorItem: 100,
  maxLargoTexto: 200,
});

/** R4 · Parámetros del análisis con DeepSeek. */
export const CONFIG_IA = Object.freeze({
  modelo: 'deepseek-chat',
  temperatura: 0.2,
  maxTokens: 400,
  riesgosValidos: Object.freeze(['bajo', 'medio', 'alto']),
  puntajeMaximoAceptable: 69, // puntaje >= 70 se rechaza aunque la IA diga "viable"
  maxMotivos: 5,
  maxLargoMotivo: 200,
  maxLargoMensaje: 500,
});

/** Moneda en la que se expresan precios y tarifas. */
export const MONEDA = 'USD';

/** País de origen de la tienda: define si un pedido es nacional o internacional. */
export const PAIS_ORIGEN = 'CR';

/** Reto 1 · Tipos de pedido (jerarquía PedidoNacional / PedidoInternacional). */
export const TIPOS_PEDIDO = Object.freeze({ NACIONAL: 'nacional', INTERNACIONAL: 'internacional' });

/** Reto 1 · Cargos que cada subclase aplica de forma distinta en calcularCostoEnvio(). */
export const CARGOS_ENVIO = Object.freeze({
  recargoClimaNacionalFijo: 2, // USD fijos por mal clima (nacional)
  recargoClimaInternacionalPorcentaje: 0.2, // +20 % del envío por mal clima (internacional)
  seguroInternacionalPorcentaje: 0.015, // 1.5 % del valor declarado
  seguroInternacionalMinimo: 3, // USD
});

/** Reto 1 · Restricciones propias de los envíos internacionales (aduana / reventa). */
export const RESTRICCIONES_INTERNACIONALES = Object.freeze({
  maxUnidadesPorSku: 5,
  maxValorDeclarado: 5000, // USD
});

/** Reto 2 · Umbrales para considerar el clima "severo" (datos de Open-Meteo). */
export const UMBRALES_CLIMA = Object.freeze({
  codigosSeveros: Object.freeze([65, 67, 75, 82, 86, 95, 96, 99]), // lluvia/nieve intensa, tormenta eléctrica
  vientoMaximoKmH: 60,
  precipitacionMaximaMm: 10,
});

/**
 * Códigos de motivo: permiten agrupar decisiones en el historial (Reto 4)
 * y decidir cuándo notificar por correo (Reto 3).
 */
export const CODIGOS_MOTIVO = Object.freeze({
  APROBADO: 'APROBADO',
  ESTRUCTURA_INVALIDA: 'ESTRUCTURA_INVALIDA',
  IP_INVALIDA: 'IP_INVALIDA',
  IP_NO_GEOLOCALIZABLE: 'IP_NO_GEOLOCALIZABLE',
  SIN_COBERTURA: 'SIN_COBERTURA',
  PESO_EXCEDIDO: 'PESO_EXCEDIDO',
  RESTRICCION_INTERNACIONAL: 'RESTRICCION_INTERNACIONAL',
  RIESGO_IA: 'RIESGO_IA',
  SERVICIO_NO_DISPONIBLE: 'SERVICIO_NO_DISPONIBLE',
});

/** Reto 3 · Qué decisiones disparan un correo y con qué nivel. */
export const NOTIFICACIONES = Object.freeze({
  SIN_COBERTURA: 'advertencia',
  RESTRICCION_INTERNACIONAL: 'critico',
  RIESGO_IA: 'critico',
  SERVICIO_NO_DISPONIBLE: 'critico',
});

/** Reto 4 · Parámetros del análisis de tendencia. */
export const CONFIG_TENDENCIA = Object.freeze({
  ventana: 10, // ejecuciones por bloque (recientes vs. anteriores)
  minimoPorBloque: 2, // con menos datos no se concluye
  umbralCambio: 0.1, // 10 puntos porcentuales para hablar de mejora/empeoramiento
});

/**
 * Respuestas simuladas de los servicios externos, con la misma forma que
 * entregan en n8n. Permiten ejecutar main.js y las pruebas sin red ni API keys.
 */
import { readFileSync } from 'node:fs';

const RUTA_SEMILLA = new URL('./db.seed.json', import.meta.url);

/** Pedidos de la base semilla de JSON Server. */
export const cargarPedidosSemilla = () => JSON.parse(readFileSync(RUTA_SEMILLA, 'utf8')).pedidos;

/** Simula el GET /pedidos/:id de JSON Server con "Include Response Headers and Status" activo. */
export const simularConsultaPedido = (pedidos, id) => {
  const registro = pedidos.find((pedido) => pedido.id === id);
  return registro ? { statusCode: 200, headers: {}, body: structuredClone(registro) } : { statusCode: 404, headers: {}, body: {} };
};

/** Lo que entrega el nodo HTTP en modo "On Error → Continue" cuando el servicio está caído. */
export const respuestaServicioCaido = (mensaje = 'connect ETIMEDOUT') => ({ error: { message: mensaje, name: 'NodeApiError' } });

/** Respuestas de http://ip-api.com/json/{ip} */
export const GEO = {
  costaRica: {
    status: 'success',
    country: 'Costa Rica',
    countryCode: 'CR',
    regionName: 'Provincia de San José',
    city: 'San José',
    lat: 9.9281,
    lon: -84.0907,
    isp: 'Instituto Costarricense de Electricidad y Telecom.',
    proxy: false,
    hosting: false,
    query: '201.191.20.10',
  },
  estadosUnidos: {
    status: 'success',
    country: 'United States',
    countryCode: 'US',
    regionName: 'Florida',
    city: 'Miami',
    lat: 25.7617,
    lon: -80.1918,
    isp: 'Comcast Cable Communications',
    proxy: false,
    hosting: false,
    query: '73.162.10.25',
  },
  panamaConVPN: {
    status: 'success',
    country: 'Panama',
    countryCode: 'PA',
    regionName: 'Provincia de Panamá',
    city: 'Panama City',
    lat: 8.9824,
    lon: -79.5199,
    isp: 'M247 Europe SRL',
    proxy: true,
    hosting: true,
    query: '190.140.45.12',
  },
  espana: {
    status: 'success',
    country: 'Spain',
    countryCode: 'ES',
    regionName: 'Madrid',
    city: 'Madrid',
    lat: 40.4168,
    lon: -3.7038,
    isp: 'Telefonica de Espana',
    proxy: false,
    hosting: false,
    query: '81.38.10.12',
  },
  ipNoUbicable: { status: 'fail', message: 'reserved range', query: '240.0.0.1' },
};

/** Respuesta de api.open-meteo.com/v1/forecast?current=temperature_2m,precipitation,weather_code,wind_speed_10m */
const respuestaOpenMeteo = ({ temperatura, precipitacion, codigo, viento }) => ({
  latitude: 9.94,
  longitude: -84.09,
  timezone: 'America/Costa_Rica',
  current_units: { temperature_2m: '°C', precipitation: 'mm', weather_code: 'wmo code', wind_speed_10m: 'km/h' },
  current: { time: '2026-10-19T09:00', interval: 900, temperature_2m: temperatura, precipitation: precipitacion, weather_code: codigo, wind_speed_10m: viento },
});

export const CLIMA = {
  despejado: respuestaOpenMeteo({ temperatura: 24.5, precipitacion: 0, codigo: 1, viento: 9 }),
  tormenta: respuestaOpenMeteo({ temperatura: 19.2, precipitacion: 14.6, codigo: 95, viento: 48 }),
};

/** Lo que entrega el nodo Merge: campos de ip-api + campos de Open-Meteo en un solo ítem. */
export const combinarGeoYClima = (geo, clima) => ({ ...geo, ...clima });

/** Envuelve un objeto como lo devuelve https://api.deepseek.com/chat/completions. */
export const respuestaDeepSeek = (contenido) => ({
  id: 'chatcmpl-simulado',
  object: 'chat.completion',
  model: 'deepseek-chat',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: typeof contenido === 'string' ? contenido : JSON.stringify(contenido) },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 420, completion_tokens: 90, total_tokens: 510 },
});

export const IA = {
  riesgoBajo: respuestaDeepSeek({
    viable: true,
    riesgo: 'bajo',
    puntaje: 8,
    motivos: ['IP y destino coinciden', 'Montos y cantidades habituales para el tipo de artículo'],
    mensajeCliente: '¡Gracias por tu compra! Tu pedido fue confirmado y pronto recibirás la guía de envío.',
  }),
  riesgoAlto: respuestaDeepSeek({
    viable: false,
    riesgo: 'alto',
    puntaje: 91,
    motivos: ['12 unidades del mismo smartphone sugieren reventa', 'IP de VPN en centro de datos', 'Entrega en casillero de zona libre'],
    mensajeCliente: 'No pudimos confirmar tu pedido en este momento. Nuestro equipo te contactará para ayudarte.',
  }),
  respuestaNoJSON: respuestaDeepSeek('Lo siento, no puedo ayudarte con eso.'),
};

/**
 * Tarifas de ejemplo para probar la jerarquía de pedidos (Reto 1).
 * La tienda solo tiene cobertura en la GAM; estas zonas internacionales no se
 * usan en el flujo, solo permiten ejercitar PedidoInternacional en las pruebas.
 */
export const ZONAS_PRUEBA = {
  CENTROAMERICA: { codigo: 'CENTROAMERICA', nombre: 'Centroamérica', paises: ['PA'], tarifaBase: 12, tarifaPorKg: 2.5, pesoMaximoKg: 20, envioGratisDesde: null, diasEntrega: '4-7' },
  NORTEAMERICA: { codigo: 'NORTEAMERICA', nombre: 'Norteamérica', paises: ['US'], tarifaBase: 20, tarifaPorKg: 4, pesoMaximoKg: 15, envioGratisDesde: 250, diasEntrega: '5-10' },
};

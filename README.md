# Laboratorio #1 · Pedidos con verificación geográfica de cobertura

Soluciones de Negocio (POO + n8n) · **Escenario 2**, con análisis de riesgo por **DeepSeek** como valor agregado.

Un webhook de n8n recibe un pedido y la IP del cliente, consulta el pedido en **JSON Server**, geolocaliza la IP con **ip-api.com**, consulta el clima con **Open-Meteo** (ambos se unen en un nodo **Merge**), verifica cobertura y calcula el envío con clases POO (**PedidoNacional** / **PedidoInternacional**), pide a **DeepSeek** un análisis de riesgo, deja el pedido `aprobado`, `rechazado` o `en_revision`, guarda la ejecución en el historial, analiza la **tendencia** y envía **alertas por correo**.

Incluye un **panel web** con modo día/noche en **http://localhost:3000** para crear pedidos, procesarlos y ver todo el resultado. Los retos de extensión están en [docs/retos-extension.md](docs/retos-extension.md).

## Estructura

```
├── main.js                         # Demo independiente de las clases (sin n8n ni red)
├── src/
│   ├── config/reglasNegocio.js     # Cantones de la GAM, tarifas, estados, umbrales (parámetros del negocio)
│   ├── modelos/
│   │   ├── Pedido.js               # Clase base: R1 estructura, R3 envío, R5 estados
│   │   ├── PedidoNacional.js       # Reto 1: subclase (recargo climático fijo)
│   │   ├── PedidoInternacional.js  # Reto 1: subclase (seguro, recargo %, restricciones)
│   │   └── fabricaPedidos.js       # Reto 1: elige la subclase según el destino
│   ├── servicios/
│   │   ├── ValidadorCobertura.js   # R1 IP, geolocalización, R2 cobertura por cantón (GAM)
│   │   ├── AnalizadorClima.js      # Reto 2: interpreta Open-Meteo
│   │   ├── AnalizadorRiesgoIA.js   # R4 consulta y validación de DeepSeek
│   │   ├── HistorialTendencia.js   # Reto 4: registro y análisis de tendencia
│   │   ├── NotificadorAlertas.js   # Reto 3: cuándo y qué notificar por correo
│   │   └── GestorPedidos.js        # Orquesta las 3 fases = los 3 nodos Code
│   ├── errores/errores.js          # ErrorNegocio / ErrorIntegracion
│   └── utils/utilidades.js
├── n8n/
│   ├── workflow-pedidos-cobertura.json   # EL workflow (único archivo a importar en n8n)
│   ├── codigo-generado/                  # Código exacto de cada nodo Code (generado)
│   ├── definicionWorkflow.js             # Definición de nodos (fuente del JSON)
│   └── adaptadores.js                    # Únicas líneas propias de n8n en los nodos Code
├── public/                         # Panel web (lo sirve JSON Server en :3000)
├── scripts/
│   ├── generar-nodos-n8n.js        # src/ → nodos Code + JSON del workflow
│   ├── preparar-db.js              # Crea/restaura db.json
│   └── probar-webhook.js           # Prueba de punta a punta contra n8n
├── datos/
│   ├── db.seed.json                # 7 pedidos + historial de ejecuciones de ejemplo
│   └── respuestasSimuladas.js      # Respuestas de ip-api, Open-Meteo y DeepSeek para demo y pruebas
├── tests/                          # node:test (incluye prueba de sincronización POO ↔ n8n)
└── docs/
    ├── arquitectura.md             # Flujo de datos, clases, nodos, reglas y errores
    ├── retos-extension.md          # Retos 1–4: herencia, Merge, correo, tendencia + panel
    └── documento-logica-negocio.md # Borrador del documento entregable (2–4 páginas)
```

## Panel web

```bash
npm run db      # JSON Server + panel en http://localhost:3000
n8n start       # en otra terminal, con el workflow activo
```

Abre http://localhost:3000. La primera vez pide la **clave del webhook** (`X-API-Key`), que se guarda solo en tu navegador. El botón del sol o la luna cambia entre modo día y modo noche.

## Requisitos

- Node.js 20 o superior
- n8n (Desktop, `npx n8n` o Docker)
- Una API key de DeepSeek (solo para el flujo en n8n; la demo y las pruebas no la necesitan)

## Uso rápido

```bash
npm install
npm start          # demo de las clases por consola (herencia, flujo completo, tendencia)
npm test           # pruebas, incluida la sincronización con n8n
```

## Ejecutar con n8n

1. **JSON Server**

   ```bash
   npm run db          # crea db.json desde la semilla y levanta http://localhost:3000
   npm run db:reset    # restaura los pedidos de ejemplo
   ```

   Si n8n corre en Docker, levanta JSON Server con `npx json-server --watch db.json --port 3000 --host 0.0.0.0` y cambia el nodo **Configuración** a `http://host.docker.internal:3000`.

2. **Credenciales en n8n** (*Credentials → New → Header Auth*):

   | Nombre | Header | Valor |
   |---|---|---|
   | `Webhook pedidos (Header Auth)` | `X-API-Key` | una clave larga aleatoria |
   | `DeepSeek API` | `Authorization` | `Bearer <tu API key de OpenRouter o de DeepSeek>` |

   El modelo es siempre DeepSeek. Por defecto se llama a través de **OpenRouter** (`deepseek/deepseek-chat`). Para usar la API directa de DeepSeek, cambia en el nodo **Configuración** `iaUrl` a `https://api.deepseek.com/chat/completions` y `iaModelo` a `deepseek-chat`, y pon tu key de DeepSeek en la credencial.

   Para las alertas por correo (Reto 3) crea además una credencial **SMTP** (Gmail: `smtp.gmail.com`, puerto 465, SSL, con una *contraseña de aplicación*).

3. **Importar** `n8n/workflow-pedidos-cobertura.json` (*Workflows → Import from file*). Es un único flujo: incluye también la rama de errores inesperados. Selecciona las credenciales en los nodos **Recibir pedido**, **Analizar riesgo con DeepSeek** y **Enviar alerta por correo**, y en el nodo **Configuración** pon `correoAlertas` y `correoRemitente`.

4. **Probar todo de una vez** (con el workflow activo):

   ```bash
   npm run probar -- <tu clave X-API-Key>
   ```

   Envía los 8 casos por POST, verifica la respuesta y el estado guardado en JSON Server, y restaura `db.json` al final.

   > **Abrir la URL del webhook en el navegador da 404** ("not registered for GET requests"). Es normal: el navegador hace GET y el webhook solo acepta **POST** con JSON y el header `X-API-Key`.

   O a mano (con *Listen for test event* activo):

   ```bash
   curl -X POST http://localhost:5678/webhook-test/pedidos/verificar-cobertura \
     -H "Content-Type: application/json" -H "X-API-Key: <tu clave>" \
     -d '{"pedidoId":"PED-1001","ipCliente":"201.191.20.10"}'
   ```

   En PowerShell:

   ```powershell
   Invoke-RestMethod -Method Post -Uri http://localhost:5678/webhook-test/pedidos/verificar-cobertura `
     -Headers @{ 'X-API-Key' = '<tu clave>' } -ContentType 'application/json' `
     -Body '{"pedidoId":"PED-1001","ipCliente":"201.191.20.10"}'
   ```

   | Caso | Cuerpo | Resultado esperado |
   |---|---|---|
   | Con cobertura (Escazú, GAM) | `{"pedidoId":"PED-1001","ipCliente":"201.191.20.10"}` | Pasa a DeepSeek; envío gratis (compra ≥ $75) |
   | Cantón fuera de la GAM | `{"pedidoId":"PED-1008","ipCliente":"201.191.20.10"}` | `rechazado` (Grecia, Alajuela) |
   | Provincia sin cobertura | `{"pedidoId":"PED-1009","ipCliente":"201.191.20.10"}` | `rechazado` (Liberia, Guanacaste) |
   | Destino fuera de Costa Rica | `{"pedidoId":"PED-1003","ipCliente":"201.191.20.10"}` | `rechazado` (Miami, US) |
   | IP fuera de Costa Rica | `{"pedidoId":"PED-1005","ipCliente":"81.38.10.12"}` | `rechazado` (IP en España) |
   | IP privada | `{"pedidoId":"PED-1002","ipCliente":"192.168.1.15"}` | `rechazado` |
   | Peso excedido | `{"pedidoId":"PED-1007","ipCliente":"201.191.20.10"}` | `rechazado` (40 kg > 30 kg) |
   | Ya procesado | `{"pedidoId":"PED-1006","ipCliente":"8.8.8.8"}` | HTTP 409, sin cambios |
   | Inexistente | `{"pedidoId":"PED-9999","ipCliente":"8.8.8.8"}` | HTTP 404 |

   Para simular caídas: detén JSON Server (503) o deja la credencial de DeepSeek con una clave inválida (el pedido queda `en_revision`).

## Reglas de negocio

| # | Regla | Si no se cumple |
|---|---|---|
| R1 | Estructura completa del pedido e IP pública con formato estricto | `rechazado` |
| R2 | IP en Costa Rica y entrega en uno de los 31 cantones de la GAM (San José, Alajuela, Heredia, Cartago) | `rechazado` |
| R3 | Envío = $3,50 + ⌈kg⌉ × $0,75; gratis desde $75; máximo 30 kg | `rechazado` si excede peso |
| R4 | DeepSeek: rechazo si no viable, riesgo alto o puntaje ≥ 70 | `rechazado` |
| R5 | Solo pedidos `pendiente`/`en_revision`; transiciones controladas con historial | sin cambios (409) |

**Cobertura (R2).** Solo se entrega en la Gran Área Metropolitana. Los cantones están en `CANTONES_GAM` de [src/config/reglasNegocio.js](src/config/reglasNegocio.js); la dirección lleva `provincia` y `canton` (se aceptan alias como «Tres Ríos» → La Unión). No tienen cobertura: cualquier destino o IP fuera de Costa Rica, todo Guanacaste, Puntarenas y Limón, y los cantones no metropolitanos de San José (Puriscal, Tarrazú, Acosta, Turrubares, Dota, Pérez Zeledón, León Cortés), Alajuela (todos menos Alajuela, Atenas y Poás), Cartago (Jiménez, Turrialba) y Heredia (Sarapiquí). La pestaña **Cobertura** del panel lo muestra cantón por cantón. `PedidoInternacional` se conserva para el Reto 1 (herencia), pero con esta regla ningún pedido internacional llega a calcular envío.

Fallas de ip-api o DeepSeek dejan el pedido **`en_revision`**, no rechazado. Detalle completo en [docs/arquitectura.md](docs/arquitectura.md).

## Modificar la lógica

Las reglas viven solo en `src/`. Después de cualquier cambio:

```bash
npm run build:n8n   # regenera n8n/codigo-generado/ y los JSON del workflow
npm test            # falla si el workflow versionado quedó desactualizado
```

No edites el código dentro de los nodos Code en n8n: se sobrescribe al regenerar.

## Seguridad

- Las API keys se guardan solo en el gestor de credenciales de n8n; los JSON exportados no contienen secretos.
- `db.json` está en `.gitignore`; los datos de ejemplo usan correos `@example.com`.
- A DeepSeek no se envían nombre, correo ni dirección exacta del cliente.

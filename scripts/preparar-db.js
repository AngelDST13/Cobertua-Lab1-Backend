/**
 * Crea db.json (la base que JSON Server modifica) a partir de datos/db.seed.json.
 *
 *   node scripts/preparar-db.js            → solo si db.json no existe
 *   node scripts/preparar-db.js --forzar   → restaura los datos de ejemplo
 */
import { copyFileSync, existsSync } from 'node:fs';

const SEMILLA = new URL('../datos/db.seed.json', import.meta.url);
const BASE = new URL('../db.json', import.meta.url);
const forzar = process.argv.includes('--forzar');

if (forzar || !existsSync(BASE)) {
  copyFileSync(SEMILLA, BASE);
  console.log('✔ db.json restaurado desde datos/db.seed.json');
} else {
  console.log('db.json ya existe (usa "npm run db:reset" para restaurarlo)');
}

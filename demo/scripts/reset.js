/* Restores public/login.html from the pristine snapshot, so the demo
   can be run again from a clean state. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TARGET = path.join(ROOT, 'public', 'login.html');
const SNAPSHOT = path.join(ROOT, 'snapshots', 'login.pristine.html');

fs.copyFileSync(SNAPSHOT, TARGET);
console.log('public/login.html restored from snapshot — working state.');

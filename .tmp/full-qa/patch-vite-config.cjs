const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(__dirname, '../../config/dist/src/defineViteConfig.mjs');
let source = fs.readFileSync(file, 'utf8');
if (!source.includes('fileURLToPath')) {
  source = "import {fileURLToPath} from 'node:url';\n" + source;
  source = source.replace('path.dirname(new URL(import.meta.url).pathname)', 'path.dirname(fileURLToPath(import.meta.url))');
  fs.writeFileSync(file, source);
}

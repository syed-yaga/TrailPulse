import fs from 'fs';
fs.writeFileSync('dist/server.js', "import './server/src/server.js';\n");

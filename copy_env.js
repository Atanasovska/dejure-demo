import fs from 'fs';
let env = ''
if (fs.existsSync('./env')) {
    env = ""+ fs.readFileSync('./env');
    env= env.trim().replace(/[\n\r]+/g, '');
}

var source = 'config/env.docker.'+env
console.log( source +" -> " + '.env')
fs.copyFileSync(source,'.env');
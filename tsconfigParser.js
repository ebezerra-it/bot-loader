//Read tsconfig.json file and parse it as JSON
module.exports = function tsconfigParser(NODE_ENV) {
    const fs = require('fs');
    var compilerOptions = fs.readFileSync('./tsconfig.json').toString();
    //compilerOptions = compilerOptions.replace(/\*([^*]|[\r\n]|(\*+([^*/]|[\r\n])))*\*+/g, '').replace(/[^:]\/\/.*/g,'');
    compilerOptions = compilerOptions.replace(/\/\*.*\*\//g, '').replace(/\/\/.*\n/g,'');
    compilerOptions = JSON.parse(compilerOptions);
    
    //Captures look up migration folder and file extension depending on NODE_ENV
    var envFolder = (NODE_ENV==='PROD'?compilerOptions.compilerOptions.outDir:compilerOptions.compilerOptions.rootDir);

    //Removes rightmost '/', if exists
    envFolder = envFolder.substr(envFolder.length-1) === '/'?envFolder.substr(0,envFolder.length-1):envFolder;

    var extension = (NODE_ENV==='PROD'?'js':'ts');
    return { envFolder, extension }
}


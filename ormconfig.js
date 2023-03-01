var { readFileSync } = require('fs');
var { join } = require('path');
var tsconfigParser = require('./tsconfigParser');
var { envFolder, extension } = tsconfigParser(process.env.NODE_ENV);

module.exports={
   "type": "postgres",
   "host": process.env.DB_HOST,
   "port": Number(process.env.DB_PORT),
   "username": process.env.DB_USER,
   "password": process.env.DB_PASS,
   "database": process.env.DB_NAME,
   // "logging": ["error", "query"],
   "logging": ["error"],
   "migrations": [
      envFolder + "/db/migrations/**/*." + extension
   ],
   "cli": {
      "migrationsDir": envFolder + "/db/migrations" 
   },
   migrationsTransactionMode: 'each',
   ssl: {
      checkServerIdentity: () => {}, // skip host validation in certificate
      sslmode: 'verify-ca',
      rejectUnauthorized: true,
      ca: readFileSync(join(__dirname, '/cert/db', 'root.crt'), 'utf-8').toString(),
      key: readFileSync(join(__dirname, '/cert/db', 'client.key'), 'utf-8').toString(),
      cert: readFileSync(join(__dirname, '/cert/db', 'client.crt'), 'utf-8').toString(),
   },
}
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
   /* "ssl": {
      "rejectUnauthorized": true,
      ca: readFileSync(path.join(__dirname, '/cert', 'rootCA_CA.pem')).toString(),
      key: readFileSync(path.join(__dirname, '/cert', 'localhost.key')).toString(),
      cert: readFileSync(path.join(__dirname, '/cert', 'localhost.crt')).toString(),
   } */

}
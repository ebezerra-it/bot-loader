COUNTRY=WW
STATE=GlobalStockExchanges
LOCATION=WorldWideWeb
ORGANIZATION=MyOraculum
UNIT=MyOraculum
EMAIL=t.me@myoraculum
DBHOST=localhost
DBUSER=myoraculum-user

rm -f server.csr server.key server.crt root.crt server.csr 
rm -f client.key client.csr client.crt client.der.key root.srl

# Server certificate files
openssl req -new -text -nodes -subj "/C=$COUNTRY/ST=$STATE/L=$LOCATION/O=$ORGANIZATION/OU=$UNIT/emailAddress=$EMAIL/CN=$DBHOST" -keyout server.key -out server.csr
openssl req -days 3650 -x509 -text -in server.csr -key server.key -out server.crt
cp server.crt root.crt
rm server.csr
# - CA CERTIFICATE: root.crt
# - SERVER CERTIFICATE: server.crt
# - SERVER PRIVATE KEY: server.key

# Client certificate files
openssl req -days 3650 -new -nodes -subj "/C=$COUNTRY/ST=$STATE/L=$LOCATION/O=$ORGANIZATION/OU=$UNIT/emailAddress=$EMAIL/CN=$DBUSER" -keyout client.key -out client.csr
openssl x509 -days 3650 -req  -CAcreateserial -in client.csr -CA root.crt -CAkey server.key -out client.crt
openssl pkcs8 -topk8 -inform PEM -outform DER -nocrypt -in client.key -out client.pk8.key
rm client.csr root.srl
#DBEAVER: 
# - CA CERTIFICATE: root.crt
# - CLIENT CERTIFICATE: client.crt
# - CLIENT PRIVATE KEY: client.pk8.key
#TYPEORM/NODE-POSTGRES: 
# - CA CERTIFICATE: root.crt
# - CLIENT CERTIFICATE: client.crt
# - CLIENT PRIVATE KEY: client.key

# Copy certificate files to TRYD-DATA-LOADER
cp ./root.crt ../../../tryd-data-loader/cert/db/root.crt
cp ./client.crt ../../../tryd-data-loader/cert/db/client.crt
cp ./client.key ../../../tryd-data-loader/cert/db/client.key

echo "[DB-CERTIFICATES] Server and Client certificates generated successfuly for DBHOST: $DBHOST - DBUSER: $DBUSER"
printf "\n[MYORACULUM-POSTGRES] Remember to: \e[5m\e[31mREBUILD POSTGRES CONTAINER WITH NEW CERTIFICATE FILES\e[0m "

SSL_FOLDER="./ssl/"
CA_FILE_PREFIX="ca"
CLIENT_FILE_PREFIX="client"
PG_USER="myoraculum-user"
HOST_ADDR="66.94.96.81"

mkdir -p ${SSL_FOLDER}
rm -rf ${SSL_FOLDER}${CA_FILE_PREFIX}.key ${SSL_FOLDER}${CA_FILE_PREFIX}.crt ${SSL_FOLDER}${CLIENT_FILE_PREFIX}.key ${SSL_FOLDER}${CLIENT_FILE_PREFIX}.csr ${SSL_FOLDER}${CLIENT_FILE_PREFIX}.crt

openssl ecparam -name prime256v1 -genkey -noout -out ${SSL_FOLDER}${CA_FILE_PREFIX}.key
openssl req -new -x509 -sha256 -key ${SSL_FOLDER}${CA_FILE_PREFIX}.key -out ${SSL_FOLDER}${CA_FILE_PREFIX}.crt -subj "/CN=${HOST_ADDR}"
openssl ecparam -name prime256v1 -genkey -noout -out ${SSL_FOLDER}${CLIENT_FILE_PREFIX}.key
openssl req -new -sha256 -key ${SSL_FOLDER}${CLIENT_FILE_PREFIX}.key -out ${SSL_FOLDER}${CLIENT_FILE_PREFIX}.csr -subj "/CN=${PG_USER}"
openssl x509 -req -in ${SSL_FOLDER}${CLIENT_FILE_PREFIX}.csr -CA ${SSL_FOLDER}${CA_FILE_PREFIX}.crt -CAkey ${SSL_FOLDER}${CA_FILE_PREFIX}.key -CAcreateserial -out ${SSL_FOLDER}${CLIENT_FILE_PREFIX}.crt -days 3650 -sha256

echo "SSL files generated!"
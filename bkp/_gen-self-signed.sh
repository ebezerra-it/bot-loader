#!/bin/bash

#==================================================================
# When creating a new cert/key pair for your site you only need to
# change the details below and make sure CA_PEM and CA_KEY are in the
# same directory as this script and that CA_PEM is added to your browser.
# Then add the newly created .key/.crt pair to your webserver.
SSL_FOLDER = "./ssl/"
EMAIL="myoraculum@gmail.com"
PG_USER="myoraculum-user"   # POSTGRES DATABASE USER
PG_HOST="myoraculum-postgres" # POSTGRES HOST NAME
CN=$PG_USER
NAMES=$PG_HOST
IP1="66.94.96.81"     # POSTGRES HOST IP
IP2="127.0.0.1"
C="US"
ST="NY"
L="New York"
O="Self signed certificate"
OU="SSC"
DURATION=3650 # 10 years

#
FILENAME="server"

# Your CA details
CA_PEM="root_CA.pem"
CA_KEY="root_CA.key"
#==================================================================

j=0
SAN=""
getaltnames(){
for i in $(echo $NAMES | sed "s/,/ /g")
do
	if [[ ! -z "$i" ]]; then
		j=$((j+1))
		if [ "$j" -gt 1 ]; then
			SAN="${SAN}"$'\n'
		fi
		SAN="${SAN}DNS.${j} = ${i}"
	fi
done <<< "${CN},${SAN}"
}

buildCsrCnf() {
cat << EOF > "${FILENAME}.csr.cnf"
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
[dn]
C=${C}
ST=${ST}
L=${L}
O=${O}
OU=${OU}
CN=${CN}
emailAddress=${EMAIL}
EOF
}

buildExtCnf() {
cat << EOF > "${FILENAME}.v3.ext"
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names
[alt_names]
${SAN}
IP.1=${IP1}
IP.2=${IP2}
EOF
}

# Build TLS Certificate
build() {

  # Put list of sub domains (NAMES) into SAN variable (${SAN})
  getaltnames

  # CSR Configuration
  buildCsrCnf

  # Create v3.ext configuration file
  buildExtCnf

  # Server key
  openssl req -new -sha256 -nodes -out "${SSL_FOLDER}${FILENAME}.csr" -newkey rsa:2048 -keyout "${SSL_FOLDER}${FILENAME}.key" -config <( cat "${SSL_FOLDER}${FILENAME}.csr.cnf" )

  # Server certificate
  openssl x509 -req -in "${SSL_FOLDER}${FILENAME}.csr" -CA "${SSL_FOLDER}${CA_PEM}" -CAkey "${SSL_FOLDER}${CA_KEY}" -CAcreateserial -out "${SSL_FOLDER}${FILENAME}.crt" -days "${DURATION}" -sha256 -extfile "${SSL_FOLDER}${FILENAME}.v3.ext"
}

# Script starts here
build
#!/bin/bash

# Directories
cur=$(pwd)
tmp=$(mktemp -d)
scriptName=$(basename "$0")

# Certificate Variables
OUTPATH="./ssl/"
VERBOSE=0
DURATION=3650 # 10 years
PG_USER="myoraculum-user" # POSTGRES DATABASE USER
EMAIL="myoraculum@gmail.com"

C="US"
ST="NY"
L="New York"
O="Self signed certificate"
OU="SSE"

safeExit() {
  if [ -d "$tmp" ]; then
    if [ $VERBOSE -eq 1 ]; then
      echo "Removing temporary directory '${tmp}'"
    fi
    rm -rf "$tmp"
  fi

  trap - INT TERM EXIT
  exit
}

# Help Screen
help() {
  echo -n "${scriptName} [OPTIONS] --name=mylanCA
Generate a CA using OpenSSL which you can use to make your own self-signed Certs
 Options:
  -n|--name			Name to give your own Certificate Authority
  -h|--help			Display this help and exit
"
}

# Script starts here...
# Process Arguments
while [ "$1" != "" ]; do
  PARAM=$(echo "$1" | awk -F= '{print $1}')
  VALUE=$(echo "$1" | awk -F= '{print $2}')
  case $PARAM in
    -h|--help) help; safeExit ;;
    -n|--name) NAME=$VALUE ;;
    *) echo "ERROR: unknown parameter \"$PARAM\""; help; exit 1 ;;
  esac
  shift
done

# Prompt for variables that were not provided in arguments
checkVariables() {
  # Country
  if [ -z "$NAME" ]; then
    echo -n "Name to give your own Certificate Authority:"
    read -r NAME
  fi
}

# Build TLS Certificate
build() {
  # Sanitise domain name for file name
  FILENAME=${NAME/\*\./}
  # Generate CA key & crt
  openssl genrsa -out "${FILENAME}_CA.key" 2048
  openssl req -x509 -new -nodes -key "${FILENAME}_CA.key" -sha256 -days "${DURATION}" -out "${OUTPATH}${FILENAME}_CA.pem" -subj "/C=$C/ST=$ST/L=$L/O=$O/OU=$OU/CN=$PG_USER/emailAddress=$EMAIL"

}

checkVariables
build
safeExit
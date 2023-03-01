# Instructions: (Working on Windows Chrome, Edge and Android Chorme)
# - Double click "cert.der.crt" to install on Windows under "Autoridades de Certificação Raiz Confiáveis"
# - Send "cert.der.crt" to Android device and install it under Smartphone Config Settings
# - Axios request: use cert.pem in htts.Agent { ca: fs.readFileAsync("cert.pem") }
rm -f key.pem cert.pem cert.der.crt certkey.pem certkey.der.crt
openssl genrsa -out key.pem 4096
openssl req -new -sha256 -key key.pem -out csr.pem -config ssl.conf
openssl x509 -req -days 9999 -in csr.pem -signkey key.pem -out cert.pem -extensions v3_req -extfile ssl.conf
openssl x509 -inform PEM -outform DER -in cert.pem -out cert.der.crt
cat key.pem cert.pem > certkey.pem
openssl x509 -inform PEM -outform DER -in certkey.pem -out certkey.der.crt
rm csr.pem

# Copy certificate file to TRYD-DATA-LOADER
cp ./cert.pem ../../../tryd-data-loader/cert/web/cert.pem

echo "[WEB-CERTIFICATES] Server and Client certificates generated successfuly"
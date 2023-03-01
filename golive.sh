set -e     # Exit immediately if a command exits with a non-zero status
PATH_TO_ENV=./prod.env

if [ -z $1 ]; then
    export APP_VERSION=1.0
else
    export APP_VERSION=$1
fi

if [ -n $2 ]; then
    SERVICE=$2
fi

printf "[MYORACULUM-BOTLOADER] !!! ATTENTION !!!: GOING LIVE \e[5m\e[31mBOT-LOADER\e[0m - Type <BOTLOADER> to continue: "
read CONFIRM
if [ "$CONFIRM" != "BOTLOADER" ]; then
    echo "Script confirmation failed"
    exit 1;
fi

if [ "$SERVICE" = "" ]; then
    # TRYDLOADER - Update SSL certificates
    printf "[MYORACULUM-TRYDLOADER] Update \e[5m\e[31mSSL certificates\e[0m - Type <SSL> to continue: "
    read CONFIRM
    if [ "$CONFIRM" != "SSL" ]; then
        echo "Script confirmation failed"
        exit 0;
    fi

    echo "[MYORACULUM-TRYDLOADER] Updating SSL certificates..."
    HOST="154.12.237.3" 
    HOST_PORT=22

    # Check if certificate files exists
    if ! test -f "./cert/db/root.crt" ; then
        echo "[MYORACULUM-TRYDLOADER] ERROR - Missing certificate file: cert/db/root.crt"
        exit 1
    fi
    if ! test -f "./cert/db/client.key" ; then
        echo "[MYORACULUM-TRYDLOADER] ERROR - Missing certificate file: cert/db/client.key"
        exit 1
    fi
    if ! test -f "./cert/db/client.crt" ; then
        echo "[MYORACULUM-TRYDLOADER] ERROR - Missing certificate file: cert/db/client.crt"
        exit 1
    fi
    if ! test -f "./cert/web/cert.pem" ; then
        echo "[MYORACULUM-TRYDLOADER] ERROR - Missing certificate file: cert/web/cert.pem"
        exit 1
    fi

    VM_TRYDLOADER_HOST_DIR=$(grep VM_TRYDLOADER_HOST_DIR $PATH_TO_ENV | cut -d "=" -f2)
    rsync --update --force --mkpath --relative -e "ssh -p $HOST_PORT" ./cert/db/root.crt ./cert/db/client.key ./cert/db/client.crt ./cert/web/cert.pem ebezerra@$HOST:${VM_TRYDLOADER_HOST_DIR%/}

    echo "[MYORACULUM-TRYDLOADER] SSL certificates updated!"
fi

echo "[MYORACULUM-BOTLOADER] Generating build - App version $APP_VERSION"
yarn build
unset DOCKER_HOST
docker context use prod-vds #production
echo "[MYORACULUM-BOTLOADER] Stopping and removing docker container and image"
docker-compose -f PROD_docker-compose.yml --env-file ./prod.env rm --force --stop $SERVICE
echo "[MYORACULUM-BOTLOADER] Building docker image and starting service"
COMPOSE_DOCKER_CLI_BUILD=0 docker-compose -f PROD_docker-compose.yml --env-file ./prod.env up --build --detach $SERVICE
echo "[MYORACULUM-BOTLOADER] Deleting unused images"
docker image prune --all --force
echo "[MYORACULUM-BOTLOADER] Service deployed successfully - App version: $APP_VERSION - Date:" `date`
unset APP_VERSION SERVICE #DOCKER_HOST
docker context use default
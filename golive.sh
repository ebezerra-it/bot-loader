set -e     # Exit immediately if a command exits with a non-zero status

if [ -z $1 ]; then
    export APP_VERSION=1.0
else
    export APP_VERSION=$1
fi

if [ -n $2 ]; then
    SERVICE=$2
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
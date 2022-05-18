export $(cat .env | grep 'NODE_ENV=')
if [ $NODE_ENV = "PROD" ]
then
    yarn prod:install
    yarn prod:typeorm migration:run
    yarn start $*
else
    yarn dev:install
    yarn dev:typeorm migration:run
    yarn dev $*
fi
export $(cat .env | grep 'NODE_ENV=')
if [ $NODE_ENV = "PROD" ]
then
    yarn prod:typeorm $*
else
    yarn dev:typeorm $*
fi
exit 0
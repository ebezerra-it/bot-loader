docker rm -f $(docker ps -a -q)
docker image rm $(docker image ls -q)
docker volume rm $(docker volume ls -q)

#export DOCKER_HOST=ssh://ebezerra@66.94.96.81
#unset DOCKER_HOST
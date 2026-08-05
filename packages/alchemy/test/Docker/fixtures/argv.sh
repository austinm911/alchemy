#!/bin/sh
# Prints one argument per line so tests can assert on the exact argv a Docker
# command builder produced, without a Docker daemon. Installed through the
# documented `DOCKER_BIN` override.
for arg in "$@"; do
  printf '%s\n' "$arg"
done

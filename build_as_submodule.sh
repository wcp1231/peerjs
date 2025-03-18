#!/bin/bash

set -e

bun run build

rm -rf ../../node_modules/peerjs 

mkdir -p ../../node_modules/peerjs 

cp package.json ../../node_modules/peerjs/
cp -r dist ../../node_modules/peerjs/

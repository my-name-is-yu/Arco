#!/bin/sh
# Local-only runtime for this Mac; the portable manifest points inside its package.
exec "/Users/yuyoshimuta/.nvm/versions/node/v22.16.0/bin/node" "$(dirname "$0")/server.mjs"

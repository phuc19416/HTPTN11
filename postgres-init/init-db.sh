#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE biteswift_user;
    CREATE DATABASE biteswift_order;
    CREATE DATABASE biteswift_delivery;
EOSQL

echo "Multiple databases created successfully!"

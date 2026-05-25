FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY gateway/package.json gateway/package.json
COPY user-service/package.json user-service/package.json
COPY merchant-service/package.json merchant-service/package.json
COPY order-service/package.json order-service/package.json
COPY delivery-service/package.json delivery-service/package.json
COPY notification-service/package.json notification-service/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci

COPY . .

ARG WORKSPACE
ENV WORKSPACE=${WORKSPACE}

RUN npm run build -w ${WORKSPACE}

CMD ["sh", "-c", "npm start -w ${WORKSPACE}"]

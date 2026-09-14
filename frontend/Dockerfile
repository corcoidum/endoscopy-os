# syntax=docker/dockerfile:1.7

FROM node:24.17.0-alpine3.24 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Caddy가 사용할 정적 결과물만 남기는 one-shot artifact image입니다.
FROM alpine:3.24 AS artifact

WORKDIR /dist

COPY --from=build /app/dist/client/ /dist/client/

# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# ВНИМАНИЕ: адрес API вшивается в бандл на этапе СБОРКИ.
# Amvera не отдаёт переменные окружения во время сборки, поэтому на ней
# значение берётся отсюда — впишите свой домен API до первого пуша (SETUP.md).
ARG VITE_API_URL=http://localhost:3001
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

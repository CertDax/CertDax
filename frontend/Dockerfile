FROM node:24-alpine AS build

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit && npm install @rollup/rollup-linux-x64-musl

COPY . .
RUN npm run build

FROM docker.io/library/nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# Imagen del frontend de Glazz.
#
# La app es una SPA estatica: no necesita Node en ejecucion, solo un servidor de
# archivos. Se construye con Node y se sirve con nginx.
#
# La imagen NO lleva credenciales horneadas: se configuran al arrancar el
# contenedor mediante las variables SUPABASE_URL y SUPABASE_ANON_KEY, que
# docker/entrypoint.sh vuelca en config.js. Asi la misma imagen que se prueba en
# local es la que se despliega, sin recompilar por entorno.

# ── Etapa de build ─────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Se copian primero los manifiestos para que la capa de dependencias quede
# cacheada mientras package-lock.json no cambie.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Servido desde el contenedor la app vive en la raiz, no bajo /VidrioSystem/.
ENV VITE_BASE_PATH=/
RUN npm run build

# ── Etapa de ejecucion ─────────────────────────────────────────────────────
FROM nginx:alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /docker-entrypoint.d/40-glazz-config.sh

# La imagen base de nginx ejecuta todo lo que encuentre en /docker-entrypoint.d/
# antes de arrancar el servidor, asi que basta con dejarlo ejecutable.
RUN chmod +x /docker-entrypoint.d/40-glazz-config.sh

EXPOSE 80

#!/bin/sh
# Vuelca la configuracion de ejecucion en config.js antes de arrancar nginx.
#
# La imagen base de nginx ejecuta los scripts de /docker-entrypoint.d/ en orden
# alfabetico durante el arranque, por eso este archivo se llama 40-glazz-config.sh.

set -eu

CONFIG_FILE=/usr/share/nginx/html/config.js

# Fallar temprano y con un mensaje claro: sin estas variables la app arranca pero
# muestra una pantalla en blanco, que es mucho mas dificil de diagnosticar.
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "ERROR: faltan SUPABASE_URL y/o SUPABASE_ANON_KEY en el entorno del contenedor." >&2
  echo "       Defínelas en docker-compose.yml o con 'docker run -e'." >&2
  exit 1
fi

cat > "$CONFIG_FILE" <<EOF
window.__APP_CONFIG__ = {
  SUPABASE_URL: '${SUPABASE_URL}',
  SUPABASE_ANON_KEY: '${SUPABASE_ANON_KEY}',
}
EOF

echo "glazz: config.js generado apuntando a ${SUPABASE_URL}"

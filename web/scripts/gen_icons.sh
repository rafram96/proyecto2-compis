#!/usr/bin/env bash
# Genera los iconos PNG/ICO y la imagen para redes a partir de public/favicon.svg y scripts/brand/og.html.
# Uso (desde web/):  bash scripts/gen_icons.sh      Requiere Google Chrome y ffmpeg.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SVG="$(pwd)/public/favicon.svg"

shot() { # shot <html> <ancho> <alto> <salida>
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$2,$3" --screenshot="$4" "file://$1" >/dev/null 2>&1
}

icon() { # icon <tamaño> <relleno %> <fondo> <salida>: la marca centrada sobre un cuadrado lleno
  cat >"$TMP/i.html" <<EOF
<html><body style="margin:0;width:$1px;height:$1px;background:$3;display:grid;place-items:center">
<img src="file://$SVG" style="width:$2%;height:$2%"></body></html>
EOF
  shot "$TMP/i.html" "$1" "$1" "$4"
}

icon 180 100 "#0077B6" public/apple-touch-icon.png    # iOS recorta las esquinas por su cuenta
icon 192 100 transparent public/icon-192.png
icon 512 100 transparent public/icon-512.png
icon 512 78 "#0077B6" public/icon-maskable-512.png   # zona segura del 80 % para Android
icon 32 100 transparent "$TMP/32.png"
ffmpeg -loglevel error -y -i "$TMP/32.png" public/favicon.ico
shot "$(pwd)/scripts/brand/og.html" 1200 630 public/og.png
ls -la public/*.png public/favicon.ico

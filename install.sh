#!/usr/bin/env bash
set -euo pipefail

uuid='layout-safe-window-anim@local'
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
target="$data_dir/gnome-shell/extensions/$uuid"

mkdir -p "$target"
cp "$project_dir/extension.js" "$target/extension.js"
cp "$project_dir/metadata.json" "$target/metadata.json"

if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions enable "$uuid" || true
fi

echo "已安装到 $target"
echo '如果扩展没有立即生效，请在 X11 下按 Alt+F2，输入 r，回车；Wayland 请注销并重新登录。'

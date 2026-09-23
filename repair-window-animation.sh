#!/usr/bin/env bash
# Re-enable the GNOME 42 window animation fix.
# This is intentionally user-local and does not modify system packages.

set -u

uuid='layout-safe-window-anim@local'
restart_x11=0
if [[ "${1:-}" == '--restart-x11' ]]; then
    restart_x11=1
elif [[ -n "${1:-}" ]]; then
    echo '用法：repair-window-animation.sh [--restart-x11]'
    exit 2
fi

if ! command -v gnome-extensions >/dev/null 2>&1; then
    echo '找不到 gnome-extensions。'
    exit 1
fi

if ! gnome-extensions info "$uuid" >/dev/null 2>&1; then
    echo "未找到扩展 $uuid。"
    exit 1
fi

gnome-extensions disable "$uuid" >/dev/null 2>&1 || true
gnome-extensions enable "$uuid" >/dev/null 2>&1 || {
    echo "无法启用扩展 $uuid。"
    exit 1
}

if [[ "$restart_x11" == 0 ]]; then
    echo '窗口动画修复扩展已重新加载。'
    exit 0
fi

if [[ "${XDG_SESSION_TYPE:-}" != 'x11' ]]; then
    echo '扩展已重新加载。当前不是 X11，不能单独重启 GNOME Shell。'
    echo '如果仍有问题，请注销并重新登录后再测试。'
    exit 0
fi

old_pid=$(systemctl --user show org.gnome.Shell@x11.service \
    -p MainPID --value 2>/dev/null || true)
if [[ ! "$old_pid" =~ ^[1-9][0-9]*$ ]]; then
    echo '没有找到 GNOME Shell 的 X11 服务进程；扩展已启用。'
    exit 0
fi

kill -TERM "$old_pid" 2>/dev/null || {
    echo '无法请求 GNOME Shell 重启；扩展已重新加载。'
    exit 1
}

for _ in $(seq 1 30); do
    new_pid=$(systemctl --user show org.gnome.Shell@x11.service \
        -p MainPID --value 2>/dev/null || true)
    if [[ "$new_pid" =~ ^[1-9][0-9]*$ ]] && [[ "$new_pid" != "$old_pid" ]]; then
        echo "窗口动画修复已重新加载（GNOME Shell PID $new_pid）。"
        exit 0
    fi
    sleep 1
done

echo '扩展已重新加载，但 GNOME Shell 没有在预期时间内重启。'
exit 1

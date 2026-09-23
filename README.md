# GNOME Shell 42 Layout Safe Window Animation

这是一个针对 GNOME Shell 42 的用户级扩展，用来修复 X11 (wayland说不定也可以，没有试过)下窗口最小化和还原时偶发的错误位置闪现：窗口从任务栏恢复时，可能先在左上角出现一个缩小副本，然后跳回正确位置。

## 修复了什么

GNOME 42 的原生窗口动画在同一个 `actor.ease()` 中同时动画布局位置 `x/y` 和绘制缩放 `scale`。`x/y` 会触发布局 allocation，`scale` 属于绘制变换。Mutter 偶尔会先提交最终窗口位置，而缩放仍停留在任务栏图标大小，于是产生一帧“最终位置 + 图标大小”的错误画面。

这个扩展只改变移动的实现方式：

- 保留 GNOME 原来的 400ms 时长、动画曲线和缩放效果；
- 最小化时保持布局位置稳定，用 `translation_x/y` 移向任务栏图标；
- 还原时先固定布局到最终窗口位置，用反向平移保持画面在图标处，再让平移归零；
- 清理旧的 `x/y` 和平移 transition，避免被打断的旧动画覆盖新状态。

因此它不需要关闭桌面动画，也不需要关闭 Dash to Panel 的窗口预览。

## 兼容范围

- Ubuntu 22.04 / GNOME Shell 42.x；
- 主要针对 X11；
- 只处理普通窗口、对话框的最小化和还原动画；
- GNOME Shell 的 WindowManager 属于私有 JavaScript API，升级到 GNOME 43 或更高版本后需要重新验证。

## 安装

```bash
git clone git@github.com:wenziji-hub/gnome-shell-layout-safe-window-anim.git
cd gnome-shell-layout-safe-window-anim
./install.sh
```

X11 下修改扩展代码后，可以使用 Alt+F2，输入 `r`，回车，重新加载 GNOME Shell。Wayland 下不要强制杀 Shell；需要重新加载代码时注销并重新登录。

## 问题再次出现时

先重新加载扩展：

```bash
./repair-window-animation.sh
```

如果当前是 X11，仍然出现异常，再执行：

```bash
./repair-window-animation.sh --restart-x11
```

查看扩展状态和错误：

```bash
gnome-extensions list --enabled | grep layout-safe-window-anim
gdbus call --session --dest org.gnome.Shell.Extensions \
  --object-path /org/gnome/Shell/Extensions \
  --method org.gnome.Shell.Extensions.GetExtensionErrors \
  'layout-safe-window-anim@local'
```

## 回滚

恢复 GNOME 原生动画：

```bash
gnome-extensions disable layout-safe-window-anim@local
```

删除扩展目录前应先禁用它：

```bash
rm -r ~/.local/share/gnome-shell/extensions/layout-safe-window-anim@local
```

## 如何确认根因

诊断时应比较同一帧的窗口固定位置、allocation、缩放、平移和 `get_transformed_position()`。故障样本会出现这些状态不一致，而四条 transition 的进度仍然一致。这说明问题是布局提交和绘制变换的帧级时序竞争，不是 Dash to Panel 缩略图，也不是缩放曲线不同步。

## 注意事项

- 这是针对 GNOME 42 内部 API 的运行时补丁，不是对 Mutter 系统文件的修改；
- 不要在 Wayland 会话中执行 `--restart-x11`；
- 如果 GNOME 升级后扩展报错，应先禁用扩展并重新检查对应版本的 `windowManager.js`；
- 扩展只解决这类窗口动画时序问题，不能作为其他桌面问题的通用修复器。

## License

MIT License。见 [LICENSE](LICENSE)。

// Layout Safe Window Animation — GNOME Shell 42
//
// 修的是 GNOME 42.9 自己的一个时序 bug：WindowManager._minimizeWindow() /
// _unminimizeWindow() 在同一次 actor.ease() 里同时改 x/y（布局属性，要走一次
// allocation）和 scale（绘制变换）。Mutter 42 可能比变换晚一帧才提交 allocation，
// 于是还原时会闪出一帧「最终位置 + 图标大小」的小窗口（残影）。
//
// 做法：接管这两个动画。GNOME 自己连在 global.window_manager 'minimize' /
// 'unminimize' 上的 handler 被屏蔽，换成这里的实现。时长、曲线、缩放与 GNOME
// 原版一致，只把移动从布局 x/y 改成绘制 translation（和 scale 同属绘制变换，同一帧
// 生效），动画期间布局位置不动。收尾仍交给 Main.wm 的 _minimizing/_unminimizing
// 集合和 *Done() 函数，所以 kill-window-effects 等其它代码路径照常工作。
//
// 另外修了 GNOME 原版的两处小毛病：
//   · 还原动画还没放完就被最小化时，原版的旧回调会 remove_all_transitions()，
//     把新开始的最小化动画一起杀掉（窗口直接消失、没有动画）。这里给每个窗口的
//     动画编号，过期回调只补记账、不动画面。
//   · 找不到显示器时原版调用 _minimizeWindowDone() 不带参数，窗口会卡在
//     「最小化中」。这里正常收尾。
//
// 只针对 GNOME 42：升级 GNOME 后要重新核对 windowManager.js。

const { Clutter, GObject, Meta } = imports.gi;
const Main = imports.ui.main;
const WindowManager = imports.ui.windowManager;

// 最小化结束时，在 GNOME 原有缩放（缩到任务栏图标大小）的基础上再乘的系数：越小收得越紧
const MINIMIZE_END_SCALE = 0.6;
// 最小化落点的横向修正（像素）：GNOME 给的落点偏图标左侧，正值往右挪
const MINIMIZE_END_OFFSET_X = 16;

const ANIMATED_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.DIALOG,
];

// 每个窗口 actor 当前这次动画的编号；回调里编号对不上就是过期回调
const generations = new WeakMap();

function nextGeneration(actor) {
    const generation = (generations.get(actor) || 0) + 1;
    generations.set(actor, generation);
    return generation;
}

function isCurrent(actor, generation) {
    return generations.get(actor) === generation;
}

function rtl() {
    return Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
}

function minimize(wm, shellwm, actor) {
    const generation = nextGeneration(actor);

    // 还原动画还没放完就被最小化：先替它结账（不碰 transition，下面的动画会接管画面）
    if (wm._unminimizing.delete(actor))
        shellwm.completed_unminimize(actor);

    if (!wm._shouldAnimateActor(actor, ANIMATED_TYPES)) {
        shellwm.completed_minimize(actor);
        return;
    }

    actor.set_scale(1.0, 1.0);
    wm._minimizing.add(actor);

    const done = () => {
        if (!isCurrent(actor, generation)) {
            if (wm._minimizing.delete(actor))
                shellwm.completed_minimize(actor);
            return;
        }
        wm._minimizeWindowDone(shellwm, actor);
    };

    if (actor.meta_window.is_monitor_sized()) {
        actor.ease({
            opacity: 0,
            duration: WindowManager.MINIMIZE_WINDOW_ANIMATION_TIME,
            mode: WindowManager.MINIMIZE_WINDOW_ANIMATION_MODE,
            onStopped: done,
        });
        return;
    }

    let xDest, yDest, xScale, yScale;
    const [success, geom] = actor.meta_window.get_icon_geometry();
    if (success) {
        xDest = geom.x;
        yDest = geom.y;
        xScale = geom.width / actor.width * MINIMIZE_END_SCALE;
        yScale = geom.height / actor.height * MINIMIZE_END_SCALE;
    } else {
        const monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
        if (!monitor) {
            wm._minimizeWindowDone(shellwm, actor);
            return;
        }
        xDest = monitor.x + (rtl() ? monitor.width : 0);
        yDest = monitor.y;
        xScale = 0;
        yScale = 0;
    }

    // 清掉被打断的旧动画残留的过渡，免得它们在缩放期间提交过期的位置
    for (const property of ['x', 'y', 'translation-x', 'translation-y'])
        actor.remove_transition(property);

    const offsetX = success ? MINIMIZE_END_OFFSET_X : 0;
    actor.ease({
        scale_x: xScale,
        scale_y: yScale,
        translation_x: xDest + offsetX - actor.x,
        translation_y: yDest - actor.y,
        duration: WindowManager.MINIMIZE_WINDOW_ANIMATION_TIME,
        mode: WindowManager.MINIMIZE_WINDOW_ANIMATION_MODE,
        onStopped: () => {
            if (isCurrent(actor, generation)) {
                // 和 GNOME 原版的终态一致：布局位置落在图标处、没有平移
                actor.set_translation(0, 0, 0);
                actor.set_position(xDest, yDest);
            }
            done();
        },
    });
}

function unminimize(wm, shellwm, actor) {
    const generation = nextGeneration(actor);

    if (!wm._shouldAnimateActor(actor, ANIMATED_TYPES)) {
        shellwm.completed_unminimize(actor);
        return;
    }

    wm._unminimizing.add(actor);

    const done = () => {
        if (!isCurrent(actor, generation)) {
            if (wm._unminimizing.delete(actor))
                shellwm.completed_unminimize(actor);
            return;
        }
        actor.set_translation(0, 0, 0);
        wm._unminimizeWindowDone(shellwm, actor);
    };

    if (actor.meta_window.is_monitor_sized()) {
        actor.opacity = 0;
        actor.set_scale(1.0, 1.0);
        actor.ease({
            opacity: 255,
            duration: WindowManager.MINIMIZE_WINDOW_ANIMATION_TIME,
            mode: WindowManager.MINIMIZE_WINDOW_ANIMATION_MODE,
            onStopped: done,
        });
        return;
    }

    let xStart, yStart;
    const [success, geom] = actor.meta_window.get_icon_geometry();
    if (success) {
        xStart = geom.x;
        yStart = geom.y;
        actor.set_scale(geom.width / actor.width, geom.height / actor.height);
    } else {
        const monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
        if (!monitor) {
            actor.show();
            wm._unminimizeWindowDone(shellwm, actor);
            return;
        }
        xStart = monitor.x + (rtl() ? monitor.width : 0);
        yStart = monitor.y;
        actor.set_scale(0, 0);
    }

    // 布局位置一开始就放在窗口的最终位置，起点用反向平移表示，再让平移归零
    const rect = actor.meta_window.get_buffer_rect();
    for (const property of ['x', 'y', 'translation-x', 'translation-y'])
        actor.remove_transition(property);
    actor.set_position(rect.x, rect.y);
    actor.set_translation(xStart - rect.x, yStart - rect.y, 0);
    actor.show();
    actor.ease({
        scale_x: 1,
        scale_y: 1,
        translation_x: 0,
        translation_y: 0,
        duration: WindowManager.MINIMIZE_WINDOW_ANIMATION_TIME,
        mode: WindowManager.MINIMIZE_WINDOW_ANIMATION_MODE,
        onStopped: done,
    });
}

class Extension {
    enable() {
        const shellwm = global.window_manager;
        // GNOME 自己的 handler 是 WindowManager 构造时最早连上的那个
        const minimizeId = GObject.signal_handler_find(shellwm, { signalId: 'minimize' });
        const unminimizeId = GObject.signal_handler_find(shellwm, { signalId: 'unminimize' });
        if (!minimizeId || !unminimizeId) {
            log('[layout-safe-window-anim] GNOME 的最小化 handler 没找到，扩展不生效');
            return;
        }
        GObject.signal_handler_block(shellwm, minimizeId);
        GObject.signal_handler_block(shellwm, unminimizeId);
        this._blocked = [minimizeId, unminimizeId];
        this._connected = [
            shellwm.connect('minimize', (wm, actor) => minimize(Main.wm, wm, actor)),
            shellwm.connect('unminimize', (wm, actor) => unminimize(Main.wm, wm, actor)),
        ];
    }

    disable() {
        const shellwm = global.window_manager;
        for (const id of this._connected || [])
            shellwm.disconnect(id);
        for (const id of this._blocked || [])
            GObject.signal_handler_unblock(shellwm, id);
        this._connected = null;
        this._blocked = null;
    }
}

function init() {
    return new Extension();
}

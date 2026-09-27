// GNOME 42 layout-safe window movement
//
// WindowManager.ease() animates x/y (layout properties) and scale (paint
// transform) together.  In Mutter 42 the x/y allocation can commit one frame
// after the transform, so a window can briefly be painted from the old
// allocation.  For minimize/restore movement, animate translation instead.

const Main = imports.ui.main;

// 最小化动画"结束时"窗口的缩放系数：越小，窗口在消失前收得越紧。
// 原始结束缩放由 Shell 决定（本机实测约 0.137 x 0.065），乘上这个系数即可再缩小。
// 只作用于 minimize 方向（还原动画不受影响，否则窗口会以很小的尺寸恢复、然后跳回原样）。
const MINIMIZE_END_SCALE = 0.6;

// 最小化落点的横向修正：Shell 给的落点偏图标左侧一点，正值把它往右挪。
const MINIMIZE_END_OFFSET_X = 16;

let originalShouldAnimateActor = null;

function pathName() {
    const stack = new Error().stack || '';
    if (stack.indexOf('_minimizeWindow') !== -1 &&
        stack.indexOf('_unminimizeWindow') === -1)
        return 'minimize';
    if (stack.indexOf('_unminimizeWindow') !== -1)
        return 'unminimize';
    return null;
}

function install(actor, path) {
    if (!actor || actor.__layoutSafeEase)
        return;

    const originalEase = actor.ease;
    const state = {generation: 0};
    actor.__layoutSafeEase = state;

    actor.ease = function (params) {
        const movable = path === 'minimize' || path === 'unminimize';
        const hasPositionAndScale = params &&
            params.x !== undefined && params.y !== undefined &&
            params.scale_x !== undefined && params.scale_y !== undefined;

        if (!movable || !hasPositionAndScale) {
            const result = originalEase.call(this, params);
            this.ease = originalEase;
            delete this.__layoutSafeEase;
            return result;
        }

        const targetX = params.x;
        const targetY = params.y;
        const baseX = this.x;
        const baseY = this.y;
        const generation = ++state.generation;

        // Do not leave a previous translation transition attached to this
        // actor.  The next animation owns the transform from this point.
        try {
            // The stock effect uses these layout properties.  If an older
            // effect was interrupted, their transitions can still commit a
            // stale allocation while the new scale animation is running.
            this.remove_transition('x');
            this.remove_transition('y');
            this.remove_transition('translation-x');
            this.remove_transition('translation-y');
        } catch (e) {}
        // During restore Mutter synchronizes the actor's layout position
        // back to the window geometry.  Keep that layout position at the
        // final location and represent the icon location with a paint
        // translation.  This prevents final allocation from being paired
        // with the icon-sized scale for one frame.
        let initialTranslationX = 0;
        let initialTranslationY = 0;
        let destinationTranslationX = targetX - baseX;
        if (path === 'minimize')
            destinationTranslationX += MINIMIZE_END_OFFSET_X;   // 落点右移，对准图标
        let destinationTranslationY = targetY - baseY;
        if (path === 'unminimize') {
            initialTranslationX = baseX - targetX;
            initialTranslationY = baseY - targetY;
            destinationTranslationX = 0;
            destinationTranslationY = 0;
            this.set_position(targetX, targetY);
        }
        this.translation_x = initialTranslationX;
        this.translation_y = initialTranslationY;

        const translated = Object.assign({}, params);
        delete translated.x;
        delete translated.y;
        translated.translation_x = destinationTranslationX;
        translated.translation_y = destinationTranslationY;

        if (path === 'minimize') {
            if (translated.scale_x !== undefined)
                translated.scale_x *= MINIMIZE_END_SCALE;
            if (translated.scale_y !== undefined)
                translated.scale_y *= MINIMIZE_END_SCALE;
        }

        const stopped = params.onStopped;
        translated.onStopped = () => {
            // A stale callback must not complete a newer minimize/restore
            // operation or put the actor at the older destination.
            if (state.generation !== generation)
                return;

            try {
                this.remove_transition('translation-x');
                this.remove_transition('translation-y');
            } catch (e) {}
            this.translation_x = 0;
            this.translation_y = 0;
            this.set_position(targetX, targetY);
            if (stopped)
                stopped();
        };

        log('[layout-safe-window-anim] ' + path +
            ' scale=' + params.scale_x + 'x' + params.scale_y +
            ' -> ' + translated.scale_x + 'x' + translated.scale_y + ' target=' +
            targetX + ',' + targetY + ' base=' + baseX + ',' + baseY +
            ' initial=' + initialTranslationX + ',' + initialTranslationY +
            ' destination=' + translated.translation_x + ',' +
            translated.translation_y);
        const result = originalEase.call(this, translated);
        this.ease = originalEase;
        delete this.__layoutSafeEase;
        return result;
    };
}

function init() {
    return {
        enable() {
            const wm = Main.wm;
            originalShouldAnimateActor = wm._shouldAnimateActor;
            const original = originalShouldAnimateActor;
            wm._shouldAnimateActor = function (actor, types) {
                const path = pathName();
                const result = original.call(this, actor, types);
                if (result && path && actor)
                    install(actor, path);
                return result;
            };
            log('[layout-safe-window-anim] enabled');
        },

        disable() {
            if (originalShouldAnimateActor && Main.wm)
                Main.wm._shouldAnimateActor = originalShouldAnimateActor;
            originalShouldAnimateActor = null;
            log('[layout-safe-window-anim] disabled');
        },
    };
}

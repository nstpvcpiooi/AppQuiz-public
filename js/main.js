import { Router } from './router.js';
import { initApp } from './student/index.js';
import { initAdmin } from './admin/index.js';
import { initAdminAuth } from './admin-auth.js';

/** Race initAdminAuth against a timeout so the app never hangs. */
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => {
            console.warn(`initAdminAuth did not resolve within ${ms}ms — continuing without admin state.`);
            resolve(false);
        }, ms))
    ]);
}

document.addEventListener('DOMContentLoaded', async () => {
    const appHandlers = initApp();
    const adminHandlers = initAdmin();

    const handleNavigation = (screen, params) => {
        try {
            appHandlers.onNavigate(screen, params);
            adminHandlers.onNavigate(screen, params);
        } catch (err) {
            console.error("Navigation error:", err);
        }
    };

    let router = null;
    await withTimeout(initAdminAuth(() => router?.handleRoute()), 5000);

    router = new Router(handleNavigation);

    appHandlers.setRouter(router);
    adminHandlers.setRouter(router);
});

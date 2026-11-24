/**
 * Proxy / Profile Concurrency Coordinator (Layer 2 Application Service).
 *
 * Keeps proxy mutations serialized so a listener cannot be removed or edited while
 * a profile is starting or being assigned to it, while allowing multiple profile
 * launches to proceed concurrently. Zero `ipcMain` coupling.
 */
export class ProxyCoordinator {
    constructor({ proxyManager, chromeManager }) {
        this.proxyManager = proxyManager;
        this.chromeManager = chromeManager;
        this.pending = Promise.resolve();
        this.activeLaunches = new Set();
        this.closing = false;
        this.shutdownPromise = null;
    }

    run(operation) {
        if (this.closing) return Promise.reject(new Error('程序正在退出'));
        const result = this.pending.then(async () => {
            if (this.activeLaunches.size > 0) {
                await Promise.allSettled([...this.activeLaunches]);
            }
            return operation();
        });
        this.pending = result.catch(() => {});
        return result;
    }

    runLaunch(operation) {
        if (this.closing) return Promise.reject(new Error('程序正在退出'));
        const gate = this.pending;
        const launchPromise = gate.then(() => {
            if (this.closing) throw new Error('程序正在退出');
            return operation();
        });
        const tracked = launchPromise.catch(() => {});
        this.activeLaunches.add(tracked);
        tracked.finally(() => {
            this.activeLaunches.delete(tracked);
        });
        return launchPromise;
    }

    async assertProxyUnused(id, removing = false) {
        const bindings = await this.chromeManager.getProxyBindings();
        if (
            bindings.some(
                (item) => item.proxyId === id && (removing || item.isRunning),
            )
        ) {
            throw new Error(
                removing
                    ? '请先解除所有环境与此代理的绑定（包括回收站中的环境）'
                    : '仍有环境正在使用此代理，请先关闭对应浏览器',
            );
        }
    }

    async validateBinding(id, data) {
        if (!('proxyId' in data) && !('proxy' in data)) return;
        const bindings = await this.chromeManager.getProxyBindings();
        if (bindings.some((item) => item.id === id && item.isRunning)) {
            throw new Error('请先关闭环境，再修改代理配置');
        }
        if (
            data.proxyId &&
            !this.proxyManager.list().some((proxy) => proxy.id === data.proxyId)
        ) {
            throw new Error('所选代理不存在，请刷新后重试');
        }
    }

    async hasRunningProfiles() {
        const bindings = await this.chromeManager.getProxyBindings();
        return bindings.some((item) => item.proxyId && item.isRunning);
    }

    shutdown() {
        if (this.shutdownPromise) return this.shutdownPromise;
        this.closing = true;
        this.shutdownPromise = this.pending
            .then(() => Promise.allSettled([...this.activeLaunches]))
            .then(() => this.proxyManager.closeAll())
            .catch((error) => {
                this.shutdownPromise = null;
                throw error;
            });
        return this.shutdownPromise;
    }
}

export { ProxyCoordinator as ProxyIntegration };

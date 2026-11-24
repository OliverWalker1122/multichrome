import net from 'node:net';
import {
    DEFAULT_AUTOMATION_PORT,
    MAX_AUTOMATION_PORT,
    MIN_AUTOMATION_PORT,
} from '../domain/automationPolicy.js';

const AUTOMATION_PORT_SCAN_COUNT = 80;

/**
 * Probe whether a loopback (127.0.0.1) TCP port is free to bind.
 * Pass `port = 0` to probe an OS-assigned ephemeral port.
 */
export function probeLoopbackPort(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        let settled = false;
        const finish = (available, boundPort = 0) => {
            if (settled) return;
            settled = true;
            resolve({ available, port: boundPort });
        };
        server.unref?.();
        server.once('error', () => {
            try {
                server.close();
            } catch {
                // ignore
            }
            finish(false, 0);
        });
        server.once('listening', () => {
            const addr = server.address();
            const actualPort =
                addr && typeof addr === 'object' ? addr.port : port;
            server.close(() => finish(true, actualPort));
        });
        try {
            server.listen({ host: '127.0.0.1', port, exclusive: true });
        } catch {
            finish(false, 0);
        }
    });
}

/**
 * Allocate an ephemeral local 127.0.0.1 port for managed sing-box listeners.
 */
export async function reserveEphemeralLoopbackPort() {
    const server = net.createServer();
    return new Promise((resolve, reject) => {
        server.once('error', () => reject(new Error('无法分配本地代理端口')));
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            const port = addr && typeof addr === 'object' ? addr.port : 0;
            server.close((error) =>
                error || !port
                    ? reject(new Error('无法分配本地代理端口'))
                    : resolve(port),
            );
        });
    });
}

/**
 * Find an available port for the local automation control plane.
 */
export async function findAvailableAutomationPort({
    preferredPort = DEFAULT_AUTOMATION_PORT,
    excludePorts = [],
    scanStart = DEFAULT_AUTOMATION_PORT,
    scanCount = AUTOMATION_PORT_SCAN_COUNT,
    probe = probeLoopbackPort,
    locale = 'zh-CN',
} = {}) {
    const excluded = new Set(
        (Array.isArray(excludePorts) ? excludePorts : []).filter(
            (p) =>
                Number.isInteger(p) &&
                p >= MIN_AUTOMATION_PORT &&
                p <= MAX_AUTOMATION_PORT,
        ),
    );

    const candidates = [];
    const seen = new Set();
    const pushCandidate = (candidate) => {
        if (
            !Number.isInteger(candidate) ||
            candidate < MIN_AUTOMATION_PORT ||
            candidate > MAX_AUTOMATION_PORT ||
            excluded.has(candidate) ||
            seen.has(candidate)
        ) {
            return;
        }
        seen.add(candidate);
        candidates.push(candidate);
    };

    pushCandidate(preferredPort);
    for (let offset = 0; offset < scanCount; offset += 1) {
        pushCandidate(scanStart + offset);
    }

    for (const candidate of candidates) {
        const result = await probe(candidate);
        if (
            result &&
            result.available &&
            Number.isInteger(result.port) &&
            result.port >= MIN_AUTOMATION_PORT &&
            result.port <= MAX_AUTOMATION_PORT &&
            !excluded.has(result.port)
        ) {
            return result.port;
        }
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
        const result = await probe(0);
        if (
            result &&
            result.available &&
            Number.isInteger(result.port) &&
            result.port >= MIN_AUTOMATION_PORT &&
            result.port <= MAX_AUTOMATION_PORT &&
            !excluded.has(result.port)
        ) {
            return result.port;
        }
    }

    throw new Error(
        locale === 'en-US'
            ? 'Unable to find an available local loopback port (127.0.0.1)'
            : '无法找到可用的本地回环端口（127.0.0.1）',
    );
}

/**
 * Private randomized debug port reservation pool for isolated browser profiles.
 * Avoids 9222, 18922, and Windows 49152+ Hyper-V excluded port ranges, with OS fallback.
 */
export class DebugPortReservationPool {
    constructor() {
        this.reservedPorts = new Set();
    }

    async isPortAvailable(port) {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once('error', () => {
                resolve(false);
            });
            server.once('listening', () => {
                server.close();
                resolve(true);
            });
            server.listen(port, '127.0.0.1');
        });
    }

    async acquire(minPort = 20000, maxPort = 39999, maxAttempts = 60) {
        const span = Math.max(1, maxPort - minPort + 1);
        const startOffset = Math.floor(Math.random() * span);

        for (let i = 0; i < maxAttempts; i += 1) {
            const port = minPort + ((startOffset + i * 97) % span);
            if (port === 9222 || port === 18922 || this.reservedPorts.has(port)) {
                continue;
            }
            if (await this.isPortAvailable(port)) {
                this.reservedPorts.add(port);
                return port;
            }
        }

        for (let fallback = 0; fallback < 10; fallback += 1) {
            const osPort = await new Promise((resolve) => {
                const srv = net.createServer();
                srv.once('error', () => resolve(0));
                srv.listen(0, '127.0.0.1', () => {
                    const addr = srv.address();
                    const p = addr && typeof addr === 'object' ? addr.port : 0;
                    srv.close(() => resolve(p));
                });
            });
            if (
                osPort > 1024 &&
                osPort !== 9222 &&
                osPort !== 18922 &&
                !this.reservedPorts.has(osPort)
            ) {
                this.reservedPorts.add(osPort);
                return osPort;
            }
        }

        throw new Error(`无法找到可用的调试端口 (尝试范围: ${minPort}-${maxPort})`);
    }

    release(port) {
        if (typeof port === 'number') {
            this.reservedPorts.delete(port);
        }
    }
}

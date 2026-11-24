import path from 'path';
import { app, Menu, nativeImage, Tray } from 'electron';

export interface TrayManagerOptions {
    isEnglishLocale: () => boolean;
    onShowWindow: () => void;
    onCloseAllAndQuit: () => void;
}

export class TrayManager {
    private tray: Tray | null = null;
    private readonly isEnglishLocale: () => boolean;
    private readonly onShowWindow: () => void;
    private readonly onCloseAllAndQuit: () => void;

    constructor(options: TrayManagerOptions) {
        this.isEnglishLocale = options.isEnglishLocale;
        this.onShowWindow = options.onShowWindow;
        this.onCloseAllAndQuit = options.onCloseAllAndQuit;
    }

    private getTrayIconPath(): string {
        return path.join(
            app.getAppPath(),
            'assets',
            process.platform === 'win32' ? 'icon.ico' : 'icon.png',
        );
    }

    public updateMenu(): void {
        if (!this.tray || this.tray.isDestroyed()) return;
        const isEn = this.isEnglishLocale();
        this.tray.setToolTip(
            isEn
                ? 'MultiChrome (Running in background)'
                : 'MultiChrome（后台运行中）',
        );
        const contextMenu = Menu.buildFromTemplate([
            {
                label: isEn ? 'Show MultiChrome' : '显示 MultiChrome',
                click: () => this.onShowWindow(),
            },
            { type: 'separator' },
            {
                label: isEn
                    ? 'Close All Environments & Quit'
                    : '关闭全部环境并退出',
                click: () => this.onCloseAllAndQuit(),
            },
        ]);
        this.tray.setContextMenu(contextMenu);
    }

    public ensure(): Tray {
        if (this.tray && !this.tray.isDestroyed()) {
            this.updateMenu();
            return this.tray;
        }
        const icon = nativeImage.createFromPath(this.getTrayIconPath());
        this.tray = new Tray(icon);
        this.updateMenu();
        this.tray.on('click', () => this.onShowWindow());
        this.tray.on('double-click', () => this.onShowWindow());
        return this.tray;
    }

    public destroy(): void {
        if (this.tray && !this.tray.isDestroyed()) {
            this.tray.destroy();
        }
        this.tray = null;
    }
}

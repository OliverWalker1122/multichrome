/* eslint-disable @typescript-eslint/no-var-requires -- Electron 28 CLI helpers use CommonJS. */
// Lossless icon converter supporting both .svg (rendered via Skia RGBA canvas at
// 1024x1024) and square .png inputs. Generates icon.png (512), icon.ico (16-256),
// and macOS-inset icon.icns (128-1024).
// Usage: node scripts/prepare-app-icon.cjs --input assets/icon.svg --output assets
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseArgs } = require('node:util');

if (!process.versions.electron) {
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(
        require('electron'),
        [__filename, ...process.argv.slice(2)],
        {
            stdio: 'inherit',
            windowsHide: true,
        },
    );
    if (result.error) {
        console.error('Unable to start the isolated icon converter');
    }
    process.exitCode = result.status ?? 1;
} else {
    const { app, BrowserWindow, nativeImage } = require('electron');
    const { values } = parseArgs({
        options: {
            input: { type: 'string', default: 'assets/icon.svg' },
            output: { type: 'string', default: 'assets' },
            preview: { type: 'string' },
            social: { type: 'string' },
        },
    });
    const inputPath = path.resolve(values.input || 'assets/icon.svg');
    const ext = path.extname(inputPath).toLowerCase();
    if (ext !== '.png' && ext !== '.svg') {
        throw new Error('Provide an .svg or .png file with --input');
    }

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'multichrome-icon-'));
    app.setPath('userData', scratch);
    app.disableHardwareAcceleration();

    const renderViaCanvas = async (svgSource) => {
        const win = new BrowserWindow({
            width: 128,
            height: 128,
            show: false,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
        try {
            const svgB64 = Buffer.from(svgSource, 'utf8').toString('base64');
            await win.loadURL('data:text/html;charset=utf-8,<!doctype html><html><body></body></html>');
            const result = await win.webContents.executeJavaScript(`
                (async () => {
                    const img = new Image();
                    img.decoding = 'sync';
                    await new Promise((resolve, reject) => {
                        img.onload = resolve;
                        img.onerror = () => reject(new Error('Failed to decode SVG'));
                        img.src = 'data:image/svg+xml;base64,${svgB64}';
                    });

                    // 1) Master 1024x1024 RGBA (Windows / Linux / Web / Titlebar)
                    const master = document.createElement('canvas');
                    master.width = 1024;
                    master.height = 1024;
                    const mctx = master.getContext('2d');
                    mctx.clearRect(0, 0, 1024, 1024);
                    mctx.drawImage(img, 0, 0, 1024, 1024);

                    // 2) macOS Big Sur+ Dock-grid inset 1024x1024 RGBA (~85% optical pad, pure flat)
                    const mac = document.createElement('canvas');
                    mac.width = 1024;
                    mac.height = 1024;
                    const cctx = mac.getContext('2d');
                    cctx.clearRect(0, 0, 1024, 1024);
                    cctx.drawImage(img, 76, 76, 872, 872);

                    // 3) Optional multi-size dark/light taskbar & hero contact sheet
                    const sheet = document.createElement('canvas');
                    sheet.width = 920;
                    sheet.height = 420;
                    const sctx = sheet.getContext('2d');
                    sctx.fillStyle = '#0f172a';
                    sctx.fillRect(0, 0, 460, 420);
                    sctx.fillStyle = '#f1f5f9';
                    sctx.fillRect(460, 0, 460, 420);

                    // Large hero previews
                    sctx.drawImage(master, 56, 44, 240, 240);
                    sctx.drawImage(master, 516, 44, 240, 240);

                    // Simulated taskbar strips (64, 48, 32, 24, 16)
                    const demoSizes = [64, 48, 32, 24, 16];
                    for (const [panelOffset, barBg, labelColor] of [
                        [0, '#1c212b', '#94a3b8'],
                        [460, '#e2e8f0', '#475569'],
                    ]) {
                        sctx.fillStyle = barBg;
                        sctx.beginPath();
                        sctx.roundRect(panelOffset + 36, 312, 388, 76, 14);
                        sctx.fill();
                        let x = panelOffset + 60;
                        for (const sz of demoSizes) {
                            const y = 312 + Math.round((76 - sz) / 2) - 6;
                            sctx.drawImage(master, x, y, sz, sz);
                            sctx.fillStyle = labelColor;
                            sctx.font = '600 11px Segoe UI, sans-serif';
                            sctx.textAlign = 'center';
                            sctx.fillText(sz + 'px', x + sz / 2, 381);
                            x += sz + 34;
                        }
                    }

                    // 4) Optional 1280x640 GitHub Social Preview banner (pure flat solid palette)
                    const social = document.createElement('canvas');
                    social.width = 1280;
                    social.height = 640;
                    const gctx = social.getContext('2d');
                    gctx.fillStyle = '#0F172A';
                    gctx.fillRect(0, 0, 1280, 640);

                    gctx.fillStyle = '#162033';
                    gctx.strokeStyle = '#283652';
                    gctx.lineWidth = 2;
                    gctx.beginPath();
                    gctx.roundRect(76, 88, 1128, 464, 32);
                    gctx.fill();
                    gctx.stroke();

                    // App icon on left
                    gctx.drawImage(master, 136, 184, 272, 272);

                    // Typography on right
                    gctx.fillStyle = '#F8FAFC';
                    gctx.font = '700 70px "Segoe UI", -apple-system, sans-serif';
                    gctx.textAlign = 'left';
                    gctx.fillText('MultiChrome', 456, 268);

                    gctx.fillStyle = '#94A3B8';
                    gctx.font = '400 26px "Segoe UI", -apple-system, sans-serif';
                    gctx.fillText('Local-First Isolated Browser Profile Manager', 458, 322);

                    // Feature chips (solid flat fills)
                    const chips = [
                        'C++ Privacy Kernel',
                        'Fail-Closed Proxy',
                        'Guarded CDP & MCP',
                        'Win · macOS · Linux',
                    ];
                    let chipX = 458;
                    gctx.font = '600 16px "Segoe UI", -apple-system, sans-serif';
                    for (const label of chips) {
                        const w = Math.ceil(gctx.measureText(label).width) + 26;
                        gctx.fillStyle = '#1E293B';
                        gctx.strokeStyle = '#334155';
                        gctx.lineWidth = 1.5;
                        gctx.beginPath();
                        gctx.roundRect(chipX, 370, w, 38, 19);
                        gctx.fill();
                        gctx.stroke();
                        gctx.fillStyle = '#E2E8F0';
                        gctx.fillText(label, chipX + 13, 395);
                        chipX += w + 10;
                    }

                    return {
                        masterPng: master.toDataURL('image/png'),
                        macPng: mac.toDataURL('image/png'),
                        previewPng: sheet.toDataURL('image/png'),
                        socialPng: social.toDataURL('image/png'),
                    };
                })()
            `);
            return result;
        } finally {
            win.destroy();
        }
    };

    app.whenReady()
        .then(async () => {
            let masterImage;
            let macBaseImage;

            if (ext === '.svg') {
                const svgSource = fs.readFileSync(inputPath, 'utf8');
                const rendered = await renderViaCanvas(svgSource);
                masterImage = nativeImage.createFromDataURL(rendered.masterPng);
                macBaseImage = nativeImage.createFromDataURL(rendered.macPng);
                if (values.preview) {
                    const previewBuf = Buffer.from(
                        rendered.previewPng.replace(/^data:image\/png;base64,/, ''),
                        'base64',
                    );
                    fs.mkdirSync(path.dirname(path.resolve(values.preview)), { recursive: true });
                    fs.writeFileSync(path.resolve(values.preview), previewBuf);
                }
                if (values.social) {
                    const socialBuf = Buffer.from(
                        rendered.socialPng.replace(/^data:image\/png;base64,/, ''),
                        'base64',
                    );
                    fs.mkdirSync(path.dirname(path.resolve(values.social)), { recursive: true });
                    fs.writeFileSync(path.resolve(values.social), socialBuf);
                }
            } else {
                masterImage = nativeImage.createFromPath(inputPath);
                macBaseImage = masterImage;
            }

            if (masterImage.isEmpty()) {
                throw new Error('Unable to decode the source icon image');
            }
            const dimensions = masterImage.getSize();
            if (dimensions.width !== dimensions.height) {
                throw new Error('The source icon must have a square canvas');
            }

            const outputDirectory = path.resolve(values.output);
            fs.mkdirSync(outputDirectory, { recursive: true });

            const sizes = [16, 24, 32, 48, 64, 128, 256];
            const images = sizes.map((size) =>
                masterImage.resize({ width: size, height: size, quality: 'best' }).toPNG(),
            );

            // Windows Vista+ lossless PNG-in-ICO container
            const header = Buffer.alloc(6 + sizes.length * 16);
            header.writeUInt16LE(1, 2);
            header.writeUInt16LE(sizes.length, 4);
            let offset = header.length;
            images.forEach((image, index) => {
                const entry = 6 + index * 16;
                const size = sizes[index];
                header[entry] = size === 256 ? 0 : size;
                header[entry + 1] = size === 256 ? 0 : size;
                header.writeUInt16LE(1, entry + 4);
                header.writeUInt16LE(32, entry + 6);
                header.writeUInt32LE(image.length, entry + 8);
                header.writeUInt32LE(offset, entry + 12);
                offset += image.length;
            });
            fs.writeFileSync(
                path.join(outputDirectory, 'icon.ico'),
                Buffer.concat([header, ...images]),
            );
            fs.writeFileSync(
                path.join(outputDirectory, 'icon.png'),
                masterImage.resize({ width: 512, height: 512, quality: 'best' }).toPNG(),
            );

            // macOS ICNS container with lossless PNG chunks (ic07..ic10)
            const icnsSpecs = [
                ['ic07', 128],
                ['ic08', 256],
                ['ic09', 512],
                ['ic10', 1024],
            ];
            const icnsChunks = icnsSpecs.map(([type, size]) => {
                const png = macBaseImage
                    .resize({ width: size, height: size, quality: 'best' })
                    .toPNG();
                const hdr = Buffer.alloc(8);
                hdr.write(type, 0, 4, 'ascii');
                hdr.writeUInt32BE(8 + png.length, 4);
                return Buffer.concat([hdr, png]);
            });
            const icnsBody = Buffer.concat(icnsChunks);
            const icnsHeader = Buffer.alloc(8);
            icnsHeader.write('icns', 0, 4, 'ascii');
            icnsHeader.writeUInt32BE(8 + icnsBody.length, 4);
            fs.writeFileSync(
                path.join(outputDirectory, 'icon.icns'),
                Buffer.concat([icnsHeader, icnsBody]),
            );

            console.log(
                'Prepared icon.png (512), icon.ico (16-256), and icon.icns (128-1024)',
            );
            try {
                fs.rmSync(scratch, { recursive: true, force: true });
            } catch {
                /* Leave any runtime-owned files intact. */
            }
            app.exit(0);
        })
        .catch((err) => {
            console.error(err);
            app.exit(1);
        });
}

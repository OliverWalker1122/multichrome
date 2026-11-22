/* eslint-disable @typescript-eslint/no-var-requires -- Electron 28 CLI helpers use CommonJS. */
// Format conversion for a generated PNG; no drawing, compositing or credential
// loading. Electron's image decoder preserves alpha while creating icon sizes.
// Usage: node scripts/prepare-app-icon.cjs --input image.png --output assets
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
    if (result.error)
        console.error('Unable to start the isolated icon converter');
    process.exitCode = result.status ?? 1;
} else {
    const { app, nativeImage } = require('electron');
    const { values } = parseArgs({
        options: {
            input: { type: 'string' },
            output: { type: 'string', default: 'assets' },
        },
    });
    if (!values.input || path.extname(values.input).toLowerCase() !== '.png') {
        throw new Error('Provide a generated PNG with --input');
    }

    // Do not launch the MultiChrome main entry or use its application data.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'multichrome-icon-'));
    app.setPath('userData', scratch);
    app.disableHardwareAcceleration();

    const original = nativeImage.createFromPath(path.resolve(values.input));
    if (original.isEmpty()) throw new Error('Unable to decode the source PNG');
    const dimensions = original.getSize();
    if (dimensions.width !== dimensions.height) {
        throw new Error('The generated icon must have a square canvas');
    }
    const outputDirectory = path.resolve(values.output);
    fs.mkdirSync(outputDirectory, { recursive: true });
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const images = sizes.map((size) =>
        original.resize({ width: size, height: size, quality: 'best' }).toPNG(),
    );

    // Windows Vista and newer support lossless PNG payloads in an ICO file.
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
        original.resize({ width: 512, height: 512, quality: 'best' }).toPNG(),
    );

    // Build macOS ICNS container with lossless PNG chunks (ic07..ic10).
    const icnsSpecs = [
        ['ic07', 128],
        ['ic08', 256],
        ['ic09', 512],
        ['ic10', 1024],
    ];
    const icnsChunks = icnsSpecs.map(([type, size]) => {
        const png = original
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
        'Prepared icon.png (512), icon.ico (16–256), and icon.icns (128–1024)',
    );
    try {
        fs.rmdirSync(scratch);
    } catch {
        /* Leave any runtime-owned files intact. */
    }
    app.exit(0);
}

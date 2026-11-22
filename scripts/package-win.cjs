const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const workspace = path.resolve(__dirname, '..');

async function packageWindows({ outputDirectory, expectedVersion } = {}) {
    // Use the builder API: its CLI implicitly loads electron-builder.env.
    // This local installer never signs, discovers credentials, or publishes.
    for (const variable of [
        'CSC_LINK',
        'WIN_CSC_LINK',
        'CSC_KEY_PASSWORD',
        'WIN_CSC_KEY_PASSWORD',
        'GH_TOKEN',
        'GITHUB_TOKEN',
    ])
        delete process.env[variable];
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
    process.env.SKIP_DOTENV = 'true';
    process.env.DOTENV_CONFIG_PATH = '/dev/null';

    const { build, Platform, Arch } = require('electron-builder');
    const asar = require('@electron/asar');
    const packageJson = JSON.parse(
        fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'),
    );
    if (expectedVersion && packageJson.version !== expectedVersion) {
        throw new Error('Unexpected application version');
    }
    const output = path.resolve(
        workspace,
        outputDirectory || packageJson.build.directories.output,
    );

    await build({
        projectDir: workspace,
        targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
        publish: 'never',
        config: {
            directories: { output },
            win: {
                // Resource editing writes the icon and version into MultiChrome.exe.
                // Signing remains disabled through this explicit no-op signer.
                signAndEditExecutable: true,
                forceCodeSigning: false,
                sign: async () => {},
            },
        },
    });

    const resources = path.join(output, 'win-unpacked', 'resources');
    // Third-party binaries (sing-box and fingerprint-chromium) are downloaded on demand
    // by the user inside Settings from official GitHub Releases with SHA-256 verification.
    if (fs.existsSync(path.join(resources, 'sing-box', 'sing-box.exe'))) {
        throw new Error('Installer should not bundle third-party sing-box binary');
    }

    const archive = path.join(resources, 'app.asar');
    const bundledPackage = JSON.parse(
        asar.extractFile(archive, 'package.json').toString(),
    );
    if (bundledPackage.version !== packageJson.version)
        throw new Error('Bundled application version mismatch');
    for (const name of ['icon.ico', 'icon.png']) {
        const iconPath = path.join('assets', name);
        if (
            !asar
                .extractFile(archive, iconPath)
                .equals(fs.readFileSync(path.join(workspace, iconPath)))
        ) {
            throw new Error(
                'Bundled window icon does not match the source asset',
            );
        }
    }
    const files = asar
        .listPackage(archive)
        .map((file) => file.replaceAll('\\', '/'));
    for (const name of [
        'proxyManager.js',
        'singboxCore.js',
        'singboxConfig.js',
        'managedProxyArgs.js',
        'proxyExitProbe.js',
        'applicationLogs.js',
        'kernelManager.js',
        'fingerprintProfile.js',
    ]) {
        if (!files.some((file) => file.endsWith(`/electron/${name}`))) {
            throw new Error('Missing bundled application module');
        }
    }
    console.log('WINDOWS_PACKAGE_VERIFIED');
    return output;
}

module.exports = { packageWindows };

if (require.main === module) {
    const { values } = parseArgs({ options: { output: { type: 'string' } } });
    packageWindows({ outputDirectory: values.output }).catch(() => {
        console.error('WINDOWS_PACKAGE_FAILED');
        process.exitCode = 1;
    });
}

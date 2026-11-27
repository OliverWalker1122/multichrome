'use strict';

// Also guard direct invocations of the JS and Electron test entry points.
if (process.platform === 'win32' && !process.env.MULTICHROME_TEST_AUDIT_DIR) {
    throw new Error('Windows browser tests require the supervised npm command on an isolated test account.');
}

module.exports = function requireAuditedBuild() {
    if (process.platform !== 'win32') return;
    const fs = require('node:fs');
    const path = require('node:path');
    const launcher = path.join(__dirname, '../dist/electron/services/browserLaunchService.js');
    if (!fs.existsSync(launcher) || !fs.readFileSync(launcher, 'utf8').includes('await reserveWindowsTestLaunch(')) {
        throw new Error('Windows browser test protection missing from build. Run npm run build first.');
    }
};

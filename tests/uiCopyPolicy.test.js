import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function collectCodeFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectCodeFiles(full, out);
        } else if (/\.(?:ts|tsx|js)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

function isAllowedTechnicalSlashString(text) {
    // Allow URLs, schemes, routes, MIME types, CSS functions, IANA timezones, npm scopes, JSON-RPC methods
    if (/^(?:https?|socks5?|vless|vmess|trojan|ss|hy2|hysteria2|tuic|file|multichrome|devtools|chrome):\/\//i.test(text)) {
        return true;
    }
    if (/^(?:\.\.?\/|\/api\/|\/json|\/devtools\/|\/mcp\b|\/t\/|\/Applications\/|\/oliverwalker1122|\/start\b|\/ip\b|\/\?fields=)/i.test(text)) {
        return true;
    }
    if (/^(?:America|Europe|Asia|Australia|Pacific|Africa|Atlantic)\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(text)) {
        return true;
    }
    if (/^(?:application|text|image)\/[a-z0-9.+-]+/i.test(text)) {
        return true;
    }
    if (/^(?:color-mix\(|rgba?\(|1 \/ -1|0 \/ 0|tools\/|resources\/|prompts\/|scripts\/)/i.test(text)) {
        return true;
    }
    return false;
}

test('UI copy globally forbids xxx/vvv slash-paired dual phrasings across src/ and electron/', () => {
    const violations = [];
    const files = [...collectCodeFiles('src'), ...collectCodeFiles('electron')];

    for (const filePath of files) {
        const source = fs.readFileSync(filePath, 'utf8');
        const sf = ts.createSourceFile(
            filePath,
            source,
            ts.ScriptTarget.Latest,
            true,
            filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );

        const inspectText = (rawText, node) => {
            const text = rawText.trim();
            if (!text || (!text.includes('/') && !text.includes('／'))) return;
            if (isAllowedTechnicalSlashString(text)) return;

            // Strip embedded URLs, npm @scope/pkg, API paths, HTTP/1.x, and user-agent tokens before checking natural-language words
            const stripped = text
                .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'`)]+/gi, '')
                .replace(/@[a-z0-9_-]+\/[a-z0-9_.-]+/gi, '')
                .replace(/\/(?:api\/v1|json\/version|json\/list|devtools\/|mcp\b)[^\s"'`)]*/gi, '')
                .replace(/\bHTTP\/\d\.\d\b/gi, '')
                .replace(/\bMultiChrome[^/\s]*\/[\d.${}a-z-]+/gi, '')
                .replace(/\bgoogle\.com\/search[^\s"'`)]*/gi, '')
                .replace(/\[(?:路径已隐藏|path hidden)\]/g, '');

            // Forbid spaced dual labels ("防泄露 / 指纹", "Exit IP / Location", "OS / Brand")
            // and Chinese slash-joined word pairs ("代理/环境", "公钥/Short ID")
            const hasSpacedDualSlash =
                /[\u4e00-\u9fffA-Za-z]{2,}\s+[/／]\s+[\u4e00-\u9fffA-Za-z.]{2,}/.test(
                    stripped,
                );
            const hasCjkDualSlash =
                /[\u4e00-\u9fff][/／][\u4e00-\u9fffA-Za-z]|[A-Za-z][/／][\u4e00-\u9fff]/.test(
                    stripped,
                );

            if (hasSpacedDualSlash || hasCjkDualSlash) {
                const { line } = sf.getLineAndCharacterOfPosition(
                    node.getStart(sf),
                );
                violations.push(
                    `${filePath}:${line + 1} -> ${JSON.stringify(text)}`,
                );
            }
        };

        const visit = (node) => {
            if (
                ts.isImportDeclaration(node) ||
                ts.isExportDeclaration(node) ||
                ts.isRegularExpressionLiteral(node)
            ) {
                return;
            }
            if (
                ts.isStringLiteral(node) ||
                ts.isNoSubstitutionTemplateLiteral(node) ||
                ts.isJsxText(node)
            ) {
                inspectText(node.text, node);
            } else if (ts.isTemplateExpression(node)) {
                inspectText(node.head.text, node.head);
                for (const span of node.templateSpans) {
                    inspectText(span.literal.text, span.literal);
                }
            }
            ts.forEachChild(node, visit);
        };

        visit(sf);
    }

    assert.deepEqual(
        violations,
        [],
        `Found forbidden xxx/vvv dual-slash UI phrasings:\n${violations.join('\n')}`,
    );
});

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const outputDirectory = new URL('../.output/chrome-mv3/', import.meta.url);

test('the Chrome build contains the expected MV3 popup and icons', async () => {
  const [manifestContents, packageContents] = await Promise.all([
    readFile(new URL('manifest.json', outputDirectory), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestContents);
  const packageJson = JSON.parse(packageContents);

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "GitHub Don't Merge");
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.description, packageJson.description);
  assert.equal(manifest.action?.default_popup, 'popup.html');
  assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
  assert.deepEqual(manifest.host_permissions, ['https://github.com/*']);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.equal(manifest.content_scripts, undefined);
  assert.ok(manifest.background?.service_worker);
  await Promise.all(
    ['content-scripts/github.js', 'content-scripts/github.css', manifest.background.service_worker].map((path) =>
      access(new URL(path, outputDirectory)),
    ),
  );

  const popup = await readFile(
    new URL(manifest.action.default_popup, outputDirectory),
    'utf8',
  );
  assert.match(popup, /merging is not blocked/);

  const script = popup.match(/<script\b[^>]*\bsrc="([^"]+)"/);
  const stylesheet = popup.match(/<link\b[^>]*\bhref="([^"]+\.css)"/);
  assert.ok(script, 'Missing popup script');
  assert.ok(stylesheet, 'Missing popup stylesheet');
  await Promise.all(
    [script[1], stylesheet[1]].map((path) =>
      access(new URL(path.replace(/^\//, ''), outputDirectory)),
    ),
  );

  for (const size of [16, 32, 48, 128]) {
    const iconPath = manifest.icons?.[size];
    assert.ok(iconPath, `Missing ${size}px extension icon`);
    const icon = await readFile(
      new URL(iconPath.replace(/^\//, ''), outputDirectory),
    );
    assert.deepEqual(icon.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'));
    assert.equal(icon.readUInt32BE(16), size);
    assert.equal(icon.readUInt32BE(20), size);
  }
});

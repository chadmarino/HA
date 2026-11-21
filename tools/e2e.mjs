#!/usr/bin/env node
// End-to-end test: runs the mock HA server and drives the app in Chromium.
//   npm test            (SCREENSHOTS=dir to save screenshots)

import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// Use a local playwright install if present, else the global one.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const globalRoot = execSync('npm root -g').toString().trim();
  ({ chromium } = createRequire(import.meta.url)(path.join(globalRoot, 'playwright')));
}
import assert from 'node:assert/strict';

const PORT = 18123 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}/local/ha-app/`;
const SHOTS = process.env.SCREENSHOTS;

const server = spawn(process.execPath, ['tools/mock-ha.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('Mock Home Assistant') && resolve()));

const browser = await chromium.launch();
const errors = [];
let passed = 0;
async function step(name, fn) {
  process.stdout.write(`• ${name} … `);
  await fn();
  passed++;
  console.log('ok');
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  const shot = (n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png` });

  await step('login screen shows, prefilled with HA origin', async () => {
    await page.goto(BASE);
    await page.getByRole('heading', { name: 'Connect to Home Assistant' }).waitFor();
    assert.equal(await page.getByLabel('Home Assistant URL').inputValue(), `http://localhost:${PORT}`);
    await shot('01-login');
  });

  await step('connect with long-lived token', async () => {
    await page.getByText('Use a long-lived access token instead').click();
    await page.getByLabel('Access token').fill('mock-token');
    await page.getByRole('button', { name: 'Connect with token' }).click();
    await page.getByRole('heading', { name: 'Mock Home' }).waitFor();
  });

  await step('home groups entities by area and hides diagnostics', async () => {
    for (const a of ['Kitchen', 'Living Room', 'Outside', 'Bedroom']) await page.locator('.area h2', { hasText: a }).first().waitFor();
    assert.equal(await page.locator('[data-entity="sensor.wifi_signal"]').count(), 0);
    assert.ok(!(await page.locator('.home-body').innerText()).includes('null'), 'no stray "null" text');
    assert.equal(await page.locator('[data-entity="automation.porch_light_at_sunset"]').count(), 0);
    // Thermostat area comes from its device
    await page.locator('.area', { hasText: 'Living Room' }).locator('[data-entity="climate.thermostat"]').waitFor();
    await shot('02-home');
  });

  await step('toggle a light on and see it update live', async () => {
    const card = page.locator('[data-entity="light.kitchen"]');
    await card.getByRole('checkbox').click();
    await card.locator('.card-state', { hasText: 'On · 100%' }).waitFor();
    assert.ok(await card.evaluate((el) => el.classList.contains('active')));
  });

  await step('brightness slider sets brightness', async () => {
    const card = page.locator('[data-entity="light.kitchen"]');
    const slider = card.getByLabel('Brightness');
    await slider.evaluate((el) => {
      el.value = 40;
      el.dispatchEvent(new Event('input'));
      el.dispatchEvent(new Event('change'));
    });
    await card.locator('.card-state', { hasText: 'On · 40%' }).waitFor();
  });

  await step('climate +/- and cover buttons', async () => {
    const t = page.locator('[data-entity="climate.thermostat"]');
    await t.getByRole('button', { name: 'Raise' }).click();
    await t.locator('.target-temp', { hasText: '21.5°' }).waitFor();
    const c = page.locator('[data-entity="cover.garage"]');
    await c.getByRole('button', { name: '▲ Open' }).click();
    await c.locator('.card-state', { hasText: 'Open' }).waitFor();
  });

  await step('favorite a device', async () => {
    await page.locator('[data-entity="lock.front_door"]').first().getByRole('button', { name: 'Toggle favorite' }).click();
    await page.getByRole('combobox', { name: 'Filter by type' }).selectOption('');
    await page.getByPlaceholder('Search devices…').fill('front');
    await page.locator('.area.favorites [data-entity="lock.front_door"]').waitFor();
    await page.getByPlaceholder('Search devices…').fill('');
  });

  await step('entity details dialog with history', async () => {
    await page.locator('[data-entity="sensor.outside_temperature"] .card-info').click();
    await page.locator('dialog .spark').waitFor();
    await shot('03-details');
    await page.locator('dialog').getByRole('button', { name: 'Close' }).click();
  });

  await step('automations: list, disable, run', async () => {
    await page.getByRole('button', { name: /Automations/ }).first().click();
    const row = page.locator('.row[data-entity="automation.porch_light_at_sunset"]');
    await row.waitFor();
    await row.getByRole('checkbox', { name: 'Enabled' }).click();
    await row.locator('.muted', { hasText: 'Disabled' }).waitFor();
    await row.getByRole('button', { name: 'Run' }).click();
    await row.locator('.muted', { hasText: /Last run \d+s ago|just now/ }).waitFor();
    await page.locator('.row[data-entity="automation.yaml_only"]', { hasText: 'read-only' }).waitFor();
    await shot('04-automations');
  });

  await step('create automation with quick builder', async () => {
    await page.getByRole('button', { name: '+ New automation' }).click();
    await page.getByLabel('Trigger entity').fill('binary_sensor.motion_hall');
    await page.getByLabel('Changes to').fill('on');
    await page.getByLabel('Action entity').fill('light.bedroom');
    await page.getByLabel('Name').fill('Hall motion bedroom light');
    await page.getByRole('button', { name: 'Generate YAML ↓' }).click();
    const yamlText = await page.getByLabel('YAML').inputValue();
    assert.match(yamlText, /binary_sensor\.motion_hall/);
    assert.match(yamlText, /light\.turn_on/);
    await shot('05-editor');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.locator('.row', { hasText: 'Hall motion bedroom light' }).waitFor();
  });

  await step('edit and delete automation', async () => {
    const row = page.locator('.row', { hasText: 'Hall motion bedroom light' });
    await row.getByRole('button', { name: 'Edit' }).click();
    const ta = page.getByLabel('YAML');
    await ta.waitFor();
    const v = await ta.inputValue();
    await ta.fill(v.replace('alias: Hall motion bedroom light', 'alias: Hall motion renamed'));
    await page.getByRole('button', { name: 'Save' }).click();
    const renamed = page.locator('.row', { hasText: 'Hall motion renamed' });
    await renamed.waitFor();
    await renamed.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await renamed.waitFor({ state: 'detached' });
  });

  await step('invalid YAML is caught before saving', async () => {
    await page.getByRole('button', { name: '+ New automation' }).click();
    await page.getByLabel('YAML').fill('alias: [broken');
    await page.locator('dialog .error:not([hidden])').waitFor();
    await page.locator('dialog').getByRole('button', { name: 'Close' }).click();
  });

  await step('scripts tab: run script', async () => {
    await page.getByRole('tab', { name: 'Scripts' }).click();
    const row = page.locator('.row[data-entity="script.good_night"]');
    await row.getByRole('button', { name: 'Run' }).click();
    await row.locator('.muted', { hasText: 'Running' }).waitFor();
  });

  await step('tools: perform an action', async () => {
    await page.getByRole('button', { name: /Tools/ }).first().click();
    await page.getByLabel('Action', { exact: true }).fill('light.turn_on');
    await page.getByText('Turn on one or more lights.').waitFor();
    await page.getByLabel('Target entities').fill('light.bedroom');
    await page.getByRole('button', { name: 'Perform action' }).click();
    await page.locator('.output', { hasText: 'OK' }).waitFor();
    await shot('06-tools');
  });

  await step('tools: template renders live', async () => {
    await page.getByRole('tab', { name: 'Template' }).click();
    await page.getByLabel('Template').fill("Lamp is {{ states('light.bedroom') }}");
    await page.locator('.output', { hasText: 'Lamp is on' }).waitFor();
  });

  await step('tools: system check config', async () => {
    await page.getByRole('tab', { name: 'System' }).click();
    await page.getByRole('button', { name: 'Check configuration' }).click();
    await page.locator('.output', { hasText: 'Configuration is valid' }).waitFor();
  });

  await step('mobile layout renders', async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    mp.on('pageerror', (e) => errors.push(e.message));
    await mp.goto(BASE);
    await mp.getByText('Use a long-lived access token instead').click();
    await mp.getByLabel('Access token').fill('mock-token');
    await mp.getByRole('button', { name: 'Connect with token' }).click();
    await mp.locator('[data-entity="light.living_room"]').first().waitFor();
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, 'no horizontal scroll on mobile');
    if (SHOTS) await mp.screenshot({ path: `${SHOTS}/07-mobile.png` });
    await m.close();
  });

  await step('OAuth login flow ("Log in with Home Assistant")', async () => {
    const o = await browser.newContext();
    const op = await o.newPage();
    op.on('pageerror', (e) => errors.push(e.message));
    await op.goto(BASE);
    await op.getByRole('button', { name: 'Log in with Home Assistant' }).click();
    await op.locator('#approve').click();
    await op.getByRole('heading', { name: 'Mock Home' }).waitFor();
    assert.ok(!op.url().includes('code='), 'auth code removed from URL');
    await op.reload();
    await op.getByRole('heading', { name: 'Mock Home' }).waitFor();
    await o.close();
  });

  await step('log out returns to login', async () => {
    await page.getByRole('button', { name: /Settings/ }).first().click();
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.getByRole('heading', { name: 'Connect to Home Assistant' }).waitFor();
  });

  assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`);
  console.log(`\nAll ${passed} checks passed.`);
} catch (e) {
  console.log('FAILED');
  console.error(e);
  if (errors.length) console.error('Browser errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}

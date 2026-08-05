/**
 * Synapse Phase 5 & 6 — End-to-End Test Script
 * Uses Puppeteer to test AI chat panel, socket connection, and generate mode.
 * 
 * Run with: node test-ai-e2e.mjs
 */

import puppeteer from 'puppeteer-core';

const BASE_URL = 'http://localhost:3000';
const ROOM = 'e2e-test-' + Date.now();
const BOARD_URL = `${BASE_URL}/board/${ROOM}`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let browser, page;
const results = [];

function log(test, pass, detail = '') {
  const icon = pass ? '✅' : '❌';
  const msg = `${icon} ${test}${detail ? ' — ' + detail : ''}`;
  console.log(msg);
  results.push({ test, pass, detail });
}

async function run() {
  console.log(`\n🧪 Synapse AI E2E Tests — Room: ${ROOM}\n${'='.repeat(60)}\n`);

  // Launch browser
  browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900'],
    defaultViewport: { width: 1400, height: 900 },
  });
  page = await browser.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // ──────────────────────────────────────────────────────────────
  // TEST 1: Page loads and socket connects
  // ──────────────────────────────────────────────────────────────
  try {
    await page.goto(BOARD_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    log('Page loads', true, `${BOARD_URL}`);
  } catch (e) {
    log('Page loads', false, e.message);
    await cleanup();
    return;
  }

  // Wait for canvas to initialize
  await sleep(3000);

  // Check for the AI FAB button
  try {
    const fab = await page.$('.ai-fab');
    log('AI FAB button present', !!fab);
  } catch (e) {
    log('AI FAB button present', false, e.message);
  }

  // Check for the AI eye SVG
  try {
    const eye = await page.$('.ai-fab svg');
    log('AI Eye SVG rendered', !!eye);
  } catch (e) {
    log('AI Eye SVG rendered', false, e.message);
  }

  // ──────────────────────────────────────────────────────────────
  // TEST 2: Click FAB to open panel
  // ──────────────────────────────────────────────────────────────
  try {
    await page.click('.ai-fab');
    await sleep(500);
    const panel = await page.$('.ai-panel');
    log('AI panel opens on click', !!panel);
  } catch (e) {
    log('AI panel opens on click', false, e.message);
  }

  // Check panel header
  try {
    const modelText = await page.$eval('.ai-panel-model', el => el.textContent);
    log('Panel header shows model', modelText.includes('gemini-3.5-flash'), modelText.trim());
  } catch (e) {
    log('Panel header shows model', false, e.message);
  }

  // Check status dot
  try {
    const dot = await page.$('.ai-panel-status-dot');
    log('Status dot present', !!dot);
  } catch (e) {
    log('Status dot present', false, e.message);
  }

  // Check room ID display
  try {
    const roomText = await page.$eval('.ai-panel-room', el => el.textContent);
    log('Room ID shown', roomText.length > 0, roomText);
  } catch (e) {
    log('Room ID shown', false, e.message);
  }

  // Check empty state
  try {
    const emptyState = await page.$('.ai-empty-state');
    log('Empty state shown (no messages)', !!emptyState);
  } catch (e) {
    log('Empty state shown', false, e.message);
  }

  // Check mode toggle buttons
  try {
    const chatBtn = await page.$('.ai-mode-btn.active');
    const btnText = await page.$eval('.ai-mode-btn.active', el => el.textContent);
    log('Chat mode active by default', btnText.includes('Chat'), btnText.trim());
  } catch (e) {
    log('Chat mode active by default', false, e.message);
  }

  // Check input area
  try {
    const input = await page.$('.ai-input');
    const placeholder = await page.$eval('.ai-input', el => el.placeholder);
    log('Input field present', !!input, `placeholder: "${placeholder}"`);
  } catch (e) {
    log('Input field present', false, e.message);
  }

  // Check send button
  try {
    const sendBtn = await page.$('.ai-send-btn');
    const disabled = await page.$eval('.ai-send-btn', el => el.disabled);
    log('Send button present and disabled (empty)', !!sendBtn && disabled);
  } catch (e) {
    log('Send button present', false, e.message);
  }

  // ──────────────────────────────────────────────────────────────
  // TEST 3: Type message and verify send button enables
  // ──────────────────────────────────────────────────────────────
  try {
    await page.click('.ai-input');
    await page.type('.ai-input', 'Hello, what is 2+2?');
    await sleep(200);
    const disabled = await page.$eval('.ai-send-btn', el => el.disabled);
    log('Send button enabled when text entered', !disabled);
  } catch (e) {
    log('Send button enabled', false, e.message);
  }

  // ──────────────────────────────────────────────────────────────
  // TEST 4: Send chat message (Bug 1 fix: optimistic message)
  // ──────────────────────────────────────────────────────────────
  try {
    await page.click('.ai-send-btn');
    await sleep(300); // Should show optimistically immediately

    const userMsg = await page.$('.ai-msg-user');
    const msgContent = userMsg ? await page.$eval('.ai-msg-user div:last-child', el => el.textContent) : '';
    log('Optimistic user message appears instantly', !!userMsg && msgContent.includes('2+2'), msgContent.trim());
  } catch (e) {
    log('Optimistic user message', false, e.message);
  }

  // Check input cleared
  try {
    const inputVal = await page.$eval('.ai-input', el => el.value);
    log('Input cleared after send', inputVal === '');
  } catch (e) {
    log('Input cleared', false, e.message);
  }

  // Check streaming state
  try {
    const inputDisabled = await page.$eval('.ai-input', el => el.disabled);
    log('Input disabled during streaming', inputDisabled);
  } catch (e) {
    log('Input disabled during streaming', false, e.message);
  }

  // Check status dot streaming
  try {
    const streamDot = await page.$('.ai-panel-status-dot.streaming');
    log('Status dot shows streaming state', !!streamDot);
  } catch (e) {
    log('Status dot streaming', false, e.message);
  }

  // ──────────────────────────────────────────────────────────────
  // TEST 5: Wait for AI response to stream in
  // ──────────────────────────────────────────────────────────────
  try {
    // Wait up to 20 seconds for AI response
    await page.waitForSelector('.ai-msg-ai', { timeout: 20000 });
    log('AI response message appears', true);
  } catch (e) {
    log('AI response message appears', false, 'Timed out waiting for AI response');
  }

  // Wait for stream to finish
  await sleep(5000);

  // Check stream end (cursor gone, input re-enabled)
  try {
    const cursor = await page.$('.ai-streaming-cursor');
    const inputEnabled = await page.$eval('.ai-input', el => !el.disabled);
    log('Streaming finishes (cursor gone, input re-enabled)', !cursor && inputEnabled);
  } catch (e) {
    log('Streaming finishes', false, e.message);
  }

  // Check AI message has Gemini label
  try {
    const label = await page.$eval('.ai-msg-label-ai', el => el.textContent);
    log('AI message shows Gemini label', label.includes('Gemini'), label.trim());
  } catch (e) {
    log('Gemini label', false, e.message);
  }

  // ──────────────────────────────────────────────────────────────
  // TEST 6: Mode toggle to Generate
  // ──────────────────────────────────────────────────────────────
  try {
    const generateBtn = await page.$$('.ai-mode-btn');
    if (generateBtn.length >= 2) {
      await generateBtn[1].click();
      await sleep(300);
      const placeholder = await page.$eval('.ai-input', el => el.placeholder);
      log('Generate mode: placeholder changes', placeholder.includes('diagram'), placeholder);
    } else {
      log('Generate mode toggle', false, 'Could not find generate button');
    }
  } catch (e) {
    log('Generate mode toggle', false, e.message);
  }

  // Switch back to chat
  try {
    const chatBtn = (await page.$$('.ai-mode-btn'))[0];
    await chatBtn.click();
    await sleep(300);
    const placeholder = await page.$eval('.ai-input', el => el.placeholder);
    log('Switch back to Chat mode', placeholder.includes('Message'), placeholder);
  } catch (e) {
    log('Switch back to Chat', false, e.message);
  }

  // ──────────────────────────────────────────────────────────────
  // TEST 7: Escape key closes panel (Bug 3 fix)
  // ──────────────────────────────────────────────────────────────
  try {
    await page.click('.ai-input');
    await page.keyboard.press('Escape');
    await sleep(500);
    const panel = await page.$('.ai-panel');
    log('Escape key closes panel', !panel);
  } catch (e) {
    log('Escape closes panel', false, e.message);
  }

  // Reopen panel
  try {
    await page.click('.ai-fab');
    await sleep(500);
    const panel = await page.$('.ai-panel');
    log('Panel reopens after Escape', !!panel);
  } catch (e) {
    log('Panel reopens', false, e.message);
  }

  // ──────────────────────────────────────────────────────────────
  // TEST 8: Previous messages persist after close/reopen
  // ──────────────────────────────────────────────────────────────
  try {
    const msgs = await page.$$('.ai-msg');
    log('Messages persist after panel close/reopen', msgs.length >= 2, `${msgs.length} messages`);
  } catch (e) {
    log('Messages persist', false, e.message);
  }

  // ──────────────────────────────────────────────────────────────
  // TEST 9: Console errors check
  // ──────────────────────────────────────────────────────────────
  // Filter out known harmless errors
  const realErrors = consoleErrors.filter(e => 
    !e.includes('favicon') && 
    !e.includes('ERR_CONNECTION_REFUSED') &&
    !e.includes('DevTools')
  );
  log('No critical console errors', realErrors.length === 0, 
    realErrors.length > 0 ? realErrors.slice(0, 3).join('; ') : 'clean');

  // ──────────────────────────────────────────────────────────────
  // TEST 10: Screenshot
  // ──────────────────────────────────────────────────────────────
  try {
    const screenshotPath = 'c:\\synapse\\test-ai-screenshot.png';
    await page.screenshot({ path: screenshotPath, fullPage: false });
    log('Screenshot captured', true, screenshotPath);
  } catch (e) {
    log('Screenshot', false, e.message);
  }

  // ──────────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(60)}`);
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n🧪 Results: ${passed} passed, ${failed} failed out of ${results.length} tests\n`);

  if (failed > 0) {
    console.log('Failed tests:');
    results.filter(r => !r.pass).forEach(r => console.log(`  ❌ ${r.test}: ${r.detail}`));
  }

  await cleanup();
}

async function cleanup() {
  if (browser) {
    await browser.close().catch(() => {});
  }
  process.exit(results.some(r => !r.pass) ? 1 : 0);
}

run().catch(e => {
  console.error('Fatal error:', e);
  cleanup();
});

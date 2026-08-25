const fs = require('fs');

const app = fs.readFileSync('public/app.js', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

for (const marker of [
  'MESSAGE_RENDER_WINDOW_SIZE = 120',
  '加载更早消息',
  'messageRenderWindow.preserveScroll = true',
]) {
  if (!app.includes(marker) && !css.includes(marker)) throw new Error(`missing message window marker: ${marker}`);
}
if (!app.includes('const visibleMsgs = windowStart > 0 ? renderMsgs.slice(windowStart) : renderMsgs')) {
  throw new Error('renderMessages is not windowed');
}
if (css.includes('content-visibility: auto')) throw new Error('message windows must not use estimated message heights');
console.log('message window checks passed');

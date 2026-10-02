/* 守护：RPG 判定骰子必须由服务端掷。
   客户端 Math.random 的骰面不可复算，权威判定链不能用它。
   普通正文里的 1d20 属于文本展示，仍走 app-render 的本地版本，不受本约束。 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'frontend/ai-runtime.js'), 'utf-8');
const render = fs.readFileSync(path.join(root, 'frontend/app-render.js'), 'utf-8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf-8');

assert.ok(/fetch\('\/api\/dice'/.test(runtime), 'ai-runtime 必须通过 /api/dice 取权威骰面');
assert.ok(/crypto\.randomInt/.test(server), '服务端骰子必须使用 crypto.randomInt');
assert.ok(!/rollWorldDice\s*\(/.test(runtime), 'ai-runtime 的判定路径不得使用客户端随机掷骰（rollWorldDice）');
assert.ok(/function rollDiceIn\s*\(/.test(render), 'app-render 保留本地文本骰子（仅用于正文展示）');
console.log('check_dice_authority: ok');

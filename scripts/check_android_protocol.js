const fs = require('fs');

const src = fs.readFileSync('android/app/src/main/java/com/tavern/app/TavernServer.kt', 'utf8');
for (const marker of [
  'val route = uri.substringBefore(\'?\')',
  'route == "/api/world-saves"',
  'if (session.method == Method.PUT) org.json.JSONArray(incomingTurns.toString())',
  'put("agentToolTrace"',
  'put("phaseHistory"',
]) {
  if (!src.includes(marker)) throw new Error(`missing Android protocol marker: ${marker}`);
}
console.log('android protocol checks passed');

/**
 * Quick GLB inspector — run: node scripts/inspect-glb.js
 */
const fs = require('fs');
const path = require('path');

const GLB = path.join(__dirname, '../assets/poson06(02).glb');
const buf = fs.readFileSync(GLB);

function readChunk(offset) {
  const len = buf.readUInt32LE(offset);
  const type = buf.toString('ascii', offset + 4, offset + 8);
  const data = buf.slice(offset + 8, offset + 8 + len);
  return { len, type, data, next: offset + 8 + len };
}

const jsonChunk = readChunk(12);
const gltf = JSON.parse(jsonChunk.data.toString());

console.log('Meshes:', gltf.meshes?.length ?? 0);
console.log('Nodes:', gltf.nodes?.length ?? 0);
console.log('Animations:', gltf.animations?.length ?? 0);
if (gltf.animations?.length) {
  gltf.animations.forEach((a, i) => console.log(`  [${i}] ${a.name || 'unnamed'}`));
}
console.log('Scenes:', gltf.scenes?.length ?? 0);
if (gltf.scenes?.[0]) console.log('Root nodes:', gltf.scenes[0].nodes);

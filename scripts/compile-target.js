/**
 * Compiles company logo into MindAR image target (.mind file)
 */
const fs = require('fs');
const path = require('path');
const { Compiler } = require('mind-ar/dist/mindar-image.prod.js');

const INPUT = path.join(__dirname, '../assets/company_logo.jpeg');
const OUTPUT = path.join(__dirname, '../public/targets.mind');

async function main() {
  const imageBuffer = fs.readFileSync(INPUT);
  const compiler = new Compiler();
  await compiler.compileImageTargets([imageBuffer], (progress) => {
    process.stdout.write(`\rCompiling target: ${Math.round(progress)}%`);
  });
  const buffer = await compiler.exportData();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, Buffer.from(buffer));
  console.log(`\nTarget compiled: ${OUTPUT}`);
}

main().catch((err) => {
  console.error('Compilation failed:', err);
  process.exit(1);
});

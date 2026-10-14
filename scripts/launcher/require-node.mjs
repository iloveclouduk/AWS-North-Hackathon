// Imported first by every launcher script: the server needs Node 24 (server/package.json engines), and an older
// Node fails later with errors that don't say so.
const MIN = 24;
const major = Number(process.versions.node.split('.')[0]);
if (major < MIN) {
  console.error(`\n✗ AWS City needs Node.js ${MIN} or newer; this is ${process.versions.node}.`);
  console.error(`  Install it from https://nodejs.org (or: nvm install ${MIN} && nvm use), then run this again.\n`);
  process.exit(1);
}

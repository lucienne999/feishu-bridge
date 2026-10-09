// Runs before cli.mjs, which old Node cannot even parse (optional chaining etc.):
// keep this file free of post-ES2015 syntax so the friendly message can be shown.
const NODE_MIN_MAJOR = 22;
const NODE_MIN_MINOR = 13;

export function nodeVersionError(version) {
  const shown = String(version || process.versions.node);
  const parts = shown.split('-')[0].split('.');
  const major = Number(parts[0]) || 0;
  const minor = Number(parts[1]) || 0;
  if (major > NODE_MIN_MAJOR || (major === NODE_MIN_MAJOR && minor >= NODE_MIN_MINOR)) return null;
  return Error([
    `Node.js version too old: ${shown}, requires ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}+ (built-in node:sqlite)`,
    'Upgrade Node.js first:',
    '  git clone https://github.com/nvm-sh/nvm.git ~/.nvm && echo \'export NVM_DIR="$HOME/.nvm"\' >> ~/.bashrc && echo \'[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"\' >> ~/.bashrc && source ~/.bashrc   # install nvm',
    '  nvm install 22 && nvm use 22',
  ].join('\n'));
}

const error = nodeVersionError();
if (error) {
  console.error(error.message);
  process.exit(1);
}

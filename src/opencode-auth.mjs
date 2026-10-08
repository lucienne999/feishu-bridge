import {spawn} from 'node:child_process';
import {opencodeBinary} from './providers.mjs';
import {withLocalBinPath} from './tools-install.mjs';

const command = process.argv[2] || 'login';
if (!['login', 'list'].includes(command)) throw Error('支持 login 或 list');
const env = withLocalBinPath(process.env);
const bin = opencodeBinary();
const args = command === 'login' ? ['auth', 'login'] : ['auth', 'list'];
const child = spawn(bin, args, {stdio: 'inherit', env});
child.on('error', () => {
  console.error('OpenCode 不可用，请先安装：curl -fsSL https://opencode.ai/v2/install | bash\n或运行 npm run init -- --full\n文档：https://opencode.ai/docs/cli/');
  process.exitCode = 1;
});
child.on('close', code => { process.exitCode = code ?? 1; });

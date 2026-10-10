import {spawn} from 'node:child_process';
import {qoderBinary} from './providers.mjs';
import {INSTALL_HINTS, withLocalBinPath} from './tools-install.mjs';

const command = process.argv[2] || 'login';
if (!['login', 'status'].includes(command)) throw Error('支持 login 或 status');
const env = withLocalBinPath(process.env);
const bin = qoderBinary();
const child = spawn(bin, [command], {stdio: 'inherit', env});
child.on('error', () => {
  console.error(`Qoder CLI 不可用，请先安装：${INSTALL_HINTS.qoder.installCmd}\n或运行 npm run init -- --full`);
  process.exitCode = 1;
});
child.on('close', code => { process.exitCode = code ?? 1; });

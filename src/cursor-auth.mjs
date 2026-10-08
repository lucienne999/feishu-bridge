import {spawn} from 'node:child_process';
import {cursorBinary} from './providers.mjs';
const command=process.argv[2] || 'login';
if(!['login','status'].includes(command)) throw Error('支持 login 或 status');
const child=spawn(cursorBinary(),[command],{stdio:'inherit'});
child.on('error',()=>{console.error('Cursor CLI 不可用，请先安装：https://cursor.com/docs/cli/installation');process.exitCode=1;});
child.on('close',code=>{process.exitCode=code ?? 1;});

import koaRouter from 'koa-router';
import RocketChatClient from '@rocket.chat/sdk/clients/Rocketchat';
import fetch from 'node-fetch';

import * as prom from '../lib/prom';

import { login, register, sendMessage } from '../lib/api';

global.fetch = fetch;

const router = koaRouter();
router.prefix('/load');

const clients = [];

router.post('/connect', async (ctx/*, next*/) => {
	const {
		howMany = 1
	} = ctx.request.body;

	for (let i = 0; i < howMany; i++) {
		const client = new RocketChatClient({
			logger: console,
			host: process.env.HOST_URL || 'http://localhost:3000',
			useSsl: true,
		});

		prom.connected.inc();

		clients.push(client);
	}

	ctx.body = { success: true };
});

router.post('/disconnect', async (ctx/*, next*/) => {
	const {
		howMany = 1
	} = ctx.request.body;

	const total = clients.length;

	let i = 0;
	while (i < howMany && i < total) {
		const client = clients.shift();
		await client.disconnect();

		prom.connected.dec();
		i++;
	}

	ctx.body = { success: true };
});

const doLogin = async (countInit) => {
	const total = clients.length;

	let i = 0;
	while (i < total) {
		if (clients[i].loggedInInternal) {
			i++;
			continue;
		}
		const userCount = countInit + i;
		console.log('i ->', i);

		const credentials = {
			username: `loadtest${ userCount }`,
			password: `pass${ userCount }`
		};

		try {
			const end = prom.login.startTimer();
			await login(clients[i], credentials);
			end();

			clients[i].loggedInInternal = true;
		} catch (e) {
			const registerEnd = prom.register.startTimer();
			await register(clients[i], credentials);
			registerEnd();

			const end = prom.login.startTimer();
			await login(clients[i], credentials);
			end();

			clients[i].loggedInInternal = true;
		}
		i++;
	}
}

router.post('/login', async (ctx/*, next*/) => {
	const countInit = parseInt(process.env.LOGIN_OFFSET) || 0;

	doLogin(countInit);

	ctx.body = { success: true };
});

router.post('/subscribe/:rid', async (ctx/*, next*/) => {
	const total = clients.length;

	// console.log('ctx.params', ctx.params);
	const { rid } = ctx.params;

	let i = 0;
	while (i < total) {
		if (!clients[i].loggedInInternal) {
			i++;
			continue;
		}
		clients[i].subscribeRoom(rid);
		i++;
	}

	ctx.body = { success: true };
});

let msgInterval;
router.post('/message/send', async (ctx/*, next*/) => {
	const { period = 'relative', time = 1 } = ctx.params;

	const total = clients.length;
	const msgPerSecond = 0.002857142857143;
	const timeInterval = period === 'relative' ? (1 / msgPerSecond/ total) : time;

	if (msgInterval) {
		clearInterval(msgInterval);
	}

	msgInterval = setInterval(async () => {
		let chosenOne = Math.floor(Math.random() * total);

		while (!clients[chosenOne].loggedInInternal) {
			chosenOne = Math.floor(Math.random() * total);
		}

		sendMessage(clients[chosenOne], 'GENERAL', `hello from ${ chosenOne }`);

	}, timeInterval * 1000);

	ctx.body = { success: true };
});

router.delete('/message/send', async (ctx/*, next*/) => {
	clearInterval(msgInterval);
});

export default router;

import { ActingAsDevice, StageLinqOptions, Services, DeviceId } from '../types';
import { StateData, StateMap, BeatData, BeatInfo, Broadcast } from '../services';
import { sleep } from '../utils/sleep';
import { StageLinq } from '../StageLinq';
import { Logger } from '../LogEmitter';


require('console-stamp')(console, {
	format: ':date(HH:MM:ss) :label',
});

function convertHexStringToRgba(str: string): { r: number, g: number, b: number, a: number } {
	const hex = str.replace('#', '');
	// it seems as though the stagelinq color string is ARGB, not RGBA
	return {
		r: parseInt(hex.substring(2, 4), 16),
		g: parseInt(hex.substring(4, 6), 16),
		b: parseInt(hex.substring(6, 8), 16),
		a: hex.length === 8 ? parseInt(hex.substring(0, 2), 16) / 255 : 1
	};
}

async function main() {

	console.log('Starting CLI');

	const osc = require('osc');
	const udp = new osc.UDPPort({
		localAddress: "127.0.0.1",
		localPort: 57121,
		remoteAddress: "127.0.0.1",
		remotePort: 57200
	});
	udp.open();

	const stageLinqOptions: StageLinqOptions = {
		actingAs: ActingAsDevice.StageLinqJS,
		services: [
			Services.StateMap,
			Services.BeatInfo,
			Services.Broadcast,
		],
	}

	StageLinq.options = stageLinqOptions;

	StageLinq.logger.on('error', (...args: any) => {
		console.error(...args);
	});
	StageLinq.logger.on('warn', (...args: any) => {
		console.warn(...args);
		args.push("\n");
	});
	StageLinq.logger.on('info', (...args: any) => {
		console.info(...args);
		args.push("\n");
	});
	StageLinq.logger.on('log', (...args: any) => {
		console.log(...args);
		args.push("\n");
	});
	// StageLinq.logger.on('debug', (...args: any) => {
	//   console.debug(...args);
	//   args.push("\n");
	// });
	//Note: Silly is very verbose!
	// stageLinq.logger.on('silly', (...args: any) => {
	//   console.debug(...args);
	// });


	StageLinq.discovery.on('listening', () => {
		console.log(`[DISCOVERY] Listening`)
	});

	StageLinq.discovery.on('announcing', (info) => {
		console.log(`[DISCOVERY] Broadcasting Announce ${info.deviceId.string} Port ${info.port} ${info.source} ${info.software.name}:${info.software.version}`)
	});

	StageLinq.discovery.on('newDiscoveryDevice', (info) => {
		console.log(`[DISCOVERY] New Device ${info.deviceId.string} ${info.source} ${info.software.name} ${info.software.version}`)
	});

	StageLinq.discovery.on('updatedDiscoveryDevice', (info) => {
		console.log(`[DISCOVERY] Updated Device ${info.deviceId.string} Port:${info.port} ${info.source} ${info.software.name} ${info.software.version}`)
	});


	StageLinq.devices.on('newDevice', (device) => {
		console.log(`[DEVICES] New Device ${device.deviceId.string}`)
	});

	StageLinq.devices.on('newService', (device, service) => {
		console.log(`[DEVICES] New ${service.name} Service on ${device.deviceId.string} port ${service.serverInfo.port}`)
	});


	if (stageLinqOptions.services.includes(Services.Broadcast)) {

		Broadcast.emitter.on('message', async (deviceId: DeviceId, name: string, value) => {
			console.log(`[BROADCAST] ${deviceId.string} ${name}`, value);
		})

	}


	if (stageLinqOptions.services.includes(Services.StateMap)) {

		async function deckIsMaster(data: StateData) {
			if (data.json.state) {
				const deck = parseInt(data.name.substring(12, 13));
				await sleep(250);
				const track = StageLinq.status.getTrack(data.deviceId, deck);
				console.log(`Now Playing: `, track);
			}
		}


		StateMap.emitter.on('newDevice', async (service: StateMap) => {
			console.log(`[STATEMAP] Subscribing to States on ${service.deviceId.string}`);

			for (let i = 1; i <= service.device.deckCount(); i++) {
				service.addListener(`/Engine/Deck${i}/DeckIsMaster`, deckIsMaster);
			}

			service.subscribe();
		});

		StateMap.emitter.on('stateMessage', async (data: StateData) => {
			Logger.info(`[STATEMAP] ${data.deviceId.string} ${data.name} => ${JSON.stringify(data.json)}`);
			var args: any[] = [];

			if ("string" in data.json) {
				args = [{ type: 's', value: data.json.string }];
			} else if ("state" in data.json) {
				args = [{ type: data.json.state ? "T" : "F", value: 0 }];
			} else if ("value" in data.json) {
				args = [{ type: 'f', value: data.json.value }];
			} else if ("color" in data.json && typeof data.json.color === 'string') {
				args = [{ type: 'r', value: convertHexStringToRgba(data.json.color) }];
			}

			if (args.length > 0) {
				udp.send({
					address: `${data.name}`,
					args: args
				});
			}
		});

	}

	if (stageLinqOptions.services.includes(Services.BeatInfo)) {

		/**
		 * Resolution for triggering callback
		 *    0 = every message WARNING, it's a lot!
		 *    1 = every beat
		 *    4 = every 4 beats
		 *    .25 = every 1/4 beat
		 */
		const beatOptions = {
			everyNBeats: 1,
		}

		/**
		 *  User callback function.
		 *  Will be triggered everytime a player's beat counter crosses the resolution threshold
		 * @param {BeatData} bd
		 */
		function beatCallback(bd: BeatData,) {
			let deckBeatString = ""
			for (let i = 0; i < bd.deckCount; i++) {
				deckBeatString += `Deck: ${i + 1} Beat: ${bd.deck[i].beat.toFixed(3)}/${bd.deck[i].totalBeats.toFixed(0)} `

				// only send OS if we have a valid beat
				if (bd.deck[i].totalBeats > 0) {
					udp.send({
						address: `/Engine/Deck${i + 1}/Beat`,
						args: [ bd.deck[i].beat ]
					});
				}
			}
			console.log(`[BEATINFO] ${bd.deviceId.string} clock: ${bd.clock} ${deckBeatString}`);
		}

		////  callback is optional, BeatInfo messages can be consumed by:
		//      - user callback
		//      - event messages
		//      - reading the register
		const beatMethod = {
			useCallback: true,
			useEvent: false,
			useRegister: false,
		};

		BeatInfo.emitter.on('newDevice', async (beatInfo: BeatInfo) => {
			console.log(`[BEATINFO] New Device ${beatInfo.deviceId.string}`)

			if (beatMethod.useCallback) {
				beatInfo.startBeatInfo(beatOptions, beatCallback);
			}

			if (beatMethod.useEvent) {
				beatInfo.startBeatInfo(beatOptions);
				BeatInfo.emitter.on('beatMessage', (bd) => {

					if (bd) {
						beatCallback(bd);
					}
				});
			}

			if (beatMethod.useRegister) {
				beatInfo.startBeatInfo(beatOptions);

				function beatFunc(beatInfo: BeatInfo) {
					const beatData = beatInfo.getBeatData();
					if (beatData) beatCallback(beatData);
				}

				setTimeout(beatFunc, 4000, beatInfo)
			}

		})
	}


	/////////////////////////////////////////////////////////////////////////
	// CLI

	let returnCode = 0;
	try {
		process.on('SIGINT', async function () {
			console.info('... exiting');

			try {
				await StageLinq.disconnect();
			} catch (err: any) {
				const message = err.stack.toString();
				console.error(message);
			}
			process.exit(returnCode);
		});

		await StageLinq.connect();

		while (true) {
			await sleep(250);
		}

	} catch (err: any) {
		const message = err.stack.toString();
		console.error(message);
		returnCode = 1;
	}

	await StageLinq.disconnect();
	process.exit(returnCode);
}

main();

import assert from 'assert';
import { TextDecoder } from 'util';
import Packet from './structure/Packet';
import TCPSocket from './structure/TCPSocket';
import formatResultFE from './util/formatResultFE';
import resolveSRV, { SRVRecord } from './util/resolveSRV';
import { StatusResponse } from './model/StatusResponse';
import { StatusOptions } from './model/Options';

const ipAddressRegEx = /^\d{1,3}(\.\d{1,3}){3}$/;
const decoder = new TextDecoder('utf-16be');

function applyDefaultOptions(options?: StatusOptions): Required<StatusOptions> {
	// Apply the provided options on the default options
	return Object.assign({
		port: 25565,
		protocolVersion: 47,
		timeout: 1000 * 5,
		enableSRV: true
	} as Required<StatusOptions>, options);
}

/**
 * Retrieves the status of the server using the Beta 1.8 - 1.3.2 format.
 * @param {string} host The host of the server
 * @param {StatusOptions} [options] The options to use when retrieving the status
 * @returns {Promise<StatusResponse>} The status information of the server
 * @async
 */
export default async function statusFE(host: string, options?: StatusOptions): Promise<StatusResponse> {
	// Applies the provided options on top of the default options
	const opts = applyDefaultOptions(options);

	// Assert that the arguments are the correct type and format
	assert(typeof host === 'string', `Expected 'host' to be a string, got ${typeof host}`);
	assert(host.length > 0, 'Expected \'host\' to have content, got an empty string');
	assert(typeof options === 'object' || typeof options === 'undefined', `Expected 'options' to be an object or undefined, got ${typeof options}`);
	assert(typeof opts === 'object', `Expected 'options' to be an object, got ${typeof opts}`);
	assert(typeof opts.port === 'number', `Expected 'options.port' to be a number, got ${typeof opts.port}`);
	assert(opts.port > 0, `Expected 'options.port' to be greater than 0, got ${opts.port}`);
	assert(opts.port < 65536, `Expected 'options.port' to be less than 65536, got ${opts.port}`);
	assert(Number.isInteger(opts.port), `Expected 'options.port' to be an integer, got ${opts.port}`);
	assert(typeof opts.protocolVersion === 'number', `Expected 'options.protocolVersion' to be a number, got ${typeof opts.protocolVersion}`);
	assert(opts.protocolVersion >= 0, `Expected 'options.protocolVersion' to be greater than or equal to 0, got ${opts.protocolVersion}`);
	assert(Number.isInteger(opts.protocolVersion), `Expected 'options.protocolVersion' to be an integer, got ${opts.protocolVersion}`);
	assert(typeof opts.timeout === 'number', `Expected 'options.timeout' to be a number, got ${typeof opts.timeout}`);
	assert(opts.timeout > 0, `Expected 'options.timeout' to be greater than 0, got ${opts.timeout}`);
	assert(typeof opts.enableSRV === 'boolean', `Expected 'options.enableSRV' to be a boolean, got ${typeof opts.enableSRV}`);

	let srvRecord: SRVRecord | null = null;

	// Automatically resolve from host (e.g. play.hypixel.net) into a connect-able address
	if (opts.enableSRV && !ipAddressRegEx.test(host)) {
		srvRecord = await resolveSRV(host);
	}

	const startTime = Date.now();

	// Create a new TCP connection to the specified address
	const socket = await TCPSocket.connect(srvRecord?.host ?? host, srvRecord?.port ?? opts.port, opts.timeout);

	try {
		// Create the necessary packets and send them to the server
		// https://wiki.vg/Server_List_Ping#Beta_1.8_to_1.3
		const packet = new Packet();
		packet.writeByte(0xFE);
		socket.writePacket(packet, false);

		let motd = '';
		let playerCount = 0;
		let maxPlayers = 0;

		const packetType = await socket.readByte();

		// Packet was unexpected type, ignore the rest of the data in this packet
		if (packetType !== 0xFF) throw new Error('Packet returned from server was unexpected type');

		// Read the length of the data string
		const length = await socket.readShort();

		// Read all of the data string and convert to a UTF-8 string
		const data = decoder.decode(await socket.readBytes(length * 2));

		const [motdStr, playerCountStr, maxPlayersStr] = data.split('??');

		motd = motdStr;
		playerCount = parseInt(playerCountStr);
		maxPlayers = parseInt(maxPlayersStr);

		if (isNaN(playerCount)) throw new Error('Server returned an invalid player count: ' + playerCountStr);
		if (isNaN(maxPlayers)) throw new Error('Server returned an invalid max player count: ' + maxPlayersStr);

		// Convert the data from raw Minecraft status payload format into a more human readable format and resolve the promise
		return formatResultFE(host, opts.port, srvRecord, motd, playerCount, maxPlayers, Date.now() - startTime);
	} finally {
		// Destroy the socket, it is no longer needed
		await socket.destroy();
	}
}
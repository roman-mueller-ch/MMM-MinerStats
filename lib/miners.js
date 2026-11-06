const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

// Outside the MagicMirror folder on purpose: MagicMirror serves everything in
// /modules and /config over HTTP, so a file in either could be downloaded.
const MINERS_FILE = path.join(os.homedir(), ".config", "MMM-MinerStats", "miners.json");
const MINERS_FILE_LABEL = "~/.config/MMM-MinerStats/miners.json";
const REQUEST_TIMEOUT_MS = 5000;
const CGMINER_PORT = 4028;

const number = (value) => {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

// Parsing errors can quote the response, which may hold pool passwords, so they are never passed on.
function parseJson (text, message) {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(message);
	}
}

// AxeOS reports GH/s.
function parseBitaxe (text) {
	const data = parseJson(text, "unreadable response");
	return {
		hash: number(data.hashRate) / 1000,
		power: number(data.power),
		temp: typeof data.temp === "number" ? data.temp : null
	};
}

// The Nano's estats reply packs its readings into text like "GHSspd[6302.56] TAvg[90] PS[0 0 27177 4 0 3678 131]".
// GHSspd is in GH/s, and the last value of PS is the power in watts.
function parseAvalonNano (text) {
	const field = (name) => text.match(new RegExp(`\\b${name}\\[([^\\]]*)\\]`))?.[1];

	const speed = field("GHSspd");
	if (speed === undefined) throw new Error("unreadable response");

	const temp = Number.parseFloat(field("TAvg"));
	return {
		hash: number(speed) / 1000,
		power: number(field("PS")?.trim().split(/\s+/).at(-1)),
		temp: Number.isFinite(temp) ? temp : null
	};
}

async function readBitaxe ({ host }, timeoutMs) {
	const response = await fetch(`http://${host}/api/system/info`, { signal: AbortSignal.timeout(timeoutMs) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return parseBitaxe(await response.text());
}

// The CGMiner API takes one command per TCP connection and ends its reply with a null byte.
function askCgminer (host, port, command, timeoutMs) {
	return new Promise((resolve, reject) => {
		let reply = "";
		const socket = net.connect({ host, port }, () => socket.write(JSON.stringify({ command })));
		const timer = setTimeout(() => {
			const error = new Error("timeout");
			error.name = "TimeoutError";
			socket.destroy(error);
		}, timeoutMs);

		socket.setEncoding("utf8");
		socket.on("data", (chunk) => {
			reply += chunk;
			if (reply.includes("\0")) socket.destroy();
		});
		socket.on("error", reject);
		socket.on("close", () => {
			clearTimeout(timer);
			resolve(reply);
		});
	});
}

async function readAvalonNano ({ host, port = CGMINER_PORT }, timeoutMs) {
	return parseAvalonNano(await askCgminer(host, port, "estats", timeoutMs));
}

const MINER_TYPES = {
	"bitaxe": readBitaxe,
	"avalon-nano": readAvalonNano
};

async function loadMiners (file = MINERS_FILE) {
	let text;
	try {
		text = await fs.readFile(file, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") throw new Error(`Create ${MINERS_FILE_LABEL}, see the README`);
		throw new Error(`Cannot read ${MINERS_FILE_LABEL} (${error.code})`);
	}

	const { miners } = parseJson(text, `${MINERS_FILE_LABEL} is not valid JSON`);
	if (!Array.isArray(miners) || miners.length === 0) {
		throw new Error(`${MINERS_FILE_LABEL} needs a "miners" list`);
	}
	miners.forEach((miner, index) => {
		if (!miner.name || !miner.host || !MINER_TYPES[miner.type]) {
			throw new Error(`Miner ${index + 1} in ${MINERS_FILE_LABEL} needs a name, a host and a known type`);
		}
	});
	return miners;
}

function describeFailure (error) {
	if (error.name === "TimeoutError") return "timeout";
	return error.cause?.code || error.code || error.message;
}

async function pollMiner (miner, timeoutMs) {
	try {
		return { name: miner.name, online: true, ...await MINER_TYPES[miner.type](miner, timeoutMs) };
	} catch (error) {
		return { name: miner.name, online: false, problem: describeFailure(error) };
	}
}

// One slow or dead miner does not hold up the others.
function pollMiners (miners, timeoutMs = REQUEST_TIMEOUT_MS) {
	return Promise.all(miners.map((miner) => pollMiner(miner, timeoutMs)));
}

function summarize (results) {
	const online = results.filter((miner) => miner.online);
	const totalPower = online.reduce((sum, miner) => sum + miner.power, 0);
	return {
		miners: results,
		totalHash: online.reduce((sum, miner) => sum + miner.hash, 0),
		totalPower,
		kwhPerDay: (totalPower * 24) / 1000
	};
}

module.exports = { loadMiners, parseAvalonNano, parseBitaxe, pollMiners, summarize };

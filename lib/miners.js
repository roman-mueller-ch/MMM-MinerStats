const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

// Outside the MagicMirror folder on purpose: MagicMirror serves everything in
// /modules and /config over HTTP, so a file in either could be downloaded.
const MINERS_FILE = path.join(os.homedir(), ".config", "MMM-MinerStats", "miners.json");
const MINERS_FILE_LABEL = "~/.config/MMM-MinerStats/miners.json";
const REQUEST_TIMEOUT_MS = 5000;

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

// The Nano answers with JSONP that has trailing commas, or with its login page if the cookie is not accepted.
function parseAvalonNano (text) {
	if (!text.includes("dashboardCallback")) throw new Error("cookie rejected");

	const json = text
		.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
		.replace(/,\s*([}\]])/g, "$1");
	const data = parseJson(json, "unreadable response");
	return {
		hash: number(data.realtime_hash),
		power: number(data.power),
		temp: null
	};
}

const MINER_TYPES = {
	"bitaxe": {
		url: (host) => `http://${host}/api/system/info`,
		parse: parseBitaxe
	},
	"avalon-nano": {
		url: (host) => `http://${host}/get_dashboard.cgi?num=${Math.random()}`,
		parse: parseAvalonNano
	}
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
	return error.cause?.code || error.message;
}

async function pollMiner (miner, timeoutMs) {
	const { url, parse } = MINER_TYPES[miner.type];
	try {
		const response = await fetch(url(miner.host), {
			signal: AbortSignal.timeout(timeoutMs),
			headers: miner.cookie ? { Cookie: miner.cookie } : {}
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return { name: miner.name, online: true, ...parse(await response.text()) };
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

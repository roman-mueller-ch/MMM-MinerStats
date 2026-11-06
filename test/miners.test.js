const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");
const { loadMiners, parseAvalonNano, parseAvalonSummary, parseBitaxe, pollMiners, summarize } = require("../lib/miners");

const SECRET = "not-a-real-secret";
const NANO_REPLY = `{"STATS":[{"STATS":0,"ID":"AVA100","MM ID0":"Ver[${SECRET}] GHSspd[6300.00] GHSavg[6350.00] TAvg[80] MTavg[85] PS[0 0 27000 4 0 3600 131]"}]}`;
const NANO_SUMMARY = '{"SUMMARY":[{"Best Share":2000000000,"Found Blocks":1}]}';

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

describe("parsers", () => {
	it("converts a Bitaxe hash rate from GH/s to TH/s", () => {
		assert.deepEqual(
			parseBitaxe('{"hashRate":1500,"power":25.5,"temp":65,"bestDiff":5000000,"blockFound":2}'),
			{ hash: 1.5, power: 25.5, temp: 65, bestDiff: 5000000, blocks: 2 }
		);
	});

	it("reads a best difficulty written as text by older AxeOS", () => {
		assert.equal(parseBitaxe('{"bestDiff":"4.5G"}').bestDiff, 4500000000);
		assert.equal(parseBitaxe('{"bestDiff":"750"}').bestDiff, 750);
		assert.equal(parseBitaxe("{}").bestDiff, 0);
	});

	it("reads the Nano's best share and blocks found", () => {
		assert.deepEqual(parseAvalonSummary(NANO_SUMMARY), { bestDiff: 2000000000, blocks: 1 });
		assert.deepEqual(parseAvalonSummary('{"STATUS":[]}'), { bestDiff: 0, blocks: 0 });
	});

	it("reads the Nano's estats text", () => {
		assert.deepEqual(parseAvalonNano(NANO_REPLY), { hash: 6.3, power: 131, temp: 80 });
	});

	it("keeps the hash rate when the Nano leaves out power and temperature", () => {
		assert.deepEqual(parseAvalonNano("GHSspd[6300.00]"), { hash: 6.3, power: 0, temp: null });
	});

	it("rejects a Nano reply without a hash rate", () => {
		assert.throws(() => parseAvalonNano('{"STATUS":[]}'), /unreadable response/);
		assert.throws(() => parseAvalonNano(""), /unreadable response/);
	});

	it("does not quote the response when it cannot be parsed", () => {
		assert.throws(() => parseBitaxe(`{"stratumUser":"${SECRET}"`), (error) => !error.message.includes(SECRET));
	});
});

describe("pollMiners", () => {
	let server;
	let nanoServer;
	let hangingNanoServer;
	let host;
	let nanoPort;
	let hangingNanoPort;
	const commandsSeen = [];

	before(async () => {
		server = http.createServer((request, response) => {
			if (request.url === "/api/system/info") {
				response.end(`{"hashRate":1000,"power":20,"temp":60,"bestDiff":5000000,"blockFound":0,"stratumUser":"${SECRET}","ssid":"${SECRET}"}`);
			}
			// Any other path never answers, which is how the timeout is tested.
		});
		host = `127.0.0.1:${await listen(server)}`;

		// Keeps the connection open after replying, so the null byte has to end the read.
		nanoServer = net.createServer((socket) => {
			socket.on("error", () => {});
			socket.once("data", (data) => {
				const { command } = JSON.parse(data.toString());
				commandsSeen.push(command);
				socket.write(`${command === "summary" ? NANO_SUMMARY : NANO_REPLY}\0`);
			});
		});
		nanoPort = await listen(nanoServer);

		hangingNanoServer = net.createServer((socket) => socket.on("error", () => {}));
		hangingNanoPort = await listen(hangingNanoServer);
	});

	after(() => {
		server.closeAllConnections();
		server.close();
		nanoServer.close();
		hangingNanoServer.close();
	});

	it("asks the Nano with read commands and passes on only the readings", async () => {
		const results = await pollMiners([
			{ name: "A", type: "bitaxe", host },
			{ name: "B", type: "avalon-nano", host: "127.0.0.1", port: nanoPort }
		]);
		assert.deepEqual(commandsSeen, ["estats", "summary"]);
		assert.deepEqual(results, [
			{ name: "A", online: true, hash: 1, power: 20, temp: 60, bestDiff: 5000000, blocks: 0 },
			{ name: "B", online: true, hash: 6.3, power: 131, temp: 80, bestDiff: 2000000000, blocks: 1 }
		]);
		assert.ok(!JSON.stringify(results).includes(SECRET));
	});

	it("gives up on a Nano that never replies", async () => {
		const [result] = await pollMiners([{ name: "Hanging", type: "avalon-nano", host: "127.0.0.1", port: hangingNanoPort }], 100);
		assert.deepEqual(result, { name: "Hanging", online: false, problem: "timeout" });
	});

	it("gives up on a miner that hangs, while the others still answer", async () => {
		const results = await pollMiners([
			{ name: "Hanging", type: "bitaxe", host: `${host}/hang?` },
			{ name: "Fine", type: "bitaxe", host }
		], 100);
		assert.deepEqual(results[0], { name: "Hanging", online: false, problem: "timeout" });
		assert.equal(results[1].online, true);
	});

	it("marks an unreachable miner offline", async () => {
		const closed = http.createServer();
		const port = await listen(closed);
		await new Promise((resolve) => closed.close(resolve));

		const results = await pollMiners([
			{ name: "Gone", type: "bitaxe", host: `127.0.0.1:${port}` },
			{ name: "Gone too", type: "avalon-nano", host: "127.0.0.1", port }
		]);
		assert.deepEqual(results.map((miner) => miner.problem), ["ECONNREFUSED", "ECONNREFUSED"]);
	});
});

describe("summarize", () => {
	it("adds up only the miners that are online", () => {
		const summary = summarize([
			{ name: "A", online: true, hash: 1.5, power: 25, temp: 60, bestDiff: 900, blocks: 1 },
			{ name: "B", online: false, problem: "timeout" },
			{ name: "C", online: true, hash: 6.5, power: 75, temp: null, bestDiff: 100, blocks: 2 }
		]);
		assert.equal(summary.bestDiff, 900);
		assert.equal(summary.blocks, 3);
		assert.equal(summary.totalHash, 8);
		assert.equal(summary.totalPower, 100);
		assert.equal(summary.kwhPerDay, 2.4);
		assert.equal(summary.miners.length, 3);
	});
});

describe("loadMiners", () => {
	let directory;
	const write = async (text) => {
		const file = path.join(directory, "miners.json");
		await fs.writeFile(file, text);
		return file;
	};

	before(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "minerstats-"));
	});

	after(() => fs.rm(directory, { recursive: true }));

	it("reads the example file", async () => {
		const miners = await loadMiners(path.join(__dirname, "..", "miners.example.json"));
		assert.deepEqual(miners.map((miner) => miner.type), ["bitaxe", "avalon-nano"]);
	});

	it("explains what to do when the file is missing", async () => {
		await assert.rejects(loadMiners(path.join(directory, "missing.json")), /Create .*miners\.json/);
	});

	it("does not quote the file when it is not valid JSON", async () => {
		const file = await write(`{"miners":[{"host":"${SECRET}"`);
		await assert.rejects(loadMiners(file), (error) => /not valid JSON/.test(error.message) && !error.message.includes(SECRET));
	});

	it("rejects an unknown miner type", async () => {
		const file = await write('{"miners":[{"name":"A","type":"antminer","host":"x"}]}');
		await assert.rejects(loadMiners(file), /Miner 1 .* known type/);
	});
});

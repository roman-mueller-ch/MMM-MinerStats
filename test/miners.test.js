const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");
const { loadMiners, parseAvalonNano, parseBitaxe, pollMiners, summarize } = require("../lib/miners");

const SECRET = "not-a-real-secret";
const NANO_BODY = `dashboardCallback({"hwtype":"Avalon Nano3s", "realtime_hash":"6.30", "power":"131",
	"passwd1":"${SECRET}", "worker1":"${SECRET}", "list":[1,2,],});`;

describe("parsers", () => {
	it("converts a Bitaxe hash rate from GH/s to TH/s", () => {
		assert.deepEqual(parseBitaxe('{"hashRate":1500,"power":25.5,"temp":65}'), { hash: 1.5, power: 25.5, temp: 65 });
	});

	it("reads the Nano's JSONP with trailing commas", () => {
		assert.deepEqual(parseAvalonNano(NANO_BODY), { hash: 6.3, power: 131, temp: null });
	});

	it("reports a login page as a rejected cookie", () => {
		assert.throws(() => parseAvalonNano("<html>login</html>"), /cookie rejected/);
	});

	it("does not quote the response when it cannot be parsed", () => {
		assert.throws(() => parseBitaxe(`{"stratumUser":"${SECRET}"`), (error) => !error.message.includes(SECRET));
	});
});

describe("pollMiners", () => {
	let server;
	let host;
	let cookieSeen;

	before(async () => {
		server = http.createServer((request, response) => {
			if (request.url.startsWith("/get_dashboard.cgi")) {
				cookieSeen = request.headers.cookie;
				response.end(NANO_BODY);
			} else if (request.url === "/api/system/info") {
				response.end(`{"hashRate":1000,"power":20,"temp":60,"stratumUser":"${SECRET}","ssid":"${SECRET}"}`);
			}
			// Any other path never answers, which is how the timeout is tested.
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		host = `127.0.0.1:${server.address().port}`;
	});

	after(() => {
		server.closeAllConnections();
		server.close();
	});

	it("sends the cookie and passes on only the readings", async () => {
		const results = await pollMiners([
			{ name: "A", type: "bitaxe", host },
			{ name: "B", type: "avalon-nano", host, cookie: "auth=abc" }
		]);
		assert.equal(cookieSeen, "auth=abc");
		assert.deepEqual(results, [
			{ name: "A", online: true, hash: 1, power: 20, temp: 60 },
			{ name: "B", online: true, hash: 6.3, power: 131, temp: null }
		]);
		assert.ok(!JSON.stringify(results).includes(SECRET));
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
		await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
		const { port } = closed.address();
		await new Promise((resolve) => closed.close(resolve));

		const [result] = await pollMiners([{ name: "Gone", type: "bitaxe", host: `127.0.0.1:${port}` }]);
		assert.equal(result.online, false);
		assert.equal(result.problem, "ECONNREFUSED");
	});
});

describe("summarize", () => {
	it("adds up only the miners that are online", () => {
		const summary = summarize([
			{ name: "A", online: true, hash: 1.5, power: 25, temp: 60 },
			{ name: "B", online: false, problem: "timeout" },
			{ name: "C", online: true, hash: 6.5, power: 75, temp: null }
		]);
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
		const file = await write(`{"miners":[{"cookie":"${SECRET}"`);
		await assert.rejects(loadMiners(file), (error) => /not valid JSON/.test(error.message) && !error.message.includes(SECRET));
	});

	it("rejects an unknown miner type", async () => {
		const file = await write('{"miners":[{"name":"A","type":"antminer","host":"x"}]}');
		await assert.rejects(loadMiners(file), /Miner 1 .* known type/);
	});
});

const NodeHelper = require("node_helper");
const { loadMiners, pollMiners, summarize } = require("./lib/miners");

module.exports = NodeHelper.create({
	start () {
		this.polling = false;
		this.lastStatus = new Map();
	},

	socketNotificationReceived (notification) {
		if (notification === "MINERSTATS_FETCH") this.update();
	},

	// Every open browser asks on its own timer, so requests that overlap share one poll.
	async update () {
		if (this.polling) return;
		this.polling = true;
		try {
			const results = await pollMiners(await loadMiners());
			this.logChanges(results);
			this.sendSocketNotification("MINERSTATS_DATA", { ok: true, ...summarize(results) });
		} catch (error) {
			console.error(`MMM-MinerStats: ${error.message}`);
			this.sendSocketNotification("MINERSTATS_DATA", { ok: false, error: error.message });
		} finally {
			this.polling = false;
		}
	},

	// Logs when a miner goes down or comes back, not on every poll.
	logChanges (results) {
		for (const { name, online, problem } of results) {
			const status = online ? "online" : `offline (${problem})`;
			const previous = this.lastStatus.get(name);
			if (status === previous) continue;
			if (!online) console.error(`MMM-MinerStats: ${name} is ${status}`);
			else if (previous) console.log(`MMM-MinerStats: ${name} is back online`);
			this.lastStatus.set(name, status);
		}
	}
});

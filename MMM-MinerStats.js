Module.register("MMM-MinerStats", {
	defaults: {
		updateInterval: 30 * 1000,
		title: "MINERS",
		showTemperature: false,
		showEnergy: true,
		showSolo: true
	},

	getStyles () {
		return ["MMM-MinerStats.css"];
	},

	start () {
		this.stats = null;
		this.fetchStats();
		setInterval(() => this.fetchStats(), Math.max(this.config.updateInterval, 5000));
	},

	fetchStats () {
		this.sendSocketNotification("MINERSTATS_FETCH");
	},

	socketNotificationReceived (notification, payload) {
		if (notification === "MINERSTATS_DATA") {
			this.stats = payload;
			this.updateDom();
		}
	},

	getDom () {
		const wrapper = document.createElement("div");
		wrapper.className = "small minerstats";

		if (!this.stats) {
			wrapper.textContent = this.translate("LOADING");
			return wrapper;
		}

		wrapper.append(this.heading("fa-brands fa-bitcoin", this.config.title));

		if (!this.stats.ok) {
			const problem = this.element("div", "minerstats-problem");
			problem.append(this.icon("fa-solid fa-triangle-exclamation"), ` ${this.stats.error}`);
			wrapper.append(problem);
			return wrapper;
		}

		const table = this.element("table", "minerstats-miners");
		for (const miner of this.stats.miners) table.append(this.minerRow(miner));
		wrapper.append(table);

		wrapper.append(this.heading("fa-solid fa-fire", "TOTAL"));
		wrapper.append(this.element("div", "", `${this.stats.totalHash.toFixed(2)} TH/s · ${this.stats.totalPower.toFixed(1)} W`));

		if (this.config.showEnergy) {
			const energy = this.element("div", "minerstats-energy");
			energy.append(this.icon("fa-solid fa-plug"), ` Energy: ${this.stats.kwhPerDay.toFixed(2)} kWh / day`);
			wrapper.append(energy);
		}

		if (this.config.showSolo) {
			const heading = this.heading("fa-solid fa-trophy", "SOLO");
			heading.classList.add("minerstats-solo");
			wrapper.append(heading);
			wrapper.append(this.element("div", "", `Best diff ${this.formatDifficulty(this.stats.bestDiff)} · Blocks found ${this.stats.blocks}`));
		}

		return wrapper;
	},

	formatDifficulty (value) {
		const units = [[1e15, "P"], [1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"]];
		const unit = units.find(([size]) => value >= size);
		return unit ? `${(value / unit[0]).toFixed(2)} ${unit[1]}` : String(value);
	},

	minerRow (miner) {
		const row = document.createElement("tr");
		const cell = (icon, text) => {
			const td = document.createElement("td");
			td.append(this.icon(icon), ` ${text}`);
			row.append(td);
		};

		if (!miner.online) {
			row.className = "minerstats-offline";
			cell("fa-solid fa-triangle-exclamation", miner.name);
			const status = this.element("td", "", "OFFLINE");
			status.colSpan = this.config.showTemperature ? 3 : 2;
			row.append(status);
			return row;
		}

		cell("fa-solid fa-hammer", miner.name);
		cell("fa-solid fa-wind", `${miner.hash.toFixed(2)} TH/s`);
		cell("fa-solid fa-bolt", `${miner.power.toFixed(1)} W`);
		if (this.config.showTemperature) {
			cell("fa-solid fa-temperature-half", miner.temp === null ? "–" : `${miner.temp.toFixed(0)} °C`);
		}
		return row;
	},

	heading (icon, text) {
		const heading = this.element("div", "minerstats-heading");
		const label = document.createElement("strong");
		label.append(this.icon(icon), ` ${text}`);
		heading.append(label);
		return heading;
	},

	icon (className) {
		return this.element("i", className);
	},

	element (tag, className, text) {
		const element = document.createElement(tag);
		if (className) element.className = className;
		if (text !== undefined) element.textContent = text;
		return element;
	}
});

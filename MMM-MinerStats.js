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
		table.append(this.totalHeadingRow(), this.totalRow());
		wrapper.append(table);

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

		if (!miner.online) {
			row.className = "minerstats-offline";
			row.append(this.iconCell("fa-solid fa-triangle-exclamation", miner.name));
			const status = this.element("td", "", "OFFLINE");
			status.colSpan = this.config.showTemperature ? 3 : 2;
			row.append(status);
			return row;
		}

		row.append(
			this.iconCell("fa-solid fa-hammer", miner.name),
			this.iconCell("fa-solid fa-wind", `${miner.hash.toFixed(2)} TH/s`),
			this.iconCell("fa-solid fa-bolt", `${miner.power.toFixed(1)} W`)
		);
		if (this.config.showTemperature) {
			row.append(this.iconCell("fa-solid fa-temperature-half", miner.temp === null ? "–" : `${miner.temp.toFixed(0)} °C`));
		}
		return row;
	},

	totalHeadingRow () {
		const row = this.element("tr", "minerstats-total-heading");
		const cell = document.createElement("td");
		cell.colSpan = this.config.showTemperature ? 4 : 3;
		cell.append(this.heading("fa-solid fa-fire", "TOTAL"));
		row.append(cell);
		return row;
	},

	totalRow () {
		const row = document.createElement("tr");
		row.append(
			document.createElement("td"),
			this.iconCell("fa-solid fa-wind", `${this.stats.totalHash.toFixed(2)} TH/s`),
			this.iconCell("fa-solid fa-bolt", `${this.stats.totalPower.toFixed(1)} W`)
		);
		if (this.config.showTemperature) row.append(document.createElement("td"));
		return row;
	},

	iconCell (icon, text) {
		const cell = document.createElement("td");
		cell.append(this.icon(icon), ` ${text}`);
		return cell;
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

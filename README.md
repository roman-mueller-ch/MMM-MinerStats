# MMM-MinerStats

Shows the hash rate and power of your home miners on [MagicMirror²](https://magicmirror.builders/), with totals and the energy they use per day. A miner that stops answering turns red.

![The module with made-up readings and one miner offline](docs/demo.png)

Works with any mix of:

- **Bitaxe** and other miners running AxeOS (`bitaxe`)
- **Avalon Nano 3S** (`avalon-nano`)

## Install

It has no dependencies, so there is nothing to `npm install`. It needs Node 18 or newer.

```sh
cd ~/MagicMirror/modules
git clone https://github.com/roman-mueller-ch/MMM-MinerStats
```

### 1. List your miners

Your miners go in a private file outside the MagicMirror folder:

```sh
mkdir -p ~/.config/MMM-MinerStats
cp ~/MagicMirror/modules/MMM-MinerStats/miners.example.json ~/.config/MMM-MinerStats/miners.json
chmod 600 ~/.config/MMM-MinerStats/miners.json
```

Then edit it. The module rereads it on every update, so changes need no restart.

```json
{
	"miners": [
		{ "name": "Bitaxe", "type": "bitaxe", "host": "192.168.1.50" },
		{ "name": "Nano 3S", "type": "avalon-nano", "host": "192.168.1.51", "cookie": "auth=YOUR_COOKIE_VALUE" }
	]
}
```

| Field | What it is |
| --- | --- |
| `name` | The label on the mirror. |
| `type` | `bitaxe` or `avalon-nano`. |
| `host` | The miner's IP address or hostname. |
| `cookie` | Avalon Nano only: its login cookie. |

**Finding the Nano's cookie:** log in to the Nano's web page, open your browser's developer tools and find the `auth` cookie under the site's storage. Write it as `auth=` followed by its value. If the mirror shows `COOKIE REJECTED`, log in again and copy the new value.

### 2. Add the module

Add it to `config/config.js`:

```js
{
	module: "MMM-MinerStats",
	position: "bottom_right",
	config: {
		updateInterval: 30000
	}
}
```

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `updateInterval` | `30000` | Milliseconds between updates, at least 5000. |
| `title` | `"MINERS"` | The heading above the list. |
| `showTemperature` | `false` | Adds a temperature column. Bitaxe only, the Nano shows a dash. |
| `showEnergy` | `true` | Shows the energy line. |

The energy line assumes today's power draw continues for 24 hours, so it is an estimate.

## Privacy

**Keep your miner details out of `config/config.js` and the module's folder.** MagicMirror serves both `/config` and `/modules` over HTTP, so anyone who can reach your mirror could download files from them. That is why this module reads `~/.config/MMM-MinerStats/miners.json`.

Only the module's Node helper reads that file. The browser gets each miner's name and readings, and never its address, cookie, wallet or pool details.

Requests to miners use plain HTTP because that is all they offer, so the cookie is readable to others on your network while it travels. Keep your miners on a network you trust.

## Tests

```sh
npm test
```

To redraw `docs/demo.png` with made-up readings, run `tools/screenshot.sh`. It needs Chromium, or set `CHROME` to your browser's path, and it loads the icon font from a CDN.

# Plugin Auto-Update

This repo supports both Claude Code and Codex users. The two clients update plugins
differently, so keep the setup explicit.

## Claude Code

Claude Code supports marketplace auto-update for GitHub marketplaces. Add Codepresso
as a GitHub marketplace and enable auto-update:

```json
{
  "extraKnownMarketplaces": {
    "codepresso": {
      "source": {
        "source": "github",
        "repo": "code-presso/codepresso-ai-plugin"
      },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "codepresso@codepresso": true
  }
}
```

User-level location: `~/.claude/settings.json`.

Project-level location, when a repository should suggest the same marketplace to
all collaborators: `.claude/settings.json`.

Manual commands:

```bash
claude plugin marketplace add code-presso/codepresso-ai-plugin
claude plugin install codepresso@codepresso
```

When Claude updates the plugin, run `/reload-plugins` if prompted.

## Codex

Codex currently installs this repo through a personal local marketplace because
the repository root is the plugin directory.

Install:

```bash
mkdir -p ~/plugins ~/.agents/plugins
git clone https://github.com/code-presso/codepresso-ai-plugin.git ~/plugins/codepresso
cd ~/plugins/codepresso
npm install
codex plugin add codepresso@personal
```

Keep `~/.agents/plugins/marketplace.json` pointed at the local clone:

```json
{
  "name": "personal",
  "interface": {
    "displayName": "Personal"
  },
  "plugins": [
    {
      "name": "codepresso",
      "source": {
        "source": "local",
        "path": "./plugins/codepresso"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

Auto-update via cron:

```cron
*/30 * * * * git -C "$HOME/plugins/codepresso" pull --ff-only && npm --prefix "$HOME/plugins/codepresso" install >/tmp/codepresso-codex-update.log 2>&1 && codex plugin add codepresso@personal >>/tmp/codepresso-codex-update.log 2>&1
```

Or run the same refresh manually:

```bash
git -C ~/plugins/codepresso pull --ff-only
npm --prefix ~/plugins/codepresso install
codex plugin add codepresso@personal
```

Open a new Codex thread after an update so new skills, commands, and MCP servers
are loaded.

# Anti Slop

A local dashboard for your AI coding tools. One prompt goes in, a small team of models and CLI agents splits the work and ships it into a folder you choose.

Anti Slop does not ship a model and does not proxy your traffic through anyone. You bring the keys, you say who is on duty, and everything runs on your machine.

![The Anti Slop dashboard](assets/brand/social.svg)

## The folder rule

Anti Slop lives in exactly one place:

```
~/Library/Application Support/Anti-Slop-WEHNIT_STUDIOS
```

If that folder is not there, Anti Slop is not installed on this Mac. Everything it knows — providers, models, runs, the ledger of what each model did — is in that folder. Delete it and the tool is gone, with nothing left behind anywhere else.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/wehnnit/anti-slop/main/install.sh | sh
```

The installer checks for Node 22.4 or newer, puts the app in the folder above, builds it, and adds a launcher to your `PATH`.

Then:

```sh
antiSL
```

Your browser opens on the dashboard. `antiSL` is the whole interface; there is no menu bar app, no background daemon, and no account.

## Set up your team

Three steps, each one screen.

**1. Add a provider.** A base URL, a flavour (OpenAI-compatible or Anthropic), and a key. Any endpoint that speaks either dialect works: OpenAI, Anthropic, OpenRouter, Groq, Together, a local llama.cpp server, an Ollama proxy, your own gateway. Anti Slop never fetches a model list, because the list is always wrong at the edges — you type the model ids you actually use.

**2. Authorize models.** Every model you add is a row you created, with an id you typed. Nothing is enabled by default.

**3. Put people on duty.** An assignment is a named teammate with a role — planner, builder, reviewer, or any — pointed at one model or one CLI. Give them names you will recognise in the run log. That roster is the only thing that can execute work.

The same screen detects CLI agents already on your machine: Codex, Claude Code, OpenCode, Hermes, Cursor. Authorizing one is a checkbox. A CLI runs as a subprocess in your workspace with the prompt as its argument; it uses whatever credentials it already has, and Anti Slop never reads them.

## Running a job

Write the brief, pick a folder, press start.

The planner reads your roster and splits the brief into between one and eight tasks with explicit dependencies. Tasks run in dependency order, in parallel where nothing blocks, each one handed to a teammate whose role fits. If planning fails, a fixed three-step plan is used instead, so a run never dies because one model had a bad day.

While it runs you get the plan, each task's status, and the output streaming in as it arrives. At the end a reviewer writes one summary of what the team delivered. Every run is a folder of events on disk, so you can reopen it later and read exactly what happened.

If the dashboard closes mid-run, the next launch marks the interrupted run as failed rather than leaving it hanging.

## What it will not do

- No telemetry, no analytics, no update checks, no remote logging.
- No model list fetching, no capability guessing, no hidden defaults about what a model can do.
- No cloud component. The server binds to `127.0.0.1` and checks the `Origin` header on every write.
- No shell interpolation of prompts. A CLI gets argv, never a shell string.

Your keys sit in `secrets.json` in the support folder with mode `0600`. They are never returned by the API — the dashboard only ever learns whether a key exists, never its value.

## Commands

```sh
antiSL                 # start the dashboard
antiSL --port 4400     # use a different port
antiSL --no-open       # do not open a browser
antiSL doctor          # check the install, Node version, and folder
antiSL where           # print the support folder path
antiSL runs            # list recent runs
antiSL uninstall       # remove the launcher
```

## Development

```sh
npm install
npm run dev      # rebuild on change, server with reload
npm run build    # typecheck, compile, bundle
npm test         # unit and integration tests
```

The server is `node:http` with no runtime dependencies. The dashboard is plain TypeScript and CSS bundled by esbuild, with no framework and no CSS build step. The test suite drives the real HTTP surface and the real engine against a stub endpoint.

Layout:

```
src/store      the support folder: JSON collections, runs, secrets
src/server     HTTP, routing, SSE, static assets
src/providers  OpenAI and Anthropic streaming adapters
src/harnesses  CLI detection and subprocess execution
src/engine     planner, scheduler, task execution, run ledger
web/           dashboard source, styles, and shell
```

## Licence

MIT. Copyright (c) 2026 WEHNIT STUDIOS.

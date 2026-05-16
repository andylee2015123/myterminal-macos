# MyTerminal

MyTerminal is a macOS desktop terminal app built with Electron, React, TypeScript, xterm.js, and node-pty.

It manages local folder connections and remote SSH connections, then opens each session in a tabbed terminal UI.

## Package for macOS

Prerequisite: install Node.js with npm.

Install dependencies once on the build machine:

```sh
npm install
```

Create the macOS ZIP package:

```sh
npm run package:mac
```

Create a DMG on a regular macOS terminal:

```sh
npm run dmg:mac
```

Create only an unpacked `.app` for quick local testing:

```sh
npm run pack:mac
```

Short alias:

```sh
npm run app
```

The packaging script does the following:

- Generates the macOS icon from `assets/app-icon.png`
- Runs the TypeScript and Electron/Vite production build
- Keeps native dependencies such as `node-pty` outside the app ASAR archive
- Creates a macOS `.zip` package

The generated files are written to:

```text
release/
```

Main output:

```text
release/MyTerminal-0.1.0-<arch>.zip
```

Quick local test app:

```text
release/mac-<arch>/MyTerminal.app
```

For normal use, unzip the package and move `MyTerminal.app` into Applications.

Verified on this project:

```text
release/MyTerminal-0.1.0-arm64.zip
release/mac-arm64/MyTerminal.app
```

## Development Run

For development only:

```sh
npm run dev
```

End users should not need `npm run dev`; they should use the packaged app instead.

The default package config uses the `node-pty` macOS prebuild and skips Electron's automatic native rebuild. If a native dependency ever needs to be rebuilt manually, run:

```sh
npm run rebuild:native
```

## Notes

- Local connections default to `zsh`.
- SSH connections use the system `ssh` command.
- This project is not code-signed or notarized yet. For public distribution, add Apple Developer signing and notarization before release.

## License

This project is licensed under the MIT License.

Third-party dependencies such as Electron, React, xterm.js, and node-pty remain governed by their own licenses.

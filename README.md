# MyTerminal

MyTerminal is a Windows desktop terminal app built with Electron, React, TypeScript, xterm.js, and node-pty.

It manages local folder connections and remote SSH connections, then opens each session in a tabbed terminal UI.

## Package as a Windows EXE

Install dependencies once on the build machine:

```powershell
npm install
```

Create the Windows installer:

```powershell
npm run package:win
```

Short alias:

```powershell
npm run exe
```

The packaging script does the following:

- Generates the Windows icon from `assets/app-icon.png`
- Runs the TypeScript and Electron/Vite production build
- Rebuilds native dependencies such as `node-pty` for Electron
- Creates a Windows NSIS installer

The generated files are written to:

```text
release/
```

Main output:

```text
release/MyTerminal-0.1.0-Setup.exe
```

Quick local test executable:

```text
release/win-unpacked/MyTerminal.exe
```

For normal use, install with `MyTerminal-0.1.0-Setup.exe`. Use `win-unpacked/MyTerminal.exe` only for quick local testing, and keep the whole `win-unpacked` folder intact.

## Run the Packaged App on Windows

1. Double-click `release/MyTerminal-0.1.0-Setup.exe`.
2. Choose the install location when prompted.
3. Finish the installer.
4. Launch MyTerminal from the desktop shortcut or the Start Menu shortcut.

The installer is configured to create:

- Desktop shortcut
- Start Menu shortcut
- Installed app executable with the MyTerminal icon

Because this project is not code-signed yet, Windows SmartScreen may show a warning. For public distribution, add code signing before release.

## Development Run

For development only:

```powershell
npm run dev
```

End users should not need `npm run dev`; they should use the packaged installer instead.

## License

No open-source license has been selected for this project yet.

Until a `LICENSE` file is added and a `license` field is set in `package.json`, treat this project as proprietary / all rights reserved. Do not redistribute or reuse the source code outside the project owner's permission.

Third-party dependencies such as Electron, React, xterm.js, and node-pty remain governed by their own licenses.

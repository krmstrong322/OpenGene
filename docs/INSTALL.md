# Installing OpenGene

A short, non-technical guide. You don't need Python, Node, or any developer
tools — just download one file and open it.

Your plasmids are saved automatically on your own computer and stay there when
you close the app.

---

## macOS

1. Download the right file for your Mac. Not sure which? Click the Apple menu
   (the Apple logo, top-left of the screen) → **About This Mac**:
   - **Chip: Apple M1 / M2 / M3…** → download **`OpenGene-x.y.z-arm64.dmg`**
   - **Processor: Intel…** → download **`OpenGene-x.y.z-x64.dmg`**
2. Double-click it, then drag **OpenGene** into your **Applications** folder.
3. Open **Applications** and double-click **OpenGene**.

**First time only — if you see "OpenGene can't be opened because Apple cannot
check it for malicious software":**

> This appears because the app isn't signed yet. It's safe to open — you just
> have to tell macOS once.

- **Right-click** (or Control-click) the **OpenGene** icon → choose **Open** →
  click **Open** again in the dialog.
- After you do this once, it opens normally every time.

*(If right-click → Open doesn't offer an Open button: open **System Settings →
Privacy & Security**, scroll down, and click **Open Anyway** next to the
OpenGene message.)*

---

## Windows

1. Download **`OpenGene Setup x.y.z.exe`**.
2. Double-click it and follow the installer. OpenGene opens when it finishes and
   adds a Start Menu / desktop shortcut.

**First time only — if you see a blue "Windows protected your PC" box:**

> This appears because the app isn't signed yet. It's safe to run.

- Click **More info**, then **Run anyway**.
- You won't see this again after installing.

---

## Using it

- The app opens its own window. Click **Load the demo** to see an example plasmid,
  or **Import…** to open your own `.gb`, `.fasta`, `.embl`, or `.dna` file.
- **Export GenBank / FASTA** saves a file you can open in other software.
- Everything you do is saved on this computer automatically. There's no account
  and nothing is uploaded — it all runs locally.

## Updating

Download the newer installer and open it the same way. Your saved plasmids are
kept.

## Something not working?

- **"The backend stopped unexpectedly"** — fully quit OpenGene and open it
  again. If it persists, reinstall using the latest installer.
- Your data lives in `~/Library/Application Support/OpenGene` (macOS) or
  `%APPDATA%\OpenGene` (Windows) if you ever need to back it up.

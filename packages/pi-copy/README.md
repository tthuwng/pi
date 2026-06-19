# pi-copy

Pi extension for remote SSH image paste.

`pi-copy` runs a local bridge command inside the machine running Pi,
expects that command to print a remote image path, and pastes that path into
the editor. When `pi-paster` is loaded, the bracketed paste is converted into a
first-class image placeholder like `[#image 1]`.

This is not a fork of `pi-paster`. It only supplies the transport step that
remote Linux Pi sessions cannot do by reading the Mac clipboard directly.

## Recommended setup

Install and configure a clipboard bridge on the Mac, for example `clipaste`:

```bash
brew install hqhq1025/clipaste/clipaste
brew services start clipaste
clipaste ssh-setup ec2-user@YOUR-HOST
```

Open a new SSH session so the bridge forwarding/shims apply, then verify on the
remote host:

```bash
clipaste-paste
```

Expected output is a path to an image file on the remote host, for example:

```text
/tmp/clipaste-abc123.png
```

## Pi package order

Load `pi-paster` first and `pi-copy` after it:

```json
{
  "packages": [
    "npm:pi-paster",
    "packages/pi-copy"
  ]
}
```

With that order, `pi-copy` wraps `pi-paster`'s image-paste handler:

1. `Ctrl+V` triggers Pi's `app.clipboard.pasteImage` keybinding.
2. `pi-copy` runs the bridge command.
3. If the command prints an accessible image path, `pi-copy` bracket-pastes
   that path.
4. `pi-paster` converts the path into `[#image N]` and attaches bytes on submit.
5. If the bridge fails, `pi-copy` falls back to the previous Pi/`pi-paster`
   paste handler.

## Configuration

Defaults:

| Setting | Default |
| --- | --- |
| command | `clipaste-paste` |
| timeout | `5000` ms |
| failure notifications | enabled |

Environment variables:

```bash
PI_COPY_COMMAND=clipaste-paste
PI_COPY_TIMEOUT_MS=5000
PI_COPY_NOTIFY_FAILURE=true
```

`PI_PASTER_CLIPBOARD_COMMAND` is also accepted as a command fallback for
compatibility with older local experiments.

Programmatic config:

```ts
import { createPiCopy } from "pi-copy";

export default createPiCopy({
  command: ["clipaste-paste"],
  timeoutMs: 5000,
  notifyOnFailure: true,
});
```

## Notes

- `pi-copy` validates that the printed path exists and is a regular file before
  pasting it.
- `pi-copy` does not validate image signatures; `pi-paster` validates and
  attaches supported PNG, JPEG, GIF, and WebP files.
- The bridge command must create the file on the same host where Pi is running.

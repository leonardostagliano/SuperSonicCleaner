# Optional Codex analysis

The AI panel adds advisory review priorities to completed cleaner, large-file,
duplicate and disk results. It is off by default and requires an explicit click
to send each analysis. It never changes the cleanup selection or deletes files.
It uses the existing local Codex login, through Codex App Server; SuperSonicCleaner does not
extract or copy the login credentials. Normal Codex account limits apply.

## Data boundary

Each request samples at most 100 of the largest displayed candidates. The GUI
creates fresh random IDs and retains the ID-to-path mapping only in memory.
Names, paths, scanner IDs, hashes, raw extensions, application names and file
contents are not accepted by the AI request contract. Allowed fields are:

- Temporary item ID and, for duplicates, temporary group ID.
- Broad file type from a fixed enumeration, and byte size.
- Coarse modification/access ages in days, or null when unknown.
- Analysis source from a fixed enumeration.

The main process validates the contract again, including bounds and unknown
fields. A local loopback inference gateway then **rebuilds the complete model
request** from that validated snapshot. It discards the CLI's input, local
instructions, environment context, tools, metadata and conversation history.
Only the rebuilt request is sent to the fixed OpenAI Codex endpoint; redirects
are refused. Login headers are forwarded in memory and never logged.

The request declares an empty tool list and `tool_choice: none`. The gateway
buffers and validates the entire response before giving anything back to Codex.
Tool calls, unknown event types, incomplete responses and unrecognized file IDs
fail closed. The client also disables integrations, hooks and command tools,
and rejects server approval/tool requests. A read-only sandbox or a prompt alone
is **not** the privacy boundary: read-only access would still permit file reads.

Responses are plain text and validated structured recommendations. The GUI
resolves IDs locally to show full paths. Switching views preserves the active
analysis, its results and the local mapping in renderer memory. Turning AI off,
cancelling, replacing scan results or reloading/closing the window discards the
mapping and invalidates pending results. For file scans, SuperSonicCleaner does not persist AI
prompts or recommendations. `store: false`
is set on inference requests; this is not a claim about all provider retention
policies.

## Performance recordings

Diagnostics also offers an optional **Run Codex analysis** action after a recording
has been stopped and saved. It reuses the same Codex sign-in and restricted
inference gateway. Enabling the option checks the connection; only pressing the
analysis button sends measurements. The local analysis remains available as a
separate report.

The renderer sends only the local recording ID and the chosen report language
to the main process. The main process reads the encrypted recording and builds a
new allowlisted numerical snapshot:

- Relative sample times, recording duration and measurement coverage.
- Logical core count and total memory capacity.
- Bounded windows with median and maximum CPU, memory and disk throughput values.
- Optional process CPU and memory measurements with fresh random IDs.

Process names, original PIDs, start dates, machine and CPU model descriptions,
recording titles, notes, paths and file contents are excluded. Missing values
remain missing. The local report retains pointers that let the interface associate
opaque IDs with processes in the original recording; those pointers are never
sent to Codex.

The response separates observations, possible explanations and suggested manual
checks. Evidence must reference available metrics, valid relative times and known
process IDs. A throughput spike alone cannot establish a disk fault, and a short
recording cannot establish a memory leak or prove the cause of a slowdown.

Performance AI jobs survive navigation between views and can be cancelled. The
validated report is saved alongside the recording in encrypted local storage,
separately from the local report, and is included in an explicit JSON export.
Exports are unencrypted and may contain locally collected process names. AI
analysis does not execute suggested checks or change the system.

## Last access is an indication

SuperSonicCleaner captures filesystem access timestamps from metadata already requested by
the scanner. It does not open a file to obtain its access time. For duplicates,
the timestamp is captured before the existing local hashing phase. Directory
access timestamps are omitted because enumeration itself can affect them.

Access timestamps can be unavailable, disabled, delayed or changed by a
background process. They do not establish when a person last opened a file.
The AI receives a coarse age and is instructed not to recommend deletion on
that basis alone. See [Microsoft's file-time documentation](https://learn.microsoft.com/en-us/windows/win32/sysinfo/file-times).

## Compatibility and validation

The reviewed CLI version is **0.157.1**. The connection requires this version's
App Server/configuration capabilities. Unsupported versions or configuration
fail closed; the connection does not fall back to
an unrestricted agent. The gateway accepts only a bounded response protocol, so
future protocol changes can require a compatibility update.

Tests cover metadata-field rejection, pseudonym generation, local name
resolution, request reconstruction, tool-call blocking and response validation.
The connection uses the [official App Server protocol](https://learn.chatgpt.com/docs/app-server)
and [provider configuration](https://learn.chatgpt.com/docs/config-file/config-reference).

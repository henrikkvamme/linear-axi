# linear-axi Command Reference

This file is generated from `commandSpecs`. Run `bun run skill:generate` after changing commands, flags, usage, examples, or command safety guidance.

## capabilities

```text
Usage: linear-axi capabilities
Options:
  --help
Example:
```

## capabilities require

```text
Usage: linear-axi capabilities require [--api-level <integer>] [--capability <name>]...
Options:
  --help
  --api-level <integer>
  --capability <name>
Example:
```

## auth status

```text
Usage: linear-axi auth status
Options:
  --help
Example:
  linear-axi auth status
```

## auth login

```text
Usage: linear-axi auth login [--client-id <id>] [--redirect-uri <url>] [--scope <scopes>] [--actor user|app] [--prompt-consent] [--notify] [--no-open] [--env-file <path>] [--timeout 300]
Options:
  --help
  --client-id <id>
  --redirect-uri <url>
  --scope <scopes>
  --actor user|app
  --prompt-consent
  --notify
  --no-open
  --env-file <path>
  --timeout <seconds>
Example:
  linear-axi auth login
  linear-axi auth login --notify --timeout 300
```

## auth oauth setup

```text
Usage: linear-axi auth oauth setup [--redirect-uri <url>] [--scope <scopes>] [--actor user|app] [--notify]
Options:
  --help
  --notify
  --redirect-uri <url>
  --scope <scopes>
  --actor user|app
Example:
  linear-axi auth oauth setup --notify
```

## auth oauth connect

```text
Usage: linear-axi auth oauth connect [--client-id <id>] [--redirect-uri <url>] [--scope <scopes>] [--actor user|app] [--prompt-consent] [--write-env] [--env-file <path>] [--timeout 300] [--notify]
Options:
  --help
  --client-id <id>
  --redirect-uri <url>
  --scope <scopes>
  --actor user|app
  --prompt-consent
  --notify
  --write-env
  --env-file <path>
  --timeout <seconds>
Example:
  linear-axi auth oauth connect --client-id lin_oauth_app_123 --write-env
```

## attachments list

```text
Usage: linear-axi attachments list --issue <issue-id-or-key> [--after <cursor>] [--limit 100]
Continuation cursors bind to exact attachment membership and order. Restart without --after if the page changed.
Options:
  --help
  --issue <issue> (required)
  --after <cursor>
  --limit <1-100>
Example:
  linear-axi attachments list --issue ENG-123
```

## attachments view

```text
Usage: linear-axi attachments view --id <attachment-id>
Reports metadata and content availability without exposing signed URLs or headers.
Options:
  --help
  --id <id> (required)
Example:
  linear-axi attachments view --id <attachment-id>
```

## attachments download

```text
Usage: linear-axi attachments download --id <attachment-id> --output <path> [--overwrite] [--max-bytes <n>]
Defaults to 1 GiB; --max-bytes accepts 1 through 2147483647. Requires macOS or Linux and an existing non-symlink destination directory. Installs atomically without replacement; existing destinations fail closed, including with --overwrite.
Options:
  --help
  --id <id> (required)
  --output <path> (required)
  --overwrite
  --max-bytes <bytes>
Example:
  linear-axi attachments download --id <attachment-id> --output ./attachment.bin
```

## attachments read

```text
Usage: linear-axi attachments read --id <attachment-id> [--max-bytes <n>] [--full]
Renders UTF-8 text/*, JSON, XML, YAML, TOML, JavaScript, SQL, and SVG with no charset or a UTF-8 charset. Defaults to 32768 bytes; --max-bytes accepts 1 through 1048576 and is mutually exclusive with --full, which selects that ceiling. Other files must be downloaded for inspection.
Options:
  --help
  --id <id> (required)
  --max-bytes <bytes>
  --full
Example:
  linear-axi attachments read --id <attachment-id>
```

## attachments upload

```text
Usage: linear-axi attachments upload --issue <issue-id-or-key> --file <path> [--title <title>] [--subtitle <text>] [--media-type <type>] [--allow-large] --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Requires macOS or Linux and an explicit stable, non-empty, non-symlink regular file. Media type is inferred for txt, md, csv, json, yaml, yml, xml, toml, js, mjs, ts, tsx, html, css, sql, svg, png, jpg, jpeg, gif, webp, pdf, zip, gz, mp4, and mov; --media-type may override it with one supported parameter-free type. Supported types: text/plain, text/markdown, text/csv, application/json, application/yaml, application/xml, application/toml, application/javascript, text/typescript, text/tsx, text/html, text/css, application/sql, image/svg+xml, image/png, image/jpeg, image/gif, image/webp, application/pdf, application/zip, application/gzip, video/mp4, video/quicktime. Defaults to 100 MiB; --allow-large raises the ceiling to 2147483647 bytes. Resumable recovery records live under $XDG_STATE_HOME/linear-axi/uploads or ~/.local/state/linear-axi/uploads. Deprecated base64 creation is excluded.
Options:
  --help
  --issue <issue> (required)
  --file <path> (required)
  --title <title>
  --subtitle <text>
  --media-type <type>
  --allow-large
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi attachments upload --issue ENG-123 --file ./trace.txt --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## teams list

```text
Usage: linear-axi teams list [--limit 50]
Options:
  --help
  --limit <1-100>
Example:
  linear-axi teams list --limit 25
```

## workflow-states list

```text
Usage: linear-axi workflow-states list --team <key-or-id>
Options:
  --help
  --team <team> (required)
Example:
  linear-axi workflow-states list --team ENG
```

## issues list

```text
Usage: linear-axi issues list [--team <key-or-id>] [--label <id-or-name>] [--parent <issue-id-or-key>] [--assignee me|none|<user-uuid>] [--state open|closed] [--after <cursor>] [--limit 20] [--fields <fields>]
Options:
  --help
  --assignee <assignee>
  --team <team>
  --label <label>
  --parent <issue>
  --state <state>
  --after <cursor>
  --limit <1-100>
  --fields <id,identifier,title,state,assignee,parent,labels,updatedAt,url,subIssueSortOrder>
Example:
  linear-axi issues list --team ENG --state open
  linear-axi issues list --assignee me --limit 10
```

## issues view

```text
Usage: linear-axi issues view --id <issue-id-or-key> [--full]
Options:
  --help
  --id <id> (required)
  --full
Example:
  linear-axi issues view --id ENG-123 --full
```

## issues create

```text
Usage: linear-axi issues create --team <key-or-id> --title "..." [--description <text> | --description-file <path|->] [--parent <issue>] [--label <label> | --labels-json '<array>'] [--assignee <selector>] [--delegate <agent>] [--state <id-or-name>] [--priority 0-4] [--due-date YYYY-MM-DD] [--estimate <number>] [--project <selector>] [--cycle <selector>] [--milestone <selector>] [--links-json '<[{url,title}]>'] [--releases-json '<array>'] [--id <uuid-v4> | --if-absent] --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Advanced creation uses one official save_issue mutation after an exact-title preflight. --if-absent makes retries resumable; --id is supported by the native core path.
Options:
  --help
  --team <team> (required)
  --title <title> (required)
  --description <text>
  --description-file <path|->
  --parent <issue>
  --label <label>
  --labels-json <JSON string array>
  --id <id>
  --if-absent
  --assignee <assignee>
  --delegate <value>
  --state <state>
  --priority <value>
  --due-date <value>
  --estimate <value>
  --project <value>
  --cycle <value>
  --milestone <value>
  --links-json <value>
  --releases-json <value>
  --blocks-json <value>
  --blocked-by-json <value>
  --related-to-json <value>
  --duplicate-of <value>
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi issues create --team ENG --title "Fix auth bug" --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## issues assign

```text
Usage: linear-axi issues assign --id <issue-id-or-key> --assignee me|<user-id-email-name-or-display-name> [--replace] --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options:
  --help
  --id <id> (required)
  --assignee <assignee> (required)
  --replace
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi issues assign --id ENG-123 --assignee me --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## issues unassign

```text
Usage: linear-axi issues unassign --id <issue-id-or-key> [--if-assignee me|<user-id-email-name-or-display-name>] --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options:
  --help
  --id <id> (required)
  --if-assignee <assignee>
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi issues unassign --id ENG-123 --if-assignee me --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## issues close

```text
Usage: linear-axi issues close --id <issue-id-or-key> [--state <completed-state-uuid>] --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options:
  --help
  --id <id> (required)
  --state <state>
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi issues close --id ENG-123 --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## issues state

```text
Usage: linear-axi issues state --id <issue-id-or-key> --state <state-id-or-name> --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options:
  --help
  --id <id> (required)
  --state <state> (required)
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi issues state --id ENG-123 --state "In Progress" --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## issues parent set

```text
Usage: linear-axi issues parent set --id <issue-id-or-key> --parent <parent-id-or-key> --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options:
  --help
  --id <id> (required)
  --parent <issue> (required)
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi issues parent set --id ENG-124 --parent ENG-123 --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## issues parent clear

```text
Usage: linear-axi issues parent clear --id <issue-id-or-key> --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options:
  --help
  --id <id> (required)
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi issues parent clear --id ENG-124 --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## issues update

```text
Usage: linear-axi issues update --id <issue> [--title <text>] [--description <text> | --description-file <path|-> --if-updated-at <timestamp>] [--assignee <selector> | --clear-assignee] [--delegate <agent> | --clear-delegate] [--state <id-or-name>] [--priority 0-4] [--due-date YYYY-MM-DD | --clear-due-date] [--estimate <number> | --clear-estimate] [--project <selector> | --clear-project] [--cycle <selector> | --clear-cycle] [--milestone <selector> | --clear-milestone] [--parent <issue> | --clear-parent] [--labels-json '<array>' | --clear-labels] [--links-json '<[{url,title}]>'] [--set-releases-json '<array>' | --add-releases-json '<array>' | --remove-releases-json '<array>'] --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Selected official MCP fields are sent in one save_issue mutation. Due-date and milestone clears use one verified native mutation and may only be combined with each other. Other clear flags pass explicit null or an empty label set. Links are append-only. Description writes require the exact updatedAt emitted by the CLI. Linear has no atomic compare-and-swap; an edit can still race between the final read and write.
Options:
  --help
  --id <id> (required)
  --title <title>
  --description <text>
  --description-file <path|->
  --if-updated-at <YYYY-MM-DDTHH:mm:ss.sssZ>
  --assignee <assignee>
  --clear-assignee
  --delegate <value>
  --clear-delegate
  --state <state>
  --priority <value>
  --due-date <value>
  --clear-due-date
  --estimate <value>
  --clear-estimate
  --project <value>
  --clear-project
  --cycle <value>
  --clear-cycle
  --milestone <value>
  --clear-milestone
  --parent <issue>
  --clear-parent
  --labels-json <JSON string array>
  --clear-labels
  --links-json <value>
  --set-releases-json <value>
  --add-releases-json <value>
  --remove-releases-json <value>
  --blocks-json <value>
  --blocked-by-json <value>
  --related-to-json <value>
  --duplicate-of <value>
  --clear-duplicate
  --remove-blocks-json <value>
  --remove-blocked-by-json <value>
  --remove-related-to-json <value>
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi issues update --id ENG-123 --description-file issue.md --if-updated-at 2026-07-13T12:00:00.000Z --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## labels list

```text
Usage: linear-axi labels list [--workspace | --team <key-or-id>] [--name <exact-name>] [--issue <issue-id-or-key>] [--include-archived] [--after <cursor>] [--limit 100] [--fields <fields>]
Options:
  --help
  --workspace
  --team <team>
  --name <name>
  --issue <issue>
  --include-archived
  --after <cursor>
  --limit <1-100>
  --fields <id,name,scope,color,description,isGroup,parentId,archivedAt>
Example:
  linear-axi labels list --team ENG --name wayfinder:task
  linear-axi labels list --workspace --include-archived --fields id,name,archivedAt
```

## labels create

```text
Usage: linear-axi labels create --name <name> --color <#RRGGBB> (--workspace | --team <key-or-id>) [--description "..."] [--group] [--parent <group-id-or-name>] [--id <uuid-v4>] [--if-absent] --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
--parent creates a child under an existing group. --group creates a label group. Caller UUID and --if-absent provide idempotent retries.
Options:
  --help
  --name <name> (required)
  --color <#RRGGBB> (required)
  --workspace
  --team <team>
  --description <text>
  --id <id>
  --if-absent
  --group
  --parent <group-id-or-name>
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi labels create --team ENG --name wayfinder:task --color '#123456' --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## labels apply

```text
Usage: linear-axi labels apply --issue <issue-id-or-key> --label <id-or-name> --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options:
  --help
  --issue <issue> (required)
  --label <label> (required)
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi labels apply --issue ENG-123 --label wayfinder:task --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## labels add

```text
Usage: linear-axi labels add --issue <issue-id-or-key> --label <id-or-name> --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options:
  --help
  --issue <issue> (required)
  --label <label> (required)
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi labels add --issue ENG-123 --label Bug --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## labels remove

```text
Usage: linear-axi labels remove --issue <issue-id-or-key> --label <id-or-name> --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options:
  --help
  --issue <issue> (required)
  --label <label> (required)
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi labels remove --issue ENG-123 --label Bug --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## labels replace

```text
Usage: linear-axi labels replace --issue <issue-id-or-key> --labels-json '<JSON string array>' --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Replacement is explicit: labels omitted from the JSON array are removed. Use [] to clear all labels.
Options:
  --help
  --issue <issue> (required)
  --labels-json <JSON string array> (required)
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi labels replace --issue ENG-123 --labels-json '["Bug","Urgent"]' --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## relations list

```text
Usage: linear-axi relations list --issue <blocked-issue> --blocked-by [--after <cursor>] [--limit 100]
   or: linear-axi relations list --issue <issue-id-or-key> [--type blocks|related|duplicate|similar] [--direction outgoing|incoming|both] [--after <cursor>] [--limit 100]
--blocked-by lists blockers of --issue by selecting incoming blocks relations. Output names the query as blockedIssue and each counterpart as blockerIssue. Do not combine --blocked-by with --type or --direction.
Options:
  --help
  --issue <issue> (required)
  --blocked-by
  --type <type>
  --direction <direction>
  --after <cursor>
  --limit <1-100>
Example:
  linear-axi relations list --issue ENG-124 --blocked-by
  linear-axi relations list --issue ENG-123 --type blocks --direction outgoing
```

## relations create

```text
Usage: linear-axi relations create --issue <blocked-issue> --blocked-by <blocker-issue> [--id <uuid-v4>] --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
   or: linear-axi relations create --issue <source-issue> --related-issue <target-issue> --type blocks|related|duplicate|similar [--id <uuid-v4>] --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
--blocked-by is the blocker (source); --issue is the blocked issue (target). Do not combine --blocked-by with --related-issue or --type.
For generic --type blocks, --issue is the blocker and --related-issue is the blocked issue. Blocks relations cannot use two references that resolve to the same issue.
Options:
  --help
  --issue <issue> (required)
  --blocked-by <issue>
  --related-issue <issue>
  --type <type>
  --id <id>
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi relations create --issue ENG-124 --blocked-by ENG-123 --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
  linear-axi relations create --issue ENG-123 --related-issue ENG-124 --type blocks --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## relations remove

```text
Usage: linear-axi relations remove --id <relation-id> --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
   or: linear-axi relations remove --issue <blocked-issue> --blocked-by <blocker-issue> --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
   or: linear-axi relations remove --issue <source> --related-issue <target> --type blocks|related|duplicate|similar --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options:
  --help
  --id <id>
  --issue <issue>
  --blocked-by <issue>
  --related-issue <issue>
  --type <type>
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi relations remove --issue ENG-124 --blocked-by ENG-123 --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
  linear-axi relations remove --id <relation-id> --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## comments list

```text
Usage: linear-axi comments list --issue <issue-id-or-key> [--after <cursor>] [--limit 50] [--full]
Options:
  --help
  --issue <issue> (required)
  --after <cursor>
  --limit <1-100>
  --full
Example:
  linear-axi comments list --issue ENG-123 --full
```

## comments create

```text
Usage: linear-axi comments create --issue <issue-id-or-key> (--body "..." | --body-file <path|->) [--id <uuid-v4>] --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options:
  --help
  --issue <issue> (required)
  --body <text>
  --body-file <path|->
  --id <id>
  --expect-workspace <workspace-uuid-or-url-key> (required)
  --expect-team <team-key-or-uuid>
Example:
  linear-axi comments create --issue ENG-123 --body "Implemented in PR." --expect-workspace <workspace-uuid-or-url-key> --expect-team <team-key-or-uuid>
```

## wayfinder frontier

```text
Usage: linear-axi wayfinder frontier --map <issue-id-or-key> [--first 20] [--after <cursor>] [--limit 20]
Each page recomputes current Linear state and does not provide snapshot isolation, so membership or ordering changes can move issues across the cursor. Restart without --after for a fresh frontier. --limit remains an alias for --first.
Options:
  --help
  --map <issue> (required)
  --first <1-100>
  --after <cursor>
  --limit <1-100>
Example:
  linear-axi wayfinder frontier --map ENG-100 --first 20
```

## comments search

```text
Usage: linear-axi comments search
Options (single-use unless marked repeatable):
  --help - Show command help.
  --limit <integer:1..100> (default: 50) - Maximum results to return.
  --after <cursor> - Continue after this pagination cursor.
  --order-by <createdAt|updatedAt> (default: updatedAt) - Sort results by this timestamp.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --issue-id <id> - Issue identifier or ID.
  --project-id <id> - Project ID.
  --initiative-id <id> - Initiative ID.
  --document-id <id> - Set or filter by document id.
  --milestone-id <id> - Set or filter by milestone id.
  --status-update-id <id> - Set or filter by status update id.
  --status-update-type <project|initiative> - Set or filter by status update type.
Example:
  linear-axi comments search --project-id <project-id>
```

## agent-skills list

```text
Usage: linear-axi agent-skills list
Options (single-use unless marked repeatable):
  --help - Show command help.
  --limit <integer:1..100> (default: 50) - Maximum results to return.
  --after <cursor> - Continue after this pagination cursor.
  --order-by <createdAt|updatedAt> (default: updatedAt) - Sort results by this timestamp.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi agent-skills list --limit 50
```

## agent-skills view

```text
Usage: linear-axi agent-skills view --id <id>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --id <id> (required) - Entity ID or documented stable selector.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi agent-skills view --id <skill-id> --full
```

## cycles list

```text
Usage: linear-axi cycles list --team-id <id>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --team-id <id> (required) - Team ID.
  --type <current|previous|next> - Set or filter by type.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi cycles list --team-id <team-id> --type current
```

## documents list

```text
Usage: linear-axi documents list
Options (single-use unless marked repeatable):
  --help - Show command help.
  --limit <integer:1..100> (default: 50) - Maximum results to return.
  --after <cursor> - Continue after this pagination cursor.
  --order-by <createdAt|updatedAt> (default: updatedAt) - Sort results by this timestamp.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --query <query> - Search text or documented entity selector.
  --project-id <id> - Project ID.
  --initiative-id <id> - Initiative ID.
  --team-id <id> - Team ID.
  --creator-id <id> - Set or filter by creator id.
  --created-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --updated-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --include-archived | --no-include-archived (default: false) - Include archived.
Example:
  linear-axi documents list --query roadmap --limit 20
```

## documents view

```text
Usage: linear-axi documents view --id <id>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --id <id> (required) - Entity ID or documented stable selector.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi documents view --id <id-or-slug> --full
```

## documents update

```text
Usage: linear-axi documents update --id <id> --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options (single-use unless marked repeatable):
  --help - Show command help.
  --id <id> (required) - Entity ID or documented stable selector.
  --title <text> - Literal title.
  --content <text> - Markdown content.
  --clear-content (conflicts: --content) - Clear content to an empty string.
  --if-updated-at <YYYY-MM-DDTHH:mm:ss.sssZ> - Require the exact updatedAt from the latest full view before replacing rich text.
  --project <selector> - Project name, slug, or ID.
  --issue <selector> - Issue identifier or ID.
  --initiative <selector> - Initiative name or ID.
  --cycle <selector> - Cycle name, number, or ID.
  --team <selector> - Team name, key, or ID.
  --icon <text> - Icon name or emoji code, not raw Unicode.
  --color <#RRGGBB> - Six-digit hexadecimal color.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --expect-workspace <workspace-uuid-or-url-key> (required) - Fail closed unless the authenticated workspace matches.
  --expect-team <team-key-or-uuid> - Fail closed unless the resolved target team matches.
Safety:
  Rich-text replacements and clears require --if-updated-at from the latest full view. Linear has no atomic compare-and-swap, so a final read/write race remains.
Example:
  linear-axi documents update --id <document-id> --title "New title" --expect-workspace <workspace-uuid-or-url-key>
```

## issues inspect

```text
Usage: linear-axi issues inspect --id <id>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --id <id> (required) - Entity ID or documented stable selector.
  --relations | --no-relations (default: false) - Include relations.
  --customer-needs | --no-customer-needs (default: false) - Include customer needs.
  --releases | --no-releases (default: false) - Include releases.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi issues inspect --id ENG-123 --relations --full
```

## issues search

```text
Usage: linear-axi issues search
Options (single-use unless marked repeatable):
  --help - Show command help.
  --limit <integer:1..100> (default: 50) - Maximum results to return.
  --after <cursor> - Continue after this pagination cursor.
  --order-by <createdAt|updatedAt> (default: updatedAt) - Sort results by this timestamp.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --query <query> - Search text or documented entity selector.
  --team <selector> - Team name, key, or ID.
  --state <selector> - State type, name, or ID.
  --cycle <selector> - Cycle name, number, or ID.
  --label <selector> - Label name or ID.
  --assignee <selector> - User ID, name, email, me, or null where supported.
  --delegate <selector> - Agent name or ID.
  --project <selector> - Project name, slug, or ID.
  --release <selector> - Release ID or slug.
  --priority <integer:0..4> - Priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
  --parent-id <id> - Parent issue identifier or ID.
  --created-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --updated-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --include-archived | --no-include-archived (default: true) - Include archived.
Example:
  linear-axi issues search --team ENG --query auth
```

## projects list

```text
Usage: linear-axi projects list
Options (single-use unless marked repeatable):
  --help - Show command help.
  --limit <integer:1..50> (default: 50) - Maximum results to return.
  --after <cursor> - Continue after this pagination cursor.
  --order-by <createdAt|updatedAt> (default: updatedAt) - Sort results by this timestamp.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --query <query> - Search text or documented entity selector.
  --state <selector> - State type, name, or ID.
  --initiative <selector> - Initiative name or ID.
  --team <selector> - Team name, key, or ID.
  --member <selector> - User ID, name, email, or me.
  --label <selector> - Label name or ID.
  --created-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --updated-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --milestones | --no-milestones (default: false) - Include milestones.
  --members | --no-members (default: false) - Include members.
  --include-archived | --no-include-archived (default: false) - Include archived.
Example:
  linear-axi projects list --team ENG --limit 20
```

## projects view

```text
Usage: linear-axi projects view --query <query>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --query <query> (required) - Search text or documented entity selector.
  --milestones | --no-milestones (default: false) - Include milestones.
  --members | --no-members (default: false) - Include members.
  --resources | --no-resources (default: false) - Include resources.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi projects view --query <id-name-or-slug> --full
```

## projects update

```text
Usage: linear-axi projects update --id <id> --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options (single-use unless marked repeatable):
  --help - Show command help.
  --id <id> (required) - Entity ID or documented stable selector.
  --name <text> - Literal name.
  --icon <text> - Icon name or emoji code, not raw Unicode.
  --color <#RRGGBB> - Six-digit hexadecimal color.
  --summary <text:max-255> - Literal short summary.
  --clear-summary (conflicts: --summary) - Clear summary to an empty string.
  --description <text> - Markdown description.
  --clear-description (conflicts: --description) - Clear description to an empty string.
  --if-updated-at <YYYY-MM-DDTHH:mm:ss.sssZ> - Require the exact updatedAt from the latest full view before replacing rich text.
  --state <selector> - State type, name, or ID.
  --start-date <YYYY-MM-DD> - Set or filter by start date.
  --start-date-resolution <halfYear|month|quarter|year> - Set or filter by start date resolution.
  --target-date <YYYY-MM-DD> - Set or filter by target date.
  --target-date-resolution <halfYear|month|quarter|year> - Set or filter by target date resolution.
  --priority <integer:0..4> - Priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
  --add-teams-json <JSON-string-array> (conflicts: --teams-json) - Add the listed teams.
  --remove-teams-json <JSON-string-array> (conflicts: --teams-json) - Remove the listed teams.
  --teams-json <JSON-string-array> (conflicts: --add-teams-json, --remove-teams-json) - Replace the complete teams set.
  --labels-json <JSON-string-array> - Replace the complete labels set.
  --lead <selector> - User ID, name, email, or me.
  --clear-lead (conflicts: --lead) - Clear lead to null.
  --add-initiatives-json <JSON-string-array> (conflicts: --initiatives-json) - Add the listed initiatives.
  --remove-initiatives-json <JSON-string-array> (conflicts: --initiatives-json) - Remove the listed initiatives.
  --initiatives-json <JSON-string-array> (conflicts: --add-initiatives-json, --remove-initiatives-json) - Replace the complete initiatives set.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --expect-workspace <workspace-uuid-or-url-key> (required) - Fail closed unless the authenticated workspace matches.
  --expect-team <team-key-or-uuid> - Fail closed unless the resolved target team matches.
Safety:
  Rich-text replacements and clears require --if-updated-at from the latest full view. Linear has no atomic compare-and-swap, so a final read/write race remains.
Example:
  linear-axi projects update --id <project-id> --state started --expect-workspace <workspace-uuid-or-url-key>
```

## project-labels list

```text
Usage: linear-axi project-labels list
Options (single-use unless marked repeatable):
  --help - Show command help.
  --limit <integer:1..100> (default: 50) - Maximum results to return.
  --after <cursor> - Continue after this pagination cursor.
  --order-by <createdAt|updatedAt> (default: updatedAt) - Sort results by this timestamp.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --name <text> - Literal name.
Example:
  linear-axi project-labels list --name Platform
```

## release-pipelines list

```text
Usage: linear-axi release-pipelines list
Options (single-use unless marked repeatable):
  --help - Show command help.
  --limit <integer:1..100> (default: 50) - Maximum results to return.
  --after <cursor> - Continue after this pagination cursor.
  --order-by <createdAt|updatedAt> (default: updatedAt) - Sort results by this timestamp.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --query <query> - Search text or documented entity selector.
  --team <selector> - Team name, key, or ID.
  --type <continuous|scheduled> - Set or filter by type.
  --production | --no-production - Filter by is production.
  --stages | --no-stages (default: false) - Include stages.
  --teams | --no-teams (default: false) - Include teams.
  --created-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --updated-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --include-archived | --no-include-archived (default: false) - Include archived.
Example:
  linear-axi release-pipelines list --team ENG
```

## releases list

```text
Usage: linear-axi releases list
Options (single-use unless marked repeatable):
  --help - Show command help.
  --limit <integer:1..100> (default: 50) - Maximum results to return.
  --after <cursor> - Continue after this pagination cursor.
  --order-by <createdAt|updatedAt> (default: updatedAt) - Sort results by this timestamp.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --query <query> - Search text or documented entity selector.
  --pipeline <selector> - Release pipeline name, slug, or ID.
  --stage <selector> - Release stage name, type, or ID.
  --stage-type <planned|started|completed|canceled> - Set or filter by stage type.
  --version <text> - Set or filter by version.
  --has-release-notes | --no-has-release-notes - Filter by whether results have release notes.
  --release-notes | --no-release-notes (default: false) - Include release notes.
  --created-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --updated-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --include-archived | --no-include-archived (default: false) - Include archived.
Example:
  linear-axi releases list --pipeline <pipeline> --limit 20
```

## releases view

```text
Usage: linear-axi releases view --id <id>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --id <id> (required) - Entity ID or documented stable selector.
  --release-notes | --no-release-notes (default: false) - Include release notes.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi releases view --id <id-or-slug> --release-notes
```

## releases update

```text
Usage: linear-axi releases update --id <id> --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options (single-use unless marked repeatable):
  --help - Show command help.
  --id <id> (required) - Entity ID or documented stable selector.
  --name <text> - Literal name.
  --description <text> - Markdown description.
  --clear-description (conflicts: --description) - Clear description to an empty string.
  --if-updated-at <YYYY-MM-DDTHH:mm:ss.sssZ> - Require the exact updatedAt from the latest full view before replacing rich text.
  --version <text> - Set or filter by version.
  --pipeline <selector> - Release pipeline name, slug, or ID.
  --stage <selector> - Release stage name, type, or ID.
  --start-date <YYYY-MM-DD> - Set or filter by start date.
  --clear-start-date (conflicts: --start-date) - Clear start date to null.
  --target-date <YYYY-MM-DD> - Set or filter by target date.
  --clear-target-date (conflicts: --target-date) - Clear target date to null.
  --created-at <YYYY-MM-DDTHH:mm:ss.sssZ> - Filter after this ISO-8601 timestamp or duration.
  --started-at <YYYY-MM-DDTHH:mm:ss.sssZ> - Set or filter by started at.
  --clear-started-at (conflicts: --started-at) - Clear started at to null.
  --completed-at <YYYY-MM-DDTHH:mm:ss.sssZ> - Set or filter by completed at.
  --clear-completed-at (conflicts: --completed-at) - Clear completed at to null.
  --commit-sha <SHA> - Set or filter by commit sha.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --expect-workspace <workspace-uuid-or-url-key> (required) - Fail closed unless the authenticated workspace matches.
  --expect-team <team-key-or-uuid> - Fail closed unless the resolved target team matches.
Safety:
  Rich-text replacements and clears require --if-updated-at from the latest full view. Linear has no atomic compare-and-swap, so a final read/write race remains.
Example:
  linear-axi releases update --id <release-id> --stage shipped --expect-workspace <workspace-uuid-or-url-key>
```

## release-notes list

```text
Usage: linear-axi release-notes list
Options (single-use unless marked repeatable):
  --help - Show command help.
  --limit <integer:1..100> (default: 50) - Maximum results to return.
  --after <cursor> - Continue after this pagination cursor.
  --order-by <createdAt|updatedAt> (default: updatedAt) - Sort results by this timestamp.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --query <query> - Search text or documented entity selector.
  --pipeline <selector> - Release pipeline name, slug, or ID.
  --release <selector> - Release ID or slug.
  --content | --no-content (default: false) - Include content.
  --releases | --no-releases (default: false) - Include releases.
  --created-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --updated-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --include-archived | --no-include-archived (default: false) - Include archived.
Example:
  linear-axi release-notes list --pipeline <pipeline>
```

## release-notes view

```text
Usage: linear-axi release-notes view --id <id>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --id <id> (required) - Entity ID or documented stable selector.
  --releases | --no-releases (default: false) - Include releases.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi release-notes view --id <id-or-slug> --full
```

## release-notes update

```text
Usage: linear-axi release-notes update --id <id> --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options (single-use unless marked repeatable):
  --help - Show command help.
  --id <id> (required) - Entity ID or documented stable selector.
  --pipeline <selector> - Release pipeline name, slug, or ID.
  --title <text> - Literal title.
  --content <text> - Markdown content.
  --clear-content (conflicts: --content) - Clear content to an empty string.
  --if-updated-at <YYYY-MM-DDTHH:mm:ss.sssZ> - Require the exact updatedAt from the latest full view before replacing rich text.
  --releases-json <JSON-string-array> (conflicts: --range-from, --range-to) - Replace the complete releases set.
  --range-from <selector> (conflicts: --releases-json) - First release in the note range.
  --range-to <selector> (conflicts: --releases-json) - Last release in the note range.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --expect-workspace <workspace-uuid-or-url-key> (required) - Fail closed unless the authenticated workspace matches.
  --expect-team <team-key-or-uuid> - Fail closed unless the resolved target team matches.
Safety:
  Rich-text replacements and clears require --if-updated-at from the latest full view. Linear has no atomic compare-and-swap, so a final read/write race remains.
Example:
  linear-axi release-notes update --id <note-id> --title "v2 notes" --expect-workspace <workspace-uuid-or-url-key>
```

## diffs list

```text
Usage: linear-axi diffs list
Options (single-use unless marked repeatable):
  --help - Show command help.
  --limit <integer:1..100> (default: 50) - Maximum results to return.
  --after <cursor> - Continue after this pagination cursor.
  --order-by <createdAt|updatedAt> (default: updatedAt) - Sort results by this timestamp.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --query <query> - Search text or documented entity selector.
  --owner <selector> - Set or filter by owner.
  --repo <text> - Set or filter by repo.
  --status <text> - Set or filter by status.
Example:
  linear-axi diffs list --repo linear-axi --limit 20
```

## diffs view

```text
Usage: linear-axi diffs view --id <id>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --id <id> (required) - Entity ID or documented stable selector.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi diffs view --id <url-or-id> --full
```

## diffs threads

```text
Usage: linear-axi diffs threads --id <id>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --id <id> (required) - Entity ID or documented stable selector.
  --thread-id <id> - Set or filter by thread id.
  --resolved | --no-resolved - Filter by resolved.
  --order-by <createdAt|updatedAt> (default: updatedAt) - Sort threads by this timestamp.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi diffs threads --id <url-or-id>
```

## milestones list

```text
Usage: linear-axi milestones list --project <selector>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --project <selector> (required) - Project name, slug, or ID.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi milestones list --project <project>
```

## milestones view

```text
Usage: linear-axi milestones view --project <selector> --query <query>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --project <selector> (required) - Project name, slug, or ID.
  --query <query> (required) - Search text or documented entity selector.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi milestones view --project <project> --query <id-or-name>
```

## milestones update

```text
Usage: linear-axi milestones update --project <selector> --id <id> --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options (single-use unless marked repeatable):
  --help - Show command help.
  --project <selector> (required) - Project name, slug, or ID.
  --id <id> (required) - Entity ID or documented stable selector.
  --name <text> - Literal name.
  --description <text> - Markdown description.
  --clear-description (conflicts: --description) - Clear description to an empty string.
  --if-updated-at <YYYY-MM-DDTHH:mm:ss.sssZ> - Require the exact updatedAt from the latest full view before replacing rich text.
  --target-date <YYYY-MM-DD> - Set or filter by target date.
  --clear-target-date (conflicts: --target-date) - Clear target date to null.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --expect-workspace <workspace-uuid-or-url-key> (required) - Fail closed unless the authenticated workspace matches.
  --expect-team <team-key-or-uuid> - Fail closed unless the resolved target team matches.
Safety:
  Rich-text replacements and clears require --if-updated-at from the latest full view. Linear has no atomic compare-and-swap, so a final read/write race remains.
Example:
  linear-axi milestones update --project Roadmap --id <milestone-id> --target-date 2026-09-01 --expect-workspace <workspace-uuid-or-url-key>
```

## teams search

```text
Usage: linear-axi teams search
Options (single-use unless marked repeatable):
  --help - Show command help.
  --limit <integer:1..100> (default: 50) - Maximum results to return.
  --after <cursor> - Continue after this pagination cursor.
  --order-by <createdAt|updatedAt> (default: updatedAt) - Sort results by this timestamp.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --query <query> - Search text or documented entity selector.
  --include-archived | --no-include-archived (default: false) - Include archived.
  --created-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --updated-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
Example:
  linear-axi teams search --query Engineering
```

## teams view

```text
Usage: linear-axi teams view --query <query>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --query <query> (required) - Search text or documented entity selector.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi teams view --query <id-key-or-name>
```

## users list

```text
Usage: linear-axi users list
Options (single-use unless marked repeatable):
  --help - Show command help.
  --limit <integer:1..100> (default: 50) - Maximum results to return.
  --after <cursor> - Continue after this pagination cursor.
  --order-by <createdAt|updatedAt> (default: updatedAt) - Sort results by this timestamp.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --query <query> - Search text or documented entity selector.
  --team <selector> - Team name, key, or ID.
Example:
  linear-axi users list --query Alice
```

## users view

```text
Usage: linear-axi users view --query <query>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --query <query> (required) - Search text or documented entity selector.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi users view --query <id-name-or-email>
```

## docs search

```text
Usage: linear-axi docs search --query <query>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --query <query> (required) - Search text or documented entity selector.
  --page <integer:>=0> (default: 0) - Zero-based documentation result page.
Example:
  linear-axi docs search --query "project updates"
```

## status-updates list

```text
Usage: linear-axi status-updates list --type <project|initiative>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --limit <integer:1..100> (default: 50) - Maximum results to return.
  --after <cursor> - Continue after this pagination cursor.
  --order-by <createdAt|updatedAt> (default: updatedAt) - Sort results by this timestamp.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --type <project|initiative> (required) - Set or filter by type.
  --project <selector> - Project name, slug, or ID.
  --initiative <selector> - Initiative name or ID.
  --user <selector> - User ID, name, email, or me.
  --created-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --updated-at <ISO-8601> - Filter after this ISO-8601 timestamp or duration.
  --include-archived | --no-include-archived (default: false) - Include archived.
Example:
  linear-axi status-updates list --type project --project <project>
```

## status-updates view

```text
Usage: linear-axi status-updates view --id <id> --type <project|initiative>
Options (single-use unless marked repeatable):
  --help - Show command help.
  --id <id> (required) - Entity ID or documented stable selector.
  --type <project|initiative> (required) - Set or filter by type.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
Example:
  linear-axi status-updates view --id <update-id> --type project
```

## status-updates update

```text
Usage: linear-axi status-updates update --type <project|initiative> --id <id> --expect-workspace <workspace-uuid-or-url-key> [--expect-team <team-key-or-uuid>]
Options (single-use unless marked repeatable):
  --help - Show command help.
  --type <project|initiative> (required) - Set or filter by type.
  --id <id> (required) - Entity ID or documented stable selector.
  --project <selector> - Project name, slug, or ID.
  --initiative <selector> - Initiative name or ID.
  --body <text> - Markdown body.
  --clear-body (conflicts: --body) - Clear body to an empty string.
  --if-updated-at <YYYY-MM-DDTHH:mm:ss.sssZ> - Require the exact updatedAt from the latest full view before replacing rich text.
  --health <onTrack|atRisk|offTrack> - Set or filter by health.
  --full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.
  --expect-workspace <workspace-uuid-or-url-key> (required) - Fail closed unless the authenticated workspace matches.
  --expect-team <team-key-or-uuid> - Fail closed unless the resolved target team matches.
Safety:
  Rich-text replacements and clears require --if-updated-at from the latest full view. Linear has no atomic compare-and-swap, so a final read/write race remains.
Example:
  linear-axi status-updates update --type project --id <update-id> --health onTrack --expect-workspace <workspace-uuid-or-url-key>
```

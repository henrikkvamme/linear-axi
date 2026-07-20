# linear-axi Command Reference

This file is generated from `commandSpecs`. Run `bun run skill:generate` after changing commands, flags, usage, examples, or command safety guidance.

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
Usage: linear-axi issues create --team <key-or-id> --title "..." [--description <text> | --description-file <path|->] [--parent <issue>] [--label <label> | --labels-json '<array>'] [--assignee <selector>] [--delegate <agent>] [--state <id-or-name>] [--priority 0-4] [--due-date YYYY-MM-DD] [--estimate <number>] [--project <selector>] [--cycle <selector>] [--milestone <selector>] [--links-json '<[{url,title}]>'] [--releases-json '<array>'] [--id <uuid-v4> | --if-absent]
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
Example:
  linear-axi issues create --team ENG --title "Fix auth bug"
```

## issues assign

```text
Usage: linear-axi issues assign --id <issue-id-or-key> --assignee me|<user-id-email-name-or-display-name> [--replace]
Options:
  --help
  --id <id> (required)
  --assignee <assignee> (required)
  --replace
Example:
  linear-axi issues assign --id ENG-123 --assignee me
```

## issues unassign

```text
Usage: linear-axi issues unassign --id <issue-id-or-key> [--if-assignee me|<user-id-email-name-or-display-name>]
Options:
  --help
  --id <id> (required)
  --if-assignee <assignee>
Example:
  linear-axi issues unassign --id ENG-123 --if-assignee me
```

## issues close

```text
Usage: linear-axi issues close --id <issue-id-or-key> [--state <completed-state-uuid>]
Options:
  --help
  --id <id> (required)
  --state <state>
Example:
  linear-axi issues close --id ENG-123
```

## issues state

```text
Usage: linear-axi issues state --id <issue-id-or-key> --state <state-id-or-name>
Options:
  --help
  --id <id> (required)
  --state <state> (required)
Example:
  linear-axi issues state --id ENG-123 --state "In Progress"
```

## issues parent set

```text
Usage: linear-axi issues parent set --id <issue-id-or-key> --parent <parent-id-or-key>
Options:
  --help
  --id <id> (required)
  --parent <issue> (required)
Example:
  linear-axi issues parent set --id ENG-124 --parent ENG-123
```

## issues parent clear

```text
Usage: linear-axi issues parent clear --id <issue-id-or-key>
Options:
  --help
  --id <id> (required)
Example:
  linear-axi issues parent clear --id ENG-124
```

## issues update

```text
Usage: linear-axi issues update --id <issue> [--title <text>] [--description <text> | --description-file <path|-> --if-updated-at <timestamp>] [--assignee <selector> | --clear-assignee] [--delegate <agent> | --clear-delegate] [--state <id-or-name>] [--priority 0-4] [--due-date YYYY-MM-DD | --clear-due-date] [--estimate <number> | --clear-estimate] [--project <selector> | --clear-project] [--cycle <selector> | --clear-cycle] [--milestone <selector> | --clear-milestone] [--parent <issue> | --clear-parent] [--labels-json '<array>' | --clear-labels] [--links-json '<[{url,title}]>'] [--set-releases-json '<array>' | --add-releases-json '<array>' | --remove-releases-json '<array>']
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
Example:
  linear-axi issues update --id ENG-123 --description-file issue.md --if-updated-at 2026-07-13T12:00:00.000Z
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
Usage: linear-axi labels create --name <name> --color <#RRGGBB> (--workspace | --team <key-or-id>) [--description "..."] [--group] [--parent <group-id-or-name>] [--id <uuid-v4>] [--if-absent]
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
  --parent <issue>
Example:
  linear-axi labels create --team ENG --name wayfinder:task --color '#123456'
```

## labels apply

```text
Usage: linear-axi labels apply --issue <issue-id-or-key> --label <id-or-name>
Options:
  --help
  --issue <issue> (required)
  --label <label> (required)
Example:
  linear-axi labels apply --issue ENG-123 --label wayfinder:task
```

## labels add

```text
Usage: linear-axi labels add --issue <issue-id-or-key> --label <id-or-name>
Options:
  --help
  --issue <issue> (required)
  --label <label> (required)
Example:
  linear-axi labels add --issue ENG-123 --label Bug
```

## labels remove

```text
Usage: linear-axi labels remove --issue <issue-id-or-key> --label <id-or-name>
Options:
  --help
  --issue <issue> (required)
  --label <label> (required)
Example:
  linear-axi labels remove --issue ENG-123 --label Bug
```

## labels replace

```text
Usage: linear-axi labels replace --issue <issue-id-or-key> --labels-json '<JSON string array>'
Replacement is explicit: labels omitted from the JSON array are removed. Use [] to clear all labels.
Options:
  --help
  --issue <issue> (required)
  --labels-json <JSON string array> (required)
Example:
  linear-axi labels replace --issue ENG-123 --labels-json '["Bug","Urgent"]'
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
Usage: linear-axi relations create --issue <blocked-issue> --blocked-by <blocker-issue> [--id <uuid-v4>]
   or: linear-axi relations create --issue <source-issue> --related-issue <target-issue> --type blocks|related|duplicate|similar [--id <uuid-v4>]
--blocked-by is the blocker (source); --issue is the blocked issue (target). Do not combine --blocked-by with --related-issue or --type.
For generic --type blocks, --issue is the blocker and --related-issue is the blocked issue. Blocks relations cannot use two references that resolve to the same issue.
Options:
  --help
  --issue <issue> (required)
  --blocked-by <issue>
  --related-issue <issue>
  --type <type>
  --id <id>
Example:
  linear-axi relations create --issue ENG-124 --blocked-by ENG-123
  linear-axi relations create --issue ENG-123 --related-issue ENG-124 --type blocks
```

## relations remove

```text
Usage: linear-axi relations remove --id <relation-id>
   or: linear-axi relations remove --issue <blocked-issue> --blocked-by <blocker-issue>
   or: linear-axi relations remove --issue <source> --related-issue <target> --type blocks|related|duplicate|similar
Options:
  --help
  --id <id>
  --issue <issue>
  --blocked-by <issue>
  --related-issue <issue>
  --type <type>
Example:
  linear-axi relations remove --issue ENG-124 --blocked-by ENG-123
  linear-axi relations remove --id <relation-id>
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
Usage: linear-axi comments create --issue <issue-id-or-key> (--body "..." | --body-file <path|->) [--id <uuid-v4>]
Options:
  --help
  --issue <issue> (required)
  --body <text>
  --body-file <path|->
  --id <id>
Example:
  linear-axi comments create --issue ENG-123 --body "Implemented in PR."
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
Options:
  --help
  --limit <value>
  --after <value>
  --order-by <value>
  --full
  --issue-id <value>
  --project-id <value>
  --initiative-id <value>
  --document-id <value>
  --milestone-id <value>
  --status-update-id <value>
  --status-update-type <value>
Example:
  linear-axi comments search --project-id <project-id>
```

## agent-skills list

```text
Usage: linear-axi agent-skills list
Options:
  --help
  --limit <value>
  --after <value>
  --order-by <value>
  --full
Example:
  linear-axi agent-skills list --limit 50
```

## agent-skills view

```text
Usage: linear-axi agent-skills view --id <value>
Options:
  --help
  --id <value> (required)
  --full
Example:
  linear-axi agent-skills view --id <skill-id> --full
```

## cycles list

```text
Usage: linear-axi cycles list --team-id <value>
Options:
  --help
  --team-id <value> (required)
  --type <value>
  --full
Example:
  linear-axi cycles list --team-id <team-id> --type current
```

## documents list

```text
Usage: linear-axi documents list
Options:
  --help
  --limit <value>
  --after <value>
  --order-by <value>
  --full
  --query <value>
  --project-id <value>
  --initiative-id <value>
  --team-id <value>
  --creator-id <value>
  --created-at <value>
  --updated-at <value>
  --include-archived
  --no-include-archived
Example:
  linear-axi documents list --query roadmap --limit 20
```

## documents view

```text
Usage: linear-axi documents view --id <value>
Options:
  --help
  --id <value> (required)
  --full
Example:
  linear-axi documents view --id <id-or-slug> --full
```

## documents update

```text
Usage: linear-axi documents update --id <value>
Options:
  --help
  --id <value> (required)
  --title <value>
  --content <value>
  --clear-content
  --if-updated-at <value>
  --project <value>
  --issue <value>
  --initiative <value>
  --cycle <value>
  --team <value>
  --icon <value>
  --color <value>
  --full
Safety:
  Rich-text replacements and clears require --if-updated-at from the latest full view. Linear has no atomic compare-and-swap, so a final read/write race remains.
Example:
  linear-axi documents update --id <document-id> --title "New title"
```

## issues inspect

```text
Usage: linear-axi issues inspect --id <value>
Options:
  --help
  --id <value> (required)
  --relations
  --no-relations
  --customer-needs
  --no-customer-needs
  --releases
  --no-releases
  --full
Example:
  linear-axi issues inspect --id ENG-123 --relations --full
```

## issues search

```text
Usage: linear-axi issues search
Options:
  --help
  --limit <value>
  --after <value>
  --order-by <value>
  --full
  --query <value>
  --team <value>
  --state <value>
  --cycle <value>
  --label <value>
  --assignee <value>
  --delegate <value>
  --project <value>
  --release <value>
  --priority <value>
  --parent-id <value>
  --created-at <value>
  --updated-at <value>
  --include-archived
  --no-include-archived
Example:
  linear-axi issues search --team ENG --query auth
```

## projects list

```text
Usage: linear-axi projects list
Options:
  --help
  --limit <value>
  --after <value>
  --order-by <value>
  --full
  --query <value>
  --state <value>
  --initiative <value>
  --team <value>
  --member <value>
  --label <value>
  --created-at <value>
  --updated-at <value>
  --milestones
  --no-milestones
  --members
  --no-members
  --include-archived
  --no-include-archived
Example:
  linear-axi projects list --team ENG --limit 20
```

## projects view

```text
Usage: linear-axi projects view --query <value>
Options:
  --help
  --query <value> (required)
  --milestones
  --no-milestones
  --members
  --no-members
  --resources
  --no-resources
  --full
Example:
  linear-axi projects view --query <id-name-or-slug> --full
```

## projects update

```text
Usage: linear-axi projects update --id <value>
Options:
  --help
  --id <value> (required)
  --name <value>
  --icon <value>
  --color <value>
  --summary <value>
  --clear-summary
  --description <value>
  --clear-description
  --if-updated-at <value>
  --state <value>
  --start-date <value>
  --start-date-resolution <value>
  --target-date <value>
  --target-date-resolution <value>
  --priority <value>
  --add-teams-json <value>
  --remove-teams-json <value>
  --teams-json <value>
  --labels-json <value>
  --lead <value>
  --clear-lead
  --add-initiatives-json <value>
  --remove-initiatives-json <value>
  --initiatives-json <value>
  --full
Safety:
  Rich-text replacements and clears require --if-updated-at from the latest full view. Linear has no atomic compare-and-swap, so a final read/write race remains.
Example:
  linear-axi projects update --id <project-id> --state started
```

## project-labels list

```text
Usage: linear-axi project-labels list
Options:
  --help
  --limit <value>
  --after <value>
  --order-by <value>
  --full
  --name <value>
Example:
  linear-axi project-labels list --name Platform
```

## release-pipelines list

```text
Usage: linear-axi release-pipelines list
Options:
  --help
  --limit <value>
  --after <value>
  --order-by <value>
  --full
  --query <value>
  --team <value>
  --type <value>
  --production
  --no-production
  --stages
  --no-stages
  --teams
  --no-teams
  --created-at <value>
  --updated-at <value>
  --include-archived
  --no-include-archived
Example:
  linear-axi release-pipelines list --team ENG
```

## releases list

```text
Usage: linear-axi releases list
Options:
  --help
  --limit <value>
  --after <value>
  --order-by <value>
  --full
  --query <value>
  --pipeline <value>
  --stage <value>
  --stage-type <value>
  --version <value>
  --has-release-notes
  --no-has-release-notes
  --release-notes
  --no-release-notes
  --created-at <value>
  --updated-at <value>
  --include-archived
  --no-include-archived
Example:
  linear-axi releases list --pipeline <pipeline> --limit 20
```

## releases view

```text
Usage: linear-axi releases view --id <value>
Options:
  --help
  --id <value> (required)
  --release-notes
  --no-release-notes
  --full
Example:
  linear-axi releases view --id <id-or-slug> --release-notes
```

## releases update

```text
Usage: linear-axi releases update --id <value>
Options:
  --help
  --id <value> (required)
  --name <value>
  --description <value>
  --clear-description
  --if-updated-at <value>
  --version <value>
  --pipeline <value>
  --stage <value>
  --start-date <value>
  --clear-start-date
  --target-date <value>
  --clear-target-date
  --created-at <value>
  --started-at <value>
  --clear-started-at
  --completed-at <value>
  --clear-completed-at
  --commit-sha <value>
  --full
Safety:
  Rich-text replacements and clears require --if-updated-at from the latest full view. Linear has no atomic compare-and-swap, so a final read/write race remains.
Example:
  linear-axi releases update --id <release-id> --stage shipped
```

## release-notes list

```text
Usage: linear-axi release-notes list
Options:
  --help
  --limit <value>
  --after <value>
  --order-by <value>
  --full
  --query <value>
  --pipeline <value>
  --release <value>
  --content
  --no-content
  --releases
  --no-releases
  --created-at <value>
  --updated-at <value>
  --include-archived
  --no-include-archived
Example:
  linear-axi release-notes list --pipeline <pipeline>
```

## release-notes view

```text
Usage: linear-axi release-notes view --id <value>
Options:
  --help
  --id <value> (required)
  --releases
  --no-releases
  --full
Example:
  linear-axi release-notes view --id <id-or-slug> --full
```

## release-notes update

```text
Usage: linear-axi release-notes update --id <value>
Options:
  --help
  --id <value> (required)
  --pipeline <value>
  --title <value>
  --content <value>
  --clear-content
  --if-updated-at <value>
  --releases-json <value>
  --range-from <value>
  --range-to <value>
  --full
Safety:
  Rich-text replacements and clears require --if-updated-at from the latest full view. Linear has no atomic compare-and-swap, so a final read/write race remains.
Example:
  linear-axi release-notes update --id <note-id> --title "v2 notes"
```

## diffs list

```text
Usage: linear-axi diffs list
Options:
  --help
  --limit <value>
  --after <value>
  --order-by <value>
  --full
  --query <value>
  --owner <value>
  --repo <value>
  --status <value>
Example:
  linear-axi diffs list --repo linear-axi --limit 20
```

## diffs view

```text
Usage: linear-axi diffs view --id <value>
Options:
  --help
  --id <value> (required)
  --full
Example:
  linear-axi diffs view --id <url-or-id> --full
```

## diffs threads

```text
Usage: linear-axi diffs threads --id <value>
Options:
  --help
  --id <value> (required)
  --thread-id <value>
  --resolved
  --no-resolved
  --order-by <value>
  --full
Example:
  linear-axi diffs threads --id <url-or-id>
```

## milestones list

```text
Usage: linear-axi milestones list --project <value>
Options:
  --help
  --project <value> (required)
  --full
Example:
  linear-axi milestones list --project <project>
```

## milestones view

```text
Usage: linear-axi milestones view --project <value> --query <value>
Options:
  --help
  --project <value> (required)
  --query <value> (required)
  --full
Example:
  linear-axi milestones view --project <project> --query <id-or-name>
```

## milestones update

```text
Usage: linear-axi milestones update --project <value> --id <value>
Options:
  --help
  --project <value> (required)
  --id <value> (required)
  --name <value>
  --description <value>
  --clear-description
  --if-updated-at <value>
  --target-date <value>
  --clear-target-date
  --full
Safety:
  Rich-text replacements and clears require --if-updated-at from the latest full view. Linear has no atomic compare-and-swap, so a final read/write race remains.
Example:
  linear-axi milestones update --project Roadmap --id <milestone-id> --target-date 2026-09-01
```

## teams search

```text
Usage: linear-axi teams search
Options:
  --help
  --limit <value>
  --after <value>
  --order-by <value>
  --full
  --query <value>
  --include-archived
  --no-include-archived
  --created-at <value>
  --updated-at <value>
Example:
  linear-axi teams search --query Engineering
```

## teams view

```text
Usage: linear-axi teams view --query <value>
Options:
  --help
  --query <value> (required)
  --full
Example:
  linear-axi teams view --query <id-key-or-name>
```

## users list

```text
Usage: linear-axi users list
Options:
  --help
  --limit <value>
  --after <value>
  --order-by <value>
  --full
  --query <value>
  --team <value>
Example:
  linear-axi users list --query Alice
```

## users view

```text
Usage: linear-axi users view --query <value>
Options:
  --help
  --query <value> (required)
  --full
Example:
  linear-axi users view --query <id-name-or-email>
```

## docs search

```text
Usage: linear-axi docs search --query <value>
Options:
  --help
  --query <value> (required)
  --page <value>
Example:
  linear-axi docs search --query "project updates"
```

## status-updates list

```text
Usage: linear-axi status-updates list --type <value>
Options:
  --help
  --limit <value>
  --after <value>
  --order-by <value>
  --full
  --type <value> (required)
  --project <value>
  --initiative <value>
  --user <value>
  --created-at <value>
  --updated-at <value>
  --include-archived
  --no-include-archived
Example:
  linear-axi status-updates list --type project --project <project>
```

## status-updates view

```text
Usage: linear-axi status-updates view --id <value> --type <value>
Options:
  --help
  --id <value> (required)
  --type <value> (required)
  --full
Example:
  linear-axi status-updates view --id <update-id> --type project
```

## status-updates update

```text
Usage: linear-axi status-updates update --type <value> --id <value>
Options:
  --help
  --type <value> (required)
  --id <value> (required)
  --project <value>
  --initiative <value>
  --body <value>
  --clear-body
  --if-updated-at <value>
  --health <value>
  --full
Safety:
  Rich-text replacements and clears require --if-updated-at from the latest full view. Linear has no atomic compare-and-swap, so a final read/write race remains.
Example:
  linear-axi status-updates update --type project --id <update-id> --health onTrack
```

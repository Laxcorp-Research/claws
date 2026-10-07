# Security

## Reporting

Email security@buildclaws.ai with a description, the version or commit, and the impact. Give us a reasonable window before any public write-up.

support@buildclaws.ai has no MX record as of 2026-10-07. Do not use it for vulnerability reports until mail is configured.

## Secrets

Never commit `.env`, tokens, or database URLs. CI on pull requests from forks does not receive repository secrets. The quality and unit-test jobs still run.

`ENCRYPTION_MASTER_KEY` rotation uses `ENCRYPTION_MASTER_KEY_PREVIOUS`: set the previous key first, deploy, then let reads re-encrypt. Do not swap the master key in one step.

## Scope

The hosted service and a self-host install share this codebase. A report about either is in scope.

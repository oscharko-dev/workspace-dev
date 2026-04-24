# Azure AI Foundry

This directory contains a minimal OpenTofu configuration for an Azure AI Foundry account, project, and `gpt-oss-120b` deployment.

## State

Remote state is stored in Azure Blob Storage with the `azurerm` backend:

- Storage account: `stworkspacedevtfstate`
- Container: `tfstate`
- Key: `foundry/workspacedev.tfstate`
- Auth: Microsoft Entra ID / RBAC via `use_azuread_auth = true`

Local state was migrated to this backend with `tofu init -migrate-state -force-copy`.

Bootstrap, recovery, and import follow the same remote backend:

```bash
tofu -chdir=infra/foundry init -migrate-state -force-copy
tofu -chdir=infra/foundry import <address> <resource_id>
```

Keep the remote blob as the source of truth unless you are intentionally resetting state.

## Defaults

- Subscription: `870027b0-5da9-473a-b238-a20b45a09a8b`
- Location: `swedencentral`
- Resource group: `rg-workspacedev-foundry-swc-001`
- Deployment capacity: `10`

The subscription default intentionally targets the WorkspaceDev subscription and must be overridden for forks or reuse.

The Foundry account and custom subdomain get a random suffix to keep the names globally unique.

## Access Boundary

Public network access is intentionally enabled for this dev Foundry endpoint. The auth boundary is Entra ID / RBAC, with local auth disabled. Private endpoint and VNet isolation are the hardening path for production.

## Capacity

`GlobalStandard` capacity defaults to `10`, which matches the current state and keeps the default plan a no-op after migration. Capacity consumes quota and can incur cost while the deployment exists. Use `tofu destroy` to clean up and release it.

## Workflow

```bash
tofu -chdir=infra/foundry fmt
tofu -chdir=infra/foundry init
tofu -chdir=infra/foundry validate
tofu -chdir=infra/foundry plan -out=tfplan
tofu -chdir=infra/foundry apply tfplan
```

Do not commit `tfplan`, state files, or local overrides. The module `.gitignore` excludes `tfplan`.

## Azure verification

After apply, verify the resources with Azure CLI:

```bash
az resource show --ids "$(tofu -chdir=infra/foundry output -raw foundry_account_id)" --api-version 2025-09-01 -o jsonc
az resource show --ids "$(tofu -chdir=infra/foundry output -raw foundry_project_id)" --api-version 2025-06-01 -o jsonc
az resource show --ids "$(tofu -chdir=infra/foundry output -raw deployment_id)" --api-version 2025-09-01 -o jsonc
```

If you want quick endpoint checks, you can query the project or OpenAI endpoints directly:

```bash
tofu -chdir=infra/foundry output -raw foundry_project_endpoint
tofu -chdir=infra/foundry output -raw foundry_openai_endpoint
```

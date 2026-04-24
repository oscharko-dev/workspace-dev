resource "random_string" "suffix" {
  length  = 8
  lower   = true
  numeric = true
  special = false
  upper   = false
}

locals {
  name_suffix             = random_string.suffix.result
  foundry_account_name    = "workspacedevfoundry${local.name_suffix}"
  custom_subdomain        = local.foundry_account_name
  foundry_project_name    = "WorkspaceDev"
  foundry_project_display = "WorkspaceDev"
  foundry_project_desc    = "WorkspaceDev Azure AI Foundry project"
  deployment_name         = "gpt-oss-120b"
}

resource "azurerm_resource_group" "foundry" {
  name     = var.resource_group_name
  location = var.location
}

resource "azapi_resource" "foundry_account" {
  type      = "Microsoft.CognitiveServices/accounts@2025-06-01"
  name      = local.foundry_account_name
  parent_id = azurerm_resource_group.foundry.id
  location  = var.location

  schema_validation_enabled = false

  identity {
    type = "SystemAssigned"
  }

  body = {
    kind = "AIServices"
    properties = {
      allowProjectManagement        = true
      customSubDomainName           = local.custom_subdomain
      disableLocalAuth              = true
      dynamicThrottlingEnabled      = false
      publicNetworkAccess           = "Enabled"
      restrictOutboundNetworkAccess = false
    }
    sku = {
      name = "S0"
    }
  }
}

resource "azapi_resource" "project" {
  type      = "Microsoft.CognitiveServices/accounts/projects@2025-06-01"
  name      = local.foundry_project_name
  parent_id = azapi_resource.foundry_account.id
  location  = var.location

  schema_validation_enabled = false

  identity {
    type = "SystemAssigned"
  }

  body = {
    properties = {
      displayName = local.foundry_project_display
      description = local.foundry_project_desc
    }
  }
}

resource "azapi_resource" "deployment" {
  type      = "Microsoft.CognitiveServices/accounts/deployments@2025-09-01"
  name      = local.deployment_name
  parent_id = azapi_resource.foundry_account.id

  depends_on = [
    azapi_resource.project,
  ]

  schema_validation_enabled = false

  body = {
    properties = {
      model = {
        format  = "OpenAI-OSS"
        name    = "gpt-oss-120b"
        version = "1"
      }
    }
    sku = {
      capacity = var.deployment_capacity
      name     = "GlobalStandard"
    }
  }
}

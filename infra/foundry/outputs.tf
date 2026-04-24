output "resource_group_name" {
  description = "Resource group name."
  value       = azurerm_resource_group.foundry.name
}

output "foundry_account_name" {
  description = "Foundry account name."
  value       = azapi_resource.foundry_account.name
}

output "foundry_account_id" {
  description = "Foundry account resource ID."
  value       = azapi_resource.foundry_account.id
}

output "foundry_project_endpoint" {
  description = "Foundry project endpoint."
  value       = "https://${azapi_resource.foundry_account.name}.services.ai.azure.com/api/projects/${azapi_resource.project.name}"
}

output "foundry_openai_endpoint" {
  description = "Foundry OpenAI endpoint."
  value       = "https://${azapi_resource.foundry_account.name}.services.ai.azure.com/openai/v1/"
}

output "foundry_project_name" {
  description = "Foundry project name."
  value       = azapi_resource.project.name
}

output "foundry_project_id" {
  description = "Foundry project resource ID."
  value       = azapi_resource.project.id
}

output "deployment_name" {
  description = "Model deployment name."
  value       = azapi_resource.deployment.name
}

output "deployment_id" {
  description = "Model deployment resource ID."
  value       = azapi_resource.deployment.id
}

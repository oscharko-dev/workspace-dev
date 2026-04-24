variable "subscription_id" {
  description = "Azure subscription ID used for the Foundry resources."
  type        = string
  default     = "870027b0-5da9-473a-b238-a20b45a09a8b"

  validation {
    condition     = can(regex("^[0-9a-fA-F-]{36}$", var.subscription_id))
    error_message = "subscription_id must be a valid UUID."
  }
}

variable "location" {
  description = "Azure region for the Foundry resources."
  type        = string
  default     = "swedencentral"
}

variable "resource_group_name" {
  description = "Resource group for the Foundry stack."
  type        = string
  default     = "rg-workspacedev-foundry-swc-001"
}

variable "deployment_capacity" {
  description = "Capacity for the gpt-oss-120b GlobalStandard deployment."
  type        = number
  default     = 10

  validation {
    condition     = var.deployment_capacity >= 1 && var.deployment_capacity == floor(var.deployment_capacity)
    error_message = "deployment_capacity must be a positive whole number."
  }
}

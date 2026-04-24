terraform {
  backend "azurerm" {
    resource_group_name  = "rg-workspacedev-tfstate-swc-001"
    storage_account_name = "stworkspacedevtfstate"
    container_name       = "tfstate"
    key                  = "foundry/workspacedev.tfstate"
    subscription_id      = "870027b0-5da9-473a-b238-a20b45a09a8b"
    use_azuread_auth     = true
  }
}

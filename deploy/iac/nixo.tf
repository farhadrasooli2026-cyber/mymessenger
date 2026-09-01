# Skeleton only. Fill backend/provider locally. Never commit access keys.
terraform {
  required_version = ">= 1.5"
}

variable "env" {
  type    = string
  default = "staging"
  validation {
    condition     = contains(["staging", "production"], var.env)
    error_message = "Use staging or production; development stays local."
  }
}

variable "min_api" { type = number default = 2 }
variable "max_api" { type = number default = 12 }

# Example contract — implement with your cloud provider modules:
# - private subnets for database and object storage
# - public edge (WAF/DDoS) only
# - IAM least privilege per service identity
# - secrets from a vault, not tfvars in git
output "contract" {
  value = {
    env             = var.env
    min_api         = var.min_api
    max_api         = var.max_api
    private_db      = true
    object_storage  = true
    cdn             = true
    multi_az        = true
    secrets_in_git  = false
  }
}
